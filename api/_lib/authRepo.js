import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { DEFAULT_BUSINESS_TIME_ZONE, normalizeBusinessTimeZone } from './businessTime.js';
import { approvedTimeOffOverlapping } from './timeOff.js';
import { normalizePersistedCustomerStatus } from '../../src/config/customer.js';

function nowIso() {
  return new Date().toISOString();
}

export function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function normalizeNamePart(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSessionVersion(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function getDisplayName(user) {
  const structuredName = [normalizeNamePart(user?.firstName), normalizeNamePart(user?.lastName)]
    .filter(Boolean)
    .join(' ');
  return structuredName || normalizeNamePart(user?.name) || normalizeNamePart(user?.email);
}

function businessPk(businessId) {
  return `BUSINESS#${businessId}`;
}

function userSk(userId) {
  return `USER#${userId}`;
}

function customerSk(customerId) {
  return `CUSTOMER#${customerId}`;
}

function jobSk(jobId) {
  return `JOB#${jobId}`;
}

function jobCounterSk(year) {
  return `JOB_COUNTER#${year}`;
}

function estimateSk(estimateId) {
  return `ESTIMATE#${estimateId}`;
}

function invoiceSk(invoiceId) {
  return `INVOICE#${invoiceId}`;
}

function expenseSk(expenseId) {
  return `EXPENSE#${expenseId}`;
}

function equipmentSk(equipmentId) {
  return `EQUIPMENT#${equipmentId}`;
}

function materialCatalogSk(materialId) {
  return `MATERIAL#${materialId}`;
}

function subcontractorCatalogSk(subcontractorId) {
  return `SUBCONTRACTOR#${subcontractorId}`;
}

function labourClassSk(labourClassId) {
  return `LABOUR_CLASS#${labourClassId}`;
}

function unbillableTimeCategorySk(categoryId) {
  return `UNBILLABLE_CATEGORY#${categoryId}`;
}

function feedbackSk(feedbackId) {
  return `FEEDBACK#${feedbackId}`;
}

function receiptSk(receiptId) {
  return `RECEIPT#${receiptId}`;
}

function fileSk(fileId) {
  return `FILE#${fileId}`;
}

function formSk(formId) {
  return `FORM#${formId}`;
}

function formFieldSk(fieldId) {
  return `FORM_FIELD#${fieldId}`;
}

function formSubmissionSk(submissionId) {
  return `FORM_SUBMISSION#${submissionId}`;
}

function formResponseSk(responseId) {
  return `FORM_RESPONSE#${responseId}`;
}

function formSubmissionIdempotencySk(employeeId, clientSubmissionId) {
  const scopedHash = createHash('sha256').update(`${employeeId}\0${clientSubmissionId}`).digest('hex');
  return `FORM_SUBMISSION_IDEMPOTENCY#${scopedHash}`;
}

function templateSk(templateId) {
  return `TEMPLATE#${templateId}`;
}

function budgetSk(budgetItemId) {
  return `BUDGET#${budgetItemId}`;
}

function budgetMetaSk(budgetId) {
  return `BUDGET_META#${budgetId}`;
}

function budgetDivisionPrefix(budgetId) {
  return `BUDGET_DIVISION#${budgetId}#DIVISION#`;
}

function budgetDivisionSk(budgetId, divisionId) {
  return `${budgetDivisionPrefix(budgetId)}${divisionId}`;
}

function budgetRateSk(rateId) {
  return `BUDGET_RATE#${rateId}`;
}

function labourBudgetPlanSk(labourBudgetPlanId) {
  return `LABOUR_BUDGET#${labourBudgetPlanId}`;
}

export function buildLabourBudgetPlanId(budgetId, employeeId, year) {
  return `${budgetId}-${employeeId}-${year}`;
}

function labourHoursSalesGoalSk(labourHoursSalesGoalId) {
  return `LABOUR_HOURS_GOAL#${labourHoursSalesGoalId}`;
}

function revenueSalesGoalSk(revenueSalesGoalId) {
  return `REVENUE_GOAL#${revenueSalesGoalId}`;
}

function employeeSk(employeeId) {
  return `EMPLOYEE#${employeeId}`;
}

function timeEntrySk(entryId) {
  return `TIME#${entryId}`;
}

function timeCorrectionSk(correctionId) {
  return `TIME_CORRECTION#${correctionId}`;
}

function timeOffRequestSk(requestId) {
  return `TIME_OFF_REQUEST#${requestId}`;
}

function timeOffIdempotencySk(employeeId, idempotencyKey) {
  const scopedHash = createHash('sha256').update(`${employeeId}\0${idempotencyKey}`).digest('hex');
  return `TIME_OFF_IDEMPOTENCY#${scopedHash}`;
}

function auditEventSk(eventId) {
  return `AUDIT#${eventId}`;
}

function taskSk(taskId) {
  return `TASK#${taskId}`;
}

function jobTaskHeadingSk(headingId) {
  return `JOB_TASK_HEADING#${headingId}`;
}

function emailPk(email) {
  return `EMAIL#${normalizeEmail(email)}`;
}

function mobileSessionTokenPk(tokenHash) {
  return `MOBILE_SESSION_TOKEN#${tokenHash}`;
}

function mobileSessionTokenHash(accessToken) {
  return createHash('sha256').update(accessToken).digest('hex');
}

function buildMobileSessionFromItem(item) {
  if (!item) return null;
  return {
    id: item.userId,
    businessId: item.businessId,
    name: getDisplayName(item),
    firstName: normalizeNamePart(item.firstName) || undefined,
    lastName: normalizeNamePart(item.lastName) || undefined,
    email: item.email,
    role: normalizeBusinessRole(item.role),
    businessName: item.businessName,
    employeeId: typeof item.employeeId === 'string' ? item.employeeId : undefined,
    sessionVersion: normalizeSessionVersion(item.sessionVersion),
  };
}

function isSessionExpired(expiresAt, nowMs = Date.now()) {
  if (typeof expiresAt !== 'string') return true;
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) return true;
  return expiresAtMs <= nowMs;
}
function normalizeBusinessRole(role) {
  if (role === 'employee') return 'crew_member';
  return role;
}

function normalizeEmployeeRole(role) {
  if (role === 'worker' || role === 'subcontractor') return 'crew_member';
  return role;
}

function mapSessionUser(userItem, businessItem, employeeId) {
  return {
    id: userItem.userId,
    businessId: userItem.businessId,
    name: getDisplayName(userItem),
    firstName: normalizeNamePart(userItem.firstName) || undefined,
    lastName: normalizeNamePart(userItem.lastName) || undefined,
    email: userItem.email,
    role: normalizeBusinessRole(userItem.role),
    businessName: businessItem.name,
    employeeId,
    sessionVersion: normalizeSessionVersion(userItem.sessionVersion),
  };
}

function normalizeEmployeeAccountRecord(employee) {
  return {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    phone: employee.phone,
    role: employee.role,
    hourlyRate: employee.hourlyRate,
    compensationType: employee.compensationType ?? 'hourly',
    labourType: employee.labourType ?? 'field_producing',
    labourClassId: typeof employee.labourClassId === 'string' && employee.labourClassId.trim() ? employee.labourClassId.trim() : null,
    payrollBurdenPct: employee.payrollBurdenPct,
    benefitsExtraCost: employee.benefitsExtraCost,
    bonus: employee.bonus,
    userId: typeof employee.userId === 'string' && employee.userId.trim() ? employee.userId.trim() : null,
    active: employee.active,
    createdAt: employee.createdAt,
  };
}

function normalizeEmployeeForWrite(employee) {
  const normalizedUserId = typeof employee?.userId === 'string' && employee.userId.trim()
    ? employee.userId.trim()
    : null;

  return {
    id: employee.id,
    name: typeof employee.name === 'string' ? employee.name.trim() : '',
    email: typeof employee.email === 'string' ? employee.email.trim().toLowerCase() : '',
    phone: typeof employee.phone === 'string' ? employee.phone.trim() : '',
    role: normalizeEmployeeRole(employee.role),
    hourlyRate: Number.isFinite(employee.hourlyRate) ? employee.hourlyRate : 0,
    compensationType: employee.compensationType === 'salary' ? 'salary' : 'hourly',
    labourType: employee.labourType === 'overhead' ? 'overhead' : 'field_producing',
    labourClassId: typeof employee.labourClassId === 'string' && employee.labourClassId.trim() ? employee.labourClassId.trim() : null,
    payrollBurdenPct: Number.isFinite(employee.payrollBurdenPct) && employee.payrollBurdenPct >= 0 ? employee.payrollBurdenPct : undefined,
    benefitsExtraCost: Number.isFinite(employee.benefitsExtraCost) && employee.benefitsExtraCost >= 0 ? employee.benefitsExtraCost : undefined,
    bonus: Number.isFinite(employee.bonus) && employee.bonus >= 0 ? employee.bonus : undefined,
    userId: normalizedUserId,
    active: employee.active !== false,
    createdAt: typeof employee.createdAt === 'string' && employee.createdAt ? employee.createdAt : nowIso(),
  };
}

function normalizeAccountAccessMode(mode) {
  if (mode === 'link_existing') return 'link_existing';
  if (mode === 'create_login') return 'create_login';
  return 'none';
}

export function buildCreateUserEmployeePayload({ businessId, name, firstName, lastName, email, password, role }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedFirstName = normalizeNamePart(firstName);
  const normalizedLastName = normalizeNamePart(lastName);
  const compatibilityName = [normalizedFirstName, normalizedLastName].filter(Boolean).join(' ') || normalizeNamePart(name);
  const seed = `${businessId}:${normalizedEmail}:${role}`;
  const userId = createHash('sha256').update(seed).digest('hex').slice(0, 24);
  const createdAt = nowIso();
  const passwordHash = bcrypt.hashSync(password, 10);
  const employeeId = userId;

  const userItem = {
    PK: businessPk(businessId),
    SK: userSk(userId),
    entityType: 'USER',
    userId,
    businessId,
    name: compatibilityName,
    ...(normalizedFirstName ? { firstName: normalizedFirstName } : {}),
    ...(normalizedLastName ? { lastName: normalizedLastName } : {}),
    email: normalizedEmail,
    role,
    active: true,
    passwordHash,
    sessionVersion: 0,
    createdAt,
  };

  const emailLookupItem = {
    PK: emailPk(normalizedEmail),
    SK: 'USER',
    entityType: 'EMAIL_LOOKUP',
    businessId,
    userId,
    createdAt,
  };

  const employeeItem = {
    PK: businessPk(businessId),
    SK: employeeSk(employeeId),
    entityType: 'EMPLOYEE',
    businessId,
    employeeId,
    id: employeeId,
    name: compatibilityName,
    email: normalizedEmail,
    phone: '',
    role,
    hourlyRate: 0,
    compensationType: 'hourly',
    labourType: 'field_producing',
    userId,
    active: true,
    createdAt,
  };

  return {
    userItem,
    emailLookupItem,
    employeeItem,
    employee: {
      id: employeeId,
      name: compatibilityName,
      email: normalizedEmail,
      phone: '',
      role,
      hourlyRate: 0,
      compensationType: 'hourly',
      labourType: 'field_producing',
      userId,
      active: true,
      createdAt,
    },
  };
}

export async function createUserEmployeePair({
  businessId,
  name,
  firstName,
  lastName,
  email,
  password,
  role,
  createEmployee,
  failIfExists = false,
}) {
  const normalizedEmail = normalizeEmail(email);

  const shouldCreateEmployee = typeof createEmployee === 'boolean'
    ? createEmployee
    : (role === 'foreman' || role === 'crew_member');
  const payload = buildCreateUserEmployeePayload({ businessId, name, firstName, lastName, email, password, role });
  const { userItem, emailLookupItem, employeeItem } = payload;

  try {
    const existingUsers = await listUsersForBusiness(businessId);
    const existingUser = existingUsers.find((item) => normalizeEmail(item.email) === normalizedEmail);
    if (existingUser) {
      if (failIfExists) {
        return { ok: false, error: 'A user with this email already exists.' };
      }
      const existingEmployees = await listEmployeesForBusiness(businessId);
      const existingEmployee = existingEmployees.find((item) => (
        (item.userId && item.userId === existingUser.id)
        || (!item.userId && normalizeEmail(item.email) === normalizedEmail)
      ));
      return {
        ok: true,
        user: existingUser,
        employee: existingEmployee ?? null,
      };
    }
  } catch (error) {
    if (error?.name !== 'CredentialsProviderError' && error?.name !== 'ConfigurationError') {
      throw error;
    }
  }

  const transactItems = [
    {
      Put: {
        TableName: tableName,
        Item: userItem,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    },
    {
      Put: {
        TableName: tableName,
        Item: emailLookupItem,
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
  ];

  if (shouldCreateEmployee) {
    transactItems.push({
      Put: {
        TableName: tableName,
        Item: employeeItem,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    });
  }

  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') {
      return { ok: false, error: 'A user with this email already exists.' };
    }
    if (error?.name === 'CredentialsProviderError' || error?.name === 'ConfigurationError' || error?.message?.includes('credentials')) {
      return {
        ok: true,
        user: {
          id: userItem.userId,
          name: getDisplayName(userItem),
          firstName: normalizeNamePart(userItem.firstName) || undefined,
          lastName: normalizeNamePart(userItem.lastName) || undefined,
          email: userItem.email,
          role: normalizeBusinessRole(userItem.role),
          active: userItem.active,
          createdAt: userItem.createdAt,
        },
        employee: shouldCreateEmployee ? payload.employee : null,
      };
    }
    throw error;
  }

  return {
    ok: true,
    user: {
      id: userItem.userId,
      name: getDisplayName(userItem),
      firstName: normalizeNamePart(userItem.firstName) || undefined,
      lastName: normalizeNamePart(userItem.lastName) || undefined,
      email: userItem.email,
      role: normalizeBusinessRole(userItem.role),
      active: userItem.active,
      createdAt: userItem.createdAt,
    },
    employee: shouldCreateEmployee ? payload.employee : null,
  };
}

export async function createBusinessWithOwner({ businessName, ownerName, firstName, lastName, email, password, timezone }) {
  const businessId = generateId();
  const userId = generateId();
  const createdAt = nowIso();
  const normalizedEmail = normalizeEmail(email);
  const normalizedFirstName = normalizeNamePart(firstName);
  const normalizedLastName = normalizeNamePart(lastName);
  const compatibilityName = [normalizedFirstName, normalizedLastName].filter(Boolean).join(' ') || normalizeNamePart(ownerName);
  const passwordHash = await bcrypt.hash(password, 10);

  const businessItem = {
    PK: businessPk(businessId),
    SK: 'PROFILE',
    entityType: 'BUSINESS',
    businessId,
    name: businessName.trim(),
    timezone: normalizeBusinessTimeZone(timezone),
    createdAt,
    updatedAt: createdAt,
  };

  const userItem = {
    PK: businessPk(businessId),
    SK: userSk(userId),
    entityType: 'USER',
    userId,
    businessId,
    name: compatibilityName,
    ...(normalizedFirstName ? { firstName: normalizedFirstName } : {}),
    ...(normalizedLastName ? { lastName: normalizedLastName } : {}),
    email: normalizedEmail,
    role: 'owner',
    active: true,
    passwordHash,
    sessionVersion: 0,
    createdAt,
  };

  const emailLookupItem = {
    PK: emailPk(normalizedEmail),
    SK: 'USER',
    entityType: 'EMAIL_LOOKUP',
    businessId,
    userId,
    createdAt,
  };

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: businessItem,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: userItem,
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: emailLookupItem,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      })
    );
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') {
      return { ok: false, error: 'An account with this email already exists.' };
    }
    throw error;
  }

  return { ok: true, user: mapSessionUser(userItem, businessItem) };
}

export async function getBusinessProfile(businessId) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: 'PROFILE' },
  }));
  if (!result.Item) return null;
  return {
    id: result.Item.businessId,
    name: result.Item.name,
    timezone: normalizeBusinessTimeZone(result.Item.timezone),
    pricingBudgetId: typeof result.Item.pricingBudgetId === 'string' && result.Item.pricingBudgetId.trim() ? result.Item.pricingBudgetId.trim() : null,
    createdAt: result.Item.createdAt,
    updatedAt: result.Item.updatedAt ?? result.Item.createdAt,
  };
}

