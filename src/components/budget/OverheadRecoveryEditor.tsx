import { useEffect, useRef, useState } from 'react';
import { Button, Card, Input } from '../ui';
import type { OverheadRecoveryAllocation, OverheadRecoveryPolicy } from '../../types';
import { formatCurrency } from '../../utils';
import { emptyRecoveryAllocation, recoveryAllocationTotal } from '../../pages/budget/overheadRecoveryModel.js';

const categories = [
  ['labourPercent', 'Labour'],
  ['equipmentPercent', 'Equipment'],
  ['materialsPercent', 'Materials'],
  ['subcontractorsPercent', 'Subcontractors'],
] as const;

interface Props {
  title: string;
  description: string;
  totalOverhead: number;
  policy?: OverheadRecoveryPolicy;
  canEdit: boolean;
  onSave: (policy: OverheadRecoveryPolicy) => Promise<unknown>;
}

export default function OverheadRecoveryEditor({ title, description, totalOverhead, policy, canEdit, onSave }: Props) {
  const [allocation, setAllocation] = useState<OverheadRecoveryAllocation>(policy?.allocation ?? emptyRecoveryAllocation());
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const saving = useRef(false);

  useEffect(() => {
    setAllocation(policy?.allocation ?? emptyRecoveryAllocation());
    setStatus('idle');
  }, [policy]);

  const total = recoveryAllocationTotal(allocation);
  const valid = Math.abs(total - 100) < 0.001;
  const save = async () => {
    if (!valid || saving.current) return;
    saving.current = true;
    setStatus('saving');
    try {
      const result = await onSave({ version: 2, allocation });
      setStatus(result ? 'saved' : 'failed');
    } catch {
      setStatus('failed');
    } finally {
      saving.current = false;
    }
  };

  return <Card className="p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h3 className="font-semibold text-gray-900 dark:text-brand-50">{title}</h3><p className="mt-1 text-sm text-gray-500 dark:text-brand-300">{description}</p></div>
      <div className="text-left sm:text-right"><p className="text-xs uppercase text-gray-500">Recovery pool</p><p className="font-semibold">{formatCurrency(totalOverhead)}</p></div>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {categories.map(([field, label]) => <div key={field}>
        <Input label={`${label} %`} type="number" min={0} max={100} step={0.01} value={allocation[field]} disabled={!canEdit || status === 'saving'} onChange={(event) => { const value = Number(event.target.value); setAllocation((current) => ({ ...current, [field]: Number.isFinite(value) ? Math.max(0, value) : 0 })); setStatus('idle'); }} />
        <p className="mt-1 text-xs text-gray-500">{formatCurrency(totalOverhead * allocation[field] / 100)}</p>
      </div>)}
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-brand-100 pt-3 dark:border-brand-600">
      <p className={`text-sm font-semibold ${valid ? 'text-green-700' : 'text-amber-700'}`}>{total.toFixed(2)}% allocated{valid ? '' : ' · Must total 100%'}</p>
      {canEdit ? <div className="flex items-center gap-3">{status === 'failed' ? <p className="text-sm text-red-600" role="alert">Recovery policy could not be saved.</p> : status === 'saved' ? <p className="text-sm text-green-700">Saved</p> : null}<Button size="sm" disabled={!valid || status === 'saving'} onClick={() => void save()}>{status === 'saving' ? 'Saving...' : 'Save Recovery'}</Button></div> : null}
    </div>
  </Card>;
}
