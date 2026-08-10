import jwt from 'jsonwebtoken';
import { requireEnv } from './env.js';
import { SESSION_COOKIE, parseCookies } from './cookies.js';
import { canReadEntity, canWriteEntity } from './authorization.js';
import { getBusinessUserById, resolveMobileSessionByAccessToken } from './authRepo.js';

const jwtSecret = requireEnv('JWT_SECRET');
export const MOBILE_ACCESS_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function createSessionToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      businessId: user.businessId,
      name: user.name,
      email: user.email,
      role: user.role,
      businessName: user.businessName,
      employeeId: user.employeeId,
    },
    jwtSecret,
    { expiresIn: '7d' }
  );
}

export function getBearerTokenFromRequest(req) {
  const rawHeader = req?.headers?.authorization;
  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof header !== 'string') return null;

  const trimmed = header.trim();
  if (!trimmed) return null;

  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (!match || typeof match[1] !== 'string') return null;

  const token = match[1].trim();
  return token || null;
}

function getSessionFromCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  try {
    const payload = jwt.verify(token, jwtSecret);
    if (!payload || typeof payload !== 'object') return null;

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.businessId !== 'string' ||
      typeof payload.name !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.businessName !== 'string'
    ) {
      return null;
    }

    return {
      id: payload.sub,
      businessId: payload.businessId,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      businessName: payload.businessName,
      employeeId: typeof payload.employeeId === 'string' ? payload.employeeId : undefined,
    };
  } catch {
    return null;
  }
}

async function resolveAuthoritativeUserSession(sessionCandidate) {
  if (!sessionCandidate || typeof sessionCandidate !== 'object') return null;
  if (typeof sessionCandidate.businessId !== 'string' || typeof sessionCandidate.id !== 'string') return null;

  const currentUser = await getBusinessUserById(sessionCandidate.businessId, sessionCandidate.id);
  if (!currentUser || currentUser.active === false) {
    return null;
  }

  return {
    id: currentUser.id,
    businessId: currentUser.businessId,
    name: currentUser.name,
    email: currentUser.email,
    role: currentUser.role,
    businessName: sessionCandidate.businessName,
    employeeId: typeof sessionCandidate.employeeId === 'string' ? sessionCandidate.employeeId : undefined,
  };
}

export async function getSessionFromRequest(req) {
  const bearerToken = getBearerTokenFromRequest(req);
  if (bearerToken) {
    try {
      const bearerSession = await resolveMobileSessionByAccessToken(bearerToken);
      if (!bearerSession.ok) {
        return null;
      }
      return resolveAuthoritativeUserSession(bearerSession.session.user);
    } catch {
      return null;
    }
  }

  try {
    const cookieSession = getSessionFromCookie(req);
    return await resolveAuthoritativeUserSession(cookieSession);
  } catch {
    return null;
  }
}

export async function requireSession(req, res, allowedRoles, entity) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return null;
  }

  const normalizedRole = session.role === 'employee' ? 'crew_member' : session.role;
  const isAllowedRole = !Array.isArray(allowedRoles) || allowedRoles.includes(normalizedRole);
  if (!isAllowedRole) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return null;
  }

  if (entity) {
    const readAllowed = canReadEntity(entity, normalizedRole);
    const writeAllowed = canWriteEntity(entity, normalizedRole);
    const method = req.method === 'GET' ? readAllowed : writeAllowed;
    if (!method) {
      res.status(403).json({ ok: false, error: 'Forbidden' });
      return null;
    }
  }

  return session;
}