export async function updateBusinessProfile({ businessId, profile }) {
  const updatedAt = nowIso();
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: 'PROFILE' },
    UpdateExpression: 'SET #timezone = :timezone, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#timezone': 'timezone' },
    ExpressionAttributeValues: {
      ':timezone': normalizeBusinessTimeZone(profile.timezone ?? DEFAULT_BUSINESS_TIME_ZONE),
      ':updatedAt': updatedAt,
    },
    ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
  }));
  return getBusinessProfile(businessId);
}

async function findEmployeeForEmail(businessId, email) {
  const employees = await listEmployeesForBusiness(businessId);
  return employees.find((employee) => normalizeEmail(employee.email) === normalizeEmail(email) && employee.active) ?? null;
}

async function findEmployeeByUserId(businessId, userId) {
  if (typeof userId !== 'string' || !userId.trim()) return null;
  const employees = await listEmployeesForBusiness(businessId);
  return employees.find((employee) => employee.userId === userId.trim()) ?? null;
}

async function findActiveEmployeeByUserId(businessId, userId) {
  if (typeof userId !== 'string' || !userId.trim()) return null;
  const employees = await listEmployeesForBusiness(businessId);
  return employees.find((employee) => employee.userId === userId.trim() && employee.active) ?? null;
}

async function findLinkedEmployeeForUser({ businessId, userId, email }) {
  const linked = await findActiveEmployeeByUserId(businessId, userId);
  if (linked) return linked;

  const employees = await listEmployeesForBusiness(businessId);
  const normalizedEmail = normalizeEmail(email);
  const legacyMatches = employees.filter((employee) => {
    if (!employee.active) return false;
    if (employee.userId) return false;
    return employee.email && normalizeEmail(employee.email) === normalizedEmail;
  });

  if (legacyMatches.length === 1) {
    return legacyMatches[0];
  }

  return null;
}

async function getBusinessUserByEmail(businessId, email) {
  if (typeof email !== 'string' || !email.trim()) return null;
  const normalizedEmail = normalizeEmail(email);

  const lookup = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: emailPk(normalizedEmail),
        SK: 'USER',
      },
    })
  );

  if (!lookup.Item || lookup.Item.businessId !== businessId) {
    return null;
  }

  const user = await getBusinessUserById(businessId, lookup.Item.userId);
  return user ?? null;
}

export async function getActiveBusinessUserByEmail(email) {
  if (typeof email !== 'string' || !email.trim()) return null;
  const normalizedEmail = normalizeEmail(email);
  const lookup = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: emailPk(normalizedEmail), SK: 'USER' },
    })
  );

  let businessId = lookup.Item?.businessId;
  let userId = lookup.Item?.userId;
  if (!businessId || !userId) {
    const legacyLookup = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'entityType = :entityType AND email = :email',
        ExpressionAttributeValues: { ':entityType': 'USER', ':email': normalizedEmail },
      })
    );
    businessId = legacyLookup.Items?.[0]?.businessId;
    userId = legacyLookup.Items?.[0]?.userId;
  }

  if (!businessId || !userId) return null;
  const user = await getBusinessUserById(businessId, userId);
  return user?.active === false ? null : user;
}

export async function authenticateUser(email, password) {
  const normalizedEmail = normalizeEmail(email);

  const lookup = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: emailPk(normalizedEmail),
        SK: 'USER',
      },
    })
  );

  if (!lookup.Item) {
    return { ok: false, error: 'Invalid email or password.' };
  }

  const userKey = {
    PK: businessPk(lookup.Item.businessId),
    SK: userSk(lookup.Item.userId),
  };

  const userRes = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: userKey,
    })
  );

  if (!userRes.Item || userRes.Item.active === false) {
    return { ok: false, error: 'Invalid email or password.' };
  }

  if (typeof userRes.Item.passwordHash !== 'string' || !userRes.Item.passwordHash) {
    return { ok: false, error: 'Invalid email or password.' };
  }

  const passwordOk = await bcrypt.compare(password, userRes.Item.passwordHash);
  if (!passwordOk) {
    return { ok: false, error: 'Invalid email or password.' };
  }

  const businessRes = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(userRes.Item.businessId),
        SK: 'PROFILE',
      },
    })
  );

  if (!businessRes.Item) {
    return { ok: false, error: 'Invalid email or password.' };
  }

  const linkedEmployee = await findLinkedEmployeeForUser({
    businessId: userRes.Item.businessId,
    userId: userRes.Item.userId,
    email: normalizedEmail,
  });

  return {
    ok: true,
    user: mapSessionUser(userRes.Item, businessRes.Item, linkedEmployee?.id),
  };
}

export async function listUsersForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'USER#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.userId,
    name: getDisplayName(item),
    firstName: normalizeNamePart(item.firstName) || undefined,
    lastName: normalizeNamePart(item.lastName) || undefined,
    email: item.email,
    role: normalizeBusinessRole(item.role),
    active: item.active,
    createdAt: item.createdAt,
  }));
}

export async function createUserForBusiness({ businessId, name, email, password, role }) {
  return createUserEmployeePair({ businessId, name, email, password, role });
}

export async function createAuthUserForBusiness({ businessId, name, firstName, lastName, email, password, role }) {
  return createUserEmployeePair({
    businessId,
    name,
    firstName,
    lastName,
    email,
    password,
    role,
    createEmployee: false,
    failIfExists: true,
  });
}

export async function getBusinessUserById(businessId, userId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: userSk(userId),
      },
    })
  );

  if (!result.Item) return null;

  return {
    id: result.Item.userId,
    businessId: result.Item.businessId,
    name: getDisplayName(result.Item),
    firstName: normalizeNamePart(result.Item.firstName) || undefined,
    lastName: normalizeNamePart(result.Item.lastName) || undefined,
    email: result.Item.email,
    role: normalizeBusinessRole(result.Item.role),
    active: result.Item.active,
    createdAt: result.Item.createdAt,
    passwordHash: result.Item.passwordHash,
    sessionVersion: normalizeSessionVersion(result.Item.sessionVersion),
  };
}

export async function createMobileSessionForUser({ user, accessToken, expiresInSeconds = 7 * 24 * 60 * 60 }) {
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + Math.max(1, expiresInSeconds) * 1000).toISOString();
  const tokenHash = mobileSessionTokenHash(accessToken);

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: mobileSessionTokenPk(tokenHash),
        SK: 'SESSION',
        entityType: 'MOBILE_SESSION',
        tokenHash,
        businessId: user.businessId,
        userId: user.id,
        name: user.name,
        firstName: normalizeNamePart(user.firstName) || null,
        lastName: normalizeNamePart(user.lastName) || null,
        email: user.email,
        role: user.role,
        businessName: user.businessName,
        employeeId: typeof user.employeeId === 'string' ? user.employeeId : null,
        sessionVersion: normalizeSessionVersion(user.sessionVersion),
        createdAt,
        updatedAt: createdAt,
        expiresAt,
        ttl: Math.floor(Date.parse(expiresAt) / 1000),
        revokedAt: null,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return {
    ok: true,
    session: {
      user: buildMobileSessionFromItem({
        businessId: user.businessId,
        userId: user.id,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        businessName: user.businessName,
        employeeId: typeof user.employeeId === 'string' ? user.employeeId : undefined,
        sessionVersion: normalizeSessionVersion(user.sessionVersion),
      }),
      expiresAt,
    },
  };
}

export async function resolveMobileSessionByAccessToken(accessToken) {
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    return { ok: false, reason: 'invalid_token' };
  }

  const tokenHash = mobileSessionTokenHash(accessToken.trim());
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: mobileSessionTokenPk(tokenHash),
        SK: 'SESSION',
      },
    })
  );

  const item = result.Item;
  if (!item) {
    return { ok: false, reason: 'invalid_token' };
  }

  if (typeof item.revokedAt === 'string' && item.revokedAt) {
    return { ok: false, reason: 'revoked' };
  }

  if (isSessionExpired(item.expiresAt)) {
    return { ok: false, reason: 'expired' };
  }

  const tokenSessionUser = buildMobileSessionFromItem(item);
  if (!tokenSessionUser) {
    return { ok: false, reason: 'invalid_token' };
  }

  const currentUser = await getBusinessUserById(tokenSessionUser.businessId, tokenSessionUser.id);
  if (!currentUser || currentUser.active === false) {
    return { ok: false, reason: 'inactive_user' };
  }

  if (normalizeSessionVersion(item.sessionVersion) !== normalizeSessionVersion(currentUser.sessionVersion)) {
    return { ok: false, reason: 'revoked' };
  }

  const user = {
    id: currentUser.id,
    businessId: currentUser.businessId,
    name: getDisplayName(currentUser),
    firstName: currentUser.firstName,
    lastName: currentUser.lastName,
    email: currentUser.email,
    role: currentUser.role,
    businessName: tokenSessionUser.businessName,
    employeeId: tokenSessionUser.employeeId,
    sessionVersion: currentUser.sessionVersion,
  };

  return {
    ok: true,
    session: {
      user,
      tokenHash,
      expiresAt: item.expiresAt,
    },
  };
}

export async function revokeMobileSessionByAccessToken(accessToken) {
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    return { ok: false, revoked: false };
  }

  const tokenHash = mobileSessionTokenHash(accessToken.trim());
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: mobileSessionTokenPk(tokenHash),
          SK: 'SESSION',
        },
        UpdateExpression: 'SET revokedAt = :revokedAt, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':revokedAt': nowIso(),
          ':updatedAt': nowIso(),
        },
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
      })
    );
    return { ok: true, revoked: true };
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      return { ok: true, revoked: false };
    }
    throw error;
  }
}

export async function updateBusinessUser({ businessId, user }) {
  const existing = await getBusinessUserById(businessId, user.id);
  if (!existing) {
    return { ok: false, error: 'User not found' };
  }

  const normalizedEmail = normalizeEmail(user.email);
  const previousEmail = normalizeEmail(existing.email);
  const expectedSessionVersion = normalizeSessionVersion(user.expectedSessionVersion ?? existing.sessionVersion);

  const userItem = {
    PK: businessPk(businessId),
    SK: userSk(user.id),
    entityType: 'USER',
    userId: user.id,
    businessId,
    name: getDisplayName(user),
    ...(normalizeNamePart(user.firstName) ? { firstName: normalizeNamePart(user.firstName) } : {}),
    ...(normalizeNamePart(user.lastName) ? { lastName: normalizeNamePart(user.lastName) } : {}),
    email: normalizedEmail,
    role: user.role,
    active: user.active,
    passwordHash: user.passwordHash,
    sessionVersion: normalizeSessionVersion(user.sessionVersion),
    createdAt: user.createdAt,
  };

  if (previousEmail !== normalizedEmail) {
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName,
                Item: userItem,
                ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND (attribute_not_exists(sessionVersion) OR sessionVersion = :expectedSessionVersion)',
                ExpressionAttributeValues: { ':expectedSessionVersion': expectedSessionVersion },
              },
            },
            {
              Delete: {
                TableName: tableName,
                Key: {
                  PK: emailPk(previousEmail),
                  SK: 'USER',
                },
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: {
                  PK: emailPk(normalizedEmail),
                  SK: 'USER',
                  entityType: 'EMAIL_LOOKUP',
                  businessId,
                  userId: user.id,
                  createdAt: nowIso(),
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        })
      );
    } catch (error) {
      if (error?.name === 'TransactionCanceledException') {
        return { ok: false, error: 'A user with this email already exists.' };
      }
      throw error;
    }

    return { ok: true };
  }

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: userItem,
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND (attribute_not_exists(sessionVersion) OR sessionVersion = :expectedSessionVersion)',
      ExpressionAttributeValues: { ':expectedSessionVersion': expectedSessionVersion },
    })
  );

  return { ok: true };
}

export async function deleteBusinessUser(businessId, userId) {
  const existing = await getBusinessUserById(businessId, userId);
  if (!existing) {
    return { ok: false, error: 'User not found' };
  }

  if (existing.role === 'owner') {
    return { ok: false, error: 'Owner account cannot be deleted.' };
  }

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: tableName,
            Key: {
              PK: businessPk(businessId),
              SK: userSk(userId),
            },
          },
        },
        {
          Delete: {
            TableName: tableName,
            Key: {
              PK: emailPk(existing.email),
              SK: 'USER',
            },
          },
        },
      ],
    })
  );

  return { ok: true };
}

export async function deleteAuthUserForBusinessByEmail(businessId, email) {
  const normalizedEmail = normalizeEmail(email);

  const lookup = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: emailPk(normalizedEmail),
        SK: 'USER',
      },
    })
  );

  if (!lookup.Item || lookup.Item.businessId !== businessId) {
    return { ok: true };
  }

  const userRes = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: userSk(lookup.Item.userId),
      },
    })
  );

  if (!userRes.Item) {
    return { ok: true };
  }

  if (userRes.Item.role === 'owner') {
    return { ok: false, error: 'Owner auth user cannot be deleted from employee removal.' };
  }

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: tableName,
            Key: {
              PK: businessPk(businessId),
              SK: userSk(lookup.Item.userId),
            },
          },
        },
        {
          Delete: {
            TableName: tableName,
            Key: {
              PK: emailPk(normalizedEmail),
              SK: 'USER',
            },
          },
        },
      ],
    })
  );

  return { ok: true };
}

export async function listTemplatesForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'TEMPLATE#',
      },
    })
  );

  return (result.Items ?? []).map(mapTemplateRecordFromItem);
}

export async function createTemplateForBusiness({ businessId, template }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: templateSk(template.id),
        entityType: 'ESTIMATE_TEMPLATE',
        businessId,
        templateId: template.id,
        ...template,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getTemplateForBusiness(businessId, templateId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: templateSk(templateId),
      },
    })
  );

  return result.Item ? mapTemplateRecordFromItem(result.Item) : null;
}

export async function updateTemplateForBusiness({ businessId, template }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: templateSk(template.id),
        entityType: 'ESTIMATE_TEMPLATE',
        businessId,
        templateId: template.id,
        ...template,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteTemplateForBusiness(businessId, templateId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: templateSk(templateId),
      },
    })
  );

  return { ok: true };
}

export async function listCustomersForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'CUSTOMER#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.customerId,
    firstName: item.firstName,
    lastName: item.lastName,
    name: item.name,
    company: item.company,
    email: item.email,
    phone: item.phone,
    properties: Array.isArray(item.properties)
      ? item.properties
      : (item.address ? [item.address] : []),
    address: item.address,
    status: normalizePersistedCustomerStatus(item.status),
    leadSource: item.leadSource,
    leadSourceOther: item.leadSourceOther,
    notes: item.notes,
    tags: item.tags ?? [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

export async function createCustomerForBusiness({ businessId, customer }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: customerSk(customer.id),
        entityType: 'CUSTOMER',
        businessId,
        customerId: customer.id,
        ...customer,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getCustomerForBusiness(businessId, customerId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: customerSk(customerId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.customerId,
        firstName: result.Item.firstName,
        lastName: result.Item.lastName,
        name: result.Item.name,
        company: result.Item.company,
        email: result.Item.email,
        phone: result.Item.phone,
        properties: Array.isArray(result.Item.properties)
          ? result.Item.properties
          : (result.Item.address ? [result.Item.address] : []),
        address: result.Item.address,
        status: normalizePersistedCustomerStatus(result.Item.status),
        leadSource: result.Item.leadSource,
        leadSourceOther: result.Item.leadSourceOther,
        notes: result.Item.notes,
        tags: result.Item.tags ?? [],
        createdAt: result.Item.createdAt,
        updatedAt: result.Item.updatedAt,
      }
    : null;
}

export async function updateCustomerForBusiness({ businessId, customer }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: customerSk(customer.id),
        entityType: 'CUSTOMER',
        businessId,
        customerId: customer.id,
        ...customer,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteCustomerForBusiness(businessId, customerId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: customerSk(customerId),
      },
    })
  );

  return { ok: true };
}

export async function listJobsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'JOB#',
      },
    })
  );

  return (result.Items ?? []).map(mapJobRecordFromItem);
}

