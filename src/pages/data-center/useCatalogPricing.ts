import { useCallback, useEffect, useState } from 'react';
import type { CatalogPricingItem, CatalogPricingPayload } from './catalogPricing';

const initial: CatalogPricingPayload = { ok: true, status: 'unconfigured' };

export function useCatalogPricing() {
  const [pricing, setPricing] = useState<CatalogPricingPayload>(initial);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/catalog-pricing', { credentials: 'include' });
      const payload = await response.json() as CatalogPricingPayload;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Catalog pricing could not be loaded.');
      setPricing(payload);
    } catch (error) {
      setPricing({ ok: false, status: 'unconfigured', error: error instanceof Error ? error.message : 'Catalog pricing could not be loaded.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveCustomRate = useCallback(async (input: { category: CatalogPricingItem['type']; sourceEntityId: string; divisionId: string; customRate: number | null }) => {
    const response = await fetch('/api/catalog-pricing', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(input),
    });
    const payload = await response.json() as CatalogPricingPayload;
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Custom pricing could not be saved.');
    setPricing(payload);
  }, []);

  return { pricing, loading, refresh, saveCustomRate };
}