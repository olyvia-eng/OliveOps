import { FolderKanban, Repeat2, Snowflake, type LucideIcon } from 'lucide-react';
import { Card, PageHeader } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import {
  BUSINESS_FEATURE_CATALOG,
  type BusinessFeatureKey,
  type BusinessFeatures,
} from '../../../shared/businessFeatures.js';
import { useState } from 'react';

const featureIcons: Record<BusinessFeatureKey, LucideIcon> = {
  projects: FolderKanban,
  recurringServices: Repeat2,
  snowOperations: Snowflake,
};

export default function CompanyFeaturesPage() {
  const features = useStore((state) => state.businessFeatures);
  const [saving, setSaving] = useState<BusinessFeatureKey | null>(null);

  const toggleFeature = async (key: BusinessFeatureKey) => {
    const previous = useStore.getState().businessFeatures;
    const next: BusinessFeatures = { ...previous, [key]: !previous[key] };
    useStore.setState({ businessFeatures: next });
    setSaving(key);
    try {
      const response = await fetch('/api/business', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ features: next }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; business?: { features?: BusinessFeatures } };
      if (!response.ok || !payload.ok || !payload.business?.features) throw new Error(payload.error ?? 'Company features could not be updated.');
      useStore.setState({ businessFeatures: payload.business.features });
    } catch (error) {
      useStore.setState({ businessFeatures: previous });
      emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Company features could not be updated.' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Features" subtitle="Choose which OliveOps tools your company uses." />
      <div className="grid gap-3 lg:grid-cols-3">
        {BUSINESS_FEATURE_CATALOG.map((feature) => {
          const Icon = featureIcons[feature.key];
          const enabled = features[feature.key];
          return (
            <Card key={feature.key} className="flex min-h-44 flex-col justify-between rounded-lg p-5">
              <div>
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-700 dark:text-brand-100"><Icon size={19} /></div>
                <h2 className="mt-4 text-base font-semibold text-brand-900 dark:text-brand-50">{feature.name}</h2>
                <p className="mt-1 text-sm leading-6 text-brand-500 dark:text-brand-200">{feature.description}</p>
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-brand-100 pt-4 dark:border-brand-600">
                <span className="text-sm font-medium text-brand-700 dark:text-brand-100">{enabled ? 'On' : 'Off'}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${enabled ? 'Disable' : 'Enable'} ${feature.name}`}
                  disabled={saving !== null}
                  onClick={() => void toggleFeature(feature.key)}
                  className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-wait disabled:opacity-60 ${enabled ? 'bg-brand-700' : 'bg-brand-200 dark:bg-brand-600'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}