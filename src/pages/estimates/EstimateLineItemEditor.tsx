import { Plus, Trash2 } from 'lucide-react';
import type { BudgetRate, EstimateLineItem, LineItemCategory } from '../../types';
import {
  applyBudgetRateToEstimateLineItem,
  calculateEstimateLineItem,
  createEmptyEstimateLineItem,
} from '../../utils/estimateModel';
import { formatNumericDisplayValue, parseNumericInputValue } from '../../utils/numberInput';
import { Button } from '../../components/ui';

const CATEGORIES: LineItemCategory[] = ['material', 'equipment', 'labour', 'subcontractor'];

interface Props {
  items: EstimateLineItem[];
  onChange: (items: EstimateLineItem[]) => void;
  pricingBudgetId?: string;
  budgetRates?: BudgetRate[];
}

export default function EstimateLineItemEditor({ items, onChange, pricingBudgetId, budgetRates = [] }: Props) {
  const addItem = () => {
    onChange([...items, createEmptyEstimateLineItem('labour')]);
  };

  const update = (id: string, key: keyof EstimateLineItem, value: unknown) => {
    onChange(
      items.map((li) => {
        if (li.id !== id) return li;
        return calculateEstimateLineItem(
          { ...li, [key]: value } as EstimateLineItem,
          { recalculateSellPrice: key === 'unitCost' || key === 'markupPercent' }
        );
      })
    );
  };

  const rateOptionsByCategory = (category: LineItemCategory) => {
    return budgetRates
      .filter((rate) => rate.active && rate.category === category && (!pricingBudgetId || rate.budgetId === pricingBudgetId))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.itemName.localeCompare(b.itemName));
  };

  const applyRate = (lineItemId: string, rateId: string) => {
    const rate = budgetRates.find((value) => value.id === rateId);
    if (!rate) return;

    onChange(items.map((lineItem) => {
      if (lineItem.id !== lineItemId) return lineItem;
      return applyBudgetRateToEstimateLineItem(lineItem, rate);
    }));
  };

  const remove = (id: string) => onChange(items.filter((li) => li.id !== id));

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No line items yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-gray-500 border-b border-gray-200">
                <th className="pb-1 font-medium text-left w-28">Category</th>
                <th className="pb-1 font-medium text-left w-36">Budget Item</th>
                <th className="pb-1 font-medium text-left">Description</th>
                <th className="pb-1 font-medium text-right w-16">Qty</th>
                <th className="pb-1 font-medium text-left w-16">Unit</th>
                <th className="pb-1 font-medium text-right w-24">Unit Cost</th>
                <th className="pb-1 font-medium text-right w-20">Markup %</th>
                <th className="pb-1 font-medium text-right w-24">Sell Price</th>
                <th className="pb-1 font-medium text-right w-24">Total</th>
                <th className="pb-1 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((li) => (
                <tr key={li.id} className="border-b border-gray-100">
                  <td className="py-1 pr-1">
                    <select
                      value={li.category}
                      onChange={(e) => update(li.id, 'category', e.target.value as LineItemCategory)}
                      className="w-full border border-gray-200 rounded px-1 py-0.5 bg-white text-xs"
                    >
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-1">
                    <select
                      value={li.sourceRateId ?? ''}
                      onChange={(e) => applyRate(li.id, e.target.value)}
                      className="w-full border border-gray-200 rounded px-1 py-0.5 bg-white text-xs"
                    >
                      <option value="">Manual entry</option>
                      {rateOptionsByCategory(li.category).map((rate) => (
                        <option key={rate.id} value={rate.id}>{rate.itemName}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-1">
                    <input
                      value={li.description}
                      onChange={(e) => update(li.id, 'description', e.target.value)}
                      placeholder="Description"
                      className="w-full border border-gray-200 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-400"
                    />
                  </td>
                  <td className="py-1 pr-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      min={0}
                      value={formatNumericDisplayValue(li.quantity)}
                      onChange={(e) => update(li.id, 'quantity', parseNumericInputValue(e.target.value))}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full border border-gray-200 rounded px-1 py-0.5 text-right text-xs"
                    />
                  </td>
                  <td className="py-1 pr-1">
                    <input
                      value={li.unit}
                      onChange={(e) => update(li.id, 'unit', e.target.value)}
                      className="w-full border border-gray-200 rounded px-1 py-0.5 text-xs"
                    />
                  </td>
                  <td className="py-1 pr-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      min={0}
                      value={formatNumericDisplayValue(li.unitCost)}
                      onChange={(e) => update(li.id, 'unitCost', parseNumericInputValue(e.target.value))}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full border border-gray-200 rounded px-1 py-0.5 text-right text-xs"
                    />
                  </td>
                  <td className="py-1 pr-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      min={0}
                      value={formatNumericDisplayValue(li.markupPercent)}
                      onChange={(e) => update(li.id, 'markupPercent', parseNumericInputValue(e.target.value))}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full border border-gray-200 rounded px-1 py-0.5 text-right text-xs"
                    />
                  </td>
                  <td className="py-1 pr-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      min={0}
                      value={formatNumericDisplayValue(li.sellPrice)}
                      onChange={(e) => update(li.id, 'sellPrice', parseNumericInputValue(e.target.value))}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full border border-gray-200 rounded px-1 py-0.5 text-right text-xs"
                    />
                  </td>
                  <td className="py-1 pr-1 text-right font-semibold whitespace-nowrap">
                    ${li.total.toFixed(2)}
                  </td>
                  <td className="py-1">
                    <button onClick={() => remove(li.id)} className="text-accent-600 hover:text-accent-800 p-0.5">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button variant="secondary" size="sm" onClick={addItem}>
        <Plus size={14} /> Add Line Item
      </Button>
    </div>
  );
}