export async function createJobForBusiness({ businessId, job }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: jobSk(job.id),
        entityType: 'JOB',
        businessId,
        jobId: job.id,
        ...job,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getJobForBusiness(businessId, jobId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: jobSk(jobId),
      },
    })
  );

  return result.Item ? mapJobRecordFromItem(result.Item) : null;
}

export async function updateJobForBusiness({ businessId, job }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: jobSk(job.id),
        entityType: 'JOB',
        businessId,
        jobId: job.id,
        ...job,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function initializeJobPlanForBusiness({ businessId, jobId, plan }) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: businessPk(businessId), SK: jobSk(jobId) },
      UpdateExpression: 'SET #operationalWorkAreas = :operationalWorkAreas, #originalEstimateSnapshot = :originalEstimateSnapshot, #planningSnapshotVersion = :planningSnapshotVersion, #planningRevision = :planningRevision, #estimatedCost = :estimatedCost, #currentPlannedCost = :currentPlannedCost, #originalContractRevenue = :originalContractRevenue, #currentContractRevenue = :currentContractRevenue, #workAreas = :workAreas, #updatedAt = :updatedAt',
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND attribute_not_exists(#planningSnapshotVersion)',
      ExpressionAttributeNames: {
        '#operationalWorkAreas': 'operationalWorkAreas',
        '#originalEstimateSnapshot': 'originalEstimateSnapshot',
        '#planningSnapshotVersion': 'planningSnapshotVersion',
        '#planningRevision': 'planningRevision',
        '#estimatedCost': 'estimatedCost',
        '#currentPlannedCost': 'currentPlannedCost',
        '#originalContractRevenue': 'originalContractRevenue',
        '#currentContractRevenue': 'currentContractRevenue',
        '#workAreas': 'workAreas',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':operationalWorkAreas': plan.operationalWorkAreas,
        ':originalEstimateSnapshot': plan.originalEstimateSnapshot,
        ':planningSnapshotVersion': plan.planningSnapshotVersion,
        ':planningRevision': plan.planningRevision,
        ':estimatedCost': plan.currentPlannedCost,
        ':currentPlannedCost': plan.currentPlannedCost,
        ':originalContractRevenue': plan.originalContractRevenue,
        ':currentContractRevenue': plan.currentContractRevenue,
        ':workAreas': plan.operationalWorkAreas.map((area) => area.name),
        ':updatedAt': plan.updatedAt,
      },
    }));
    return { ok: true };
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return { ok: false, code: 'ALREADY_INITIALIZED' };
    throw error;
  }
}

export async function updateJobPlanForBusiness({ businessId, jobId, expectedRevision, plan }) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: businessPk(businessId), SK: jobSk(jobId) },
      UpdateExpression: 'SET #operationalWorkAreas = :operationalWorkAreas, #planningRevision = :nextRevision, #estimatedCost = :estimatedCost, #currentPlannedCost = :currentPlannedCost, #currentContractRevenue = :currentContractRevenue, #workAreas = :workAreas, #estimatedHours = :estimatedHours, #updatedAt = :updatedAt',
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #planningRevision = :expectedRevision',
      ExpressionAttributeNames: {
        '#operationalWorkAreas': 'operationalWorkAreas',
        '#planningRevision': 'planningRevision',
        '#estimatedCost': 'estimatedCost',
        '#currentPlannedCost': 'currentPlannedCost',
        '#currentContractRevenue': 'currentContractRevenue',
        '#workAreas': 'workAreas',
        '#estimatedHours': 'estimatedHours',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':operationalWorkAreas': plan.operationalWorkAreas,
        ':expectedRevision': expectedRevision,
        ':nextRevision': plan.planningRevision,
        ':estimatedCost': plan.currentPlannedCost,
        ':currentPlannedCost': plan.currentPlannedCost,
        ':currentContractRevenue': plan.currentContractRevenue,
        ':workAreas': plan.operationalWorkAreas.map((area) => area.name),
        ':estimatedHours': plan.estimatedHours,
        ':updatedAt': plan.updatedAt,
      },
    }));
    return { ok: true };
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return { ok: false, code: 'STALE_REVISION' };
    throw error;
  }
}

export async function deleteJobForBusiness(businessId, jobId) {
  const headings = await listJobTaskHeadingsForBusiness(businessId);
  await Promise.all(headings
    .filter((heading) => heading.jobId === jobId)
    .map((heading) => deleteJobTaskHeadingForBusiness(businessId, heading.id)));
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: jobSk(jobId),
      },
    })
  );

  return { ok: true };
}

export async function reserveNextJobNumberForBusiness({ businessId, year }) {
  const result = await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: jobCounterSk(year),
      },
      UpdateExpression: 'SET #entityType = :entityType, #businessId = :businessId, #year = :year, #updatedAt = :updatedAt ADD #sequence :increment',
      ExpressionAttributeNames: {
        '#entityType': 'entityType',
        '#businessId': 'businessId',
        '#year': 'year',
        '#updatedAt': 'updatedAt',
        '#sequence': 'sequence',
      },
      ExpressionAttributeValues: {
        ':entityType': 'JOB_COUNTER',
        ':businessId': businessId,
        ':year': year,
        ':updatedAt': nowIso(),
        ':increment': 1,
      },
      ReturnValues: 'UPDATED_NEW',
    })
  );

  const sequence = Number(result?.Attributes?.sequence ?? 0);
  const normalizedSequence = Number.isFinite(sequence) && sequence > 0 ? sequence : 1;
  return `JOB-${year}-${String(normalizedSequence).padStart(4, '0')}`;
}

export async function convertEstimateToJobForBusiness({
  businessId,
  estimate,
  job,
  actorUserId,
  actorName,
  actorEmail,
  convertedAt,
}) {
  const eventId = `${actorUserId}:${estimate.id}:${convertedAt}`;
  const transaction = {
    TransactItems: [
      {
        Put: {
          TableName: tableName,
          Item: {
            PK: businessPk(businessId),
            SK: jobSk(job.id),
            entityType: 'JOB',
            businessId,
            jobId: job.id,
            ...job,
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
      {
        Update: {
          TableName: tableName,
          Key: {
            PK: businessPk(businessId),
            SK: estimateSk(estimate.id),
          },
          UpdateExpression: 'SET #status = :converted, #convertedToJobId = :jobId, #convertedAt = :convertedAt, #updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :accepted AND attribute_not_exists(#convertedToJobId)',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#convertedToJobId': 'convertedToJobId',
            '#convertedAt': 'convertedAt',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':accepted': 'accepted',
            ':converted': 'converted',
            ':jobId': job.id,
            ':convertedAt': convertedAt,
            ':updatedAt': convertedAt,
          },
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: {
            PK: businessPk(businessId),
            SK: auditEventSk(eventId),
            entityType: 'AUDIT_EVENT',
            businessId,
            eventId,
            action: 'estimate_converted_to_job',
            actorUserId,
            actorName,
            actorEmail: actorEmail ?? '',
            affectedEntryCount: 1,
            createdAt: convertedAt,
            metadata: {
              estimateId: estimate.id,
              proposalNumber: estimate.proposalNumber,
              jobId: job.id,
              jobNumber: job.jobNumber,
            },
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
    ],
  };

  try {
    await ddb.send(new TransactWriteCommand(transaction));
    return { ok: true };
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') {
      const currentEstimate = await getEstimateForBusiness(businessId, estimate.id);
      if (currentEstimate?.convertedToJobId) {
        return {
          ok: false,
          code: 'ALREADY_CONVERTED',
          convertedToJobId: currentEstimate.convertedToJobId,
        };
      }

      return {
        ok: false,
        code: 'CONVERSION_CONFLICT',
      };
    }
    throw error;
  }
}

export async function listEstimatesForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'ESTIMATE#',
      },
    })
  );

  return (result.Items ?? []).map(mapEstimateRecordFromItem);
}

export async function createEstimateForBusiness({ businessId, estimate }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: estimateSk(estimate.id),
        entityType: 'ESTIMATE',
        businessId,
        estimateId: estimate.id,
        ...estimate,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getEstimateForBusiness(businessId, estimateId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: estimateSk(estimateId),
      },
    })
  );

  return result.Item ? mapEstimateRecordFromItem(result.Item) : null;
}

export async function updateEstimateForBusiness({ businessId, estimate, expectedUpdatedAt }) {
  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: businessPk(businessId),
          SK: estimateSk(estimate.id),
          entityType: 'ESTIMATE',
          businessId,
          estimateId: estimate.id,
          ...estimate,
        },
        ConditionExpression: expectedUpdatedAt
          ? 'attribute_exists(PK) AND attribute_exists(SK) AND updatedAt = :expectedUpdatedAt'
          : 'attribute_exists(PK) AND attribute_exists(SK)',
        ...(expectedUpdatedAt ? {
          ExpressionAttributeValues: { ':expectedUpdatedAt': expectedUpdatedAt },
        } : {}),
      })
    );
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      return { ok: false, error: 'Estimate changed since it was opened. Review the latest version and save again.' };
    }
    throw error;
  }

  return { ok: true };
}

export async function deleteEstimateForBusiness(businessId, estimateId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: estimateSk(estimateId),
      },
    })
  );

  return { ok: true };
}

export async function listInvoicesForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'INVOICE#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.invoiceId,
    jobId: item.jobId,
    customerId: item.customerId,
    number: item.number,
    issueDate: item.issueDate,
    dueDate: item.dueDate,
    status: item.status,
    amount: item.amount,
    lineItems: item.lineItems,
    taxRate: item.taxRate,
    subtotal: item.subtotal,
    taxAmount: item.taxAmount,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

export async function createInvoiceForBusiness({ businessId, invoice }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: invoiceSk(invoice.id),
        entityType: 'INVOICE',
        businessId,
        invoiceId: invoice.id,
        ...invoice,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getInvoiceForBusiness(businessId, invoiceId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: invoiceSk(invoiceId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.invoiceId,
        jobId: result.Item.jobId,
        customerId: result.Item.customerId,
        number: result.Item.number,
        issueDate: result.Item.issueDate,
        dueDate: result.Item.dueDate,
        status: result.Item.status,
        amount: result.Item.amount,
        lineItems: result.Item.lineItems,
        taxRate: result.Item.taxRate,
        subtotal: result.Item.subtotal,
        taxAmount: result.Item.taxAmount,
        notes: result.Item.notes,
        createdAt: result.Item.createdAt,
        updatedAt: result.Item.updatedAt,
      }
    : null;
}

export async function updateInvoiceForBusiness({ businessId, invoice }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: invoiceSk(invoice.id),
        entityType: 'INVOICE',
        businessId,
        invoiceId: invoice.id,
        ...invoice,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteInvoiceForBusiness(businessId, invoiceId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: invoiceSk(invoiceId),
      },
    })
  );

  return { ok: true };
}

export async function listExpensesForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'EXPENSE#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.expenseId,
    jobId: item.jobId,
    vendor: item.vendor,
    description: item.description,
    category: item.category,
    expenseDate: item.expenseDate,
    amount: item.amount,
    status: item.status,
    notes: item.notes,
    receiptUrl: item.receiptUrl,
    receiptFileId: item.receiptFileId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

export async function createExpenseForBusiness({ businessId, expense }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: expenseSk(expense.id),
        entityType: 'EXPENSE',
        businessId,
        expenseId: expense.id,
        ...expense,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getExpenseForBusiness(businessId, expenseId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: expenseSk(expenseId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.expenseId,
        jobId: result.Item.jobId,
        vendor: result.Item.vendor,
        description: result.Item.description,
        category: result.Item.category,
        expenseDate: result.Item.expenseDate,
        amount: result.Item.amount,
        status: result.Item.status,
        notes: result.Item.notes,
        receiptUrl: result.Item.receiptUrl,
        receiptFileId: result.Item.receiptFileId,
        createdAt: result.Item.createdAt,
        updatedAt: result.Item.updatedAt,
      }
    : null;
}

export async function updateExpenseForBusiness({ businessId, expense }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: expenseSk(expense.id),
        entityType: 'EXPENSE',
        businessId,
        expenseId: expense.id,
        ...expense,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteExpenseForBusiness(businessId, expenseId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: expenseSk(expenseId),
      },
    })
  );

  return { ok: true };
}

export async function createReceiptForBusiness({ businessId, receipt }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: receiptSk(receipt.id),
        entityType: 'RECEIPT',
        businessId,
        receiptId: receipt.id,
        ...receipt,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getReceiptForBusiness(businessId, receiptId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: receiptSk(receiptId),
      },
    })
  );

  if (!result.Item) return null;

  return {
    id: result.Item.receiptId,
    fileName: result.Item.fileName,
    mimeType: result.Item.mimeType,
    dataBase64: result.Item.dataBase64,
    sizeBytes: result.Item.sizeBytes,
    uploadedAt: result.Item.uploadedAt,
  };
}

export async function createFileForBusiness({ businessId, file }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: fileSk(file.id),
        entityType: 'FILE',
        businessId,
        fileId: file.id,
        ...file,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function createPendingFileForBusiness({ businessId, file }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: fileSk(file.id),
        entityType: 'FILE',
        businessId,
        fileId: file.id,
        ...file,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function updateFileForBusiness({ businessId, fileId, updates }) {
  const entries = Object.entries(updates ?? {}).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return { ok: true };
  }

  const ExpressionAttributeNames = {};
  const ExpressionAttributeValues = { ':businessId': businessId };
  const assignments = [];

  entries.forEach(([key, value], index) => {
    const nameKey = `#f${index}`;
    const valueKey = `:v${index}`;
    ExpressionAttributeNames[nameKey] = key;
    ExpressionAttributeValues[valueKey] = value;
    assignments.push(`${nameKey} = ${valueKey}`);
  });

  ExpressionAttributeNames['#businessId'] = 'businessId';
  ExpressionAttributeValues[':now'] = nowIso();

  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: fileSk(fileId),
      },
      UpdateExpression: `SET ${assignments.join(', ')}, #businessId = :businessId, updatedAt = :now`,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function listFilesForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'FILE#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.fileId,
    fileName: item.fileName,
    originalFileName: item.originalFileName ?? item.fileName,
    sanitizedFileName: item.sanitizedFileName,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    expectedContentType: item.expectedContentType,
    expectedFileSize: item.expectedFileSize,
    key: item.key,
    objectKey: item.objectKey ?? item.key,
    uploadedAt: item.uploadedAt,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    uploadedByUserId: item.uploadedByUserId,
    entityType: item.entityType,
    entityId: item.entityId,
    category: item.category,
    uploadStatus: item.uploadStatus,
    pendingReason: item.pendingReason,
    etag: item.etag,
  }));
}

export async function getFileForBusiness(businessId, fileId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: fileSk(fileId),
      },
    })
  );

  if (!result.Item) return null;

  return {
    id: result.Item.fileId,
    fileName: result.Item.fileName,
    originalFileName: result.Item.originalFileName ?? result.Item.fileName,
    sanitizedFileName: result.Item.sanitizedFileName,
    mimeType: result.Item.mimeType,
    sizeBytes: result.Item.sizeBytes,
    expectedContentType: result.Item.expectedContentType,
    expectedFileSize: result.Item.expectedFileSize,
    key: result.Item.key,
    objectKey: result.Item.objectKey ?? result.Item.key,
    uploadedAt: result.Item.uploadedAt,
    updatedAt: result.Item.updatedAt,
    createdAt: result.Item.createdAt,
    expiresAt: result.Item.expiresAt,
    uploadedByUserId: result.Item.uploadedByUserId,
    businessId: result.Item.businessId,
    entityType: result.Item.entityType,
    entityId: result.Item.entityId,
    category: result.Item.category,
    uploadStatus: result.Item.uploadStatus,
    pendingReason: result.Item.pendingReason,
    etag: result.Item.etag,
  };
}

export async function deleteFileForBusiness(businessId, fileId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: fileSk(fileId),
      },
    })
  );

  return { ok: true };
}

export async function listFormsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'FORM#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.formId,
    name: item.name,
    description: item.description ?? '',
    category: item.category,
    status: item.status,
    assignedTo: item.assignedTo,
    assignmentValue: item.assignmentValue,
    trigger: item.trigger ?? [],
    completionRequirement: item.completionRequirement ?? 'reminder',
    requiresApproval: item.requiresApproval === true,
    division: item.division,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

