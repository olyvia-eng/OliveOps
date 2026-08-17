import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import type { FeedbackType } from '../../types';
import { validateUploadPayload } from '../../utils/fileUpload';
import { Button, Input, Modal, Select, TextArea } from '../ui';
import { useFeedbackSubmission } from './useFeedbackSubmission';

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

const FEEDBACK_TYPES: Array<{ value: FeedbackType; label: string }> = [
  { value: 'bug', label: 'Bug Report' },
  { value: 'feature_request', label: 'Feature Request' },
  { value: 'usability', label: 'Usability Feedback' },
  { value: 'general', label: 'General Feedback' },
];

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [type, setType] = useState<FeedbackType>('general');
  const [message, setMessage] = useState('');
  const [contactPreference, setContactPreference] = useState(true);
  const [contactEmail, setContactEmail] = useState('');
  const [screenshotFile, setScreenshotFile] = useState<File | undefined>();
  const [isDraggingScreenshot, setIsDraggingScreenshot] = useState(false);
  const [localError, setLocalError] = useState('');
  const screenshotInputRef = useRef<HTMLInputElement>(null);

  const {
    isSubmitting,
    submitError,
    lastFeedbackId,
    submitFeedback,
    resetSubmissionState,
  } = useFeedbackSubmission();

  const currentError = localError || submitError;

  const screenshotLabel = useMemo(() => {
    if (!screenshotFile) return 'No file selected';
    return `${screenshotFile.name} (${Math.round(screenshotFile.size / 1024)} KB)`;
  }, [screenshotFile]);

  useEffect(() => {
    if (!open) return;
    setLocalError('');
  }, [open]);

  const resetForm = () => {
    setType('general');
    setMessage('');
    setContactPreference(true);
    setContactEmail('');
    setScreenshotFile(undefined);
    setLocalError('');
    resetSubmissionState();
  };

  const closeAndReset = () => {
    resetForm();
    onClose();
  };

  const selectScreenshot = (file?: File) => {
    if (!file) return;
    const validation = validateUploadPayload({ fileName: file.name, mimeType: file.type, sizeBytes: file.size });
    if (!validation.valid) {
      setScreenshotFile(undefined);
      setLocalError(validation.error);
      return;
    }
    setScreenshotFile(file);
    setLocalError('');
  };

  const handleSubmit = async () => {
    setLocalError('');

    if (!message.trim()) {
      setLocalError('Please describe your feedback before submitting.');
      return;
    }

    if (contactPreference && contactEmail.trim() && !isValidEmail(contactEmail.trim())) {
      setLocalError('Please provide a valid follow-up email address.');
      return;
    }

    const result = await submitFeedback({
      type,
      message: message.trim(),
      contactPreference,
      contactEmail: contactEmail.trim() || undefined,
      screenshotFile,
    });

    if (!result) return;

    setMessage('');
    setScreenshotFile(undefined);
    setLocalError('');
  };

  if (lastFeedbackId) {
    return (
      <Modal
        open={open}
        onClose={closeAndReset}
        title="Feedback Sent"
        footer={<Button onClick={closeAndReset}>Done</Button>}
      >
        <div className="space-y-3 text-sm text-brand-700 dark:text-brand-200">
          <p>Thank you for your feedback. We have logged your submission.</p>
          <p className="font-medium text-brand-900 dark:text-brand-50">Reference ID: {lastFeedbackId}</p>
          <p>Our team reviews beta feedback regularly and uses it to prioritize improvements.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={closeAndReset}
      title="Send Beta Feedback"
      footer={(
        <>
          <Button variant="secondary" onClick={closeAndReset} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting ? 'Sending...' : 'Send Feedback'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-brand-600 dark:text-brand-200">
          Share bugs, rough edges, or ideas. Optional screenshots help us resolve issues faster.
        </p>

        <Select label="Feedback Type" value={type} onChange={(event) => setType(event.target.value as FeedbackType)}>
          {FEEDBACK_TYPES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>

        <TextArea
          label="What happened?"
          required
          rows={5}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Tell us what you were trying to do and what result you expected."
        />

        <div
          className={`rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${isDraggingScreenshot ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/30' : 'border-brand-200 bg-brand-50/60 dark:border-brand-600 dark:bg-brand-800/50'}`}
          onDragEnter={(event) => { event.preventDefault(); setIsDraggingScreenshot(true); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDraggingScreenshot(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingScreenshot(false); }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDraggingScreenshot(false);
            selectScreenshot(event.dataTransfer.files?.[0]);
          }}
        >
          <input
            ref={screenshotInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            onChange={(event) => {
              selectScreenshot(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <ImagePlus className="mx-auto text-brand-500 dark:text-brand-300" size={24} aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-brand-800 dark:text-brand-100">Drag and drop a screenshot here</p>
          <p className="mt-1 text-xs text-brand-500 dark:text-brand-300">PNG, JPG, WebP, or PDF up to 25 MB</p>
          <Button className="mt-3" type="button" variant="secondary" size="sm" onClick={() => screenshotInputRef.current?.click()}>
            {screenshotFile ? 'Replace File' : 'Choose File'}
          </Button>
          {screenshotFile ? (
            <div className="mx-auto mt-3 flex max-w-sm items-center justify-center gap-2 text-xs text-brand-600 dark:text-brand-200">
              <span className="truncate">{screenshotLabel}</span>
              <button type="button" className="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-brand-100 dark:hover:bg-brand-700" aria-label="Remove screenshot" onClick={() => setScreenshotFile(undefined)}><X size={14} /></button>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <label className="inline-flex items-center gap-2 text-sm text-brand-700 dark:text-brand-200">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-brand-300 text-accent-600 focus:ring-accent-500"
              checked={contactPreference}
              onChange={(event) => setContactPreference(event.target.checked)}
            />
            We can contact you for follow-up questions
          </label>
          <Input
            label="Follow-up Email (optional)"
            type="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            placeholder="you@company.com"
            disabled={!contactPreference}
          />
        </div>

        {currentError && <p className="text-sm text-accent-700">{currentError}</p>}
      </div>
    </Modal>
  );
}
