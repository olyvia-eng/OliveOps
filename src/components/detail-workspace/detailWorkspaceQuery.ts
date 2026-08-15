export type DetailWorkspaceMode = 'panel' | 'expanded';

export interface DetailWorkspaceQueryConfig {
  recordParam: string;
  tabParam: string;
  defaultTab: string;
}

export interface DetailWorkspaceQueryState {
  recordId: string | null;
  mode: DetailWorkspaceMode;
  tab: string;
}

export function readDetailWorkspaceQuery(
  searchParams: URLSearchParams,
  config: DetailWorkspaceQueryConfig
): DetailWorkspaceQueryState {
  const recordId = searchParams.get(config.recordParam)?.trim() || null;
  return {
    recordId,
    mode: recordId && searchParams.get('workspace') === 'expanded' ? 'expanded' : 'panel',
    tab: searchParams.get(config.tabParam)?.trim() || config.defaultTab,
  };
}

function updateWorkspaceQuery(
  searchParams: URLSearchParams,
  config: DetailWorkspaceQueryConfig,
  updates: { recordId?: string | null; mode?: DetailWorkspaceMode; tab?: string | null }
): URLSearchParams {
  const next = new URLSearchParams(searchParams);

  if (updates.recordId !== undefined) {
    if (updates.recordId) next.set(config.recordParam, updates.recordId);
    else next.delete(config.recordParam);
  }
  if (updates.mode !== undefined) next.set('workspace', updates.mode);
  if (updates.tab !== undefined) {
    if (updates.tab) next.set(config.tabParam, updates.tab);
    else next.delete(config.tabParam);
  }

  return next;
}

export function openDetailWorkspace(
  searchParams: URLSearchParams,
  config: DetailWorkspaceQueryConfig,
  recordId: string
): URLSearchParams {
  return updateWorkspaceQuery(searchParams, config, {
    recordId,
    mode: 'panel',
    tab: config.defaultTab,
  });
}

export function closeDetailWorkspace(
  searchParams: URLSearchParams,
  config: DetailWorkspaceQueryConfig
): URLSearchParams {
  const next = updateWorkspaceQuery(searchParams, config, { recordId: null, tab: null });
  next.delete('workspace');
  return next;
}

export function setDetailWorkspaceMode(
  searchParams: URLSearchParams,
  config: DetailWorkspaceQueryConfig,
  mode: DetailWorkspaceMode
): URLSearchParams {
  return updateWorkspaceQuery(searchParams, config, { mode });
}

export function setDetailWorkspaceTab(
  searchParams: URLSearchParams,
  config: DetailWorkspaceQueryConfig,
  tab: string
): URLSearchParams {
  return updateWorkspaceQuery(searchParams, config, { tab });
}