export async function createFormForBusiness({ businessId, form }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: formSk(form.id),
        entityType: 'FORM',
        businessId,
        formId: form.id,
        ...form,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getFormForBusiness(businessId, formId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: formSk(formId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.formId,
        name: result.Item.name,
        description: result.Item.description ?? '',
        category: result.Item.category,
        status: result.Item.status,
        assignedTo: result.Item.assignedTo,
        assignmentValue: result.Item.assignmentValue,
        trigger: result.Item.trigger ?? [],
        completionRequirement: result.Item.completionRequirement ?? 'reminder',
        requiresApproval: result.Item.requiresApproval === true,
        division: result.Item.division,
        createdAt: result.Item.createdAt,
        updatedAt: result.Item.updatedAt,
      }
    : null;
}

export async function updateFormForBusiness({ businessId, form }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: formSk(form.id),
        entityType: 'FORM',
        businessId,
        formId: form.id,
        ...form,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteFormForBusiness(businessId, formId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: formSk(formId),
      },
    })
  );

  return { ok: true };
}

export async function listFormFieldsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'FORM_FIELD#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.formFieldId,
    formId: item.formId,
    type: item.type,
    label: item.label,
    helpText: item.helpText,
    required: Boolean(item.required),
    defaultValue: item.defaultValue,
    placeholder: item.placeholder,
    options: item.options ?? [],
    acceptedResponse: item.acceptedResponse,
    order: item.order ?? 0,
  }));
}

export async function createFormFieldForBusiness({ businessId, formField }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: formFieldSk(formField.id),
        entityType: 'FORM_FIELD',
        businessId,
        formFieldId: formField.id,
        ...formField,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getFormFieldForBusiness(businessId, formFieldId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: formFieldSk(formFieldId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.formFieldId,
        formId: result.Item.formId,
        type: result.Item.type,
        label: result.Item.label,
        helpText: result.Item.helpText,
        required: Boolean(result.Item.required),
        defaultValue: result.Item.defaultValue,
        placeholder: result.Item.placeholder,
        options: result.Item.options ?? [],
        acceptedResponse: result.Item.acceptedResponse,
        order: result.Item.order ?? 0,
      }
    : null;
}

export async function updateFormFieldForBusiness({ businessId, formField }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: formFieldSk(formField.id),
        entityType: 'FORM_FIELD',
        businessId,
        formFieldId: formField.id,
        ...formField,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteFormFieldForBusiness(businessId, formFieldId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: formFieldSk(formFieldId),
      },
    })
  );

  return { ok: true };
}

export async function listFormSubmissionsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'FORM_SUBMISSION#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.formSubmissionId,
    formId: item.formId,
    employeeId: item.employeeId,
    jobId: item.jobId,
    equipmentId: item.equipmentId,
    divisionId: item.divisionId,
    trigger: item.trigger,
    periodKey: item.periodKey,
    submittedAt: item.submittedAt,
    status: item.status,
    submittedBy: item.submittedBy,
    submittedByUserId: item.submittedByUserId,
    clientSubmissionId: item.clientSubmissionId,
    workflowOccurrenceId: item.workflowOccurrenceId,
    workflowRequirementId: item.workflowRequirementId,
  }));
}

export async function createFormSubmissionForBusiness({ businessId, formSubmission }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: formSubmissionSk(formSubmission.id),
        entityType: 'FORM_SUBMISSION',
        businessId,
        formSubmissionId: formSubmission.id,
        ...formSubmission,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getFormSubmissionForBusiness(businessId, formSubmissionId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: formSubmissionSk(formSubmissionId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.formSubmissionId,
        formId: result.Item.formId,
        employeeId: result.Item.employeeId,
        jobId: result.Item.jobId,
        equipmentId: result.Item.equipmentId,
        divisionId: result.Item.divisionId,
        trigger: result.Item.trigger,
        periodKey: result.Item.periodKey,
        submittedAt: result.Item.submittedAt,
        status: result.Item.status,
        submittedBy: result.Item.submittedBy,
        submittedByUserId: result.Item.submittedByUserId,
        clientSubmissionId: result.Item.clientSubmissionId,
        workflowOccurrenceId: result.Item.workflowOccurrenceId,
        workflowRequirementId: result.Item.workflowRequirementId,
      }
    : null;
}

export async function updateFormSubmissionForBusiness({ businessId, formSubmission }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: formSubmissionSk(formSubmission.id),
        entityType: 'FORM_SUBMISSION',
        businessId,
        formSubmissionId: formSubmission.id,
        ...formSubmission,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function reviewFormSubmissionForBusiness({ businessId, formSubmissionId, status }) {
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: formSubmissionSk(formSubmissionId) },
    UpdateExpression: 'SET #status = :status',
    ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :pendingReview',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': status, ':pendingReview': 'pending_review' },
  }));
  return { ok: true };
}

export async function deleteFormSubmissionForBusiness(businessId, formSubmissionId) {
  const responses = await listFormResponsesForBusiness(businessId);
  const responseIds = responses.filter((response) => response.submissionId === formSubmissionId).map((response) => response.id);
  await Promise.all([formSubmissionId, ...responseIds].map((id, index) => ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: index === 0 ? formSubmissionSk(id) : formResponseSk(id),
      },
    })
  )));

  return { ok: true };
}

export async function getEmployeeFormSubmissionIdempotency({ businessId, employeeId, clientSubmissionId }) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: {
      PK: businessPk(businessId),
      SK: formSubmissionIdempotencySk(employeeId, clientSubmissionId),
    },
    ConsistentRead: true,
  }));
  return result.Item ? {
    employeeId: result.Item.employeeId,
    clientSubmissionId: result.Item.clientSubmissionId,
    payloadFingerprint: result.Item.payloadFingerprint,
    submission: result.Item.submission,
    expiresAt: result.Item.expiresAt,
  } : null;
}

export async function createEmployeeFormSubmissionForBusiness({ businessId, submission, responses, idempotency, workflowCompletion }) {
  const maximumResponses = 100 - 1 - (idempotency ? 1 : 0) - (workflowCompletion ? 1 : 0);
  if (!Array.isArray(responses) || responses.length > maximumResponses) {
    throw new RangeError(`A form submission can contain at most ${maximumResponses} answers.`);
  }
  const transactionItems = [
    ...(idempotency ? [{
      Put: {
        TableName: tableName,
        Item: {
          PK: businessPk(businessId),
          SK: formSubmissionIdempotencySk(submission.employeeId, idempotency.clientSubmissionId),
          entityType: 'FORM_SUBMISSION_IDEMPOTENCY',
          businessId,
          employeeId: submission.employeeId,
          clientSubmissionId: idempotency.clientSubmissionId,
          payloadFingerprint: idempotency.payloadFingerprint,
          submission: idempotency.submission,
          createdAt: submission.submittedAt,
          expiresAt: idempotency.expiresAt,
          ttl: Math.floor(Date.parse(idempotency.expiresAt) / 1000),
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    }] : []),
    {
      Put: {
        TableName: tableName,
        Item: {
          PK: businessPk(businessId),
          SK: formSubmissionSk(submission.id),
          entityType: 'FORM_SUBMISSION',
          businessId,
          formSubmissionId: submission.id,
          ...submission,
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    },
    ...responses.map((response) => ({
      Put: {
        TableName: tableName,
        Item: {
          PK: businessPk(businessId),
          SK: formResponseSk(response.id),
          entityType: 'FORM_RESPONSE',
          businessId,
          formResponseId: response.id,
          employeeId: submission.employeeId,
          ...response,
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    })),
    ...(workflowCompletion ? [workflowCompletion] : []),
  ];
  await ddb.send(new TransactWriteCommand({ TransactItems: transactionItems }));
  return { ok: true };
}

export async function listFormResponsesForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'FORM_RESPONSE#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.formResponseId,
    submissionId: item.submissionId,
    fieldId: item.fieldId,
    value: typeof item.value === 'string' ? item.value : JSON.stringify(item.value ?? ''),
    fileIds: Array.isArray(item.fileIds) ? item.fileIds : undefined,
    employeeId: item.employeeId,
  }));
}

export async function createFormResponseForBusiness({ businessId, formResponse }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: formResponseSk(formResponse.id),
        entityType: 'FORM_RESPONSE',
        businessId,
        formResponseId: formResponse.id,
        ...formResponse,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getFormResponseForBusiness(businessId, formResponseId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: formResponseSk(formResponseId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.formResponseId,
        submissionId: result.Item.submissionId,
        fieldId: result.Item.fieldId,
        value: typeof result.Item.value === 'string' ? result.Item.value : JSON.stringify(result.Item.value ?? ''),
        fileIds: Array.isArray(result.Item.fileIds) ? result.Item.fileIds : undefined,
        employeeId: result.Item.employeeId,
      }
    : null;
}

export async function updateFormResponseForBusiness({ businessId, formResponse }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: formResponseSk(formResponse.id),
        entityType: 'FORM_RESPONSE',
        businessId,
        formResponseId: formResponse.id,
        ...formResponse,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteFormResponseForBusiness(businessId, formResponseId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: formResponseSk(formResponseId),
      },
    })
  );

  return { ok: true };
}

export async function listEquipmentAssetsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'EQUIPMENT#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.equipmentId,
    name: item.name,
    type: item.type,
    status: item.status,
    costType: item.costType,
    equipmentClassification: item.equipmentClassification === 'overhead' ? 'overhead' : 'billable',
    serialNumber: item.serialNumber,
    purchaseDate: item.purchaseDate,
    hourlyCost: item.hourlyCost,
    costRateHourly: Number(item.costRateHourly ?? item.hourlyCost ?? 0),
    recommendedSellRate: Number(item.recommendedSellRate ?? 0),
    chargeOutRate: Number(item.chargeOutRate ?? item.recommendedSellRate ?? 0),
    purchasePrice: item.purchasePrice,
    equipmentPayment: item.equipmentPayment,
    equipmentPaymentFrequencyPerYear: item.equipmentPaymentFrequencyPerYear,
    fuelPriceUnit: item.fuelPriceUnit,
    averageFuelPrice: item.averageFuelPrice,
    averageFuelBurnPerHour: item.averageFuelBurnPerHour,
    yearlyFuelCost: item.yearlyFuelCost,
    yearlyInsuranceCost: item.yearlyInsuranceCost,
    yearlyMaintenanceCost: item.yearlyMaintenanceCost,
    rentalCost: item.rentalCost,
    rentalUnit: item.rentalUnit,
    currentJobId: item.currentJobId,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

export async function createEquipmentAssetForBusiness({ businessId, equipmentAsset }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: equipmentSk(equipmentAsset.id),
        entityType: 'EQUIPMENT_ASSET',
        businessId,
        equipmentId: equipmentAsset.id,
        ...equipmentAsset,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getEquipmentAssetForBusiness(businessId, equipmentId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: equipmentSk(equipmentId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.equipmentId,
        name: result.Item.name,
        type: result.Item.type,
        status: result.Item.status,
        costType: result.Item.costType,
        equipmentClassification: result.Item.equipmentClassification === 'overhead' ? 'overhead' : 'billable',
        serialNumber: result.Item.serialNumber,
        purchaseDate: result.Item.purchaseDate,
        hourlyCost: result.Item.hourlyCost,
        costRateHourly: Number(result.Item.costRateHourly ?? result.Item.hourlyCost ?? 0),
        recommendedSellRate: Number(result.Item.recommendedSellRate ?? 0),
        chargeOutRate: Number(result.Item.chargeOutRate ?? result.Item.recommendedSellRate ?? 0),
        purchasePrice: result.Item.purchasePrice,
        equipmentPayment: result.Item.equipmentPayment,
        equipmentPaymentFrequencyPerYear: result.Item.equipmentPaymentFrequencyPerYear,
        fuelPriceUnit: result.Item.fuelPriceUnit,
        averageFuelPrice: result.Item.averageFuelPrice,
        averageFuelBurnPerHour: result.Item.averageFuelBurnPerHour,
        yearlyFuelCost: result.Item.yearlyFuelCost,
        yearlyInsuranceCost: result.Item.yearlyInsuranceCost,
        yearlyMaintenanceCost: result.Item.yearlyMaintenanceCost,
        rentalCost: result.Item.rentalCost,
        rentalUnit: result.Item.rentalUnit,
        currentJobId: result.Item.currentJobId,
        notes: result.Item.notes,
        createdAt: result.Item.createdAt,
        updatedAt: result.Item.updatedAt,
      }
    : null;
}

export async function updateEquipmentAssetForBusiness({ businessId, equipmentAsset }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: equipmentSk(equipmentAsset.id),
        entityType: 'EQUIPMENT_ASSET',
        businessId,
        equipmentId: equipmentAsset.id,
        ...equipmentAsset,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteEquipmentAssetForBusiness(businessId, equipmentId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: equipmentSk(equipmentId),
      },
    })
  );

  return { ok: true };
}

export async function listMaterialCatalogItemsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'MATERIAL#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.materialId,
    name: item.name,
    unit: item.unit,
    defaultUnitCost: Number(item.defaultUnitCost ?? 0),
    active: item.active !== false,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

export async function createMaterialCatalogItemForBusiness({ businessId, materialCatalogItem }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: materialCatalogSk(materialCatalogItem.id),
        entityType: 'MATERIAL_CATALOG_ITEM',
        businessId,
        materialId: materialCatalogItem.id,
        ...materialCatalogItem,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getMaterialCatalogItemForBusiness(businessId, materialId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: materialCatalogSk(materialId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.materialId,
        name: result.Item.name,
        unit: result.Item.unit,
        defaultUnitCost: Number(result.Item.defaultUnitCost ?? 0),
        active: result.Item.active !== false,
        notes: result.Item.notes,
        createdAt: result.Item.createdAt,
        updatedAt: result.Item.updatedAt,
      }
    : null;
}

export async function updateMaterialCatalogItemForBusiness({ businessId, materialCatalogItem }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: materialCatalogSk(materialCatalogItem.id),
        entityType: 'MATERIAL_CATALOG_ITEM',
        businessId,
        materialId: materialCatalogItem.id,
        ...materialCatalogItem,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteMaterialCatalogItemForBusiness(businessId, materialId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: materialCatalogSk(materialId),
      },
    })
  );

  return { ok: true };
}

const normalizeSubcontractorCatalogItem = (item) => ({
  id: item.subcontractorId ?? item.id,
  name: item.name,
  contactName: item.contactName,
  email: item.email,
  phone: item.phone,
  trade: item.trade,
  unit: item.unit,
  defaultUnitCost: Number(item.defaultUnitCost ?? 0),
  notes: item.notes ?? '',
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

export async function listSubcontractorCatalogItemsForBusiness(businessId) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': 'SUBCONTRACTOR#' },
  }));
  return (result.Items ?? []).map(normalizeSubcontractorCatalogItem);
}

export async function getSubcontractorCatalogItemForBusiness(businessId, subcontractorId) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: subcontractorCatalogSk(subcontractorId) },
  }));
  return result.Item ? normalizeSubcontractorCatalogItem(result.Item) : null;
}

const putSubcontractorCatalogItem = async ({ businessId, subcontractorCatalogItem, exists }) => {
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: businessPk(businessId),
      SK: subcontractorCatalogSk(subcontractorCatalogItem.id),
      entityType: 'SUBCONTRACTOR_CATALOG_ITEM',
      businessId,
      subcontractorId: subcontractorCatalogItem.id,
      ...subcontractorCatalogItem,
    },
    ConditionExpression: exists ? 'attribute_exists(PK) AND attribute_exists(SK)' : 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));
  return { ok: true };
};

export const createSubcontractorCatalogItemForBusiness = (input) => putSubcontractorCatalogItem({ ...input, exists: false });
export const updateSubcontractorCatalogItemForBusiness = (input) => putSubcontractorCatalogItem({ ...input, exists: true });

export async function deleteSubcontractorCatalogItemForBusiness(businessId, subcontractorId) {
  await ddb.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: subcontractorCatalogSk(subcontractorId) },
  }));
  return { ok: true };
}

