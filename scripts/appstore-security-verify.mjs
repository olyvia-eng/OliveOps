import { randomBytes, randomUUID } from 'node:crypto';

const API = 'https://app.oliveops.ca';
const PREFIX = `APPSTORE_SECURITY_TEST_${Date.now()}`;
const execute = process.argv.includes('--execute');

if (!execute) {
  console.error('Refusing to mutate production without --execute.');
  process.exit(2);
}

const state = {
  tokens: {},
  users: {},
  employees: {},
  divisions: {},
  equipment: {},
  jobs: {},
  forms: {},
  fields: {},
  submissions: new Set(),
  entries: new Set(),
  files: new Set(),
  businesses: {},
};
const results = [];
const cleanup = [];

function id(label) {
  return `${PREFIX}_${label}_${randomUUID()}`;
}

function password() {
  return `${randomBytes(24).toString('base64url')}Aa1!`;
}

function email(label) {
  return `${PREFIX}_${label}_${randomUUID()}@example.invalid`.toLowerCase();
}

async function request(method, path, token, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: response.status, data };
}

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  return passed;
}

function expectStatus(name, response, expected) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  const passed = allowed.includes(response.status);
  record(name, passed, `HTTP ${response.status}`);
  if (!passed) {
    throw new Error(`${name} expected ${allowed.join('/')} but received ${response.status}: ${JSON.stringify(response.data)}`);
  }
  return response.data;
}

async function signup(label) {
  const credentials = {
    email: email(`${label}_owner`),
    password: password(),
  };
  const response = await request('POST', '/api/auth?action=signup', null, {
    businessName: `${PREFIX}_BUSINESS_${label}`,
    firstName: 'AppStore',
    lastName: `Security${label}`,
    email: credentials.email,
    password: credentials.password,
    timezone: 'America/Toronto',
  });
  const data = expectStatus(`provision business ${label}`, response, 200);
  state.businesses[label] = { id: data.user.businessId, ownerUserId: data.user.id, credentials };
  return credentials;
}

async function mobileLogin(name, credentials, expected = 200) {
  const response = await request('POST', '/api/auth?action=mobile-login', null, credentials);
  const data = expectStatus(name, response, expected);
  return { response, data };
}

async function createCrew(label, ownerToken) {
  const credentials = { email: email(label), password: password() };
  const employeeId = id(`EMPLOYEE_${label}`);
  const response = await request('POST', '/api/data?entity=employees', ownerToken, {
    data: {
      id: employeeId,
      name: `${PREFIX}_EMPLOYEE_${label}`,
      email: credentials.email,
      phone: '',
      role: 'crew_member',
      hourlyRate: 1,
      compensationType: 'hourly',
      labourType: 'field_producing',
      active: true,
    },
    accountAccess: {
      mode: 'create_login',
      loginEmail: credentials.email,
      password: credentials.password,
      role: 'crew_member',
    },
  });
  const data = expectStatus(`provision crew ${label}`, response, 200);
  state.users[label] = { id: data.user.id, credentials };
  state.employees[label] = data.employee.id;
  return credentials;
}

async function createData(entity, token, data, name) {
  const response = await request('POST', `/api/data?entity=${encodeURIComponent(entity)}`, token, { data });
  expectStatus(name, response, 200);
}

async function createDivision(label, token) {
  const divisionId = id(`DIVISION_${label}`);
  const response = await request('POST', '/api/divisions', token, {
    id: divisionId,
    name: `${PREFIX}_DIVISION_${label}`,
    colour: '#1d4ed8',
    active: true,
  });
  expectStatus(`provision division ${label}`, response, 200);
  state.divisions[label] = divisionId;
}

async function createEquipment(label, token) {
  const equipmentId = id(`EQUIPMENT_${label}`);
  await createData('equipment-assets', token, {
    id: equipmentId,
    name: `${PREFIX}_EQUIPMENT_${label}`,
    type: 'Security test equipment',
    status: 'available',
    costType: 'owned',
    hourlyCost: 1,
    notes: `${PREFIX} disposable fixture`,
  }, `provision equipment ${label}`);
  state.equipment[label] = equipmentId;
}

