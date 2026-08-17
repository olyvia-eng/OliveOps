import { useEffect, useState } from 'react';

export type AppearanceStyle = 'standard' | 'tinted-glass' | 'clear-glass';

interface UiPreferences {
  appearanceStyle: AppearanceStyle;
  sidebarCollapsed: boolean;
}

const defaults: UiPreferences = { appearanceStyle: 'standard', sidebarCollapsed: false };
const appearanceStyles = new Set<AppearanceStyle>(['standard', 'tinted-glass', 'clear-glass']);
const storageKey = (userId: string) => `oliveops.ui-preferences.${userId}.v1`;

function normalize(value: unknown): UiPreferences {
  const candidate = value && typeof value === 'object' ? value as Partial<UiPreferences> : {};
  return {
    appearanceStyle: appearanceStyles.has(candidate.appearanceStyle as AppearanceStyle) ? candidate.appearanceStyle as AppearanceStyle : 'standard',
    sidebarCollapsed: candidate.sidebarCollapsed === true,
  };
}

function cachedPreferences(userId: string) {
  if (typeof window === 'undefined') return defaults;
  try {
    return normalize(JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? 'null'));
  } catch {
    return defaults;
  }
}

export default function useUiPreferences(userId: string) {
  const [preferences, setPreferences] = useState<UiPreferences>(() => cachedPreferences(userId));

  useEffect(() => {
    document.documentElement.dataset.appearance = preferences.appearanceStyle;
    window.localStorage.setItem(storageKey(userId), JSON.stringify(preferences));
  }, [preferences, userId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/ui-preferences', { credentials: 'include', signal: controller.signal })
      .then(async (response) => ({ response, payload: await response.json() as { ok?: boolean; preferences?: UiPreferences } }))
      .then(({ response, payload }) => {
        if (response.ok && payload.ok) setPreferences(normalize(payload.preferences));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [userId]);

  const updatePreferences = (next: UiPreferences) => {
    setPreferences(next);
    void fetch('/api/ui-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(next),
    }).catch(() => undefined);
  };

  return {
    ...preferences,
    setAppearanceStyle: (appearanceStyle: AppearanceStyle) => updatePreferences({ ...preferences, appearanceStyle }),
    setSidebarCollapsed: (sidebarCollapsed: boolean) => updatePreferences({ ...preferences, sidebarCollapsed }),
  };
}