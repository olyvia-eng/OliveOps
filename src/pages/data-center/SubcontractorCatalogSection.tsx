import { useMemo, useState } from 'react';
import { BriefcaseBusiness } from 'lucide-react';
import { Card } from '../../components/ui';
import CatalogPriceSheet from './CatalogPriceSheet';
import type { CatalogPricingItem, CatalogPricingPayload } from './catalogPricing';

type Props = {
  pricing: CatalogPricingPayload;
  pricingLoading: boolean;
  onSaveCustomRate: (input: { category: CatalogPricingItem['type']; sourceEntityId: string; divisionId: string; customRate: number | null }) => Promise<void>;
};

export default function SubcontractorCatalogSection({ pricing, pricingLoading, onSaveCustomRate }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const resources = useMemo(() => {
    const unique = new Map<string, CatalogPricingItem>();
    for (const item of pricing.catalog?.subcontractors ?? []) {
      const key = item.sourceEntityId ?? item.budgetItemId;
      if (!unique.has(key)) unique.set(key, item);
    }
    return [...unique.entries()]
      .map(([id, item]) => ({ id, item }))
      .sort((left, right) => left.item.name.localeCompare(right.item.name));
  }, [pricing.catalog?.subcontractors]);
  const activeId = resources.some((resource) => resource.id === selectedId) ? selectedId : resources[0]?.id ?? '';
  const selectedItems = (pricing.catalog?.subcontractors ?? []).filter((item) => (item.sourceEntityId ?? item.budgetItemId) === activeId);

  if (pricingLoading || pricing.status !== 'ready' || resources.length === 0) {
    return <CatalogPriceSheet
      pricing={pricing}
      loading={pricingLoading}
      items={[]}
      labels={{ cost: 'Subcontractor Cost', calculated: 'Calculated Price', custom: 'Custom Price', estimate: 'Estimate Price' }}
      onSaveCustomRate={onSaveCustomRate}
      emptyTitle="No Subcontractors in the Pricing Budget"
      emptyDescription="Add a Subcontractor resource to a Division in the selected Pricing Budget to publish its current price."
    />;
  }

  return <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(13rem,0.4fr)_minmax(0,1fr)]">
    <Card className="overflow-hidden">
      <div className="border-b border-brand-100 p-4 dark:border-brand-600">
        <h2 className="font-semibold text-gray-900 dark:text-brand-50">Subcontractors</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-brand-200">{resources.length} in {pricing.budget?.name}</p>
      </div>
      <div className="divide-y divide-brand-100 dark:divide-brand-600">
        {resources.map(({ id, item }) => <button
          key={id}
          type="button"
          onClick={() => setSelectedId(id)}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm ${activeId === id ? 'bg-brand-50 text-brand-900 dark:bg-brand-600 dark:text-brand-50' : 'text-gray-700 hover:bg-gray-50 dark:text-brand-100 dark:hover:bg-brand-600/60'}`}
        >
          <BriefcaseBusiness size={16} className="shrink-0" />
          <span className="min-w-0 truncate font-medium">{item.name}</span>
        </button>)}
      </div>
    </Card>
    <div className="min-w-0">
      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-brand-50">{selectedItems[0]?.name}</h2>
      <CatalogPriceSheet
        pricing={pricing}
        loading={pricingLoading}
        items={selectedItems}
        labels={{ cost: 'Subcontractor Cost', calculated: 'Calculated Price', custom: 'Custom Price', estimate: 'Estimate Price' }}
        onSaveCustomRate={onSaveCustomRate}
        emptyTitle="Subcontractor pricing has not been calculated yet"
        emptyDescription="Complete this Subcontractor's planning inputs in the selected Pricing Budget."
      />
    </div>
  </div>;
}