import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeDollarSign } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, Select } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';

type BusinessPricingProfile = { name: string; timezone: string; pricingBudgetId: string | null };

export default function PricingSettingsPage() {
  const budgets = useStore((state) => state.budgets);
  const eligibleBudgets = useMemo(() => budgets
    .filter((budget) => budget.status === 'active' && budget.planningModel === 'divisions_v1' && budget.budgetType === 'operating')
    .sort((left, right) => left.name.localeCompare(right.name)), [budgets]);
  const [business, setBusiness] = useState<BusinessPricingProfile | null>(null);
  const [pricingBudgetId, setPricingBudgetId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch('/api/business', { credentials: 'include' }).then(async (response) => {
      const payload = await response.json() as { ok?: boolean; error?: string; business?: BusinessPricingProfile };
      if (!response.ok || !payload.ok || !payload.business) throw new Error(payload.error ?? 'Pricing settings could not be loaded.');
      setBusiness(payload.business);
      setPricingBudgetId(payload.business.pricingBudgetId ?? '');
    }).catch((error: unknown) => emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Pricing settings could not be loaded.' })).finally(() => setLoading(false));
  }, []);

  const configuredBudgetIsInvalid = Boolean(business?.pricingBudgetId && !eligibleBudgets.some((budget) => budget.id === business.pricingBudgetId));
  const save = async () => {
    if (!business) return;
    setSaving(true);
    try {
      const response = await fetch('/api/business', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ timezone: business.timezone, pricingBudgetId: pricingBudgetId || null }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; business?: BusinessPricingProfile };
      if (!response.ok || !payload.ok || !payload.business) throw new Error(payload.error ?? 'Pricing Budget could not be saved.');
      setBusiness(payload.business);
      setPricingBudgetId(payload.business.pricingBudgetId ?? '');
      emitAppToast({ tone: 'success', message: 'Pricing Budget updated.' });
    } catch (error: unknown) {
      emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Pricing Budget could not be saved.' });
    } finally {
      setSaving(false);
    }
  };

  return <div>
    <PageHeader title="Pricing" subtitle="Choose which operating Budget supplies the company's current price book." />
    <Card className="max-w-2xl p-5">
      <div className="mb-5 flex items-start gap-3"><BadgeDollarSign className="mt-0.5 text-brand-700" /><div><h2 className="font-semibold text-brand-900 dark:text-brand-50">Pricing Budget</h2><p className="mt-1 text-sm text-brand-500 dark:text-brand-200">Used to calculate current Catalog rates and prices for new Estimates.</p></div></div>
      {eligibleBudgets.length ? <>
        {configuredBudgetIsInvalid ? <p className="mb-4 border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">Pricing Budget needs attention. Select an active operating Division Budget.</p> : null}
        <Select label="Pricing Budget" disabled={loading || saving} value={pricingBudgetId} onChange={(event) => setPricingBudgetId(event.target.value)}>
          <option value="">No Pricing Budget selected</option>
          {eligibleBudgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}
        </Select>
        <p className="mt-3 text-sm text-gray-500">Changing the Pricing Budget updates current Catalog pricing. Existing Estimates are not repriced.</p>
        <div className="mt-5"><Button onClick={() => void save()} disabled={loading || saving || pricingBudgetId === (business?.pricingBudgetId ?? '')}>{saving ? 'Saving...' : eligibleBudgets.length === 1 && !business?.pricingBudgetId ? `Use ${eligibleBudgets[0].name} as Pricing Budget` : 'Save Pricing Budget'}</Button></div>
      </> : <EmptyState title="No eligible Pricing Budgets" description="Create and activate an operating Division Budget before selecting the company price book." action={<Link to="/budgets"><Button>View Budgets</Button></Link>} />}
    </Card>
  </div>;
}