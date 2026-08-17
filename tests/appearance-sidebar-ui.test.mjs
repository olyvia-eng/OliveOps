import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeUiPreferences } from '../api/_lib/uiPreferences.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('appearance style remains independent from light and dark theme', async () => {
  const [preferences, sidebar] = await Promise.all([
    read('../src/components/layout/useUiPreferences.ts'),
    read('../src/components/layout/Sidebar.tsx'),
  ]);
  assert.match(preferences, /AppearanceStyle = 'standard' \| 'tinted-glass' \| 'clear-glass'/);
  assert.match(preferences, /document\.documentElement\.dataset\.appearance = preferences\.appearanceStyle/);
  assert.match(sidebar, /document\.documentElement\.classList\.toggle\('dark', isDarkMode\)/);
  assert.match(sidebar, /Appearance Style/);
  assert.match(sidebar, /Standard[\s\S]*Tinted Glass[\s\S]*Clear Glass/);
});

test('appearance tokens cover standard, tinted, clear, dark, and accessibility fallbacks', async () => {
  const css = await read('../src/index.css');
  for (const token of ['--surface', '--surface-elevated', '--surface-glass', '--surface-glass-tinted', '--sidebar-surface', '--modal-surface', '--toolbar-surface', '--border-subtle', '--glass-border', '--glass-blur', '--glass-saturation', '--shadow-elevated']) {
    assert.match(css, new RegExp(token));
  }
  assert.match(css, /\[data-appearance='tinted-glass'\]/);
  assert.match(css, /\.dark\[data-appearance='tinted-glass'\]/);
  assert.match(css, /\[data-appearance='clear-glass'\]/);
  assert.match(css, /\.dark\[data-appearance='clear-glass'\]/);
  assert.match(css, /@supports not \(\(-webkit-backdrop-filter/);
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('glass is limited to chrome while dense tables and forms stay opaque', async () => {
  const [css, modal, detail] = await Promise.all([
    read('../src/index.css'),
    read('../src/components/ui/index.tsx'),
    read('../src/components/detail-workspace/DetailWorkspace.tsx'),
  ]);
  assert.match(css, /\.sidebar-surface,[\s\S]*\.app-header-surface,[\s\S]*\.modal-surface,[\s\S]*\.detail-panel-surface/);
  assert.match(css, /\.table-shell \{[\s\S]*bg-white dark:bg-brand-700/);
  assert.match(modal, /modal-surface relative/);
  assert.match(modal, /<input[\s\S]*bg-white dark:bg-brand-700/);
  assert.match(detail, /detail-panel-surface/);
  assert.match(detail, /expanded[\s\S]*'min-w-0'/);
});

test('desktop collapse creates a persistent icon rail with delayed overlay expansion', async () => {
  const [layout, sidebar, item] = await Promise.all([
    read('../src/components/layout/AppLayout.tsx'),
    read('../src/components/layout/Sidebar.tsx'),
    read('../src/components/layout/SidebarItem.tsx'),
  ]);
  assert.match(layout, /sidebarCollapsed \? 'lg:ml-16' : 'lg:ml-72'/);
  assert.doesNotMatch(layout, /lg:ml-0/);
  assert.match(sidebar, /data-sidebar-state=/);
  assert.match(sidebar, /setTimeout\(\(\) => setIsDesktopHoverExpanded\(true\), 190\)/);
  assert.match(sidebar, /setTimeout\(\(\) => setIsDesktopHoverExpanded\(false\), 140\)/);
  assert.match(sidebar, /isDesktopVisuallyExpanded \? 'w-72 p-4' : 'w-16 p-3'/);
  assert.match(sidebar, /isDesktopHoverExpanded \? 'z-40 shadow-2xl' : 'z-30'/);
  assert.match(sidebar, /Keep sidebar expanded/);
  assert.match(sidebar, /aria-label="Send Feedback"/);
  assert.match(sidebar, /aria-label=\{isDarkMode \? 'Use Light Mode' : 'Use Dark Mode'\}/);
  assert.match(sidebar, /aria-label="Log Out"/);
  assert.match(item, /title=\{iconOnly \? item\.label : undefined\}/);
  assert.match(item, /aria-label=\{item\.label\}/);
});

test('mobile keeps its existing drawer and never depends on hover expansion', async () => {
  const sidebar = await read('../src/components/layout/Sidebar.tsx');
  const mobile = sidebar.slice(sidebar.indexOf('{/* Mobile top bar */}'), sidebar.indexOf('{/* Desktop sidebar */}'));
  assert.match(mobile, /lg:hidden/);
  assert.match(mobile, /mobileOpen \? 'translate-x-0' : '-translate-x-full'/);
  assert.doesNotMatch(mobile, /onMouseEnter|scheduleHoverExpansion/);
});

test('UI preferences are cached per user and synchronized with the personal preference endpoint', async () => {
  const [preferences, endpoint, repository] = await Promise.all([
    read('../src/components/layout/useUiPreferences.ts'),
    read('../api/ui-preferences.js'),
    read('../api/_lib/uiPreferences.js'),
  ]);
  assert.match(preferences, /oliveops\.ui-preferences\.\$\{userId\}\.v1/);
  assert.match(preferences, /fetch\('\/api\/ui-preferences'/);
  assert.match(endpoint, /requireSession/);
  assert.match(repository, /UI_PREFERENCES#\$\{userId\}/);
  assert.match(repository, /APPEARANCE_STYLES\.includes/);
  assert.match(repository, /sidebarCollapsed: value\?\.sidebarCollapsed === true/);
});

test('UI preference normalization rejects unsupported appearance and collapse values', () => {
  assert.deepEqual(normalizeUiPreferences(null), { appearanceStyle: 'standard', sidebarCollapsed: false });
  assert.deepEqual(normalizeUiPreferences({ appearanceStyle: 'clear-glass', sidebarCollapsed: true }), { appearanceStyle: 'clear-glass', sidebarCollapsed: true });
  assert.deepEqual(normalizeUiPreferences({ appearanceStyle: 'invisible', sidebarCollapsed: 'true' }), { appearanceStyle: 'standard', sidebarCollapsed: false });
});