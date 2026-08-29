import { X } from 'lucide-react';
import type { EstimateLineItem } from '../../types';
import { formatCurrency } from '../../utils';
import { calculateEstimateSnapshotPricing } from '../../utils/estimatePricingModel.js';
import { formatNumericDisplayValue, parseNumericInputValue } from '../../utils/numberInput';
import { Button } from '../ui';

interface Props {
  lineItem: EstimateLineItem;
  onChange: (lineItem: EstimateLineItem) => void;
  onClose: () => void;
}

export default function EstimateLinePricingEditor({ lineItem, onChange, onClose }: Props) {
  const breakeven = lineItem.recoveredCostPerUnit ?? lineItem.breakevenRate ?? lineItem.unitCost;
  const targetMarginPct = lineItem.estimateTargetMarginPct ?? lineItem.targetMarginPct ?? 0;
  const customSellPrice = lineItem.estimateCustomSellPrice ?? null;
  const pricing = calculateEstimateSnapshotPricing({ breakeven, targetMarginPct, customSellPrice });
  const updatePricing = (nextMargin: number, nextCustomPrice: number | null) => {
    const next = calculateEstimateSnapshotPricing({ breakeven, targetMarginPct: nextMargin, customSellPrice: nextCustomPrice });
    onChange({
      ...lineItem,
      estimateTargetMarginPct: next.targetMarginPct,
      estimateCustomSellPrice: next.customSellPrice,
      sellPrice: next.sellPrice,
      total: lineItem.quantity * next.sellPrice,
      ...(lineItem.category === 'equipment' ? {
        chargeOutRateAtEstimate: next.sellPrice,
        estimatedSell: lineItem.quantity * next.sellPrice,
      } : {}),
    });
  };

  return <div className="fixed inset-0 z-50">
    <div className="absolute inset-0 bg-black/50" onClick={onClose} />
    <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl dark:bg-brand-800" aria-label="Edit line pricing">
      <div className="flex items-center justify-between border-b border-brand-100 px-4 py-3 dark:border-brand-600">
        <div className="min-w-0"><h2 className="truncate text-sm font-semibold text-gray-900 dark:text-brand-50">Pricing: {lineItem.itemName || lineItem.description || 'Item'}</h2><p className="text-xs text-gray-500 dark:text-brand-300">Estimate only · {lineItem.unit}</p></div>
        <button type="button" title="Close pricing editor" onClick={onClose} className="rounded-md p-2 text-gray-400 hover:bg-brand-50 hover:text-gray-700 dark:hover:bg-brand-700 dark:hover:text-brand-100"><X size={18} /></button>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-4 border-b border-brand-100 pb-5 text-sm dark:border-brand-600">
          <div><p className="text-xs text-gray-500 dark:text-brand-300">Breakeven</p><p className="mt-1 font-semibold tabular-nums text-gray-900 dark:text-brand-50">{formatCurrency(pricing.breakeven)}/{lineItem.unit}</p></div>
          <div><p className="text-xs text-gray-500 dark:text-brand-300">Effective margin</p><p className="mt-1 font-semibold tabular-nums text-gray-900 dark:text-brand-50">{pricing.effectiveMarginPct.toFixed(2)}%</p></div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-gray-600 dark:text-brand-200">Pricing method</p>
          <div className="grid grid-cols-2 rounded-md border border-brand-100 p-1 dark:border-brand-600">
            <button type="button" aria-pressed={customSellPrice === null} onClick={() => updatePricing(targetMarginPct, null)} className={`rounded px-3 py-2 text-sm font-medium ${customSellPrice === null ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-700'}`}>Margin</button>
            <button type="button" aria-pressed={customSellPrice !== null} onClick={() => updatePricing(targetMarginPct, pricing.sellPrice)} className={`rounded px-3 py-2 text-sm font-medium ${customSellPrice !== null ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-700'}`}>Custom price</button>
          </div>
        </div>
        {customSellPrice === null ? <label className="block text-sm font-medium text-gray-700 dark:text-brand-100">Profit margin<input aria-label="Profit margin" type="text" inputMode="decimal" value={formatNumericDisplayValue(targetMarginPct)} onChange={(event) => updatePricing(parseNumericInputValue(event.target.value), null)} onFocus={(event) => event.currentTarget.select()} className="mt-2 h-11 w-full rounded-md border border-brand-100 bg-white px-3 text-right text-base font-semibold text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" /></label>
          : <label className="block text-sm font-medium text-gray-700 dark:text-brand-100">Custom sell price / {lineItem.unit}<input aria-label="Custom sell price" type="text" inputMode="decimal" value={formatNumericDisplayValue(customSellPrice)} onChange={(event) => updatePricing(targetMarginPct, parseNumericInputValue(event.target.value))} onFocus={(event) => event.currentTarget.select()} className="mt-2 h-11 w-full rounded-md border border-brand-100 bg-white px-3 text-right text-base font-semibold text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" /></label>}
        <div className="border-t border-brand-100 pt-5 dark:border-brand-600"><p className="text-xs text-gray-500 dark:text-brand-300">Estimate sell price</p><p className="mt-1 text-2xl font-semibold tabular-nums text-gray-950 dark:text-brand-50">{formatCurrency(pricing.sellPrice)}/{lineItem.unit}</p></div>
      </div>
      <div className="border-t border-brand-100 p-4 dark:border-brand-600"><Button className="w-full" onClick={onClose}>Done</Button></div>
    </aside>
  </div>;
}