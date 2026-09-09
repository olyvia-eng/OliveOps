import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal } from '../ui';

const NAVIGATION_REQUEST_EVENT = 'oliveops:navigation-request';

export function requestAppNavigation(destination: string): boolean {
  return window.dispatchEvent(new CustomEvent(NAVIGATION_REQUEST_EVENT, {
    cancelable: true,
    detail: { destination },
  }));
}

interface UnsavedChangesGuardProps {
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => Promise<boolean>;
}

export function useUnsavedChangesGuard({ isDirty, isSaving, onSave }: UnsavedChangesGuardProps) {
  const navigate = useNavigate();
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);

  const requestNavigation = (destination: string) => {
    if (!isDirty) {
      navigate(destination);
      return;
    }
    setPendingDestination(destination);
  };

  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const handleNavigationRequest = (event: Event) => {
      const navigationEvent = event as CustomEvent<{ destination?: string }>;
      if (!navigationEvent.detail?.destination) return;
      event.preventDefault();
      setPendingDestination(navigationEvent.detail.destination);
    };
    const handleInternalLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!target || target.target === '_blank' || target.hasAttribute('download')) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      event.preventDefault();
      setPendingDestination(`${destination.pathname}${destination.search}${destination.hash}`);
    };
    const handleBrowserBack = () => {
      if (window.confirm("You have changes to this estimate that haven't been saved. Leave without saving?")) return;
      window.history.forward();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener(NAVIGATION_REQUEST_EVENT, handleNavigationRequest);
    document.addEventListener('click', handleInternalLink, true);
    window.addEventListener('popstate', handleBrowserBack);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener(NAVIGATION_REQUEST_EVENT, handleNavigationRequest);
      document.removeEventListener('click', handleInternalLink, true);
      window.removeEventListener('popstate', handleBrowserBack);
    };
  }, [isDirty]);

  const leaveWithoutSaving = () => {
    const destination = pendingDestination;
    setPendingDestination(null);
    if (destination) navigate(destination);
  };

  const saveAndLeave = async () => {
    const destination = pendingDestination;
    if (!destination) return;
    const saved = await onSave();
    if (!saved) return;
    setPendingDestination(null);
    navigate(destination);
  };

  const guardModal = (
    <Modal
      open={pendingDestination !== null}
      onClose={() => { if (!isSaving) setPendingDestination(null); }}
      title="Unsaved changes"
      footer={(
        <>
          <Button variant="secondary" onClick={() => setPendingDestination(null)} disabled={isSaving}>Keep Editing</Button>
          <Button variant="danger" onClick={leaveWithoutSaving} disabled={isSaving}>Leave Without Saving</Button>
          <Button onClick={() => void saveAndLeave()} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save & Leave'}</Button>
        </>
      )}
    >
      <p className="text-sm text-gray-600 dark:text-brand-200">You have changes to this estimate that haven't been saved. If you leave now, those changes will be lost.</p>
    </Modal>
  );

  return { requestNavigation, guardModal };
}
