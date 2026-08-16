import { useEffect, useState } from 'react';
import { Check, Download, LoaderCircle } from 'lucide-react';
import { Button, Modal, Select } from '../ui';
import type { Budget, BudgetDivision, BudgetDivisionPlanCategory } from '../../types';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';

interface SourceBudget extends Budget { divisions: Array<Pick<BudgetDivision, 'id' | 'budgetId' | 'name'>> }
interface PreviewItem {
  sourceItemId: string;
  name?: string;
  description?: string;
  role?: string;
  unit?: string;
  hourlyRate?: number;
  rate?: number;
  unitCost?: number;
  alreadyAdded?: boolean;
  unavailable?: boolean;
  unavailableReason?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  budget: Budget;
  division: BudgetDivision;
  category: BudgetDivisionPlanCategory;
}

const labelByCategory = { labour: 'Labour', equipment: 'Equipment', materials: 'Materials', subcontractors: 'Subcontractors' };

export default function BudgetPlanImportDialog({ open, onClose, budget, division, category }: Props) {
  const importItems = useStore((state) => state.importBudgetDivisionPlanningItems);
  const [sources, setSources] = useState<SourceBudget[]>([]);
  const [sourceBudgetId, setSourceBudgetId] = useState('');
  const [sourceDivisionId, setSourceDivisionId] = useState('');
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const sourceBudget = sources.find((item) => item.id === sourceBudgetId);
  const sourceDivision = sourceBudget?.divisions.find((item) => item.id === sourceDivisionId);
  const availableIds = items.filter((item) => !item.alreadyAdded && !item.unavailable).map((item) => item.sourceItemId);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void fetch(`/api/budget-division-import?budgetId=${encodeURIComponent(budget.id)}&divisionId=${encodeURIComponent(division.id)}&category=${encodeURIComponent(category)}`, { credentials: 'include' })
      .then(async (response) => ({ response, payload: await response.json() as { ok?: boolean; sourceBudgets?: SourceBudget[]; recommendedSourceBudgetId?: string } }))
      .then(({ response, payload }) => {
        if (!response.ok || !payload.ok) throw new Error('Previous Budgets could not be loaded.');
        const nextSources = payload.sourceBudgets ?? [];
        const nextBudgetId = payload.recommendedSourceBudgetId ?? nextSources[0]?.id ?? '';
        setSources(nextSources);
        setSourceBudgetId(nextBudgetId);
        setSourceDivisionId(nextSources.find((item) => item.id === nextBudgetId)?.divisions[0]?.id ?? '');
      })
      .catch(() => emitAppToast({ tone: 'error', message: 'Previous Budgets could not be loaded.' }))
      .finally(() => setLoading(false));
  }, [budget.id, category, division.id, open]);

  useEffect(() => {
    if (!open || !sourceBudgetId || !sourceDivisionId) {
      setItems([]);
      setSelected(new Set());
      return;
    }
    setLoading(true);
    const query = new URLSearchParams({ budgetId: budget.id, divisionId: division.id, category, sourceBudgetId, sourceDivisionId });
    void fetch(`/api/budget-division-import?${query}`, { credentials: 'include' })
      .then(async (response) => ({ response, payload: await response.json() as { ok?: boolean; items?: PreviewItem[] } }))
      .then(({ response, payload }) => {
        if (!response.ok || !payload.ok) throw new Error('Planning items could not be previewed.');
        const nextItems = payload.items ?? [];
        setItems(nextItems);
        setSelected(new Set(nextItems.filter((item) => !item.alreadyAdded && !item.unavailable).map((item) => item.sourceItemId)));
      })
      .catch(() => emitAppToast({ tone: 'error', message: 'Planning items could not be previewed.' }))
      .finally(() => setLoading(false));
  }, [budget.id, category, division.id, open, sourceBudgetId, sourceDivisionId]);

  const submit = async () => {
    setSaving(true);
    const result = await importItems({ budgetId: budget.id, divisionId: division.id, category, sourceBudgetId, sourceDivisionId, sourceItemIds: [...selected] });
    setSaving(false);
    if (!result.ok) {
      emitAppToast({ tone: 'error', message: result.error ?? 'Planning items could not be imported.' });
      return;
    }
    emitAppToast({ tone: 'success', message: `${result.importedCount} ${labelByCategory[category].toLowerCase()} item${result.importedCount === 1 ? '' : 's'} imported.${result.skippedCount ? ` ${result.skippedCount} already added or unavailable.` : ''}` });
    onClose();
  };

  return <Modal open={open} onClose={() => { if (!saving) onClose(); }} title={`Import ${labelByCategory[category]}`} size="wide" footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void submit()} disabled={selected.size === 0 || saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Download />} Import {selected.size} Item{selected.size === 1 ? '' : 's'}</Button></>}>
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={`Copy ${labelByCategory[category].toLowerCase()} planning items from`} value={sourceBudgetId} onChange={(event) => { const next = sources.find((item) => item.id === event.target.value); setSourceBudgetId(event.target.value); setSourceDivisionId(next?.divisions[0]?.id ?? ''); }}><option value="">Choose a Budget</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.fiscalYear} {item.name}</option>)}</Select>
        <Select label="Source Division" value={sourceDivisionId} onChange={(event) => setSourceDivisionId(event.target.value)} disabled={!sourceBudget}><option value="">Choose a Division</option>{sourceBudget?.divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      </div>
      <div className="grid gap-3 border-y border-brand-100 py-4 text-sm sm:grid-cols-2 dark:border-brand-600">
        <div><p className="text-xs font-semibold uppercase text-brand-400">Source</p><p className="mt-1 font-medium text-brand-900 dark:text-brand-50">{sourceBudget ? `${sourceBudget.fiscalYear} ${sourceBudget.name}` : 'Choose a Budget'}</p><p className="text-brand-500 dark:text-brand-300">{sourceDivision?.name ?? 'Choose a Division'}</p></div>
        <div><p className="text-xs font-semibold uppercase text-brand-400">Destination</p><p className="mt-1 font-medium text-brand-900 dark:text-brand-50">{budget.fiscalYear} {budget.name}</p><p className="text-brand-500 dark:text-brand-300">→ {division.name}</p></div>
      </div>
      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-brand-900 dark:text-brand-50">Select {labelByCategory[category]} to Import</h3><div className="flex gap-2"><button type="button" className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-100" onClick={() => setSelected(new Set(availableIds))}>Select All</button><button type="button" className="text-sm font-semibold text-brand-500 hover:underline dark:text-brand-200" onClick={() => setSelected(new Set())}>Clear All</button></div></div>
      {loading ? <div className="flex justify-center py-10 text-brand-500"><LoaderCircle className="animate-spin" /></div> : items.length === 0 ? <p className="py-8 text-center text-sm text-brand-400">No reusable {labelByCategory[category].toLowerCase()} items were found in this source.</p> : <ul className="divide-y divide-brand-100 rounded-lg border border-brand-100 dark:divide-brand-600 dark:border-brand-600">{items.map((item) => {
        const disabled = item.alreadyAdded || item.unavailable;
        return <li key={item.sourceItemId} className={`flex items-center gap-3 px-4 py-3 ${disabled ? 'opacity-60' : ''}`}><input type="checkbox" checked={selected.has(item.sourceItemId)} disabled={disabled} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.sourceItemId); else next.delete(item.sourceItemId); return next; })} className="h-4 w-4 accent-brand-700" /><div className="min-w-0 flex-1"><p className="font-medium text-brand-900 dark:text-brand-50">{item.name || item.description}</p><p className="text-xs text-brand-400">{[item.role, item.unit, item.hourlyRate !== undefined ? `$${item.hourlyRate}/hr` : null, item.rate !== undefined ? `$${item.rate}` : null, item.unitCost !== undefined ? `$${item.unitCost}/${item.unit ?? 'unit'}` : null].filter(Boolean).join(' · ')}</p></div>{item.alreadyAdded ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700"><Check size={14} /> Already added</span> : item.unavailable ? <span className="text-xs font-semibold text-accent-700" title={item.unavailableReason}>Unavailable</span> : null}</li>;
      })}</ul>}
      {selected.size > 0 ? <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm dark:bg-brand-800"><strong>Import to {division.name}</strong><span className="ml-2 text-brand-500 dark:text-brand-300">{selected.size} {labelByCategory[category]} item{selected.size === 1 ? '' : 's'} selected</span></div> : null}
    </div>
  </Modal>;
}