function normalizeLabourClass(labourClass) {
  return {
    id: labourClass.id ?? labourClass.labourClassId,
    businessId: labourClass.businessId,
    name: typeof labourClass.name === 'string' ? labourClass.name.trim() : '',
    description: typeof labourClass.description === 'string' ? labourClass.description.trim() : '',
    active: labourClass.active !== false,
    customRates: labourClass.customRates && typeof labourClass.customRates === 'object' ? labourClass.customRates : {},
    createdAt: labourClass.createdAt,
    updatedAt: labourClass.updatedAt,
  };
}

export async function listLabourClassesForBusiness(businessId) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': 'LABOUR_CLASS#' },
  }));
  return (result.Items ?? []).map(normalizeLabourClass);
}

export async function getLabourClassForBusiness(businessId, labourClassId) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: labourClassSk(labourClassId) },
  }));
  return result.Item ? normalizeLabourClass(result.Item) : null;
}

export async function createLabourClassForBusiness({ businessId, labourClass }) {
  const instant = nowIso();
  const normalized = normalizeLabourClass({ ...labourClass, businessId, createdAt: labourClass.createdAt || instant, updatedAt: instant });
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: { PK: businessPk(businessId), SK: labourClassSk(normalized.id), entityType: 'LABOUR_CLASS', labourClassId: normalized.id, ...normalized },
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));
  return { ok: true };
}

export async function updateLabourClassForBusiness({ businessId, labourClass }) {
  const normalized = normalizeLabourClass({ ...labourClass, businessId, updatedAt: nowIso() });
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: { PK: businessPk(businessId), SK: labourClassSk(normalized.id), entityType: 'LABOUR_CLASS', labourClassId: normalized.id, ...normalized },
    ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
  }));
  return { ok: true };
}

export async function archiveLabourClassForBusiness(businessId, labourClassId) {
  const labourClass = await getLabourClassForBusiness(businessId, labourClassId);
  if (!labourClass) return { ok: false, error: 'Labour Class not found.' };
  return updateLabourClassForBusiness({ businessId, labourClass: { ...labourClass, active: false } });
}

function normalizedLabourClassName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

function labourClassSetupId(businessId, normalizedName) {
  return `class-${createHash('sha256').update(`${businessId}\0${normalizedName}`).digest('hex').slice(0, 24)}`;
}

export async function applyLabourClassSetupForBusiness({ businessId, classes, assignments }) {
  const [existingClasses, employees] = await Promise.all([
    listLabourClassesForBusiness(businessId),
    listEmployeesForBusiness(businessId),
  ]);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const existingByName = new Map(existingClasses.map((labourClass) => [normalizedLabourClassName(labourClass.name), labourClass]));
  const requestedByKey = new Map();
  const resultingByName = new Map(existingByName);
  const classesToWrite = [];
  const instant = nowIso();

  for (const input of Array.isArray(classes) ? classes : []) {
    const key = typeof input?.key === 'string' ? input.key.trim() : '';
    const name = typeof input?.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
    const normalizedName = normalizedLabourClassName(name);
    if (!key || !normalizedName) return { ok: false, error: 'Every Labour Class needs a name.' };
    if (requestedByKey.has(key)) return { ok: false, error: 'Labour Class setup contains a duplicate class key.' };

    const existing = resultingByName.get(normalizedName);
    const labourClass = existing ?? {
      id: labourClassSetupId(businessId, normalizedName),
      businessId,
      name,
      description: '',
      active: true,
      customRates: {},
      createdAt: instant,
      updatedAt: instant,
    };
    const activated = labourClass.active === false ? { ...labourClass, active: true, updatedAt: instant } : labourClass;
    requestedByKey.set(key, activated);
    resultingByName.set(normalizedName, activated);
    if (!existing || existing.active === false) classesToWrite.push(activated);
  }

  const employeeAssignments = [];
  const assignedEmployeeIds = new Set();
  for (const input of Array.isArray(assignments) ? assignments : []) {
    const employeeId = typeof input?.employeeId === 'string' ? input.employeeId.trim() : '';
    if (!employeeId || !employeeById.has(employeeId)) return { ok: false, error: 'Employee not found for this business.' };
    if (assignedEmployeeIds.has(employeeId)) return { ok: false, error: 'Each Employee can only be assigned once.' };
    assignedEmployeeIds.add(employeeId);
    if (input.classKey === null || input.classKey === undefined || input.classKey === '') {
      employeeAssignments.push({ employee: employeeById.get(employeeId), labourClassId: null });
      continue;
    }
    const labourClass = requestedByKey.get(input.classKey);
    if (!labourClass) return { ok: false, error: 'Employee assignment references an unknown Labour Class.' };
    employeeAssignments.push({ employee: employeeById.get(employeeId), labourClassId: labourClass.id });
  }

  const transactItems = [
    ...classesToWrite.map((labourClass) => ({ Put: {
      TableName: tableName,
      Item: { PK: businessPk(businessId), SK: labourClassSk(labourClass.id), entityType: 'LABOUR_CLASS', labourClassId: labourClass.id, ...labourClass },
    } })),
    ...employeeAssignments.map(({ employee, labourClassId }) => ({ Update: {
      TableName: tableName,
      Key: { PK: businessPk(businessId), SK: employeeSk(employee.id) },
      UpdateExpression: 'SET labourClassId = :labourClassId',
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
      ExpressionAttributeValues: { ':labourClassId': labourClassId },
    } })),
  ];
  if (transactItems.length > 100) return { ok: false, error: 'Labour Class setup is limited to 100 changes at a time.' };
  if (transactItems.length > 0) await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  const assignmentByEmployeeId = new Map(employeeAssignments.map((item) => [item.employee.id, item.labourClassId]));
  return {
    ok: true,
    labourClasses: [...resultingByName.values()],
    employees: employees.map((employee) => assignmentByEmployeeId.has(employee.id)
      ? { ...employee, labourClassId: assignmentByEmployeeId.get(employee.id) }
      : employee),
  };
}

export async function listUnbillableTimeCategoriesForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'UNBILLABLE_CATEGORY#',
      },
    })
  );

  return (result.Items ?? [])
    .map((item) => ({
      id: item.categoryId,
      name: item.name,
      description: item.description ?? '',
      sortOrder: Number(item.sortOrder ?? 0),
      active: item.active !== false,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });
}

export async function createUnbillableTimeCategoryForBusiness({ businessId, category }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: unbillableTimeCategorySk(category.id),
        entityType: 'UNBILLABLE_TIME_CATEGORY',
        businessId,
        categoryId: category.id,
        ...category,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getUnbillableTimeCategoryForBusiness(businessId, categoryId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: unbillableTimeCategorySk(categoryId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.categoryId,
        name: result.Item.name,
        description: result.Item.description ?? '',
        sortOrder: Number(result.Item.sortOrder ?? 0),
        active: result.Item.active !== false,
        createdAt: result.Item.createdAt,
        updatedAt: result.Item.updatedAt,
      }
    : null;
}

export async function updateUnbillableTimeCategoryForBusiness({ businessId, category }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: unbillableTimeCategorySk(category.id),
        entityType: 'UNBILLABLE_TIME_CATEGORY',
        businessId,
        categoryId: category.id,
        ...category,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteUnbillableTimeCategoryForBusiness(businessId, categoryId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: unbillableTimeCategorySk(categoryId),
      },
    })
  );

  return { ok: true };
}

export async function listTasksForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'TASK#',
      },
    })
  );

  return (result.Items ?? [])
    .map((item) => ({
      id: item.taskId,
      parentTaskId: item.parentTaskId,
      title: item.title,
      description: item.description,
      dueDate: item.dueDate,
      assignedUserId: item.assignedUserId,
      status: item.status,
      priority: item.priority,
      taskTabId: item.taskTabId,
      headingId: item.headingId,
      relatedEntityType: item.relatedEntityType,
      relatedEntityId: item.relatedEntityId,
      createdByUserId: item.createdByUserId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      completedAt: item.completedAt,
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function createTaskForBusiness({ businessId, task }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: taskSk(task.id),
        entityType: 'TASK',
        businessId,
        taskId: task.id,
        ...task,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getTaskForBusiness(businessId, taskId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: taskSk(taskId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.taskId,
        parentTaskId: result.Item.parentTaskId,
        title: result.Item.title,
        description: result.Item.description,
        dueDate: result.Item.dueDate,
        assignedUserId: result.Item.assignedUserId,
        status: result.Item.status,
        priority: result.Item.priority,
        taskTabId: result.Item.taskTabId,
        headingId: result.Item.headingId,
        relatedEntityType: result.Item.relatedEntityType,
        relatedEntityId: result.Item.relatedEntityId,
        createdByUserId: result.Item.createdByUserId,
        createdAt: result.Item.createdAt,
        updatedAt: result.Item.updatedAt,
        completedAt: result.Item.completedAt,
      }
    : null;
}

export async function updateTaskForBusiness({ businessId, task }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: taskSk(task.id),
        entityType: 'TASK',
        businessId,
        taskId: task.id,
        ...task,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteTaskForBusiness(businessId, taskId) {
  const tasks = await listTasksForBusiness(businessId);
  const taskIds = [taskId, ...tasks.filter((task) => task.parentTaskId === taskId).map((task) => task.id)];
  await Promise.all(taskIds.map((id) => ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: taskSk(id),
      },
    })
  )));

  return { ok: true };
}

export async function listJobTaskHeadingsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'JOB_TASK_HEADING#',
      },
    })
  );

  return (result.Items ?? [])
    .map((item) => ({
      id: item.headingId,
      businessId: item.businessId,
      jobId: item.jobId,
      name: item.name,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt));
}

export async function getJobTaskHeadingForBusiness(businessId, headingId) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: jobTaskHeadingSk(headingId) },
  }));
  if (!result.Item) return null;
  return {
    id: result.Item.headingId,
    businessId: result.Item.businessId,
    jobId: result.Item.jobId,
    name: result.Item.name,
    sortOrder: result.Item.sortOrder,
    createdAt: result.Item.createdAt,
    updatedAt: result.Item.updatedAt,
  };
}

export async function createJobTaskHeadingForBusiness({ businessId, heading }) {
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: businessPk(businessId),
      SK: jobTaskHeadingSk(heading.id),
      entityType: 'JOB_TASK_HEADING',
      businessId,
      headingId: heading.id,
      ...heading,
    },
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));
  return { ok: true };
}

export async function updateJobTaskHeadingForBusiness({ businessId, heading }) {
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: businessPk(businessId),
      SK: jobTaskHeadingSk(heading.id),
      entityType: 'JOB_TASK_HEADING',
      businessId,
      headingId: heading.id,
      ...heading,
    },
    ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
  }));
  return { ok: true };
}

export async function deleteJobTaskHeadingForBusiness(businessId, headingId) {
  await ddb.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: jobTaskHeadingSk(headingId) },
  }));
  return { ok: true };
}

export async function listFeedbackForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'FEEDBACK#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.feedbackId,
    businessId: item.businessId,
    submittedByUserId: item.submittedByUserId,
    submittedByRole: item.submittedByRole,
    type: item.type,
    message: item.message,
    route: item.route,
    userAgent: item.userAgent,
    viewport: item.viewport,
    deviceCategory: item.deviceCategory,
    appVersion: item.appVersion,
    status: item.status,
    priority: item.priority,
    screenshotFileId: item.screenshotFileId,
    contactPreference: Boolean(item.contactPreference),
    contactEmail: item.contactEmail,
    emailNotification: item.emailNotification,
    internalNotes: item.internalNotes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

export async function createFeedbackForBusiness({ businessId, feedback }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: feedbackSk(feedback.id),
        entityType: 'FEEDBACK',
        businessId,
        feedbackId: feedback.id,
        ...feedback,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getFeedbackForBusiness(businessId, feedbackId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: feedbackSk(feedbackId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.feedbackId,
        businessId: result.Item.businessId,
        submittedByUserId: result.Item.submittedByUserId,
        submittedByRole: result.Item.submittedByRole,
        type: result.Item.type,
        message: result.Item.message,
        route: result.Item.route,
        userAgent: result.Item.userAgent,
        viewport: result.Item.viewport,
        deviceCategory: result.Item.deviceCategory,
        appVersion: result.Item.appVersion,
        status: result.Item.status,
        priority: result.Item.priority,
        screenshotFileId: result.Item.screenshotFileId,
        contactPreference: Boolean(result.Item.contactPreference),
        contactEmail: result.Item.contactEmail,
        emailNotification: result.Item.emailNotification,
        internalNotes: result.Item.internalNotes,
        createdAt: result.Item.createdAt,
        updatedAt: result.Item.updatedAt,
      }
    : null;
}

export async function updateFeedbackForBusiness({ businessId, feedback }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: feedbackSk(feedback.id),
        entityType: 'FEEDBACK',
        businessId,
        feedbackId: feedback.id,
        ...feedback,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteFeedbackForBusiness(businessId, feedbackId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: feedbackSk(feedbackId),
      },
    })
  );

  return { ok: true };
}

export async function listBudgetsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'BUDGET_META#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.budgetId,
    budgetGroupId: item.budgetGroupId,
    name: item.name,
    budgetType: item.budgetType,
    division: item.division,
    fiscalYear: item.fiscalYear,
    description: item.description,
    startDate: item.startDate,
    endDate: item.endDate,
    planningModel: item.planningModel,
    status: item.status,
    overheadRecoveryAllocation: item.overheadRecoveryAllocation,
    overheadRecoveryPolicy: item.overheadRecoveryPolicy,
    desiredNetProfit: Number(item.desiredNetProfit ?? 0),
    targetMarginPct: Number(item.targetMarginPct ?? 20),
    equipmentUtilizationHours: Number(item.equipmentUtilizationHours ?? 120),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

export async function createBudgetForBusiness({ businessId, budget }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: budgetMetaSk(budget.id),
        entityType: 'BUDGET',
        businessId,
        budgetId: budget.id,
        ...budget,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getBudgetForBusiness(businessId, budgetId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: budgetMetaSk(budgetId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.budgetId,
        budgetGroupId: result.Item.budgetGroupId,
        name: result.Item.name,
        budgetType: result.Item.budgetType,
        division: result.Item.division,
        fiscalYear: result.Item.fiscalYear,
        description: result.Item.description,
        startDate: result.Item.startDate,
        endDate: result.Item.endDate,
        planningModel: result.Item.planningModel,
        status: result.Item.status,
        overheadRecoveryAllocation: result.Item.overheadRecoveryAllocation,
        overheadRecoveryPolicy: result.Item.overheadRecoveryPolicy,
        desiredNetProfit: Number(result.Item.desiredNetProfit ?? 0),
        targetMarginPct: Number(result.Item.targetMarginPct ?? 20),
        equipmentUtilizationHours: Number(result.Item.equipmentUtilizationHours ?? 120),
        createdAt: result.Item.createdAt,
        updatedAt: result.Item.updatedAt,
      }
    : null;
}

export async function updateBudgetForBusiness({ businessId, budget }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: budgetMetaSk(budget.id),
        entityType: 'BUDGET',
        businessId,
        budgetId: budget.id,
        ...budget,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteBudgetForBusiness(businessId, budgetId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: budgetMetaSk(budgetId),
      },
    })
  );

  return { ok: true };
}

function mapBudgetDivision(item) {
  return {
    id: item.divisionId,
    budgetId: item.budgetId,
    name: item.name,
    costCode: typeof item.costCode === 'string' ? item.costCode : '',
    description: item.description,
    revenueTarget: Number(item.revenueTarget ?? 0),
    status: item.status === 'archived' ? 'archived' : 'active',
    sortOrder: Number(item.sortOrder ?? 0),
    overheadRecoveryPolicy: item.overheadRecoveryPolicy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function listBudgetDivisionsForBusiness(businessId) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': businessPk(businessId),
      ':prefix': 'BUDGET_DIVISION#',
    },
  }));
  return (result.Items ?? []).map(mapBudgetDivision);
}

export async function listBudgetDivisionsForBudget(businessId, budgetId) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': businessPk(businessId),
      ':prefix': budgetDivisionPrefix(budgetId),
    },
  }));
  return (result.Items ?? []).map(mapBudgetDivision);
}

export async function getBudgetDivisionForBusiness(businessId, budgetId, divisionId) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: {
      PK: businessPk(businessId),
      SK: budgetDivisionSk(budgetId, divisionId),
    },
  }));
  if (!result.Item || result.Item.businessId !== businessId || result.Item.budgetId !== budgetId) return null;
  return mapBudgetDivision(result.Item);
}

