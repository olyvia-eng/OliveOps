import { authenticateUser, createBusinessWithOwner, getActiveBusinessUserByEmail } from './_lib/authRepo.js';
import { buildClearedSessionCookie, buildSessionCookie } from './_lib/cookies.js';
import {
  createSessionToken,
  getSessionFromRequest,
  getBearerTokenFromRequest,
  MOBILE_ACCESS_TOKEN_TTL_SECONDS,
} from './_lib/session.js';
import {
  createMobileSessionForUser,
  getEmployeeForBusiness,
  revokeMobileSessionByAccessToken,
} from './_lib/authRepo.js';
import { createHash, randomBytes } from 'node:crypto';
import { checkRateLimit } from './_lib/rateLimit.js';
import { createPasswordReset, resetPasswordWithToken } from './_lib/passwordResetRepo.js';
import { authMailer } from './_lib/authEmails.js';

function createMobileAccessToken() {
  return `oliveops_mobile_${randomBytes(32).toString('base64url')}`;
}

const defaultDeps = {
  authenticateUser,
  createBusinessWithOwner,
  createSessionToken,
  getSessionFromRequest,
  getBearerTokenFromRequest,
  createMobileSessionForUser,
  getEmployeeForBusiness,
  revokeMobileSessionByAccessToken,
  buildSessionCookie,
  buildClearedSessionCookie,
  createMobileAccessToken,
  checkRateLimit,
  getActiveBusinessUserByEmail,
  createPasswordReset,
  resetPasswordWithToken,
  sendPasswordResetEmail: authMailer.sendPasswordReset,
  sendPasswordChangedEmail: authMailer.sendPasswordChanged,
  mobileAccessTokenTtlSeconds: MOBILE_ACCESS_TOKEN_TTL_SECONDS,
};

const AUTH_INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';
const FORGOT_PASSWORD_MESSAGE = 'If an account exists for that email address, we’ve sent password reset instructions.';

function normalizeIdentifier(value) {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  return normalized || 'unknown';
}

function hashIdentifier(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : '').digest('hex');
}

async function enforceRateLimit({ req, res, deps, action, subject, maxAttempts, windowSeconds }) {
  const decision = await deps.checkRateLimit({
    req,
    action,
    subject,
    maxAttempts,
    windowSeconds,
  });

  if (!decision.allowed) {
    res.setHeader('Retry-After', String(decision.retryAfterSeconds));
    return res.status(429).json({
      ok: false,
      error: 'Too many requests. Please try again later.',
    });
  }

  return null;
}

async function resolveCapabilitiesForUser(user, getEmployeeForBusinessFn) {
  const employeeId = typeof user?.employeeId === 'string' ? user.employeeId : '';
  if (!employeeId || typeof user?.businessId !== 'string') {
    return { paidDriveTime: false };
  }

  try {
    const employee = await getEmployeeForBusinessFn(user.businessId, employeeId);
    return {
      paidDriveTime: Boolean(employee),
    };
  } catch {
    return { paidDriveTime: false };
  }
}

