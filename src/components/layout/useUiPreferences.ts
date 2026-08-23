import { useEffect, useState } from 'react';

export type AppearanceStyle = 'standard' | 'tinted-glass' | 'clear-glass';
export type ThemePreference = 'system' | 'light' | 'dark';

interface UiPreferences {
  appearanceStyle: AppearanceStyle;
  theme: ThemePreference;
  sidebarCollapsed: boolean;
}

const defaults: UiPreferences = { appearanceStyle: 'standard', theme: 'system', sidebarCollapsed: false };
const appearanceStyles = new Set<AppearanceStyle>(['standard', 'tinted-glass', 'clear-glass']);
const themes = new Set<ThemePreference>(['system', 'light', 'dark']);
const storageKey = (userId: string) => `oliveops.ui-preferences.${userId}.v1`;
const legacyThemeStorageKey = 'oliveops.theme.v1';

function normalize(value: unknown): UiPreferences {
  const candidate = value && typeof value === 'object' ? value as Partial<UiPreferences> : {};
  const legacyTheme = typeof window === 'undefined' ? null : window.localStorage.getItem(legacyThemeStorageKey);
  return {
    appearanceStyle: appearanceStyles.has(candidate.appearanceStyle as AppearanceStyle) ? candidate.appearanceStyle as AppearanceStyle : 'standard',
    theme: themes.has(candidate.theme as ThemePreference)
      ? candidate.theme as ThemePreference
      : themes.has(legacyTheme as ThemePreference) ? legacyTheme as ThemePreference : 'system',
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
    window.localStorage.removeItem(legacyThemeStorageKey);
  }, [preferences, userId]);

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const useDark = preferences.theme === 'dark' || (preferences.theme === 'system' && colorScheme.matches);
      document.documentElement.classList.toggle('dark', useDark);
    };
    applyTheme();
    if (preferences.theme !== 'system') return;
    colorScheme.addEventListener('change', applyTheme);
    return () => colorScheme.removeEventListener('change', applyTheme);
  }, [preferences.theme]);

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
    setTheme: (theme: ThemePreference) => updatePreferences({ ...preferences, theme }),
    setSidebarCollapsed: (sidebarCollapsed: boolean) => updatePreferences({ ...preferences, sidebarCollapsed }),
  };
}