export async function createBudgetDivisionForBusiness({ businessId, division }) {
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: businessPk(businessId),
      SK: budgetDivisionSk(division.budgetId, division.id),
      entityType: 'BUDGET_DIVISION',
      businessId,
      budgetId: division.budgetId,
      divisionId: division.id,
      ...division,
    },
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));
  return getBudgetDivisionForBusiness(businessId, division.budgetId, division.id);
}

export async function updateBudgetDivisionForBusiness({ businessId, division }) {
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: businessPk(businessId),
      SK: budgetDivisionSk(division.budgetId, division.id),
      entityType: 'BUDGET_DIVISION',
      businessId,
      budgetId: division.budgetId,
      divisionId: division.id,
      ...division,
    },
    ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
  }));
  return getBudgetDivisionForBusiness(businessId, division.budgetId, division.id);
}

export async function deleteBudgetDivisionForBusiness(businessId, budgetId, divisionId) {
  await ddb.send(new DeleteCommand({
    TableName: tableName,
    Key: {
      PK: businessPk(businessId),
      SK: budgetDivisionSk(budgetId, divisionId),
    },
    ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
  }));
  return { ok: true };
}

export async function listBudgetItemsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'BUDGET#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.budgetItemId,
    budgetId: item.budgetId,
    category: item.category,
    equipmentId: item.equipmentId,
    equipmentCostType: item.equipmentCostType === 'other' ? 'owned' : item.equipmentCostType,
    equipmentClassification: item.equipmentClassification === 'overhead' ? 'overhead' : 'billable',
    costCode: item.costCode,
    equipmentPayment: item.equipmentPayment,
    equipmentPaymentFrequencyPerYear: item.equipmentPaymentFrequencyPerYear,
    fuelPriceUnit: item.fuelPriceUnit,
    averageFuelPrice: item.averageFuelPrice,
    averageFuelBurnPerHour: item.averageFuelBurnPerHour,
    yearlyFuelCost: item.yearlyFuelCost,
    fuelCostPerHour: item.fuelCostPerHour,
    yearlyInsuranceCost: item.yearlyInsuranceCost ?? ((item.monthlyInsuranceCost ?? 0) * 12),
    yearlyMaintenanceCost: item.yearlyMaintenanceCost ?? ((item.monthlyMaintenanceCost ?? 0) * 12),
    equipmentHoursPerDay: item.equipmentHoursPerDay,
    monthlyInsuranceCost: item.monthlyInsuranceCost,
    monthlyMaintenanceCost: item.monthlyMaintenanceCost,
    sellableHoursPerYear: item.sellableHoursPerYear,
    actualMachineHoursPerYear: item.actualMachineHoursPerYear,
    monthsUsedPerYear: item.monthsUsedPerYear,
    equipmentCostAllocationPercent: item.equipmentCostAllocationPercent,
    sortOrder: item.sortOrder,
    description: item.description,
    budgeted: item.budgeted,
    actual: item.actual,
    period: item.period,
  }));
}

export async function listBudgetRatesForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'BUDGET_RATE#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.rateId,
    budgetId: item.budgetId,
    category: item.category,
    itemName: item.itemName,
    description: item.description ?? '',
    unit: item.unit,
    unitCost: item.unitCost,
    budgetItemId: item.budgetItemId,
    employeeId: item.employeeId,
    equipmentId: item.equipmentId,
    materialCatalogItemId: item.materialCatalogItemId,
    vendorId: item.vendorId,
    pricingVersion: item.pricingVersion,
    divisionId: item.divisionId,
    directCostPerUnit: item.directCostPerUnit,
    divisionOverheadRecoveryPerUnit: item.divisionOverheadRecoveryPerUnit,
    companyOverheadRecoveryPerUnit: item.companyOverheadRecoveryPerUnit,
    recoveredCostPerUnit: item.recoveredCostPerUnit,
    overheadRecoveryPerUnit: Number(item.overheadRecoveryPerUnit ?? 0),
    targetMarginPercent: Number(item.targetMarginPercent ?? 0),
    recommendedSellPrice: Number(item.recommendedSellPrice ?? item.defaultSellPrice ?? 0),
    customRate: item.customRate ?? null,
    defaultMarkupPercent: item.defaultMarkupPercent,
    defaultSellPrice: item.defaultSellPrice,
    active: item.active !== false,
    sortOrder: item.sortOrder ?? 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

export async function createBudgetRateForBusiness({ businessId, budgetRate }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: budgetRateSk(budgetRate.id),
        entityType: 'BUDGET_RATE',
        businessId,
        rateId: budgetRate.id,
        ...budgetRate,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getBudgetRateForBusiness(businessId, rateId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: budgetRateSk(rateId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.rateId,
        budgetId: result.Item.budgetId,
        category: result.Item.category,
        itemName: result.Item.itemName,
        description: result.Item.description ?? '',
        unit: result.Item.unit,
        unitCost: result.Item.unitCost,
        budgetItemId: result.Item.budgetItemId,
        employeeId: result.Item.employeeId,
        equipmentId: result.Item.equipmentId,
        materialCatalogItemId: result.Item.materialCatalogItemId,
        vendorId: result.Item.vendorId,
        pricingVersion: result.Item.pricingVersion,
        divisionId: result.Item.divisionId,
        directCostPerUnit: result.Item.directCostPerUnit,
        divisionOverheadRecoveryPerUnit: result.Item.divisionOverheadRecoveryPerUnit,
        companyOverheadRecoveryPerUnit: result.Item.companyOverheadRecoveryPerUnit,
        recoveredCostPerUnit: result.Item.recoveredCostPerUnit,
        overheadRecoveryPerUnit: Number(result.Item.overheadRecoveryPerUnit ?? 0),
        targetMarginPercent: Number(result.Item.targetMarginPercent ?? 0),
        recommendedSellPrice: Number(result.Item.recommendedSellPrice ?? result.Item.defaultSellPrice ?? 0),
        customRate: result.Item.customRate ?? null,
        defaultMarkupPercent: result.Item.defaultMarkupPercent,
        defaultSellPrice: result.Item.defaultSellPrice,
        active: result.Item.active !== false,
        sortOrder: result.Item.sortOrder ?? 0,
        createdAt: result.Item.createdAt,
        updatedAt: result.Item.updatedAt,
      }
    : null;
}

export async function updateBudgetRateForBusiness({ businessId, budgetRate }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: budgetRateSk(budgetRate.id),
        entityType: 'BUDGET_RATE',
        businessId,
        rateId: budgetRate.id,
        ...budgetRate,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteBudgetRateForBusiness(businessId, rateId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: budgetRateSk(rateId),
      },
    })
  );

  return { ok: true };
}

function mapEstimateRecordFromItem(item) {
  const legacyTitle = [
    item.title,
    item.name,
    item.estimateName,
    item.projectName,
    item.proposalTitle,
    item.displayName,
  ].find((value) => typeof value === 'string' && value.trim());
  const title = legacyTitle?.trim()
    || (typeof item.proposalNumber === 'string' && item.proposalNumber.trim()
      ? `Draft Estimate ${item.proposalNumber.trim()}`
      : 'Untitled Estimate');

  return {
    id: item.estimateId,
    customerId: item.customerId,
    convertedToJobId: item.convertedToJobId,
    convertedAt: item.convertedAt,
    proposalNumber: item.proposalNumber,
    title,
    description: item.description,
    workAreas: Array.isArray(item.workAreas) ? item.workAreas : undefined,
    pricingBudgetId: item.pricingBudgetId,
    divisionId: item.divisionId,
    propertyLabel: item.propertyLabel,
    propertyAddressSnapshot: item.propertyAddressSnapshot,
    status: item.status,
    lineItems: item.lineItems ?? [],
    taxRate: item.taxRate,
    notes: item.notes,
    validUntil: item.validUntil,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    sentAt: item.sentAt,
    templateId: item.templateId,
  };
}

function mapJobRecordFromItem(item) {
  return {
    id: item.jobId,
    jobNumber: item.jobNumber,
    estimateId: item.estimateId,
    sourceEstimateId: item.sourceEstimateId,
    convertedFromEstimateAt: item.convertedFromEstimateAt,
    convertedByUserId: item.convertedByUserId,
    convertedByUserName: item.convertedByUserName,
    customerId: item.customerId,
    pricingBudgetId: item.pricingBudgetId,
    crewId: item.crewId,
    divisionId: item.divisionId,
    propertyLabel: item.propertyLabel,
    propertyAddressSnapshot: item.propertyAddressSnapshot,
    title: item.title,
    description: item.description,
    workAreas: Array.isArray(item.workAreas) ? item.workAreas : [],
    operationalWorkAreas: Array.isArray(item.operationalWorkAreas) ? item.operationalWorkAreas : undefined,
    originalEstimateSnapshot: item.originalEstimateSnapshot,
    planningSnapshotVersion: item.planningSnapshotVersion,
    planningRevision: item.planningRevision,
    status: item.status,
    startDate: item.startDate,
    endDate: item.endDate,
    scheduleConfirmed: item.scheduleConfirmed,
    scheduledStartAt: item.scheduledStartAt,
    scheduledEndAt: item.scheduledEndAt,
    scheduleAllDay: item.scheduleAllDay,
    scheduleNotes: item.scheduleNotes,
    scheduleOccurrences: Array.isArray(item.scheduleOccurrences) ? item.scheduleOccurrences : undefined,
    estimatedHours: item.estimatedHours,
    actualHours: item.actualHours,
    estimatedCost: item.estimatedCost,
    currentPlannedCost: item.currentPlannedCost,
    originalContractRevenue: item.originalContractRevenue,
    currentContractRevenue: item.currentContractRevenue,
    actualCosts: item.actualCosts ?? [],
    contractValue: item.contractValue,
    assignedEmployeeIds: item.assignedEmployeeIds ?? [],
    assignedEquipmentIds: item.assignedEquipmentIds ?? [],
    taskHeaderLabels: item.taskHeaderLabels,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function mapTemplateRecordFromItem(item) {
  return {
    id: item.templateId,
    name: item.name,
    description: item.description,
    workAreas: Array.isArray(item.workAreas) ? item.workAreas : undefined,
    lineItems: item.lineItems ?? [],
    taxRate: item.taxRate,
    notes: item.notes,
    createdAt: item.createdAt,
  };
}

export async function createBudgetItemForBusiness({ businessId, budgetItem }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: budgetSk(budgetItem.id),
        entityType: 'BUDGET_ITEM',
        businessId,
        budgetItemId: budgetItem.id,
        ...budgetItem,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getBudgetItemForBusiness(businessId, budgetItemId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: budgetSk(budgetItemId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.budgetItemId,
        budgetId: result.Item.budgetId,
        category: result.Item.category,
      equipmentId: result.Item.equipmentId,
      equipmentCostType: result.Item.equipmentCostType === 'other' ? 'owned' : result.Item.equipmentCostType,
        equipmentClassification: result.Item.equipmentClassification === 'overhead' ? 'overhead' : 'billable',
        costCode: result.Item.costCode,
        equipmentPayment: result.Item.equipmentPayment,
        equipmentPaymentFrequencyPerYear: result.Item.equipmentPaymentFrequencyPerYear,
        fuelPriceUnit: result.Item.fuelPriceUnit,
        averageFuelPrice: result.Item.averageFuelPrice,
        averageFuelBurnPerHour: result.Item.averageFuelBurnPerHour,
        yearlyFuelCost: result.Item.yearlyFuelCost,
        fuelCostPerHour: result.Item.fuelCostPerHour,
        yearlyInsuranceCost: result.Item.yearlyInsuranceCost ?? ((result.Item.monthlyInsuranceCost ?? 0) * 12),
        yearlyMaintenanceCost: result.Item.yearlyMaintenanceCost ?? ((result.Item.monthlyMaintenanceCost ?? 0) * 12),
        equipmentHoursPerDay: result.Item.equipmentHoursPerDay,
        monthlyInsuranceCost: result.Item.monthlyInsuranceCost,
        monthlyMaintenanceCost: result.Item.monthlyMaintenanceCost,
        sellableHoursPerYear: result.Item.sellableHoursPerYear,
        actualMachineHoursPerYear: result.Item.actualMachineHoursPerYear,
        monthsUsedPerYear: result.Item.monthsUsedPerYear,
        equipmentCostAllocationPercent: result.Item.equipmentCostAllocationPercent,
        sortOrder: result.Item.sortOrder,
        description: result.Item.description,
        budgeted: result.Item.budgeted,
        actual: result.Item.actual,
        period: result.Item.period,
      }
    : null;
}

export async function updateBudgetItemForBusiness({ businessId, budgetItem }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: budgetSk(budgetItem.id),
        entityType: 'BUDGET_ITEM',
        businessId,
        budgetItemId: budgetItem.id,
        ...budgetItem,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export function isCompleteEquipmentOrder(existingIds, orderedIds) {
  const existingIdSet = new Set(existingIds);
  return orderedIds.length === existingIdSet.size
    && new Set(orderedIds).size === orderedIds.length
    && orderedIds.every((id) => existingIdSet.has(id));
}

export async function reorderBudgetEquipmentForBusiness({ businessId, budgetId, orderedIds }) {
  const budgetItems = await listBudgetItemsForBusiness(businessId);
  const equipmentItems = budgetItems.filter((item) => item.budgetId === budgetId && item.category === 'equipment');
  if (!isCompleteEquipmentOrder(equipmentItems.map((item) => item.id), orderedIds)) {
    return { ok: false, code: 'INVALID_EQUIPMENT_ORDER', error: 'Equipment order must include every equipment row in this budget exactly once.' };
  }
  if (orderedIds.length === 0) return { ok: true };

  await ddb.send(new TransactWriteCommand({
    TransactItems: orderedIds.map((id, sortOrder) => ({
      Update: {
        TableName: tableName,
        Key: { PK: businessPk(businessId), SK: budgetSk(id) },
        UpdateExpression: 'SET sortOrder = :sortOrder',
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND budgetId = :budgetId AND category = :category',
        ExpressionAttributeValues: {
          ':sortOrder': sortOrder,
          ':budgetId': budgetId,
          ':category': 'equipment',
        },
      },
    })),
  }));
  return { ok: true };
}

export async function deleteBudgetItemForBusiness(businessId, budgetItemId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: budgetSk(budgetItemId),
      },
    })
  );

  return { ok: true };
}

export async function listLabourBudgetPlansForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'LABOUR_BUDGET#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.labourBudgetPlanId,
    budgetId: item.budgetId,
    employeeId: item.employeeId,
    year: item.year,
    compType: item.compType,
    description: item.description,
    sortOrder: item.sortOrder,
    hoursPerYear: item.hoursPerYear,
    billablePct: item.billablePct,
    overtimeFactorPct: item.overtimeFactorPct,
    payrollBurdenPct: item.payrollBurdenPct,
    benefitsExtraCost: item.benefitsExtraCost,
    bonus: item.bonus,
    billableHoursYear: item.billableHoursYear,
    unbillableHoursYear: item.unbillableHoursYear,
    overtimeHoursYear: item.overtimeHoursYear,
    overtimeMultiplier: item.overtimeMultiplier,
    hourlyRate: item.hourlyRate,
    annualSalary: item.annualSalary,
    labourBurdenPct: item.labourBurdenPct,
  }));
}

