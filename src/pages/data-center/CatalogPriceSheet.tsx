import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, Input, Select } from '../../components/ui';
import { formatCurrency } from '../../utils';
import { emitAppToast } from '../../toast';
import type { CatalogPricingItem, CatalogPricingPayload } from './catalogPricing';

type Labels = { cost: string; calculated: string; custom: string; estimate: string };
type Props = {
  pricing: CatalogPricingPayload;
  loading: boolean;
  items: CatalogPricingItem[];
  labels: Labels;
  onSaveCustomRate: (input: { category: CatalogPricingItem['type']; sourceEntityId: string; divisionId: string; customRate: number | null }) => Promise<void>;
  emptyTitle?: string;
  emptyDescription?: string;
};

const money = (value: number | null | undefined, unit: string) => value === null || value === undefined ? 'Unavailable' : `${formatCurrency(value)}/${unit}`;

export default function CatalogPriceSheet({ pricing, loading, items, labels, onSaveCustomRate, emptyTitle = 'Pricing has not been calculated yet', emptyDescription = 'Complete planning in the selected Pricing Budget to calculate this item.' }: Props) {
  const validItems = useMemo(() => items.filter((item) => item.pricingAvailable && item.divisionId && item.divisionName)
    .filter((item, index, values) => values.findIndex((candidate) => candidate.divisionId === item.divisionId) === index)
    .sort((left, right) => (left.divisionName ?? '').localeCompare(right.divisionName ?? '')), [items]);
  const [divisionId, setDivisionId] = useState('');
  const [customDraft, setCustomDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const selected = validItems.find((item) => item.divisionId === divisionId) ?? validItems[0];

  useEffect(() => {
    if (!validItems.some((item) => item.divisionId === divisionId)) setDivisionId(validItems[0]?.divisionId ?? '');
  }, [divisionId, validItems]);
  useEffect(() => { setCustomDraft(selected?.customRate === null || selected?.customRate === undefined ? '' : String(selected.customRate)); }, [selected]);

  if (loading) return <Card className="p-5"><p className="text-sm text-gray-500">Loading current Catalog pricing...</p></Card>;
  if (pricing.error) return <EmptyState title="Catalog pricing could not be loaded" description={pricing.error} />;
  if (pricing.status === 'unconfigured') return <EmptyState title="No Pricing Budget selected" description="Choose the Budget OliveOps should use to calculate current Catalog pricing." action={<Link to="/settings/pricing"><Button>Choose Pricing Budget</Button></Link>} />;
  if (pricing.status === 'invalid') return <EmptyState title="Pricing Budget needs attention" description="The selected Pricing Budget is missing or no longer eligible. Select a replacement without changing existing Estimates." action={<Link to="/settings/pricing"><Button>Review Pricing Budget</Button></Link>} />;
  if (!selected) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  const unit = selected.unit || 'unit';
  const save = async () => {
    const parsed = customDraft.trim() === '' ? null : Number(customDraft);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return emitAppToast({ tone: 'error', message: `${labels.custom} must be zero or greater.` });
    if (!selected.sourceEntityId || !selected.divisionId) return;
    setSaving(true);
    try {
      await onSaveCustomRate({ category: selected.type, sourceEntityId: selected.sourceEntityId, divisionId: selected.divisionId, customRate: parsed });
      emitAppToast({ tone: 'success', message: parsed === null ? `${labels.custom} cleared.` : `${labels.custom} saved.` });
    } catch (error) {
      emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : `${labels.custom} could not be saved.` });
    } finally { setSaving(false); }
  };

  return <div className="max-w-2xl space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <Select label="Pricing Division" value={selected.divisionId} onChange={(event) => setDivisionId(event.target.value)} disabled={validItems.length === 1}>
        {validItems.map((item) => <option key={item.divisionId} value={item.divisionId}>{item.divisionName}</option>)}
      </Select>
      <div><p className="text-sm font-medium text-gray-700 dark:text-brand-100">Pricing source</p><p className="mt-2 text-sm text-gray-600 dark:text-brand-200">{pricing.budget?.name}</p></div>
    </div>
    <Card className="p-5">
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-gray-600">{labels.cost}</dt><dd className="font-medium">{money(selected.costRate, unit)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-gray-600">Overhead Recovery</dt><dd className="font-medium">{money(selected.divisionOverheadRecoveryPerUnit, unit)}</dd></div>
        <div className="flex justify-between gap-4 border-t border-gray-200 pt-3"><dt className="font-medium">Breakeven</dt><dd className="font-semibold">{money(selected.recoveredCostPerUnit, unit)}</dd></div>
        <div className="flex justify-between gap-4 pt-2"><dt className="text-gray-600">Target Net Profit</dt><dd className="font-medium">{selected.targetMarginPct === null || selected.targetMarginPct === undefined ? 'Unavailable' : `${selected.targetMarginPct}%`}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-gray-600">Profit</dt><dd className="font-medium">{money(selected.profit, unit)}</dd></div>
        <div className="flex justify-between gap-4 border-t border-gray-200 pt-4 text-base"><dt className="font-semibold">{labels.calculated}</dt><dd className="font-bold">{money(selected.calculatedRate, unit)}</dd></div>
      </dl>
      <div className="mt-5 grid items-end gap-3 sm:grid-cols-[1fr_auto]">
        <Input label={labels.custom} type="number" min={0} step={0.01} value={customDraft} onChange={(event) => setCustomDraft(event.target.value)} placeholder="No override" />
        <Button variant="secondary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving...' : customDraft.trim() ? 'Save Override' : 'Clear Override'}</Button>
      </div>
      <div className="mt-5 flex items-baseline justify-between gap-4 border-t-2 border-brand-200 pt-4"><p className="text-base font-semibold">{labels.estimate}</p><p className="text-xl font-bold text-brand-800 dark:text-brand-50">{money(selected.estimateRate, unit)}</p></div>
      <p className="mt-2 text-right text-xs text-gray-500">Used for new Estimates.</p>
    </Card>
  </div>;
}