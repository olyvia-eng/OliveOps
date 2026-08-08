import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, PartyPopper, Rocket, Sparkles } from 'lucide-react';
import { Card, Button } from '../ui';
import type { DashboardOnboardingItem } from './onboardingProgress';
import { calculateDashboardOnboardingProgress } from './onboardingProgress';

type DashboardOnboardingCardProps = {
  items: DashboardOnboardingItem[];
  businessId?: string;
  prominent?: boolean;
};

const ONBOARDING_PREF_KEY_PREFIX = 'oliveops.onboarding';

function prefKey(businessId: string, key: 'minimized' | 'completed-hidden' | 'celebration-shown') {
  return `${ONBOARDING_PREF_KEY_PREFIX}.${businessId}.${key}`;
}

function readBoolPref(businessId: string, key: 'minimized' | 'completed-hidden' | 'celebration-shown') {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(prefKey(businessId, key)) === 'true';
}

function writeBoolPref(businessId: string, key: 'minimized' | 'completed-hidden' | 'celebration-shown', value: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(prefKey(businessId, key), String(value));
}

export default function DashboardOnboardingCard({ items, businessId = 'global', prominent = false }: DashboardOnboardingCardProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isCompletedHidden, setIsCompletedHidden] = useState(false);
  const [showCompletedChecklist, setShowCompletedChecklist] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const progress = useMemo(() => calculateDashboardOnboardingProgress(items), [items]);
  const checklistId = 'dashboard-onboarding-checklist';
  const completeText = `${progress.completeCount} of ${progress.totalCount} completed`;
  const progressText = `${progress.percent}%`;
  const optionalRemaining = progress.optionalTotalCount - progress.optionalCompleteCount;
  const isWelcomeMode = prominent && completeText !== `${progress.totalCount} of ${progress.totalCount} completed`;

  useEffect(() => {
    setIsMinimized(readBoolPref(businessId, 'minimized'));
    setIsCompletedHidden(readBoolPref(businessId, 'completed-hidden'));
    setPrefsLoaded(true);
  }, [businessId]);

  useEffect(() => {
    if (!prefsLoaded) return;
    if (progress.isComplete) {
      const alreadyCelebrated = readBoolPref(businessId, 'celebration-shown');
      if (!alreadyCelebrated) {
        setShowCelebration(true);
        writeBoolPref(businessId, 'celebration-shown', true);
        const timeout = window.setTimeout(() => {
          setShowCelebration(false);
        }, 1700);
        return () => window.clearTimeout(timeout);
      }
    } else {
      setShowCompletedChecklist(false);
      setIsCompletedHidden(false);
      writeBoolPref(businessId, 'completed-hidden', false);
    }

    return undefined;
  }, [businessId, prefsLoaded, progress.isComplete]);

  if (!prefsLoaded) {
    return null;
  }

  const setMinimized = (value: boolean) => {
    setIsMinimized(value);
    writeBoolPref(businessId, 'minimized', value);
  };

  const setCompletedHidden = (value: boolean) => {
    setIsCompletedHidden(value);
    writeBoolPref(businessId, 'completed-hidden', value);
  };

  if (progress.isComplete && isCompletedHidden) {
    return (
      <div className="mb-2">
        <div className="inline-flex items-center gap-2 rounded-lg border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-800 px-3 py-2">
          <span className="text-xs text-gray-600 dark:text-brand-200">Dashboard customization:</span>
          <button
            type="button"
            onClick={() => setCompletedHidden(false)}
            className="text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline"
          >
            Show Getting Started
          </button>
        </div>
      </div>
    );
  }

  if (!progress.isComplete && isMinimized) {
    return (
      <Card>
        <div className="px-4 py-3 sm:px-5 sm:py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-brand-700 dark:text-brand-200">
              <Rocket size={16} aria-hidden="true" />
              <p className="text-sm font-semibold">Finish Setup</p>
            </div>
            <p className="text-xs text-gray-600 dark:text-brand-300 mt-0.5">{completeText}</p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setMinimized(false)} aria-label="Expand onboarding checklist">
            Expand
          </Button>
        </div>
      </Card>
    );
  }

  const showChecklist = !progress.isComplete || showCompletedChecklist;

  if (progress.isComplete && !showChecklist) {
    return (
      <Card>
        <div className="p-4 sm:p-5 relative overflow-hidden" role="status" aria-live="polite">
          {showCelebration ? (
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <span className="absolute left-[12%] top-4 h-2 w-2 rounded-full bg-accent-400 animate-ping" />
              <span className="absolute left-[28%] top-8 h-1.5 w-1.5 rounded-full bg-brand-400 animate-ping" />
              <span className="absolute left-[46%] top-3 h-2 w-2 rounded-full bg-accent-500 animate-ping" />
              <span className="absolute left-[64%] top-7 h-1.5 w-1.5 rounded-full bg-brand-500 animate-ping" />
              <span className="absolute left-[82%] top-5 h-2 w-2 rounded-full bg-accent-300 animate-ping" />
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-accent-700 dark:text-accent-400">
                <PartyPopper size={16} aria-hidden="true" />
                <p className="text-sm sm:text-base font-semibold">Core Setup Complete</p>
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-brand-200">Your OliveOps workspace is ready for active work.</p>
              <p className="mt-1 text-sm font-medium text-gray-800 dark:text-brand-100">
                All {progress.totalCount} essential setup tasks are complete.
                {optionalRemaining > 0 ? ' Crew setup is still optional.' : ''}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Link to="/jobs" className="text-xs sm:text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline">
                Create New Job
              </Link>
              <button
                type="button"
                onClick={() => setShowCompletedChecklist(true)}
                className="text-xs sm:text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
                aria-expanded={showCompletedChecklist}
                aria-controls={checklistId}
              >
                View Checklist
              </button>
              <button
                type="button"
                onClick={() => setCompletedHidden(true)}
                className="text-xs sm:text-sm font-semibold text-gray-600 dark:text-brand-300 hover:underline"
              >
                Hide
              </button>
            </div>
          </div>

          {showCelebration ? (
            <p className="mt-3 text-sm text-accent-700 dark:text-accent-400">Congratulations. Your OliveOps workspace is ready.</p>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-brand-600 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">{isWelcomeMode ? 'Welcome' : 'Getting Started'}</p>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">{isWelcomeMode ? 'Welcome to OliveOps' : 'Set Up OliveOps'}</h2>
          <p className="text-sm text-gray-600 dark:text-brand-200">
            {isWelcomeMode
              ? 'Let\'s get your company ready to run your work in one place.'
              : `${completeText} (${progressText})`}
          </p>
        </div>
        {!progress.isComplete ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setMinimized(true)} aria-label="Minimize onboarding checklist">
            Minimize
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setShowCompletedChecklist(false)}
              className="text-xs sm:text-sm font-semibold text-gray-600 dark:text-brand-300 hover:underline"
            >
              Collapse
            </button>
            <button
              type="button"
              onClick={() => setCompletedHidden(true)}
              className="text-xs sm:text-sm font-semibold text-gray-600 dark:text-brand-300 hover:underline"
            >
              Hide
            </button>
          </div>
        )}
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {isWelcomeMode ? (
          <div className="rounded-xl border border-brand-100 dark:border-brand-600 bg-brand-50/70 dark:bg-brand-800/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">Company Setup</p>
            <p className="mt-1 text-sm text-gray-700 dark:text-brand-100">Complete the essentials below to unlock estimates, jobs, scheduling, and reporting with real company data.</p>
          </div>
        ) : null}

        {!progress.isComplete ? (
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-brand-200">Setup Progress</span>
              <span className="font-semibold text-gray-900 dark:text-brand-50">{progress.percent}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-brand-700" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
              <div
                className="h-full rounded-full bg-accent-600 dark:bg-accent-500 transition-all duration-700 ease-out"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        ) : null}

        {progress.isComplete ? (
          <div className="rounded-xl border border-accent-200 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/20 p-3">
            <div className="flex items-start gap-2">
              <Sparkles size={16} className="mt-0.5 text-accent-700 dark:text-accent-400" aria-hidden="true" />
              <div>
                <p className="font-semibold text-accent-800 dark:text-accent-300">Setup Complete</p>
                <p className="text-sm text-accent-700 dark:text-accent-400">Checklist expanded for review.</p>
              </div>
            </div>
          </div>
        ) : null}

        <ul id={checklistId} className="space-y-3" aria-label="Onboarding checklist">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-lg border border-gray-100 dark:border-brand-600 bg-white dark:bg-brand-800 p-3 sm:flex-row sm:items-center sm:justify-between"
              aria-label={`${item.label}: ${item.complete ? 'completed' : 'incomplete'}`}
            >
              <div className="flex items-center gap-3">
                <span aria-hidden="true">
                  {item.complete ? (
                    <CheckCircle2 size={18} className="text-accent-600 dark:text-accent-500" />
                  ) : (
                    <Circle size={18} className="text-gray-400 dark:text-brand-300" />
                  )}
                </span>
                <span className={`text-sm ${item.complete ? 'text-gray-900 dark:text-brand-100' : 'text-gray-600 dark:text-brand-200'}`}>
                  {item.label}
                </span>
              </div>

              {item.complete ? (
                <span className="text-xs font-semibold text-accent-700 dark:text-accent-400">Done</span>
              ) : (
                <div className="flex items-center gap-3">
                  {item.optional ? <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-brand-300">Optional</span> : null}
                  <Link to={item.to} className="text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline">
                    Open
                  </Link>
                </div>
              )}
            </li>
          ))}
        </ul>

        {progress.isComplete ? (
          <div className="pt-1 flex flex-wrap gap-3">
            <Link to="/jobs" className="text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline">
              Create New Job
            </Link>
            <button
              type="button"
              onClick={() => setShowCompletedChecklist(false)}
              className="text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
              aria-expanded={showCompletedChecklist}
              aria-controls={checklistId}
            >
              Collapse Checklist
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
