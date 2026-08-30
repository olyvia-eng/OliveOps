import test from 'node:test';
import assert from 'node:assert/strict';

import { createEstimatesHandler } from '../api/estimates.js';

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function baseSession() {
  return {
    id: 'user-1',
    name: 'Ops Manager',
    email: 'ops@example.com',
    role: 'admin',
    businessId: 'biz-1',
  };
}

function baseEstimate() {
  return {
    id: 'est-1',
    customerId: 'customer-1',
    title: 'Driveway Replacement',
    description: 'Replace driveway and prep subgrade',
    workAreas: [
      {
        id: 'area-1',
        name: 'Main Driveway',
        description: '',
        sortOrder: 0,
        lineItems: [
          {
            id: 'line-1',
            category: 'labour',
            description: 'Crew labor',
            quantity: 8,
            unit: 'hr',
            unitCost: 50,
            markupPercent: 20,
            sellPrice: 60,
            total: 480,
          },
        ],
      },
    ],
    pricingBudgetId: 'budget-1',
    status: 'accepted',
    taxRate: 10,
    notes: 'Include cleanup',
  };
}

test('convert-to-job rejects non-POST method', async () => {
  const handler = createEstimatesHandler();
  const req = { method: 'GET', query: { action: 'convert-to-job' } };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.body.ok, false);
});