async function createJob(label, token, employeeId, divisionId, equipmentIds = []) {
  const jobId = id(`JOB_${label}`);
  await createData('jobs', token, {
    id: jobId,
    customerId: `${PREFIX}_NO_CUSTOMER_RECORD_${label}`,
    title: `${PREFIX}_JOB_${label}`,
    status: 'scheduled',
    startDate: new Date().toISOString().slice(0, 10),
    divisionId,
    assignedEmployeeIds: [employeeId],
    assignedEquipmentIds: equipmentIds,
  }, `provision job ${label}`);
  state.jobs[label] = jobId;
}

async function createForm(label, token) {
  const formId = id(`FORM_${label}`);
  const fieldId = id(`FIELD_${label}`);
  await createData('forms', token, {
    id: formId,
    name: `${PREFIX}_FORM_${label}`,
    description: `${PREFIX} disposable on-demand form`,
    category: 'operations',
    status: 'active',
    assignedTo: 'everyone',
    assignmentValue: null,
    trigger: ['on_demand'],
    completionRequirement: 'reminder',
  }, `provision form ${label}`);
  await createData('form-fields', token, {
    id: fieldId,
    formId,
    type: 'single_line_text',
    label: `${PREFIX}_ANSWER_${label}`,
    helpText: '',
    required: true,
    defaultValue: '',
    placeholder: '',
    order: 0,
  }, `provision form field ${label}`);
  state.forms[label] = formId;
  state.fields[label] = fieldId;
}

function clockPayload(employeeId, jobId, key, requestId = key) {
  return { employeeId, workType: 'job', jobIds: [jobId], idempotencyKey: key, requestId };
}

async function clockIn(token, employeeId, jobId, key, requestId = key) {
  const response = await request('POST', '/api/clocking?action=clock-in', token, clockPayload(employeeId, jobId, key, requestId));
  if (response.status === 200 && response.data?.timeEntry?.id) state.entries.add(response.data.timeEntry.id);
  return response;
}

async function clockOut(token, entryId, key, extra = {}) {
  const response = await request('POST', '/api/clocking?action=clock-out', token, {
    entryId,
    requestId: key,
    idempotencyKey: key,
    breakMinutes: 0,
    notes: `${PREFIX} disposable shift`,
    ...extra,
  });
  return response;
}

async function uploadFile(token, entityType, entityId, category, label) {
  const bytes = Buffer.from(`PNG_SECURITY_FIXTURE_${PREFIX}_${label}`, 'utf8');
  const prepare = await request('POST', '/api/storage', token, {
    action: 'prepare-upload',
    entityType,
    entityId,
    category,
    fileName: `${PREFIX}_${label}.png`,
    mimeType: 'image/png',
    sizeBytes: bytes.length,
  });
  const plan = expectStatus(`storage prepare ${label}`, prepare, 200);
  state.files.add(plan.fileId);
  const uploaded = await fetch(plan.uploadUrl, {
    method: 'PUT',
    headers: plan.requiredHeaders,
    body: bytes,
  });
  record(`storage upload ${label}`, uploaded.ok, `HTTP ${uploaded.status}`);
  if (!uploaded.ok) throw new Error(`Storage upload ${label} failed with HTTP ${uploaded.status}`);
  const complete = await request('POST', '/api/storage', token, { action: 'complete-upload', fileId: plan.fileId });
  expectStatus(`storage complete ${label}`, complete, 200);
  return plan.fileId;
}

async function submitForm(token, label, clientSubmissionId, answer, context = {}) {
  const response = await request('POST', '/api/employee?action=submit', token, {
    formId: state.forms[label],
    trigger: 'on_demand',
    clientSubmissionId,
    responses: [{ fieldId: state.fields[label], value: answer }],
    ...context,
  });
  if (response.data?.submission?.id) state.submissions.add(response.data.submission.id);
  return response;
}

async function safeCleanup(name, operation) {
  try {
    const response = await operation();
    const passed = [200, 404].includes(response.status);
    cleanup.push({ name, passed, status: response.status });
    console.log(`${passed ? 'CLEAN' : 'CLEANUP_FAIL'} ${name}: HTTP ${response.status}`);
  } catch (error) {
    cleanup.push({ name, passed: false, status: String(error?.message ?? error) });
    console.log(`CLEANUP_FAIL ${name}: request error`);
  }
}