export async function createLabourBudgetPlanForBusiness({ businessId, labourBudgetPlan }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: labourBudgetPlanSk(labourBudgetPlan.id),
        entityType: 'LABOUR_BUDGET_PLAN',
        businessId,
        labourBudgetPlanId: labourBudgetPlan.id,
        ...labourBudgetPlan,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getLabourBudgetPlanForBusiness(businessId, labourBudgetPlanId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: labourBudgetPlanSk(labourBudgetPlanId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.labourBudgetPlanId,
        budgetId: result.Item.budgetId,
        employeeId: result.Item.employeeId,
        year: result.Item.year,
        compType: result.Item.compType,
        description: result.Item.description,
        sortOrder: result.Item.sortOrder,
        hoursPerYear: result.Item.hoursPerYear,
        billablePct: result.Item.billablePct,
        overtimeFactorPct: result.Item.overtimeFactorPct,
        payrollBurdenPct: result.Item.payrollBurdenPct,
        benefitsExtraCost: result.Item.benefitsExtraCost,
        bonus: result.Item.bonus,
        billableHoursYear: result.Item.billableHoursYear,
        unbillableHoursYear: result.Item.unbillableHoursYear,
        overtimeHoursYear: result.Item.overtimeHoursYear,
        overtimeMultiplier: result.Item.overtimeMultiplier,
        hourlyRate: result.Item.hourlyRate,
        annualSalary: result.Item.annualSalary,
        labourBurdenPct: result.Item.labourBurdenPct,
      }
    : null;
}

export async function updateLabourBudgetPlanForBusiness({ businessId, labourBudgetPlan }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: labourBudgetPlanSk(labourBudgetPlan.id),
        entityType: 'LABOUR_BUDGET_PLAN',
        businessId,
        labourBudgetPlanId: labourBudgetPlan.id,
        ...labourBudgetPlan,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteLabourBudgetPlanForBusiness(businessId, labourBudgetPlanId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: labourBudgetPlanSk(labourBudgetPlanId),
      },
    })
  );

  return { ok: true };
}

export async function listLabourHoursSalesGoalsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'LABOUR_HOURS_GOAL#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.labourHoursSalesGoalId,
    budgetId: item.budgetId,
    year: item.year,
    hoursGoal: item.hoursGoal,
  }));
}

export async function createLabourHoursSalesGoalForBusiness({ businessId, labourHoursSalesGoal }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: labourHoursSalesGoalSk(labourHoursSalesGoal.id),
        entityType: 'LABOUR_HOURS_SALES_GOAL',
        businessId,
        labourHoursSalesGoalId: labourHoursSalesGoal.id,
        ...labourHoursSalesGoal,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getLabourHoursSalesGoalForBusiness(businessId, labourHoursSalesGoalId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: labourHoursSalesGoalSk(labourHoursSalesGoalId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.labourHoursSalesGoalId,
        budgetId: result.Item.budgetId,
        year: result.Item.year,
        hoursGoal: result.Item.hoursGoal,
      }
    : null;
}

export async function updateLabourHoursSalesGoalForBusiness({ businessId, labourHoursSalesGoal }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: labourHoursSalesGoalSk(labourHoursSalesGoal.id),
        entityType: 'LABOUR_HOURS_SALES_GOAL',
        businessId,
        labourHoursSalesGoalId: labourHoursSalesGoal.id,
        ...labourHoursSalesGoal,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteLabourHoursSalesGoalForBusiness(businessId, labourHoursSalesGoalId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: labourHoursSalesGoalSk(labourHoursSalesGoalId),
      },
    })
  );

  return { ok: true };
}

export async function listRevenueSalesGoalsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'REVENUE_GOAL#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.revenueSalesGoalId,
    budgetId: item.budgetId,
    scopeType: item.scopeType,
    scopeValue: item.scopeValue,
    goalRevenue: item.goalRevenue,
    workingDays: item.workingDays,
  }));
}

export async function createRevenueSalesGoalForBusiness({ businessId, revenueSalesGoal }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: revenueSalesGoalSk(revenueSalesGoal.id),
        entityType: 'REVENUE_SALES_GOAL',
        businessId,
        revenueSalesGoalId: revenueSalesGoal.id,
        ...revenueSalesGoal,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getRevenueSalesGoalForBusiness(businessId, revenueSalesGoalId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: revenueSalesGoalSk(revenueSalesGoalId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.revenueSalesGoalId,
        budgetId: result.Item.budgetId,
        scopeType: result.Item.scopeType,
        scopeValue: result.Item.scopeValue,
        goalRevenue: result.Item.goalRevenue,
        workingDays: result.Item.workingDays,
      }
    : null;
}

export async function updateRevenueSalesGoalForBusiness({ businessId, revenueSalesGoal }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: revenueSalesGoalSk(revenueSalesGoal.id),
        entityType: 'REVENUE_SALES_GOAL',
        businessId,
        revenueSalesGoalId: revenueSalesGoal.id,
        ...revenueSalesGoal,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteRevenueSalesGoalForBusiness(businessId, revenueSalesGoalId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: revenueSalesGoalSk(revenueSalesGoalId),
      },
    })
  );

  return { ok: true };
}

export async function listEmployeesForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'EMPLOYEE#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    id: item.employeeId,
    name: item.name,
    email: item.email,
    phone: item.phone,
    role: normalizeEmployeeRole(item.role),
    hourlyRate: item.hourlyRate,
    compensationType: item.compensationType ?? 'hourly',
    labourType: item.labourType ?? 'field_producing',
    labourClassId: typeof item.labourClassId === 'string' && item.labourClassId.trim() ? item.labourClassId.trim() : null,
    payrollBurdenPct: item.payrollBurdenPct,
    benefitsExtraCost: item.benefitsExtraCost,
    bonus: item.bonus,
    userId: typeof item.userId === 'string' && item.userId.trim() ? item.userId.trim() : null,
    active: item.active,
    createdAt: item.createdAt,
  }));
}

export async function createEmployeeForBusiness({ businessId, employee }) {
  const nextEmployee = normalizeEmployeeForWrite(employee);
  const existingEmployees = await listEmployeesForBusiness(businessId);
  const normalizedEmail = typeof nextEmployee.email === 'string' ? normalizeEmail(nextEmployee.email) : '';
  const existingEmployee = normalizedEmail
    ? existingEmployees.find((item) => normalizeEmail(item.email) === normalizedEmail)
    : null;

  if (existingEmployee) {
    return { ok: true, existing: true, employee: existingEmployee };
  }

  if (nextEmployee.userId) {
    const linkedEmployee = existingEmployees.find((item) => item.userId === nextEmployee.userId && item.active);
    if (linkedEmployee) {
      return {
        ok: false,
        error: 'This account is already linked to an active employee.',
        employee: linkedEmployee,
      };
    }
  }

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: employeeSk(nextEmployee.id),
        entityType: 'EMPLOYEE',
        businessId,
        employeeId: nextEmployee.id,
        ...nextEmployee,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true, existing: false, employee: nextEmployee };
}

export async function getEmployeeForBusiness(businessId, employeeId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: employeeSk(employeeId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.employeeId,
        name: result.Item.name,
        email: result.Item.email,
        phone: result.Item.phone,
        role: normalizeEmployeeRole(result.Item.role),
        hourlyRate: result.Item.hourlyRate,
        compensationType: result.Item.compensationType ?? 'hourly',
        labourType: result.Item.labourType ?? 'field_producing',
        labourClassId: typeof result.Item.labourClassId === 'string' && result.Item.labourClassId.trim() ? result.Item.labourClassId.trim() : null,
        payrollBurdenPct: result.Item.payrollBurdenPct,
        benefitsExtraCost: result.Item.benefitsExtraCost,
        bonus: result.Item.bonus,
        userId: typeof result.Item.userId === 'string' && result.Item.userId.trim() ? result.Item.userId.trim() : null,
        active: result.Item.active,
        createdAt: result.Item.createdAt,
      }
    : null;
}

export async function updateEmployeeForBusiness({ businessId, employee }) {
  const nextEmployee = normalizeEmployeeForWrite(employee);

  if (nextEmployee.userId) {
    const linkedEmployee = await findEmployeeByUserId(businessId, nextEmployee.userId);
    if (linkedEmployee && linkedEmployee.id !== nextEmployee.id && linkedEmployee.active) {
      return {
        ok: false,
        error: 'This account is already linked to another active employee.',
      };
    }
  }

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: employeeSk(nextEmployee.id),
        entityType: 'EMPLOYEE',
        businessId,
        employeeId: nextEmployee.id,
        ...nextEmployee,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function createEmployeeWithAccessForBusiness({ businessId, payload }) {
  const accountAccess = payload?.accountAccess ?? {};
  const employeeInput = payload?.employee ?? {};
  const mode = normalizeAccountAccessMode(accountAccess.mode);

  const employeeDraft = normalizeEmployeeForWrite({
    id: typeof employeeInput.id === 'string' && employeeInput.id.trim() ? employeeInput.id.trim() : generateId(),
    name: employeeInput.name,
    email: employeeInput.email,
    phone: employeeInput.phone,
    role: employeeInput.role,
    hourlyRate: employeeInput.hourlyRate,
    compensationType: employeeInput.compensationType,
    labourType: employeeInput.labourType,
    userId: null,
    active: employeeInput.active,
    createdAt: nowIso(),
  });

  if (!employeeDraft.name) {
    return { ok: false, error: 'Employee name is required.' };
  }

  let linkedUser = null;

  if (mode === 'link_existing') {
    const linkUserId = typeof accountAccess.userId === 'string' ? accountAccess.userId.trim() : '';
    if (!linkUserId) return { ok: false, error: 'A user account is required to link access.' };

    const user = await getBusinessUserById(businessId, linkUserId);
    if (!user) return { ok: false, error: 'Selected user account was not found.' };

    const existingLinked = await findActiveEmployeeByUserId(businessId, user.id);
    if (existingLinked) {
      return { ok: false, error: 'This user account is already linked to an active employee.', employee: existingLinked };
    }

    linkedUser = user;
    employeeDraft.userId = user.id;
    if (!employeeDraft.email) {
      employeeDraft.email = user.email;
    }
  }

  if (mode === 'create_login') {
    const loginEmail = typeof accountAccess.loginEmail === 'string' ? accountAccess.loginEmail.trim() : '';
    const loginPassword = typeof accountAccess.password === 'string' ? accountAccess.password : '';
    const loginRole = accountAccess.role;

    if (!loginEmail) return { ok: false, error: 'Login email is required when creating access.' };
    if (loginPassword.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
    if (loginRole !== 'admin' && loginRole !== 'foreman' && loginRole !== 'crew_member') {
      return { ok: false, error: 'Access role is invalid.' };
    }

    const existingUserByEmail = await getBusinessUserByEmail(businessId, loginEmail);
    if (existingUserByEmail) {
      return { ok: false, error: 'A user with this email already exists.' };
    }

    const createdUser = await createAuthUserForBusiness({
      businessId,
      name: employeeDraft.name,
      email: loginEmail,
      password: loginPassword,
      role: loginRole,
    });

    if (!createdUser.ok || !createdUser.user) {
      return { ok: false, error: createdUser.error ?? 'Could not create user account.' };
    }

    linkedUser = createdUser.user;
    employeeDraft.userId = createdUser.user.id;
    if (!employeeDraft.email) {
      employeeDraft.email = createdUser.user.email;
    }
  }

  const employeeResult = await createEmployeeForBusiness({ businessId, employee: employeeDraft });
  if (!employeeResult.ok) {
    return employeeResult;
  }

  return {
    ok: true,
    employee: normalizeEmployeeAccountRecord(employeeResult.employee),
    user: linkedUser,
  };
}

export async function updateEmployeeAccessForBusiness({ businessId, employeeId, accountAccess, actorUserId, actorRole }) {
  const existingEmployee = await getEmployeeForBusiness(businessId, employeeId);
  if (!existingEmployee) {
    return { ok: false, error: 'Employee not found.' };
  }

  const mode = normalizeAccountAccessMode(accountAccess?.mode);
  const nextEmployee = normalizeEmployeeForWrite({
    ...existingEmployee,
    userId: existingEmployee.userId,
  });

  let linkedUser = null;

  if (mode === 'none') {
    if (actorRole === 'owner' && typeof actorUserId === 'string' && actorUserId && existingEmployee.userId === actorUserId) {
      return { ok: false, error: 'Owner account access cannot be unlinked from this profile.' };
    }
    nextEmployee.userId = null;
  }

  if (mode === 'link_existing') {
    const linkUserId = typeof accountAccess?.userId === 'string' ? accountAccess.userId.trim() : '';
    if (!linkUserId) return { ok: false, error: 'A user account is required to link access.' };

    const user = await getBusinessUserById(businessId, linkUserId);
    if (!user) return { ok: false, error: 'Selected user account was not found.' };

    const existingLinked = await findActiveEmployeeByUserId(businessId, user.id);
    if (existingLinked && existingLinked.id !== employeeId) {
      return { ok: false, error: 'This user account is already linked to an active employee.', employee: existingLinked };
    }

    nextEmployee.userId = user.id;
    if (!nextEmployee.email) {
      nextEmployee.email = user.email;
    }
    linkedUser = user;
  }

  if (mode === 'create_login') {
    const loginEmail = typeof accountAccess?.loginEmail === 'string' ? accountAccess.loginEmail.trim() : '';
    const loginPassword = typeof accountAccess?.password === 'string' ? accountAccess.password : '';
    const loginRole = accountAccess?.role;

    if (!loginEmail) return { ok: false, error: 'Login email is required when creating access.' };
    if (loginPassword.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
    if (loginRole !== 'admin' && loginRole !== 'foreman' && loginRole !== 'crew_member') {
      return { ok: false, error: 'Access role is invalid.' };
    }

    const existingUserByEmail = await getBusinessUserByEmail(businessId, loginEmail);
    if (existingUserByEmail) {
      return { ok: false, error: 'A user with this email already exists.' };
    }

    const createdUser = await createAuthUserForBusiness({
      businessId,
      name: nextEmployee.name,
      email: loginEmail,
      password: loginPassword,
      role: loginRole,
    });

    if (!createdUser.ok || !createdUser.user) {
      return { ok: false, error: createdUser.error ?? 'Could not create user account.' };
    }

    nextEmployee.userId = createdUser.user.id;
    if (!nextEmployee.email) {
      nextEmployee.email = createdUser.user.email;
    }
    linkedUser = createdUser.user;
  }

  const updateResult = await updateEmployeeForBusiness({ businessId, employee: nextEmployee });
  if (!updateResult.ok) return updateResult;

  return {
    ok: true,
    employee: normalizeEmployeeAccountRecord(nextEmployee),
    user: linkedUser,
  };
}

export async function deleteEmployeeForBusiness(businessId, employeeId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: employeeSk(employeeId),
      },
    })
  );

  return { ok: true };
}

export async function listTimeEntriesForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'TIME#',
      },
    })
  );

  return (result.Items ?? []).map((item) => {
    const photoAttachmentFileIds = Array.isArray(item.photoAttachmentFileIds)
      ? item.photoAttachmentFileIds
      : (typeof item.photoAttachmentFileId === 'string' && item.photoAttachmentFileId.trim() ? [item.photoAttachmentFileId.trim()] : []);
    const clockOutPhotoFileIds = Array.isArray(item.clockOutPhotoFileIds)
      ? item.clockOutPhotoFileIds
      : (typeof item.clockOutPhotoFileId === 'string' && item.clockOutPhotoFileId.trim() ? [item.clockOutPhotoFileId.trim()] : photoAttachmentFileIds);

    return {
    id: item.entryId,
    employeeId: item.employeeId,
    jobId: item.jobId ?? (Array.isArray(item.jobIds) ? item.jobIds[0] : undefined),
    jobIds: Array.isArray(item.jobIds)
      ? item.jobIds
      : (item.jobId ? [item.jobId] : []),
    workType: item.workType ?? 'job',
    unbillableCategoryId: item.unbillableCategoryId ?? undefined,
    unbillableCategoryName: item.unbillableCategoryName ?? undefined,
    clockIn: item.clockIn,
    clockOut: item.clockOut,
    clockInServerReceivedAt: item.clockInServerReceivedAt,
    clockInTimestampSource: item.clockInTimestampSource,
    clockOutServerReceivedAt: item.clockOutServerReceivedAt,
    clockOutTimestampSource: item.clockOutTimestampSource,
    breakMinutes: item.breakMinutes ?? 0,
    notes: item.notes ?? '',
    photoAttachmentUrl: item.photoAttachmentUrl ?? undefined,
    photoAttachmentFileIds,
    clockOutPhotoFileIds,
    photoAttachmentFileId: item.photoAttachmentFileId ?? photoAttachmentFileIds[0] ?? undefined,
    clockInPhotoFileId: item.clockInPhotoFileId ?? undefined,
    clockOutPhotoFileId: item.clockOutPhotoFileId ?? clockOutPhotoFileIds[0] ?? photoAttachmentFileIds[0] ?? undefined,
    status: item.status,
    labourCostRateSnapshot: item.labourCostRateSnapshot,
    labourCostTotalSnapshot: item.labourCostTotalSnapshot,
  };
  });
}

