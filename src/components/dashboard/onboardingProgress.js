function hasCompanyAccount({ businessId, businessName }) {
  if (typeof businessId === 'string' && businessId.trim().length > 0) return true;
  return typeof businessName === 'string' && businessName.trim().length > 0;
}

function hasPricingSetup(budgets, budgetRates) {
  if (budgets.length === 0) return false;
  return budgetRates.some((rate) => rate.active !== false);
}

export function buildDashboardOnboardingItems({
  businessId,
  businessName,
  employees,
  customers,
  estimates,
  jobs,
  budgets,
  budgetRates,
}) {
  return [
    {
      id: 'company-account',
      label: 'Company account ready',
      complete: hasCompanyAccount({ businessId, businessName }),
      to: '/',
    },
    {
      id: 'first-customer',
      label: 'Add your first client',
      complete: customers.length > 0,
      to: '/crm',
    },
    {
      id: 'pricing-setup',
      label: 'Set up pricing',
      complete: hasPricingSetup(budgets, budgetRates),
      to: '/budgets',
    },
    {
      id: 'first-estimate',
      label: 'Create your first estimate',
      complete: estimates.length > 0,
      to: '/estimates',
    },
    {
      id: 'first-job',
      label: 'Create or convert your first job',
      complete: jobs.length > 0,
      to: '/jobs',
    },
    {
      id: 'crew-setup',
      label: 'Add your crew (optional)',
      complete: employees.length > 0,
      to: '/employees',
      optional: true,
    },
  ];
}

export function calculateDashboardOnboardingProgress(items) {
  const essentialItems = items.filter((item) => !item.optional);
  const optionalItems = items.filter((item) => item.optional);
  const totalCount = essentialItems.length;
  const completeCount = essentialItems.filter((item) => item.complete).length;
  const optionalTotalCount = optionalItems.length;
  const optionalCompleteCount = optionalItems.filter((item) => item.complete).length;
  const percent = totalCount === 0 ? 0 : Math.round((completeCount / totalCount) * 100);

  return {
    totalCount,
    completeCount,
    optionalTotalCount,
    optionalCompleteCount,
    percent,
    isComplete: totalCount > 0 && completeCount === totalCount,
  };
}