async function deleteData(entity, idValue, token) {
  return request('DELETE', `/api/data?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(idValue)}`, token);
}

async function cleanupTenant(label, ownerToken, crewLabels) {
  const responseList = await request('GET', '/api/data?entity=form-responses', ownerToken);
  if (responseList.status === 200) {
    for (const item of responseList.data.items ?? []) {
      if (state.submissions.has(item.submissionId)) {
        await safeCleanup(`response ${item.id}`, () => deleteData('form-responses', item.id, ownerToken));
      }
    }
  }

  for (const submissionId of state.submissions) {
    await safeCleanup(`submission ${submissionId}`, () => deleteData('form-submissions', submissionId, ownerToken));
  }
  for (const fileId of [...state.files]) {
    await safeCleanup(`file ${fileId}`, () => request('POST', '/api/storage', ownerToken, { action: 'delete', fileId }));
  }
  for (const entryId of state.entries) {
    await safeCleanup(`time entry ${entryId}`, () => deleteData('time-entries', entryId, ownerToken));
  }
  if (state.fields[label]) await safeCleanup(`field ${label}`, () => deleteData('form-fields', state.fields[label], ownerToken));
  if (state.forms[label]) await safeCleanup(`form ${label}`, () => deleteData('forms', state.forms[label], ownerToken));

  for (const [jobLabel, jobId] of Object.entries(state.jobs)) {
    if ((label === 'A' && jobLabel.startsWith('A')) || (label === 'B' && jobLabel.startsWith('B'))) {
      await safeCleanup(`job ${jobLabel}`, () => deleteData('jobs', jobId, ownerToken));
    }
  }
  if (state.equipment[label]) await safeCleanup(`equipment ${label}`, () => deleteData('equipment-assets', state.equipment[label], ownerToken));
  if (state.divisions[label]) {
    await safeCleanup(`division ${label}`, () => request('PATCH', `/api/divisions?id=${encodeURIComponent(state.divisions[label])}`, ownerToken, { active: false }));
  }
  for (const crewLabel of crewLabels) {
    if (state.employees[crewLabel]) await safeCleanup(`employee ${crewLabel}`, () => deleteData('employees', state.employees[crewLabel], ownerToken));
    if (state.users[crewLabel]) await safeCleanup(`user ${crewLabel}`, () => request('DELETE', `/api/users?id=${encodeURIComponent(state.users[crewLabel].id)}`, ownerToken));
  }
}

