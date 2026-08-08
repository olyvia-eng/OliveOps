import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDashboardOnboardingItems,
  calculateDashboardOnboardingProgress,
} from '../src/components/dashboard/onboardingProgress.js';

function baseData(overrides = {}) {
  return {
    businessId: '',
    businessName: '',
    employees: [],
    customers: [],
    estimates: [],
    jobs: [],
    budgets: [],
    budgetRates: [],
    ...overrides,
  };
}

test('onboarding starts at zero when no data exists', () => {
  const items = buildDashboardOnboardingItems(baseData());
  const progress = calculateDashboardOnboardingProgress(items);

  assert.equal(items.length, 6);
  assert.equal(progress.completeCount, 0);
  assert.equal(progress.percent, 0);
  assert.equal(progress.isComplete, false);
});

test('onboarding marks pricing step complete when a budget and active rate exist', () => {
  const items = buildDashboardOnboardingItems(baseData({
    budgets: [
      {
        id: 'budget-1',
        name: '2026 Pricing Budget',
        budgetType: 'operating',
        division: 'company_wide',
        fiscalYear: '2026',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    budgetRates: [
      {
        id: 'rate-1',
        budgetId: 'budget-1',
        category: 'labour',
        itemName: 'Crew labour',
        description: '',
        unit: 'hr',
        unitCost: 45,
        defaultMarkupPercent: 20,
        defaultSellPrice: 54,
        active: true,
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }));

  const pricingStep = items.find((item) => item.id === 'pricing-setup');
  assert.equal(pricingStep?.complete, true);
});

test('optional crew step does not block onboarding completion', () => {
  const items = buildDashboardOnboardingItems(baseData({
    businessId: 'business-1',
    customers: [
      {
        id: 'customer-1',
        name: 'Acme',
        company: 'Acme Inc',
        email: 'acme@example.com',
        phone: '',
        properties: [],
        status: 'active',
        notes: '',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    budgets: [
      {
        id: 'budget-1',
        name: '2026 Pricing Budget',
        budgetType: 'operating',
        division: 'company_wide',
        fiscalYear: '2026',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    budgetRates: [
      {
        id: 'rate-1',
        budgetId: 'budget-1',
        category: 'labour',
        itemName: 'Crew labour',
        description: '',
        unit: 'hr',
        unitCost: 45,
        defaultMarkupPercent: 20,
        defaultSellPrice: 54,
        active: true,
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    estimates: [
      {
        id: 'estimate-1',
        customerId: 'customer-1',
        title: 'Estimate',
        description: '',
        status: 'draft',
        lineItems: [],
        taxRate: 0,
        notes: '',
        validUntil: '2026-01-10',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    jobs: [
      {
        id: 'job-1',
        customerId: 'customer-1',
        title: 'Demo Job',
        description: '',
        status: 'in_progress',
        startDate: '2026-01-01',
        estimatedHours: 10,
        actualHours: 0,
        estimatedCost: 0,
        actualCosts: [],
        contractValue: 1000,
        assignedEmployeeIds: [],
        notes: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }));

  const crewStep = items.find((item) => item.id === 'crew-setup');
  const progress = calculateDashboardOnboardingProgress(items);

  assert.equal(crewStep?.optional, true);
  assert.equal(crewStep?.complete, false);
  assert.equal(progress.completeCount, 5);
  assert.equal(progress.totalCount, 5);
  assert.equal(progress.optionalTotalCount, 1);
  assert.equal(progress.optionalCompleteCount, 0);
  assert.equal(progress.isComplete, true);
});

test('onboarding progress reaches 100 when all checklist conditions are met', () => {
  const items = buildDashboardOnboardingItems(baseData({
    businessId: 'business-1',
    businessName: 'OliveOps Contracting',
    employees: [
      {
        id: 'emp-1',
        name: 'Sam',
        email: 'sam@example.com',
        phone: '',
        role: 'foreman',
        hourlyRate: 30,
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    customers: [
      {
        id: 'customer-1',
        name: 'Acme',
        company: 'Acme Inc',
        email: 'acme@example.com',
        phone: '',
        properties: [],
        status: 'active',
        notes: '',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    budgets: [
      {
        id: 'budget-1',
        name: '2026 Pricing Budget',
        budgetType: 'operating',
        division: 'company_wide',
        fiscalYear: '2026',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    budgetRates: [
      {
        id: 'rate-1',
        budgetId: 'budget-1',
        category: 'labour',
        itemName: 'Crew labour',
        description: '',
        unit: 'hr',
        unitCost: 45,
        defaultMarkupPercent: 20,
        defaultSellPrice: 54,
        active: true,
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    estimates: [
      {
        id: 'estimate-1',
        customerId: 'customer-1',
        title: 'Estimate',
        description: '',
        status: 'draft',
        lineItems: [],
        taxRate: 0,
        notes: '',
        validUntil: '2026-01-10',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    jobs: [
      {
        id: 'job-1',
        customerId: 'customer-1',
        title: 'Demo Job',
        description: '',
        status: 'in_progress',
        startDate: '2026-01-01',
        estimatedHours: 10,
        actualHours: 0,
        estimatedCost: 0,
        actualCosts: [{ id: 'cost-1', category: 'labour', description: '', quantity: 1, unit: 'hr', unitCost: 25, total: 25, date: '2026-01-01' }],
        contractValue: 1000,
        assignedEmployeeIds: [],
        notes: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }));

  const progress = calculateDashboardOnboardingProgress(items);
  assert.equal(progress.completeCount, 5);
  assert.equal(progress.percent, 100);
  assert.equal(progress.isComplete, true);
  assert.equal(progress.optionalCompleteCount, 1);
});