export async function createTimeEntryForBusiness({ businessId, timeEntry }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: timeEntrySk(timeEntry.id),
        entityType: 'TIME_ENTRY',
        businessId,
        entryId: timeEntry.id,
        ...timeEntry,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getTimeEntryForBusiness(businessId, entryId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: timeEntrySk(entryId),
      },
    })
  );

  return result.Item
    ? (() => {
        const photoAttachmentFileIds = Array.isArray(result.Item.photoAttachmentFileIds)
          ? result.Item.photoAttachmentFileIds
          : (typeof result.Item.photoAttachmentFileId === 'string' && result.Item.photoAttachmentFileId.trim() ? [result.Item.photoAttachmentFileId.trim()] : []);
        const clockOutPhotoFileIds = Array.isArray(result.Item.clockOutPhotoFileIds)
          ? result.Item.clockOutPhotoFileIds
          : (typeof result.Item.clockOutPhotoFileId === 'string' && result.Item.clockOutPhotoFileId.trim() ? [result.Item.clockOutPhotoFileId.trim()] : photoAttachmentFileIds);

        return {
        id: result.Item.entryId,
        employeeId: result.Item.employeeId,
        jobId: result.Item.jobId ?? (Array.isArray(result.Item.jobIds) ? result.Item.jobIds[0] : undefined),
        jobIds: Array.isArray(result.Item.jobIds)
          ? result.Item.jobIds
          : (result.Item.jobId ? [result.Item.jobId] : []),
        workType: result.Item.workType ?? 'job',
        unbillableCategoryId: result.Item.unbillableCategoryId ?? undefined,
        unbillableCategoryName: result.Item.unbillableCategoryName ?? undefined,
        clockIn: result.Item.clockIn,
        clockOut: result.Item.clockOut,
        clockInServerReceivedAt: result.Item.clockInServerReceivedAt,
        clockInTimestampSource: result.Item.clockInTimestampSource,
        clockOutServerReceivedAt: result.Item.clockOutServerReceivedAt,
        clockOutTimestampSource: result.Item.clockOutTimestampSource,
        breakMinutes: result.Item.breakMinutes ?? 0,
        notes: result.Item.notes ?? '',
        photoAttachmentUrl: result.Item.photoAttachmentUrl ?? undefined,
        photoAttachmentFileIds,
        clockOutPhotoFileIds,
        photoAttachmentFileId: result.Item.photoAttachmentFileId ?? photoAttachmentFileIds[0] ?? undefined,
        clockInPhotoFileId: result.Item.clockInPhotoFileId ?? undefined,
        clockOutPhotoFileId: result.Item.clockOutPhotoFileId ?? clockOutPhotoFileIds[0] ?? photoAttachmentFileIds[0] ?? undefined,
        status: result.Item.status,
        labourCostRateSnapshot: result.Item.labourCostRateSnapshot,
        labourCostTotalSnapshot: result.Item.labourCostTotalSnapshot,
      };
      })()
    : null;
}

export async function updateTimeEntryForBusiness({ businessId, timeEntry }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: timeEntrySk(timeEntry.id),
        entityType: 'TIME_ENTRY',
        businessId,
        entryId: timeEntry.id,
        ...timeEntry,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteTimeEntryForBusiness(businessId, entryId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: timeEntrySk(entryId),
      },
    })
  );

  return { ok: true };
}

function mapTimeCorrectionRecordFromItem(item) {
  return {
    id: item.correctionId,
    employeeId: item.employeeId,
    timeEntryId: item.timeEntryId,
    requestType: item.requestType,
    status: item.status,
    requestedClockInAt: item.requestedClockInAt,
    requestedClockOutAt: item.requestedClockOutAt,
    requestedJobId: item.requestedJobId,
    requestedActivityType: item.requestedActivityType,
    requestedUnbillableCategoryId: item.requestedUnbillableCategoryId,
    requestedUnbillableCategoryName: item.requestedUnbillableCategoryName,
    requestedSegments: Array.isArray(item.requestedSegments) ? item.requestedSegments : undefined,
    reason: item.reason,
    submittedByUserId: item.submittedByUserId,
    submittedAt: item.submittedAt,
    reviewedByUserId: item.reviewedByUserId,
    reviewedAt: item.reviewedAt,
    reviewNote: item.reviewNote,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    originalClockInAt: item.originalClockInAt,
    originalClockOutAt: item.originalClockOutAt,
    originalJobId: item.originalJobId,
    originalJobIds: Array.isArray(item.originalJobIds) ? item.originalJobIds : undefined,
    originalActivityType: item.originalActivityType,
    originalUnbillableCategoryId: item.originalUnbillableCategoryId,
    originalUnbillableCategoryName: item.originalUnbillableCategoryName,
  };
}

export async function listTimeCorrectionsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'TIME_CORRECTION#',
      },
    })
  );

  return (result.Items ?? []).map(mapTimeCorrectionRecordFromItem);
}

export async function listApprovedTimeCorrectionsForBusiness(businessId) {
  const items = await listTimeCorrectionsForBusiness(businessId);
  return items.filter((item) => item.status === 'approved');
}

export async function getTimeCorrectionForBusiness(businessId, correctionId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: timeCorrectionSk(correctionId),
      },
    })
  );

  return result.Item ? mapTimeCorrectionRecordFromItem(result.Item) : null;
}

export async function createTimeCorrectionForBusiness({ businessId, correction }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: timeCorrectionSk(correction.id),
        entityType: 'TIME_CORRECTION',
        businessId,
        correctionId: correction.id,
        ...correction,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function updateTimeCorrectionForBusiness({ businessId, correction }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: timeCorrectionSk(correction.id),
        entityType: 'TIME_CORRECTION',
        businessId,
        correctionId: correction.id,
        ...correction,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function approveTimeCorrectionForBusiness({
  businessId,
  correction,
  reviewerUserId,
  reviewerName,
  reviewerEmail,
  reviewNote,
  reviewedAt,
  createdTimeEntry,
}) {
  const eventId = `${reviewerUserId}:${correction.id}:${reviewedAt}`;
  const transactItems = [
    {
      Update: {
        TableName: tableName,
        Key: {
          PK: businessPk(businessId),
          SK: timeCorrectionSk(correction.id),
        },
        UpdateExpression: 'SET #status = :approved, #reviewedByUserId = :reviewedByUserId, #reviewedAt = :reviewedAt, #reviewNote = :reviewNote, #updatedAt = :updatedAt',
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :pending',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#reviewedByUserId': 'reviewedByUserId',
          '#reviewedAt': 'reviewedAt',
          '#reviewNote': 'reviewNote',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':pending': 'pending',
          ':approved': 'approved',
          ':reviewedByUserId': reviewerUserId,
          ':reviewedAt': reviewedAt,
          ':reviewNote': reviewNote ?? '',
          ':updatedAt': reviewedAt,
        },
      },
    },
    {
      Put: {
        TableName: tableName,
        Item: {
          PK: businessPk(businessId),
          SK: auditEventSk(eventId),
          entityType: 'AUDIT_EVENT',
          businessId,
          eventId,
          action: 'time_correction_approved',
          actorUserId: reviewerUserId,
          actorName: reviewerName,
          actorEmail: reviewerEmail ?? '',
          affectedEntryCount: createdTimeEntry ? 2 : 1,
          createdAt: reviewedAt,
          metadata: {
            correctionId: correction.id,
            requestType: correction.requestType,
            timeEntryId: correction.timeEntryId,
            createdTimeEntryId: createdTimeEntry?.id,
          },
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    },
  ];

  if (createdTimeEntry) {
    transactItems.push({
      Put: {
        TableName: tableName,
        Item: {
          PK: businessPk(businessId),
          SK: timeEntrySk(createdTimeEntry.id),
          entityType: 'TIME_ENTRY',
          businessId,
          entryId: createdTimeEntry.id,
          ...createdTimeEntry,
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    });
  }

  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
    return { ok: true, eventId };
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') {
      return { ok: false, code: 'CONFLICT' };
    }
    throw error;
  }
}

export async function rejectTimeCorrectionForBusiness({
  businessId,
  correction,
  reviewerUserId,
  reviewerName,
  reviewerEmail,
  reviewNote,
  reviewedAt,
}) {
  const eventId = `${reviewerUserId}:${correction.id}:${reviewedAt}`;

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName,
              Key: {
                PK: businessPk(businessId),
                SK: timeCorrectionSk(correction.id),
              },
              UpdateExpression: 'SET #status = :rejected, #reviewedByUserId = :reviewedByUserId, #reviewedAt = :reviewedAt, #reviewNote = :reviewNote, #updatedAt = :updatedAt',
              ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :pending',
              ExpressionAttributeNames: {
                '#status': 'status',
                '#reviewedByUserId': 'reviewedByUserId',
                '#reviewedAt': 'reviewedAt',
                '#reviewNote': 'reviewNote',
                '#updatedAt': 'updatedAt',
              },
              ExpressionAttributeValues: {
                ':pending': 'pending',
                ':rejected': 'rejected',
                ':reviewedByUserId': reviewerUserId,
                ':reviewedAt': reviewedAt,
                ':reviewNote': reviewNote ?? '',
                ':updatedAt': reviewedAt,
              },
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                PK: businessPk(businessId),
                SK: auditEventSk(eventId),
                entityType: 'AUDIT_EVENT',
                businessId,
                eventId,
                action: 'time_correction_rejected',
                actorUserId: reviewerUserId,
                actorName: reviewerName,
                actorEmail: reviewerEmail ?? '',
                affectedEntryCount: 1,
                createdAt: reviewedAt,
                metadata: {
                  correctionId: correction.id,
                  requestType: correction.requestType,
                  timeEntryId: correction.timeEntryId,
                },
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
        ],
      })
    );

    return { ok: true, eventId };
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') {
      return { ok: false, code: 'CONFLICT' };
    }
    throw error;
  }
}

function mapTimeOffRequestFromItem(item) {
  return {
    id: item.requestId,
    businessId: item.businessId,
    employeeId: item.employeeId,
    requestType: item.requestType,
    startDate: item.startDate,
    endDate: item.endDate,
    employeeNote: item.employeeNote ?? '',
    status: item.status,
    submittedAt: item.submittedAt,
    reviewedAt: item.reviewedAt,
    reviewedByUserId: item.reviewedByUserId,
    reviewNote: item.reviewNote,
    cancelledAt: item.cancelledAt,
    idempotencyKey: item.idempotencyKey,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function listTimeOffRequestsForBusiness(businessId) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': 'TIME_OFF_REQUEST#' },
  }));
  return (result.Items ?? []).map(mapTimeOffRequestFromItem).sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt));
}

export async function listApprovedTimeOffOverlappingForBusiness(businessId, startDate, endDate) {
  return approvedTimeOffOverlapping(await listTimeOffRequestsForBusiness(businessId), startDate, endDate);
}

export async function getTimeOffRequestForBusiness(businessId, requestId) {
  const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: timeOffRequestSk(requestId) } }));
  return result.Item ? mapTimeOffRequestFromItem(result.Item) : null;
}

export async function getTimeOffCreationIdempotency({ businessId, employeeId, idempotencyKey }) {
  const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: timeOffIdempotencySk(employeeId, idempotencyKey) } }));
  return result.Item ? { requestId: result.Item.requestId, payloadFingerprint: result.Item.payloadFingerprint } : null;
}

export async function createTimeOffRequestForBusiness({ businessId, request, payloadFingerprint, actor }) {
  const eventId = `time-off-created:${request.id}`;
  const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: timeOffIdempotencySk(request.employeeId, request.idempotencyKey), entityType: 'TIME_OFF_IDEMPOTENCY', businessId, employeeId: request.employeeId, idempotencyKey: request.idempotencyKey, requestId: request.id, payloadFingerprint, createdAt: request.createdAt, ttl }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: timeOffRequestSk(request.id), entityType: 'TIME_OFF_REQUEST', requestId: request.id, ...request }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: auditEventSk(eventId), entityType: 'AUDIT_EVENT', businessId, eventId, action: 'time_off_request_created', actorUserId: actor.id, actorName: actor.name, actorEmail: actor.email ?? '', affectedEntryCount: 1, createdAt: request.createdAt, metadata: { requestId: request.id, employeeId: request.employeeId, fromStatus: null, toStatus: 'pending' } }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
    ] }));
    return { ok: true };
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') return { ok: false, code: 'CONFLICT' };
    throw error;
  }
}

async function transitionTimeOffRequest({ businessId, request, status, actor, reviewNote, transitionedAt, action }) {
  const eventId = `${action}:${request.id}:${transitionedAt}`;
  const isCancellation = status === 'cancelled';
  const setExpression = isCancellation
    ? 'SET #status = :status, #cancelledAt = :at, #updatedAt = :at'
    : 'SET #status = :status, #reviewedAt = :at, #reviewedByUserId = :actorId, #reviewNote = :reviewNote, #updatedAt = :at';
  const names = { '#status': 'status', '#updatedAt': 'updatedAt', ...(isCancellation ? { '#cancelledAt': 'cancelledAt' } : { '#reviewedAt': 'reviewedAt', '#reviewedByUserId': 'reviewedByUserId', '#reviewNote': 'reviewNote' }) };
  const values = { ':pending': 'pending', ':status': status, ':at': transitionedAt, ...(isCancellation ? {} : { ':actorId': actor.id, ':reviewNote': reviewNote ?? '' }) };
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: timeOffRequestSk(request.id) }, UpdateExpression: setExpression, ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :pending', ExpressionAttributeNames: names, ExpressionAttributeValues: values } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: auditEventSk(eventId), entityType: 'AUDIT_EVENT', businessId, eventId, action, actorUserId: actor.id, actorName: actor.name, actorEmail: actor.email ?? '', affectedEntryCount: 1, createdAt: transitionedAt, metadata: { requestId: request.id, employeeId: request.employeeId, fromStatus: 'pending', toStatus: status } }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
    ] }));
    return { ok: true };
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') return { ok: false, code: 'CONFLICT' };
    throw error;
  }
}

export const cancelTimeOffRequestForBusiness = (input) => transitionTimeOffRequest({ ...input, status: 'cancelled', action: 'time_off_request_cancelled' });
export const approveTimeOffRequestForBusiness = (input) => transitionTimeOffRequest({ ...input, status: 'approved', action: 'time_off_request_approved' });
export const denyTimeOffRequestForBusiness = (input) => transitionTimeOffRequest({ ...input, status: 'denied', action: 'time_off_request_denied' });

export async function listAuditEventsForBusiness(businessId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': businessPk(businessId),
        ':prefix': 'AUDIT#',
      },
    })
  );

  return (result.Items ?? [])
    .map((item) => ({
      id: item.eventId,
      action: item.action,
      actorUserId: item.actorUserId,
      actorName: item.actorName,
      actorEmail: item.actorEmail,
      affectedEntryCount: item.affectedEntryCount,
      createdAt: item.createdAt,
      metadata: item.metadata ?? {},
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function createAuditEventForBusiness({ businessId, auditEvent }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: auditEventSk(auditEvent.id),
        entityType: 'AUDIT_EVENT',
        businessId,
        eventId: auditEvent.id,
        ...auditEvent,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return { ok: true };
}

export async function getAuditEventForBusiness(businessId, eventId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: auditEventSk(eventId),
      },
    })
  );

  return result.Item
    ? {
        id: result.Item.eventId,
        action: result.Item.action,
        actorUserId: result.Item.actorUserId,
        actorName: result.Item.actorName,
        actorEmail: result.Item.actorEmail,
        affectedEntryCount: result.Item.affectedEntryCount,
        createdAt: result.Item.createdAt,
        metadata: result.Item.metadata ?? {},
      }
    : null;
}

export async function updateAuditEventForBusiness({ businessId, auditEvent }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: auditEventSk(auditEvent.id),
        entityType: 'AUDIT_EVENT',
        businessId,
        eventId: auditEvent.id,
        ...auditEvent,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  return { ok: true };
}

export async function deleteAuditEventForBusiness(businessId, eventId) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: auditEventSk(eventId),
      },
    })
  );

  return { ok: true };
}