export function createAuthHandler(overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };

  return async function handler(req, res) {
    const action = req.query.action;

    if (action === 'session') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
      }

      const session = await deps.getSessionFromRequest(req);
      if (!session) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }

      const capabilities = await resolveCapabilitiesForUser(session, deps.getEmployeeForBusiness);

      return res.status(200).json({ ok: true, user: session, capabilities });
    }

    if (action === 'logout') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
      }

      const bearerToken = deps.getBearerTokenFromRequest(req);
      if (bearerToken) {
        try {
          await deps.revokeMobileSessionByAccessToken(bearerToken);
        } catch {
          return res.status(500).json({ ok: false, error: 'Logout failed' });
        }
      }

      res.setHeader('Set-Cookie', deps.buildClearedSessionCookie());
      return res.status(200).json({ ok: true });
    }

    if (action === 'login') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
      }

      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ ok: false, error: 'Invalid payload' });
      }

      const limited = await enforceRateLimit({
        req,
        res,
        deps,
        action: 'login',
        subject: normalizeIdentifier(email),
        maxAttempts: 8,
        windowSeconds: 15 * 60,
      });
      if (limited) {
        return limited;
      }

      try {
        const result = await deps.authenticateUser(email, password);
        if (!result.ok) {
          return res.status(401).json({ ok: false, error: AUTH_INVALID_CREDENTIALS_MESSAGE });
        }

        const token = deps.createSessionToken(result.user);
        res.setHeader('Set-Cookie', deps.buildSessionCookie(token));
        return res.status(200).json({ ok: true, user: result.user });
      } catch {
        return res.status(500).json({ ok: false, error: 'Login failed' });
      }
    }

    if (action === 'mobile-login') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
      }

      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ ok: false, error: 'Invalid payload' });
      }

      const limited = await enforceRateLimit({
        req,
        res,
        deps,
        action: 'mobile-login',
        subject: normalizeIdentifier(email),
        maxAttempts: 10,
        windowSeconds: 15 * 60,
      });
      if (limited) {
        return limited;
      }

      try {
        const result = await deps.authenticateUser(email, password);
        if (!result.ok) {
          return res.status(401).json({ ok: false, error: AUTH_INVALID_CREDENTIALS_MESSAGE });
        }

        const accessToken = deps.createMobileAccessToken();
        await deps.createMobileSessionForUser({
          user: result.user,
          accessToken,
          expiresInSeconds: deps.mobileAccessTokenTtlSeconds,
        });

        const capabilities = await resolveCapabilitiesForUser(result.user, deps.getEmployeeForBusiness);

        return res.status(200).json({
          ok: true,
          accessToken,
          tokenType: 'Bearer',
          expiresIn: deps.mobileAccessTokenTtlSeconds,
          user: result.user,
          capabilities,
        });
      } catch {
        return res.status(500).json({ ok: false, error: 'Mobile login failed' });
      }
    }

    if (action === 'forgot-password') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
      }

      const { email } = req.body ?? {};
      if (typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ ok: false, error: 'Invalid payload' });
      }

      const normalizedEmail = normalizeIdentifier(email);
      const accountLimit = await enforceRateLimit({
        req, res, deps, action: 'forgot-password', subject: normalizedEmail,
        maxAttempts: 3, windowSeconds: 60 * 60,
      });
      if (accountLimit) return accountLimit;

      const ipLimit = await enforceRateLimit({
        req, res, deps, action: 'forgot-password-ip', subject: 'all-accounts',
        maxAttempts: 20, windowSeconds: 60 * 60,
      });
      if (ipLimit) return ipLimit;

      try {
        const user = await deps.getActiveBusinessUserByEmail(normalizedEmail);
        if (user) {
          const reset = await deps.createPasswordReset({ user, email: normalizedEmail });
          await deps.sendPasswordResetEmail({ email: normalizedEmail, token: reset.token });
        }
      } catch {
        // The public response must not reveal account, storage, or delivery state.
      }

      return res.status(200).json({ ok: true, message: FORGOT_PASSWORD_MESSAGE });
    }

    if (action === 'reset-password') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
      }

      const { token, password } = req.body ?? {};
      if (typeof token !== 'string' || !token.trim() || typeof password !== 'string') {
        return res.status(400).json({ ok: false, error: 'Invalid payload' });
      }
      if (password.length < 8) {
        return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters.' });
      }

      const limited = await enforceRateLimit({
        req, res, deps, action: 'reset-password', subject: hashIdentifier(token.trim()),
        maxAttempts: 10, windowSeconds: 15 * 60,
      });
      if (limited) return limited;

      const ipLimited = await enforceRateLimit({
        req, res, deps, action: 'reset-password-ip', subject: 'all-tokens',
        maxAttempts: 30, windowSeconds: 15 * 60,
      });
      if (ipLimited) return ipLimited;

      try {
        const result = await deps.resetPasswordWithToken({ token: token.trim(), password });
        if (!result.ok) {
          const errors = {
            expired: 'This password reset link has expired.',
            used: 'This password reset link has already been used.',
            invalid: 'This password reset link is invalid.',
          };
          return res.status(400).json({ ok: false, error: errors[result.reason] ?? errors.invalid });
        }

        try {
          await deps.sendPasswordChangedEmail({ email: result.user.email });
        } catch {
          // The password change is already committed; confirmation delivery is best effort.
        }
        res.setHeader('Set-Cookie', deps.buildClearedSessionCookie());
        return res.status(200).json({ ok: true });
      } catch {
        return res.status(500).json({ ok: false, error: 'Could not reset password. Please try again later.' });
      }
    }

    if (action === 'signup') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
      }

      const { businessName, ownerName, firstName, lastName, email, password } = req.body ?? {};
      const hasStructuredName = firstName !== undefined || lastName !== undefined;
      if (
        typeof businessName !== 'string' ||
        (hasStructuredName
          ? (typeof firstName !== 'string' || typeof lastName !== 'string')
          : typeof ownerName !== 'string') ||
        typeof email !== 'string' ||
        typeof password !== 'string'
      ) {
        return res.status(400).json({ ok: false, error: 'Invalid payload' });
      }

      if (
        !businessName.trim() ||
        (hasStructuredName ? (!firstName.trim() || !lastName.trim()) : !ownerName.trim()) ||
        !email.trim() ||
        password.length < 8
      ) {
        return res.status(400).json({ ok: false, error: 'Invalid signup fields' });
      }

      const limited = await enforceRateLimit({
        req,
        res,
        deps,
        action: 'signup',
        subject: normalizeIdentifier(email),
        maxAttempts: 5,
        windowSeconds: 60 * 60,
      });
      if (limited) {
        return limited;
      }

      try {
        const result = await deps.createBusinessWithOwner({ businessName, ownerName, firstName, lastName, email, password });
        if (!result.ok) {
          return res.status(409).json({ ok: false, error: 'Unable to create account with those details.' });
        }

        const token = deps.createSessionToken(result.user);
        res.setHeader('Set-Cookie', deps.buildSessionCookie(token));
        return res.status(200).json({ ok: true, user: result.user });
      } catch {
        return res.status(500).json({ ok: false, error: 'Signup failed' });
      }
    }

    return res.status(400).json({ ok: false, error: 'Invalid auth action' });
  };
}

export default createAuthHandler();