let fatalError = null;
try {
  console.log(`Fixture prefix: ${PREFIX}`);
  const ownerACredentials = await signup('A');
  const ownerBCredentials = await signup('B');
  const ownerA = await mobileLogin('valid owner A login', ownerACredentials);
  const ownerB = await mobileLogin('valid owner B login', ownerBCredentials);
  state.tokens.ownerA = ownerA.data.accessToken;
  state.tokens.ownerB = ownerB.data.accessToken;

  const a1Credentials = await createCrew('A1', state.tokens.ownerA);
  const a2Credentials = await createCrew('A2', state.tokens.ownerA);
  const b1Credentials = await createCrew('B1', state.tokens.ownerB);
  state.tokens.A1 = (await mobileLogin('valid A1 login', a1Credentials)).data.accessToken;
  state.tokens.A2 = (await mobileLogin('valid A2 login', a2Credentials)).data.accessToken;
  state.tokens.B1 = (await mobileLogin('valid B1 login', b1Credentials)).data.accessToken;

  await createDivision('A', state.tokens.ownerA);
  await createDivision('B', state.tokens.ownerB);
  await createEquipment('A', state.tokens.ownerA);
  await createEquipment('B', state.tokens.ownerB);
  await createJob('A1', state.tokens.ownerA, state.employees.A1, state.divisions.A, [state.equipment.A]);
  await createJob('A2', state.tokens.ownerA, state.employees.A2, state.divisions.A);
  await createJob('B', state.tokens.ownerB, state.employees.B1, state.divisions.B, [state.equipment.B]);
  await createForm('A', state.tokens.ownerA);
  await createForm('B', state.tokens.ownerB);

  const a2Clock = await clockIn(state.tokens.A2, state.employees.A2, state.jobs.A2, `${PREFIX}_A2_SHARED`);
  const a2Entry = expectStatus('A2 disposable clock-in', a2Clock, 200).timeEntry.id;
  const a2File = await uploadFile(state.tokens.A2, 'time-entry', a2Entry, 'clock-out-photo', 'A2');
  expectStatus('A2 disposable clock-out', await clockOut(state.tokens.A2, a2Entry, `${PREFIX}_A2_OUT`), 200);

  const bClock = await clockIn(state.tokens.B1, state.employees.B1, state.jobs.B, `${PREFIX}_B_SHARED`);
  const bEntry = expectStatus('B1 disposable clock-in', bClock, 200).timeEntry.id;
  const bFile = await uploadFile(state.tokens.B1, 'time-entry', bEntry, 'clock-out-photo', 'B1');
  expectStatus('B1 disposable clock-out', await clockOut(state.tokens.B1, bEntry, `${PREFIX}_B_OUT`), 200);

  const a1Key = `${PREFIX}_A1_CLOCK`;
  const a1Clock = await clockIn(state.tokens.A1, state.employees.A1, state.jobs.A1, a1Key);
  const a1Entry = expectStatus('hidden-job authorized clock-in', a1Clock, 200).timeEntry.id;
  const replay = await clockIn(state.tokens.A1, state.employees.A1, state.jobs.A1, a1Key);
  const replayData = expectStatus('clock-in identical replay', replay, 200);
  record('clock-in replay returns original', replayData.timeEntry?.id === a1Entry, `entry ${replayData.timeEntry?.id === a1Entry ? 'matched' : 'mismatched'}`);
  expectStatus('clock-in changed payload conflict', await clockIn(state.tokens.A1, state.employees.A1, state.jobs.A1, a1Key, `${a1Key}_CHANGED`), 409);
  expectStatus('switch activity hidden job', await request('POST', '/api/clocking?action=switch-activity', state.tokens.A1, {
    workType: 'job', jobIds: [state.jobs.A2], requestId: `${PREFIX}_HIDDEN_SWITCH`, idempotencyKey: `${PREFIX}_HIDDEN_SWITCH`,
  }), 403);

  const a1File = await uploadFile(state.tokens.A1, 'time-entry', a1Entry, 'clock-out-photo', 'A1');
  const ownList = await request('GET', `/api/storage?view=files&entityType=time-entry&category=clock-out-photo`, state.tokens.A1);
  const ownListData = expectStatus('storage own list', ownList, 200);
  record('storage own file listed', ownListData.files?.some((file) => file.id === a1File), 'own file visibility');
  const ownDownload = await request('POST', '/api/storage', state.tokens.A1, { action: 'prepare-download', fileId: a1File });
  const ownDownloadData = expectStatus('storage own download prepare', ownDownload, 200);
  const downloaded = await fetch(ownDownloadData.downloadUrl);
  record('storage own download', downloaded.ok, `HTTP ${downloaded.status}`);
  expectStatus('storage A2 attachment denied', await request('POST', '/api/storage', state.tokens.A1, { action: 'prepare-download', fileId: a2File }), 403);
  expectStatus('storage tenant B attachment denied', await request('POST', '/api/storage', state.tokens.A1, { action: 'prepare-download', fileId: bFile }), 404);
  expectStatus('unauthorized file with authorized entry denied', await clockOut(state.tokens.A1, a1Entry, `${PREFIX}_A1_BAD_FILE`, { photoAttachmentFileIds: [a2File] }), [400, 403]);
  const a1ClockOut = await clockOut(state.tokens.A1, a1Entry, `${PREFIX}_A1_OUT`, { photoAttachmentFileIds: [a1File] });
  const a1ClockOutData = expectStatus('A1 clock-out', a1ClockOut, 200);
  const a1ClockOutRetry = await clockOut(state.tokens.A1, a1Entry, `${PREFIX}_A1_OUT`, { photoAttachmentFileIds: [a1File] });
  const clockOutReplayed = a1ClockOutRetry.status === 200 && a1ClockOutRetry.data?.timeEntry?.id === a1ClockOutData.timeEntry?.id;
  record('A1 clock-out identical retry returns original', clockOutReplayed, `HTTP ${a1ClockOutRetry.status}`);

  expectStatus('clock-in hidden same-business job', await clockIn(state.tokens.A1, state.employees.A1, state.jobs.A2, `${PREFIX}_HIDDEN_CLOCK`), 403);
  expectStatus('time correction hidden same-business job', await request('POST', '/api/clocking?action=create', state.tokens.A1, {
    requestType: 'wrong_job',
    timeEntryId: a1Entry,
    employeeId: state.employees.A1,
    requestedJobId: state.jobs.A2,
    requestedActivityType: 'job',
    reason: `${PREFIX} hidden job authorization probe`,
  }), 403);

  const scopedClock = await clockIn(state.tokens.A1, state.employees.A1, state.jobs.A1, `${PREFIX}_A2_SHARED`);
  const scopedEntry = expectStatus('A1 cannot receive A2 idempotency replay', scopedClock, 200).timeEntry.id;
  expectStatus('A1 scoped clock-out', await clockOut(state.tokens.A1, scopedEntry, `${PREFIX}_A1_SCOPED_OUT`), 200);
  const foreignReplay = await clockOut(state.tokens.A1, a2Entry, `${PREFIX}_A2_OUT`);
  expectStatus('clock-out ownership before foreign replay', foreignReplay, 409);
  record('foreign replay data not disclosed', !foreignReplay.data?.timeEntry, 'no timeEntry in denial');

  const firstForm = await submitForm(state.tokens.A1, 'A', 'TEST-A', `${PREFIX}_ANSWER_ONE`);
  const firstFormData = expectStatus('A1 form initial submission', firstForm, 201);
  const repeatForm = await submitForm(state.tokens.A1, 'A', 'TEST-A', `${PREFIX}_ANSWER_ONE`);
  const repeatFormData = expectStatus('A1 form identical replay', repeatForm, 200);
  record('form replay returns original', repeatFormData.replayed === true && repeatFormData.submission?.id === firstFormData.submission?.id, 'replayed original submission');
  const changedForm = await submitForm(state.tokens.A1, 'A', 'TEST-A', `${PREFIX}_ANSWER_CHANGED`);
  expectStatus('A1 form changed payload conflict', changedForm, 409);
  record('form conflict code stable', changedForm.data?.error === 'submission_idempotency_conflict', String(changedForm.data?.error));
  expectStatus('A2 independently reuses TEST-A', await submitForm(state.tokens.A2, 'A', 'TEST-A', `${PREFIX}_A2_ANSWER`), 201);
  const b1Form = await submitForm(state.tokens.B1, 'B', 'TEST-A', `${PREFIX}_B1_ANSWER`);
  const b1FormData = expectStatus('B1 independently reuses TEST-A', b1Form, 201);

  expectStatus('cross-tenant employee spoof write', await clockIn(state.tokens.A1, state.employees.B1, state.jobs.B, `${PREFIX}_CROSS_EMPLOYEE`), 403);
  expectStatus('cross-tenant job clock-in', await clockIn(state.tokens.A1, state.employees.A1, state.jobs.B, `${PREFIX}_CROSS_JOB`), [400, 403]);
  expectStatus('cross-tenant submission read', await request('GET', `/api/employee?action=submission&id=${encodeURIComponent(b1FormData.submission.id)}`, state.tokens.A1), 404);
  expectStatus('cross-tenant time-entry write', await request('PATCH', `/api/data?entity=time-entries&id=${encodeURIComponent(bEntry)}`, state.tokens.A1, { data: { notes: 'denied' } }), 403);
  expectStatus('cross-tenant file read', await request('POST', '/api/storage', state.tokens.A1, { action: 'prepare-download', fileId: bFile }), 404);

  const divisions = await request('GET', '/api/divisions', state.tokens.A1);
  const divisionData = expectStatus('division selector tenant read', divisions, 200);
  record('cross-tenant division absent', !divisionData.divisions?.some((division) => division.id === state.divisions.B), 'Business B division not listed');
  expectStatus('cross-tenant division mutation', await request('PATCH', `/api/divisions?id=${encodeURIComponent(state.divisions.B)}`, state.tokens.A1, { active: false }), 403);
  const equipment = await request('GET', '/api/data?entity=equipment-assets', state.tokens.A1);
  expectStatus('equipment selector access fails closed', equipment, 403);
  expectStatus('cross-tenant equipment mutation', await request('PATCH', `/api/data?entity=equipment-assets&id=${encodeURIComponent(state.equipment.B)}`, state.tokens.A1, { data: { notes: 'denied' } }), 403);
  expectStatus('foreign equipment form context', await submitForm(state.tokens.A1, 'A', `${PREFIX}_FOREIGN_EQUIPMENT`, 'denied', { jobId: state.jobs.A1, equipmentId: state.equipment.B }), 403);
  expectStatus('foreign division form context', await submitForm(state.tokens.A1, 'A', `${PREFIX}_FOREIGN_DIVISION`, 'denied', { jobId: state.jobs.A1, divisionId: state.divisions.B }), 403);
  expectStatus('foreign job form context', await submitForm(state.tokens.A1, 'A', `${PREFIX}_FOREIGN_JOB`, 'denied', { jobId: state.jobs.B }), 403);

  const formsA = await request('GET', '/api/employee?action=forms', state.tokens.A1);
  const formsAData = expectStatus('forms tenant read', formsA, 200);
  record('cross-tenant form absent', !JSON.stringify(formsAData).includes(state.forms.B), 'Business B form not listed');
  const historyA = await request('GET', '/api/employee?action=history', state.tokens.A1);
  const historyAData = expectStatus('history isolation rerun', historyA, 200);
  record('cross-tenant entry absent', !historyAData.timeEntries?.some((entry) => entry.id === bEntry), 'Business B entry not listed');
  const bootstrapA = await request('GET', '/api/bootstrap', state.tokens.A1);
  const bootstrapAData = expectStatus('bootstrap isolation rerun', bootstrapA, 200);
  record('bootstrap tenant isolation', bootstrapAData.jobs?.some((job) => job.id === state.jobs.A1) && !bootstrapAData.jobs?.some((job) => job.id === state.jobs.B), 'Business A job present and Business B job absent');

  const wrong = await mobileLogin('wrong password generic 401', { email: a1Credentials.email, password: `${a1Credentials.password}wrong` }, 401);
  const unknown = await mobileLogin('unknown email generic 401', { email: email('UNKNOWN'), password: password() }, 401);
  record('login failures are indistinguishable', JSON.stringify(wrong.data) === JSON.stringify(unknown.data), 'same generic response body');
  expectStatus('fabricated bearer rejected', await request('GET', '/api/auth?action=session', 'oliveops_mobile_fabricated_security_token'), 401);
} catch (error) {
  fatalError = error;
  console.error(`FATAL ${error?.message ?? error}`);
} finally {
  for (const [label, token] of Object.entries(state.tokens)) {
    if (!label.startsWith('owner') && token) {
      await safeCleanup(`logout ${label}`, () => request('POST', '/api/auth?action=logout', token));
    }
  }
  if (state.tokens.ownerA) await cleanupTenant('A', state.tokens.ownerA, ['A1', 'A2']);
  if (state.tokens.ownerB) await cleanupTenant('B', state.tokens.ownerB, ['B1']);
  if (state.tokens.ownerA) await safeCleanup('logout owner A', () => request('POST', '/api/auth?action=logout', state.tokens.ownerA));
  if (state.tokens.ownerB) await safeCleanup('logout owner B', () => request('POST', '/api/auth?action=logout', state.tokens.ownerB));
}

const failedResults = results.filter((result) => !result.passed);
const failedCleanup = cleanup.filter((result) => !result.passed);
console.log(JSON.stringify({
  prefix: PREFIX,
  productionApi: API,
  businesses: Object.fromEntries(Object.entries(state.businesses).map(([label, value]) => [label, value.id])),
  tests: { total: results.length, passed: results.length - failedResults.length, failed: failedResults },
  cleanup: { total: cleanup.length, passed: cleanup.length - failedCleanup.length, failed: failedCleanup },
  retained: Object.keys(state.businesses).map((label) => `${PREFIX}_BUSINESS_${label} owner/business shell`),
  expectedResiduals: ['Form idempotency records expire after retention; no public delete endpoint exists.'],
  fatal: fatalError ? String(fatalError.message ?? fatalError) : null,
}, null, 2));

process.exitCode = fatalError || failedResults.length || failedCleanup.length ? 1 : 0;