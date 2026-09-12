import { useEffect, useState } from 'react';

// Kept in sync with api/_lib/jobProjectManagementPreferences.js's JOB_PROJECT_MANAGEMENT_CARD_IDS.
export const JOB_PROJECT_MANAGEMENT_CARD_IDS = [
  'resources',
  'tasks',
  'sops',
  'notes',
  'photos',
  'forms',
  'time-entries',
] as const;

export type JobProjectManagementCardId = typeof JOB_PROJECT_MANAGEMENT_CARD_IDS[number];

const normalizeCardIds = (value: unknown): JobProjectManagementCardId[] => {
  const allowed = new Set<JobProjectManagementCardId>(JOB_PROJECT_MANAGEMENT_CARD_IDS);
  const source: unknown[] = Array.isArray(value) ? value : JOB_PROJECT_MANAGEMENT_CARD_IDS;
  return source.filter((id, index): id is JobProjectManagementCardId => (
    typeof id === 'string' && allowed.has(id as JobProjectManagementCardId) && source.indexOf(id) === index
  ));
};

// A person's own choice of which Project Management cards to show, and in what order - applies to
// every job they open, not just the one they're currently viewing (mirrors useHomeDashboardPreferences).
export default function useJobProjectManagementCardPreferences() {
  const [cardIds, setCardIds] = useState<JobProjectManagementCardId[]>([...JOB_PROJECT_MANAGEMENT_CARD_IDS]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/job-project-management-preferences', { credentials: 'include', signal: controller.signal })
      .then(async (response) => ({ response, payload: await response.json() as { ok?: boolean; cardIds?: unknown } }))
      .then(({ response, payload }) => {
        if (!response.ok || !payload.ok) return;
        setCardIds(normalizeCardIds(payload.cardIds));
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setCardIds([...JOB_PROJECT_MANAGEMENT_CARD_IDS]);
      })
      .finally(() => setHydrated(true));
    return () => controller.abort();
  }, []);

  const persist = (next: JobProjectManagementCardId[]) => {
    void fetch('/api/job-project-management-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ cardIds: next }),
    });
  };

  const saveCardIds = (next: JobProjectManagementCardId[]) => {
    const normalized = normalizeCardIds(next);
    setCardIds(normalized);
    persist(normalized);
  };

  return {
    cardIds,
    hydrated,
    availableCardIds: [...JOB_PROJECT_MANAGEMENT_CARD_IDS] as JobProjectManagementCardId[],
    reorderCards: (nextOrder: JobProjectManagementCardId[]) => saveCardIds(nextOrder),
    addCard: (id: JobProjectManagementCardId) => { if (!cardIds.includes(id)) saveCardIds([...cardIds, id]); },
    removeCard: (id: JobProjectManagementCardId) => saveCardIds(cardIds.filter((cardId) => cardId !== id)),
    resetCardIds: () => saveCardIds([...JOB_PROJECT_MANAGEMENT_CARD_IDS]),
  };
}