test('convert-to-job requires accepted estimate', async () => {
  const handler = createEstimatesHandler({
    requireSession: async () => baseSession(),
    getEstimateForBusiness: async () => ({ ...baseEstimate(), status: 'sent' }),
  });

  const req = {
    method: 'POST',
    query: { action: 'convert-to-job' },
    body: { estimateId: 'est-1' },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Only accepted estimates can be converted.');
});

test('convert-to-job returns job and estimate patch on success', async () => {
  let reservedArgs = null;
  let conversionPayload = null;

  const handler = createEstimatesHandler({
    requireSession: async () => baseSession(),
    getEstimateForBusiness: async () => baseEstimate(),
    reserveNextJobNumberForBusiness: async (args) => {
      reservedArgs = args;
      return 'JOB-2026-0007';
    },
    convertEstimateToJobForBusiness: async (payload) => {
      conversionPayload = payload;
      return { ok: true };
    },
  });

  const req = {
    method: 'POST',
    query: { action: 'convert-to-job' },
    body: {
      estimateId: 'est-1',
      title: 'Driveway Job',
      startDate: '2026-05-02',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.job.jobNumber, 'JOB-2026-0007');
  assert.equal(res.body.job.sourceEstimateId, 'est-1');
  assert.equal(res.body.estimate.convertedToJobId, res.body.job.id);
  assert.equal(res.body.estimate.status, 'converted');

  assert.deepEqual(reservedArgs.businessId, 'biz-1');
  assert.ok(/^\d{4}$/.test(reservedArgs.year));

  assert.equal(conversionPayload.businessId, 'biz-1');
  assert.equal(conversionPayload.actorUserId, 'user-1');
  assert.equal(conversionPayload.actorName, 'Ops Manager');
  assert.equal(conversionPayload.actorEmail, 'ops@example.com');
  assert.equal(conversionPayload.estimate.id, 'est-1');
  assert.equal(conversionPayload.job.jobNumber, 'JOB-2026-0007');
});

test('convert-to-job preserves accepted equipment cost and charge-out snapshots', async () => {
  const estimate = baseEstimate();
  estimate.workAreas[0].lineItems = [
    {
      id: 'equipment-line-1',
      category: 'equipment',
      description: 'Compact excavator',
      quantity: 8,
      unit: 'hr',
      unitCost: 43,
      sellPrice: 70,
      total: 560,
      equipmentId: 'equipment-1',
      equipmentName: 'Compact Excavator',
      costRateAtEstimate: 43,
      chargeOutRateAtEstimate: 70,
      estimatedCost: 344,
      estimatedSell: 560,
    },
  ];

  const handler = createEstimatesHandler({
    requireSession: async () => baseSession(),
    getEstimateForBusiness: async () => estimate,
    reserveNextJobNumberForBusiness: async () => 'JOB-2026-0013',
    convertEstimateToJobForBusiness: async () => ({ ok: true }),
  });
  const res = createMockRes();

  await handler({ method: 'POST', query: { action: 'convert-to-job' }, body: { estimateId: 'est-1' } }, res);

  const lineItem = res.body.job.operationalWorkAreas[0].lineItems[0];
  assert.equal(lineItem.equipmentId, 'equipment-1');
  assert.equal(lineItem.costRateAtEstimate, 43);
  assert.equal(lineItem.chargeOutRateAtEstimate, 70);
  assert.equal(lineItem.estimatedCost, 344);
  assert.equal(lineItem.estimatedSell, 560);
  assert.equal(res.body.job.estimatedCost, 344);
  assert.equal(res.body.job.contractValue, 616);
});

test('convert-to-job preserves complete pricing provenance in independent original and operational snapshots', async () => {
  const estimate = baseEstimate();
  estimate.divisionId = 'division-1';
  estimate.workAreas[0].lineItems = [{
    id: 'material-line-1', category: 'material', itemName: 'Gravel', description: 'Base material', quantity: 20, unit: 'tonne',
    unitCost: 40, sellPrice: 55, total: 1100, sourceBudgetId: 'budget-1', sourceBudgetItemId: 'budget-gravel',
    sourceEntityId: 'gravel', materialCatalogItemId: 'gravel', sourceOrigin: 'budget_backed', pricingReadiness: 'priced',
    sourceRateId: 'rate-gravel', pricingRateUpdatedAt: '2026-01-02T00:00:00.000Z', pricingVersion: 2, divisionId: 'division-1',
    directCostPerUnit: 40, divisionOverheadRecoveryPerUnit: 4, companyOverheadRecoveryPerUnit: 1, recoveredCostPerUnit: 45,
    targetMarginPct: 20, estimateTargetMarginPct: 18, recommendedRateAtEstimate: 56.25, calculatedRateAtEstimate: 56.25,
    estimateCustomSellPrice: 55, estimatedCost: 800, estimatedSell: 1100,
  }];
  const handler = createEstimatesHandler({
    requireSession: async () => baseSession(),
    getEstimateForBusiness: async () => estimate,
    reserveNextJobNumberForBusiness: async () => 'JOB-2026-0014',
    convertEstimateToJobForBusiness: async () => ({ ok: true }),
  });
  const res = createMockRes();

  await handler({ method: 'POST', query: { action: 'convert-to-job' }, body: { estimateId: estimate.id } }, res);

  const job = res.body.job;
  const current = job.operationalWorkAreas[0].lineItems[0];
  const original = job.originalEstimateSnapshot.workAreas[0].lineItems[0];
  for (const field of ['sourceBudgetId', 'sourceBudgetItemId', 'sourceEntityId', 'materialCatalogItemId', 'sourceOrigin', 'pricingReadiness', 'sourceRateId', 'pricingVersion', 'directCostPerUnit', 'divisionOverheadRecoveryPerUnit', 'companyOverheadRecoveryPerUnit', 'recoveredCostPerUnit', 'targetMarginPct', 'estimateTargetMarginPct', 'recommendedRateAtEstimate', 'calculatedRateAtEstimate', 'estimateCustomSellPrice']) {
    assert.equal(current[field], estimate.workAreas[0].lineItems[0][field], field);
    assert.equal(original[field], estimate.workAreas[0].lineItems[0][field], `original ${field}`);
  }
  assert.notEqual(job.operationalWorkAreas, job.originalEstimateSnapshot.workAreas);
  assert.notEqual(current, original);
  current.unitCost = 48;
  assert.equal(original.unitCost, 40);
  assert.equal(job.originalContractRevenue, 1100);
  assert.equal(job.currentContractRevenue, 1100);
  assert.equal(job.contractValue, 1210);
  assert.equal(job.currentPlannedCost, 800);
  assert.equal(job.planningRevision, 1);
  assert.equal(job.divisionId, 'division-1');
});

test('convert-to-job replaces generic draft estimate labels with an operational job name', async () => {
  const handler = createEstimatesHandler({
    requireSession: async () => baseSession(),
    getEstimateForBusiness: async () => ({ ...baseEstimate(), title: 'Draft Estimate EST-2026-0012', propertyLabel: 'Miller Residence' }),
    reserveNextJobNumberForBusiness: async () => 'JOB-2026-0012',
    convertEstimateToJobForBusiness: async () => ({ ok: true }),
  });
  const res = createMockRes();
  await handler({ method: 'POST', query: { action: 'convert-to-job' }, body: { estimateId: 'est-1', title: 'Draft Estimate EST-2026-0012' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.job.title, 'Miller Residence');
});

test('convert-to-job surfaces already-converted conflicts', async () => {
  const handler = createEstimatesHandler({
    requireSession: async () => baseSession(),
    getEstimateForBusiness: async () => baseEstimate(),
    reserveNextJobNumberForBusiness: async () => 'JOB-2026-0008',
    convertEstimateToJobForBusiness: async () => ({
      ok: false,
      code: 'ALREADY_CONVERTED',
      convertedToJobId: 'job-10',
    }),
  });

  const req = {
    method: 'POST',
    query: { action: 'convert-to-job' },
    body: { estimateId: 'est-1' },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.convertedToJobId, 'job-10');
});

test('convert-to-job allows only one concurrent conversion for the same estimate', async () => {
  const convertedEstimateIds = new Set();
  let sequence = 0;

  const handler = createEstimatesHandler({
    requireSession: async () => baseSession(),
    getEstimateForBusiness: async () => baseEstimate(),
    reserveNextJobNumberForBusiness: async () => {
      sequence += 1;
      return `JOB-2026-${String(sequence).padStart(4, '0')}`;
    },
    convertEstimateToJobForBusiness: async ({ estimate }) => {
      if (convertedEstimateIds.has(estimate.id)) {
        return {
          ok: false,
          code: 'ALREADY_CONVERTED',
          convertedToJobId: 'job-existing',
        };
      }

      convertedEstimateIds.add(estimate.id);
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { ok: true };
    },
  });

  const firstReq = {
    method: 'POST',
    query: { action: 'convert-to-job' },
    body: { estimateId: 'est-1' },
  };
  const secondReq = {
    method: 'POST',
    query: { action: 'convert-to-job' },
    body: { estimateId: 'est-1' },
  };

  const firstRes = createMockRes();
  const secondRes = createMockRes();

  await Promise.all([
    handler(firstReq, firstRes),
    handler(secondReq, secondRes),
  ]);

  const responses = [firstRes, secondRes];
  const successResponses = responses.filter((response) => response.statusCode === 200);
  const conflictResponses = responses.filter((response) => response.statusCode !== 200);

  assert.equal(successResponses.length, 1);
  assert.equal(conflictResponses.length, 1);
  assert.equal(conflictResponses[0].statusCode, 409);
  assert.equal(successResponses[0].body.ok, true);
  assert.equal(conflictResponses[0].body.ok, false);
  assert.equal(conflictResponses[0].body.error, 'Estimate already converted.');
});
