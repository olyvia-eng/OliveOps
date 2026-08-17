import { useCallback, useRef, useState } from 'react';
import { emitAppToast } from '../../toast';
import { uploadFileToStorage } from '../../utils/fileUpload';
import type { FeedbackType } from '../../types';

const FEEDBACK_ENDPOINT = '/api/feedback';

type SubmitFeedbackInput = {
  type: FeedbackType;
  message: string;
  contactPreference: boolean;
  contactEmail?: string;
  screenshotFile?: File;
  route?: string;
};

function getAppVersion() {
  const env = import.meta.env;
  return env.VITE_APP_VERSION || env.VITE_VERCEL_GIT_COMMIT_SHA || env.VERCEL_GIT_COMMIT_SHA || 'unknown';
}

function buildViewport() {
  if (typeof window === 'undefined') return undefined;
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function deriveDeviceCategory(width?: number) {
  if (!Number.isFinite(width) || !width || width <= 0) return 'unknown';
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

async function parseApiResponse(response: Response) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    return { ok: false, error: text || 'Unexpected API response.' };
  }

  try {
    return await response.json() as { ok?: boolean; error?: string; feedbackId?: string };
  } catch {
    return { ok: false, error: 'Unexpected API response.' };
  }
}

export function useFeedbackSubmission() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [lastFeedbackId, setLastFeedbackId] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const submitFeedback = useCallback(async (input: SubmitFeedbackInput) => {
    if (inFlightRef.current) return null;

    inFlightRef.current = true;
    setIsSubmitting(true);
    setSubmitError('');

    try {
      const viewport = buildViewport();
      const route = input.route || (typeof window !== 'undefined' ? window.location.pathname : '/');
      const response = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: input.type,
          message: input.message,
          contactPreference: input.contactPreference,
          contactEmail: input.contactEmail,
          route,
          viewport,
          deviceCategory: deriveDeviceCategory(viewport?.width),
          appVersion: getAppVersion(),
          deferNotification: Boolean(input.screenshotFile),
        }),
      });

      const payload = await parseApiResponse(response);
      if (!response.ok || !payload?.ok || typeof payload.feedbackId !== 'string') {
        throw new Error(payload?.error || 'Could not submit feedback.');
      }

      if (input.screenshotFile) {
        await uploadFileToStorage({
          file: input.screenshotFile,
          entityType: 'feedback',
          entityId: payload.feedbackId,
          category: 'screenshot',
        });

        const notifyResponse = await fetch(FEEDBACK_ENDPOINT, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'notify', feedbackId: payload.feedbackId }),
        });
        await parseApiResponse(notifyResponse);
      }

      setLastFeedbackId(payload.feedbackId);
      emitAppToast({ tone: 'success', message: 'Feedback sent. Thank you for helping improve OliveOps.' });
      return { feedbackId: payload.feedbackId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not submit feedback.';
      setSubmitError(message);
      emitAppToast({ tone: 'error', message });
      return null;
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  const resetSubmissionState = useCallback(() => {
    setSubmitError('');
    setLastFeedbackId(null);
  }, []);

  return {
    isSubmitting,
    submitError,
    lastFeedbackId,
    submitFeedback,
    resetSubmissionState,
  };
}
