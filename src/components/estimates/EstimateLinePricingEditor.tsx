import { useState } from 'react';
import { X } from 'lucide-react';
import type { EstimateLineItem } from '../../types';
import { formatCurrency } from '../../utils';
import { calculateEstimateSnapshotPricing, estimateLineEffectiveQuantity } from '../../utils/estimatePricingModel.js';
import { formatNumericDisplayValue, parseNumericInputValue } from '../../utils/numberInput';
import { Button } from '../ui';

interface Props {
  lineItem: EstimateLineItem;
  initialMode?: 'profit' | 'price';
  onChange: (lineItem: EstimateLineItem) => void;
  onClose: () => void;
}

export default function EstimateLinePricingEditor({ lineItem, initialMode = 'profit', onChange, onClose }: Props) {
  const breakeven = lineItem.recoveredCostPerUnit ?? lineItem.breakevenRate ?? lineItem.unitCost;
  const [targetMarginPct, setTargetMarginPct] = useState(lineItem.estimateTargetMarginPct ?? lineItem.targetMarginPct ?? 0);
  const [customSellPrice, setCustomSellPrice] = useState<number | null>(lineItem.estimateCustomSellPrice ?? null);
  const pricing = calculateEstimateSnapshotPricing({ breakeven, targetMarginPct, customSellPrice });
  const savePricing = () => {
    const effectiveQuantity = estimateLineEffectiveQuantity(lineItem);
    onChange({
      ...lineItem,
      pricingReadiness: 'priced',
      estimateTargetMarginPct: pricing.targetMarginPct,
      estimateCustomSellPrice: pricing.customSellPrice,
      sellPrice: pricing.sellPrice,
      total: effectiveQuantity * pricing.sellPrice,
      ...(lineItem.category === 'equipment' ? {
        chargeOutRateAtEstimate: pricing.sellPrice,
        estimatedSell: effectiveQuantity * pricing.sellPrice,
      } : {}),
    });
    onClose();
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
          <div><p className="text-xs text-gray-500 dark:text-brand-300">Calculated Price</p><p className="mt-1 font-semibold tabular-nums text-gray-900 dark:text-brand-50">{formatCurrency(pricing.calculatedSellPrice)}/{lineItem.unit}</p></div>
        </div>
        {initialMode === 'profit' ? <label className="block text-sm font-medium text-gray-700 dark:text-brand-100">Profit margin<input aria-label="Profit margin" type="text" inputMode="decimal" value={formatNumericDisplayValue(targetMarginPct)} onChange={(event) => setTargetMarginPct(parseNumericInputValue(event.target.value))} onFocus={(event) => event.currentTarget.select()} className="mt-2 h-11 w-full rounded-md border border-brand-100 bg-white px-3 text-right text-base font-semibold text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" /></label>
          : <label className="block text-sm font-medium text-gray-700 dark:text-brand-100">Estimate Price / {lineItem.unit}<input aria-label="Estimate Price" type="text" inputMode="decimal" value={formatNumericDisplayValue(customSellPrice ?? pricing.calculatedSellPrice)} onChange={(event) => setCustomSellPrice(parseNumericInputValue(event.target.value))} onFocus={(event) => event.currentTarget.select()} className="mt-2 h-11 w-full rounded-md border border-brand-100 bg-white px-3 text-right text-base font-semibold text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" /></label>}
        <div className="border-t border-brand-100 pt-5 dark:border-brand-600"><p className="text-xs text-gray-500 dark:text-brand-300">Estimate Price</p><p className="mt-1 text-2xl font-semibold tabular-nums text-gray-950 dark:text-brand-50">{formatCurrency(pricing.sellPrice)}/{lineItem.unit}</p><p className="mt-1 text-xs text-gray-500 dark:text-brand-300">Effective margin {pricing.effectiveMarginPct.toFixed(2)}%</p></div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-brand-100 p-4 dark:border-brand-600">{initialMode === 'price' && customSellPrice !== null ? <Button variant="secondary" onClick={() => setCustomSellPrice(null)}>Reset to Calculated Price</Button> : null}<Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={savePricing}>{initialMode === 'price' ? 'Save Price' : 'Save Profit'}</Button></div>
    </aside>
  </div>;
}