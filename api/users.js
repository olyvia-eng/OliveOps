import {
  createAuthUserForBusiness,
  deleteBusinessUser,
  getBusinessUserById,
  listUsersForBusiness,
  updateBusinessUser,
} from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function normalizeRoleInput(role) {
  if (role === 'employee') return 'crew_member';
  return role;
}

function buildUserPatch(existing, data) {
  const next = {
    id: existing.id,
    businessId: existing.businessId,
    name: existing.name,
    firstName: existing.firstName,
    lastName: existing.lastName,
    email: existing.email,
    role: existing.role,
    active: existing.active,
    createdAt: existing.createdAt,
    passwordHash: existing.passwordHash,
    sessionVersion: existing.sessionVersion,
  };

  if (Object.prototype.hasOwnProperty.call(data, 'name')) {
    if (typeof data.name !== 'string' || !data.name.trim()) {
      return { ok: false, error: 'Invalid name.' };
    }
    next.name = data.name.trim();
  }

  const hasStructuredName = Object.prototype.hasOwnProperty.call(data, 'firstName')
    || Object.prototype.hasOwnProperty.call(data, 'lastName');
  if (hasStructuredName) {
    if (typeof data.firstName !== 'string' || !data.firstName.trim() || typeof data.lastName !== 'string' || !data.lastName.trim()) {
      return { ok: false, error: 'First name and last name are required.' };
    }
    next.firstName = data.firstName.trim();
    next.lastName = data.lastName.trim();
    next.name = `${next.firstName} ${next.lastName}`;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'email')) {
    if (typeof data.email !== 'string' || !data.email.trim()) {
      return { ok: false, error: 'Invalid email.' };
    }
    next.email = normalizeEmail(data.email);
  }

  if (Object.prototype.hasOwnProperty.call(data, 'active')) {
    if (typeof data.active !== 'boolean') {
      return { ok: false, error: 'Invalid active flag.' };
    }
    next.active = data.active;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'role')) {
    const normalizedRole = normalizeRoleInput(data.role);
    if (normalizedRole !== 'owner' && normalizedRole !== 'admin' && normalizedRole !== 'foreman' && normalizedRole !== 'crew_member') {
      return { ok: false, error: 'Invalid role.' };
    }
    next.role = normalizedRole;
  }

  return { ok: true, next };
}

function mapCreateUserError(error) {
  const name = error?.name;
  const rawMessage = typeof error?.message === 'string' ? error.message.trim() : '';

  if (name === 'AccessDeniedException') {
    return {
      status: 500,
      message: 'DynamoDB access denied. Check IAM policy for GetItem, PutItem, Query, and TransactWriteItems on this table.',
    };
  }

  if (name === 'ResourceNotFoundException') {
    return {
      status: 500,
      message: 'DynamoDB table not found. Verify DDB_TABLE_NAME and AWS_REGION environment variables.',
    };
  }

  if (name === 'UnrecognizedClientException' || name === 'InvalidSignatureException') {
    return {
      status: 500,
      message: 'Invalid AWS credentials or region configuration.',
    };
  }

  if (name === 'ExpiredTokenException') {
    return {
      status: 500,
      message: 'AWS credentials are expired. Rotate AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in Vercel env vars.',
    };
  }

  if (name === 'ValidationException') {
    return {
      status: 500,
      message: 'DynamoDB validation failed. Verify OliveOpsAuth table key schema uses PK (string) and SK (string).',
    };
  }

  if (name === 'ThrottlingException' || name === 'ProvisionedThroughputExceededException') {
    return {
      status: 503,
      message: 'DynamoDB is throttling requests. Retry shortly or switch table billing to on-demand.',
    };
  }

  return {
    status: 500,
    message: `Could not create user (${name ?? 'UnknownError'}${rawMessage ? `: ${rawMessage}` : ''})`,
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const session = await requireSession(req, res, ['owner', 'admin']);
    if (!session) return;

    try {
      const users = await listUsersForBusiness(session.businessId);
      return res.status(200).json({ ok: true, users });
    } catch {
      return res.status(500).json({ ok: false, error: 'Could not load users' });
    }
  }

  if (req.method === 'POST') {
    const session = await requireSession(req, res, ['owner', 'admin']);
    if (!session) return;

    const { name, firstName, lastName, email, password, role } = req.body ?? {};
    const hasStructuredName = firstName !== undefined || lastName !== undefined;
    if (
      (hasStructuredName
        ? (typeof firstName !== 'string' || typeof lastName !== 'string')
        : typeof name !== 'string') ||
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      (role !== 'admin' && role !== 'foreman' && role !== 'crew_member')
    ) {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    if ((hasStructuredName ? (!firstName.trim() || !lastName.trim()) : !name.trim()) || !email.trim() || password.length < 8) {
      return res.status(400).json({ ok: false, error: 'Invalid user fields' });
    }

    try {
      const result = await createAuthUserForBusiness({
        businessId: session.businessId,
        name,
        firstName,
        lastName,
        email,
        password,
        role,
      });

      if (!result.ok) {
        return res.status(409).json({ ok: false, error: result.error });
      }

      return res.status(200).json({ ok: true, user: result.user, employee: result.employee });
    } catch (error) {
      console.error('POST /api/users failed', {
        name: error?.name,
        message: error?.message,
      });

      const mapped = mapCreateUserError(error);
      return res.status(mapped.status).json({ ok: false, error: mapped.message });
    }
  }

  if (req.method === 'PATCH') {
    const session = await requireSession(req, res, ['owner', 'admin']);
    if (!session) return;

    const userId = req.query.id;
    const { data } = req.body ?? {};
    if (typeof userId !== 'string' || !userId || !data || typeof data !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    try {
      const existing = await getBusinessUserById(session.businessId, userId);
      if (!existing) {
        return res.status(404).json({ ok: false, error: 'User not found' });
      }

      const patch = buildUserPatch(existing, data);
      if (!patch.ok) {
        return res.status(400).json({ ok: false, error: patch.error });
      }

      const next = patch.next;

      if (existing.role === 'owner' && next.role !== 'owner') {
        return res.status(409).json({ ok: false, error: 'Owner role cannot be changed.' });
      }

      if (existing.role !== 'owner' && next.role === 'owner') {
        return res.status(409).json({ ok: false, error: 'Owner role cannot be assigned via this endpoint.' });
      }

      const result = await updateBusinessUser({ businessId: session.businessId, user: next });
      if (!result.ok) {
        return res.status(409).json({ ok: false, error: result.error });
      }

      return res.status(200).json({ ok: true });
    } catch {
      return res.status(500).json({ ok: false, error: 'Could not update user' });
    }
  }

  if (req.method === 'DELETE') {
    const session = await requireSession(req, res, ['owner', 'admin']);
    if (!session) return;

    const userId = req.query.id;
    if (typeof userId !== 'string' || !userId) {
      return res.status(400).json({ ok: false, error: 'Invalid user id' });
    }

    try {
      const result = await deleteBusinessUser(session.businessId, userId);
      if (!result.ok) {
        return res.status(409).json({ ok: false, error: result.error });
      }

      return res.status(200).json({ ok: true });
    } catch {
      return res.status(500).json({ ok: false, error: 'Could not delete user' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
