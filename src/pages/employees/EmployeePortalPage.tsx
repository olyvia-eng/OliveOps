import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Clock, LogOut, ShieldCheck } from 'lucide-react';
import { useStore } from '../../store';
import { Button, Card, Input, Modal, Select } from '../../components/ui';
import { durationHours, formatDateTime } from '../../utils';
import { uploadFileToStorage } from '../../utils/fileUpload';
import type { FormRecord, TimeCorrectionRequestType, TimeEntryWorkType } from '../../types';
import { emitAppToast } from '../../toast';
import CalendarPage from '../calendar/CalendarPage';
import PersonalHomeDashboard from '../home/PersonalHomeDashboard';

interface EmployeePortalPageProps {
  sessionEmployeeEmail?: string;
  currentUserId: string;
  currentUserRole: string;
  onLogout?: () => void | Promise<void>;
}

export default function EmployeePortalPage({ sessionEmployeeEmail, currentUserId, currentUserRole, onLogout }: EmployeePortalPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    employees,
    jobs,
    unbillableTimeCategories,
    timeEntries,
    timeCorrections,
    forms,
    formSubmissions,
    clockIn,
    clockOut,
    addFormSubmission,
    submitTimeCorrectionRequest,
  } = useStore();

  const [clockType, setClockType] = useState<TimeEntryWorkType>('job');
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [selectedUnbillableCategoryId, setSelectedUnbillableCategoryId] = useState('');
  const [jobNotes, setJobNotes] = useState('');
  const [photoAttachmentFileId, setPhotoAttachmentFileId] = useState('');
  const [photoAttachmentFileName, setPhotoAttachmentFileName] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState('');
  const [clockInSubmitting, setClockInSubmitting] = useState(false);
  const [clockOutSubmitting, setClockOutSubmitting] = useState(false);
  const photoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [requiredFormsModalOpen, setRequiredFormsModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'clock_in' | 'clock_out' | null>(null);
  const [requiredFormsQueue, setRequiredFormsQueue] = useState<FormRecord[]>([]);
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [requestType, setRequestType] = useState<TimeCorrectionRequestType>('wrong_time');
  const [targetTimeEntryId, setTargetTimeEntryId] = useState('');
  const [requestedClockInAt, setRequestedClockInAt] = useState('');
  const [requestedClockOutAt, setRequestedClockOutAt] = useState('');
  const [requestedJobId, setRequestedJobId] = useState('');
  const [requestedActivityType, setRequestedActivityType] = useState<TimeEntryWorkType>('job');
  const [requestedUnbillableCategoryId, setRequestedUnbillableCategoryId] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [submittingCorrection, setSubmittingCorrection] = useState(false);
  const portalViewValue = searchParams.get('view');
  const portalView: 'calendar' | 'schedule' | 'clock' = portalViewValue === 'schedule' || portalViewValue === 'clock' ? portalViewValue : 'calendar';
  const setPortalView = (view: 'calendar' | 'schedule' | 'clock') => {
    const next = new URLSearchParams(searchParams);
    if (view === 'calendar') next.delete('view');
    else next.set('view', view);
    setSearchParams(next);
  };

  const sessionEmployee = useMemo(() => {
    if (!sessionEmployeeEmail) return null;
    return (
      employees.find(
        (item) => item.active && item.email.toLowerCase() === sessionEmployeeEmail.toLowerCase()
      ) ?? null
    );
  }, [employees, sessionEmployeeEmail]);

  const employee = sessionEmployee;

  const activeEntry = useMemo(() => {
    if (!employee) return null;
    return (
      timeEntries.find(
        (entry) => entry.employeeId === employee.id && entry.status === 'clocked_in'
      ) ?? null
    );
  }, [employee, timeEntries]);

  const activeJobs = jobs.filter(
    (job) => job.status === 'in_progress' || job.status === 'scheduled'
  );
  const activeUnbillableCategories = useMemo(
    () => unbillableTimeCategories
      .filter((item) => item.active)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [unbillableTimeCategories]
  );

  const myHistoricalEntries = useMemo(() => {
    if (!employee) return [];
    return timeEntries
      .filter((entry) => entry.employeeId === employee.id)
      .slice()
      .sort((a, b) => Date.parse(b.clockIn) - Date.parse(a.clockIn));
  }, [employee, timeEntries]);

  const myCorrectionRequests = useMemo(() => {
    if (!employee) return [];
    return timeCorrections
      .filter((request) => request.employeeId === employee.id)
      .slice()
      .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
  }, [employee, timeCorrections]);

  const handleLogout = () => {
    if (sessionEmployeeEmail && onLogout) {
      void onLogout();
      return;
    }

    setClockType('job');
    setSelectedJobIds([]);
    setSelectedUnbillableCategoryId('');
    setJobNotes('');
    setPhotoAttachmentFileId('');
    setPhotoAttachmentFileName('');
    setPhotoUploading(false);
    setPhotoUploadError('');
  };

  const runClockIn = () => {
    if (!employee) return;
    if (clockType === 'job' && selectedJobIds.length === 0) return;
    if (clockInSubmitting) return;

    setClockInSubmitting(true);
    void clockIn(employee.id, {
      workType: clockType,
      jobIds: clockType === 'job' ? selectedJobIds : [],
      unbillableCategoryId: clockType === 'non_billable' ? selectedUnbillableCategoryId : undefined,
    }).finally(() => {
      setClockInSubmitting(false);
    });
  };

  const runClockOut = () => {
    if (!activeEntry) return;
    if (!jobNotes.trim()) return;
    if (photoUploading || clockOutSubmitting) return;
    const nextPhotoAttachmentFileId = photoAttachmentFileId.trim() || undefined;
    setClockOutSubmitting(true);
    void clockOut(activeEntry.id, 0, jobNotes.trim(), nextPhotoAttachmentFileId)
      .then((result) => {
        if (!result.ok) return;
        setJobNotes('');
        setPhotoAttachmentFileId('');
        setPhotoAttachmentFileName('');
        setPhotoUploadError('');
      })
      .finally(() => {
        setClockOutSubmitting(false);
      });
  };

  const uploadPhotoAttachment = async (file: File) => {
    setPhotoUploadError('');
    setPhotoUploading(true);

    try {
      const upload = await uploadFileToStorage({
        file,
        entityType: 'time-entry',
        entityId: activeEntry?.id ?? '',
        category: 'clock-out-photo',
      });

      setPhotoAttachmentFileId(upload.fileId);
      setPhotoAttachmentFileName(file.name);
    } catch (error) {
      setPhotoUploadError(error instanceof Error ? error.message : 'Could not upload photo.');
      setPhotoAttachmentFileId('');
      setPhotoAttachmentFileName('');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handlePhotoSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    void uploadPhotoAttachment(file);
    event.target.value = '';
  };

  const openPhotoPicker = () => {
    if (photoUploading) return;
    photoFileInputRef.current?.click();
  };

  const clearPhotoAttachment = () => {
    setPhotoAttachmentFileId('');
    setPhotoAttachmentFileName('');
    setPhotoUploadError('');
  };

  const isFormAssignedToEmployee = (form: FormRecord) => {
    if (!employee) return false;
    if (form.assignedTo === 'everyone') return true;
    if (form.assignedTo === 'role') return form.assignmentValue === employee.role;
    if (form.assignedTo === 'employee') return form.assignmentValue === employee.id;
    if (form.assignedTo === 'job') {
      if (activeEntry?.jobId && form.assignmentValue === activeEntry.jobId) return true;
      if (selectedJobIds.includes(form.assignmentValue ?? '')) return true;
      return false;
    }
    if (form.assignedTo === 'division') {
      // TODO: Map employee to division and enforce division-scoped forms through backend policy.
      return true;
    }
    if (form.assignedTo === 'equipment') {
      // TODO: Enforce equipment-scoped forms when equipment context is attached to clock events.
      return true;
    }
    return false;
  };

  const buildMissingTriggerForms = (trigger: 'before_clock_in' | 'after_clock_out') => {
    if (!employee) return [];

    const today = new Date().toISOString().slice(0, 10);

    return forms.filter((form) => {
      if (form.status !== 'active') return false;
      if (!form.trigger.includes(trigger)) return false;
      if (!isFormAssignedToEmployee(form)) return false;

      const submittedToday = formSubmissions.some((submission) => (
        submission.formId === form.id
        && submission.employeeId === employee.id
        && submission.status === 'submitted'
        && submission.submittedAt.startsWith(today)
      ));
      return !submittedToday;
    });
  };

  const startRequiredFormsGate = (action: 'clock_in' | 'clock_out') => {
    const trigger = action === 'clock_in' ? 'before_clock_in' : 'after_clock_out';
    const requiredForms = buildMissingTriggerForms(trigger);

    if (requiredForms.length === 0) {
      if (action === 'clock_in') runClockIn();
      else runClockOut();
      return;
    }

    setPendingAction(action);
    setRequiredFormsQueue(requiredForms);
    setRequiredFormsModalOpen(true);
  };

  const markRequiredFormComplete = (formId: string) => {
    if (!employee) return;

    addFormSubmission({
      formId,
      employeeId: employee.id,
      jobId: activeEntry?.jobId ?? selectedJobIds[0],
      submittedAt: new Date().toISOString(),
      status: 'submitted',
      submittedBy: employee.name,
    });

    setRequiredFormsQueue((current) => current.filter((form) => form.id !== formId));
  };

  const continueAfterRequiredForms = () => {
    if (requiredFormsQueue.length > 0) return;
    const action = pendingAction;
    setRequiredFormsModalOpen(false);
    setPendingAction(null);
    if (action === 'clock_in') runClockIn();
    if (action === 'clock_out') runClockOut();
  };

  const handleClockIn = () => startRequiredFormsGate('clock_in');
  const handleClockOut = () => startRequiredFormsGate('clock_out');

  const submitCorrection = async () => {
    if (!employee || !correctionReason.trim()) return;
    setSubmittingCorrection(true);

    const payload = {
      employeeId: employee.id,
      timeEntryId: targetTimeEntryId || undefined,
      requestType,
      requestedClockInAt: requestedClockInAt ? new Date(requestedClockInAt).toISOString() : undefined,
      requestedClockOutAt: requestedClockOutAt ? new Date(requestedClockOutAt).toISOString() : undefined,
      requestedJobId: requestedJobId || undefined,
      requestedActivityType,
      requestedUnbillableCategoryId: requestedActivityType === 'non_billable' ? (requestedUnbillableCategoryId || undefined) : undefined,
      reason: correctionReason.trim(),
    };

    const result = await submitTimeCorrectionRequest(payload);
    setSubmittingCorrection(false);
    if (!result.ok) {
      emitAppToast({ tone: 'error', message: result.error ?? 'Could not submit correction request.' });
      return;
    }

    emitAppToast({ tone: 'success', message: 'Time correction request submitted.' });
    setCorrectionModalOpen(false);
    setTargetTimeEntryId('');
    setRequestedClockInAt('');
    setRequestedClockOutAt('');
    setRequestedJobId('');
    setRequestedActivityType('job');
    setRequestedUnbillableCategoryId('');
    setCorrectionReason('');
  };

  const activeEntryJobTitle = useMemo(() => {
    if (!activeEntry) return '—';
    if (activeEntry.workType === 'drive_time') return 'Drive Time';
    if (activeEntry.workType === 'non_billable') return 'Non-Billable Work';

    const ids = Array.isArray(activeEntry.jobIds) && activeEntry.jobIds.length > 0
      ? activeEntry.jobIds
      : (activeEntry.jobId ? [activeEntry.jobId] : []);
    const titles = ids
      .map((id) => jobs.find((job) => job.id === id)?.title)
      .filter((value): value is string => Boolean(value));
    return titles.length > 0 ? titles.join(', ') : 'Job Work';
  }, [activeEntry, jobs]);

  const toggleJobSelection = (jobId: string) => {
    setSelectedJobIds((current) =>
      current.includes(jobId)
        ? current.filter((id) => id !== jobId)
        : [...current, jobId]
    );
  };

  return (
    <div className="min-h-screen bg-cream px-4 py-10">
      <div className={`mx-auto w-full ${portalView === 'clock' ? 'max-w-lg' : 'max-w-7xl'}`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-brand-200 bg-white p-1">
            {([
              ['calendar', 'My Calendar'],
              ['schedule', 'Schedule'],
              ['clock', 'Time Clock'],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setPortalView(value)} className={`h-9 rounded-md px-3 text-sm font-semibold ${portalView === value ? 'bg-brand-700 text-white' : 'text-brand-700'}`}>{label}</button>
            ))}
          </div>
          <Button variant="secondary" onClick={handleLogout}>Log Out</Button>
        </div>

        {portalView === 'calendar' ? <PersonalHomeDashboard currentUserId={currentUserId} currentUserName={employee?.name || sessionEmployeeEmail || 'Team member'} currentUserEmail={sessionEmployeeEmail} currentUserRole={currentUserRole} onOpenSchedule={() => setPortalView('schedule')} onOpenTimeClock={() => setPortalView('clock')} /> : null}

        {portalView === 'schedule' ? <CalendarPage currentUserRole={currentUserRole} /> : null}

        {portalView === 'clock' ? (
        <Card className="p-6 sm:p-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Employee Clock Portal</h1>
              <p className="mt-1 text-sm text-gray-500">
                This view only allows clock in and clock out.
              </p>
            </div>
            <ShieldCheck className="text-brand-600" size={28} />
          </div>

          {!employee ? (
            <div className="rounded-lg border border-accent-200 bg-accent-50 p-4 text-sm text-accent-800">
              Your employee profile could not be found for this account. Ask an admin to create or reconnect your employee record.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-sm text-gray-500">Signed in as</p>
                <p className="text-base font-semibold text-gray-900">{employee.name}</p>
                <p className="text-xs text-gray-500">{employee.email} · {employee.role.replace('_', ' ')}</p>
              </div>

              {activeEntry ? (
                <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50 p-4">
                  <p className="font-semibold text-brand-800">You are clocked in.</p>
                  <p className="text-sm text-brand-700">
                    Since {formatDateTime(activeEntry.clockIn)}
                  </p>
                  <p className="text-sm text-brand-700">{activeEntryJobTitle}</p>
                  <p className="text-sm text-brand-700">
                    Hours so far: {durationHours(activeEntry.clockIn).toFixed(2)}
                  </p>
                  <Input
                    label="Job Notes"
                    required
                    value={jobNotes}
                    onChange={(event) => setJobNotes(event.target.value)}
                    placeholder="Required before clocking out"
                  />
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Attach Photo (optional)</label>
                    <input
                      ref={photoFileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoSelection}
                      disabled={photoUploading}
                      className="hidden"
                    />
                    {photoAttachmentFileId ? (
                      <div className="rounded-lg border border-brand-200 bg-white p-3">
                        <p className="text-sm font-semibold text-brand-700">Photo uploaded</p>
                        <p className="mt-1 text-xs text-gray-600">{photoAttachmentFileName || 'Uploaded photo'}</p>
                        <div className="mt-3 flex gap-3">
                          <button type="button" onClick={openPhotoPicker} className="text-sm font-medium text-brand-700 hover:text-brand-800">Replace</button>
                          <button type="button" onClick={clearPhotoAttachment} className="text-sm font-medium text-accent-700 hover:text-accent-800">Remove</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={openPhotoPicker} disabled={photoUploading} className="inline-flex items-center rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60">
                        Choose photo
                      </button>
                    )}
                    {photoUploading && <p className="text-xs text-gray-500">Uploading photo...</p>}
                    {photoUploadError && <p className="text-xs text-accent-700">{photoUploadError}</p>}
                  </div>
                  <Button
                    variant="danger"
                    onClick={handleClockOut}
                    disabled={!jobNotes.trim() || photoUploading || clockOutSubmitting}
                    className="w-full justify-center"
                  >
                    <LogOut size={16} /> {clockOutSubmitting ? 'Clocking Out...' : 'Clock Out'}
                  </Button>
                  {!jobNotes.trim() && (
                    <p className="text-xs text-accent-700">Job notes are required before clocking out.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50 p-4">
                  <p className="font-semibold text-brand-800">Choose clock-in type</p>
                  <Select
                    value={clockType}
                    onChange={(event) => {
                      const next = event.target.value as TimeEntryWorkType;
                      setClockType(next);
                      if (next !== 'job') setSelectedJobIds([]);
                      if (next !== 'non_billable') setSelectedUnbillableCategoryId('');
                    }}
                  >
                    <option value="job">Job Work</option>
                    <option value="drive_time">Drive Time</option>
                    <option value="non_billable">Non-Billable Work</option>
                  </Select>

                  {clockType === 'job' && (
                    <div className="space-y-2">
                      <p className="text-sm text-brand-800">Select one or more jobs</p>
                      <div className="max-h-44 overflow-y-auto rounded-lg border border-brand-200 bg-white p-2">
                        {activeJobs.map((job) => (
                          <label key={job.id} className="flex items-center gap-2 px-2 py-1 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={selectedJobIds.includes(job.id)}
                              onChange={() => toggleJobSelection(job.id)}
                            />
                            <span>{job.title}</span>
                          </label>
                        ))}
                        {activeJobs.length === 0 && (
                          <p className="text-sm text-brand-700 px-2 py-1">No active or scheduled jobs are available.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {clockType === 'non_billable' && (
                    <div className="space-y-2">
                      <Select
                        label="Unbillable Category"
                        required
                        value={selectedUnbillableCategoryId}
                        onChange={(event) => setSelectedUnbillableCategoryId(event.target.value)}
                      >
                        <option value="">Select category</option>
                        {activeUnbillableCategories.map((category) => (
                          <option key={category.id} value={category.id}>{category.name}</option>
                        ))}
                      </Select>
                      {activeUnbillableCategories.length === 0 && (
                        <p className="text-sm text-accent-700">No active unbillable categories are configured. Ask an admin to add one in Company Setup.</p>
                      )}
                    </div>
                  )}

                  <Button
                    onClick={handleClockIn}
                    disabled={
                      clockInSubmitting
                      || (clockType === 'job' && selectedJobIds.length === 0)
                      || (clockType === 'non_billable' && !selectedUnbillableCategoryId)
                    }
                    className="w-full justify-center"
                  >
                    <Clock size={16} /> {clockInSubmitting ? 'Clocking In...' : 'Clock In'}
                  </Button>
                </div>
              )}

              <Button variant="secondary" onClick={handleLogout} className="w-full justify-center">
                Log Out
              </Button>

              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">Time Corrections</p>
                  <Button size="sm" onClick={() => setCorrectionModalOpen(true)}>Request Correction</Button>
                </div>
                {myCorrectionRequests.length === 0 ? (
                  <p className="mt-2 text-xs text-gray-500">No correction requests submitted yet.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {myCorrectionRequests.slice(0, 5).map((request) => (
                      <li key={request.id} className="rounded border border-gray-100 px-2 py-1 text-xs text-gray-600">
                        <p className="font-medium text-gray-800">{request.requestType.replaceAll('_', ' ')} · {request.status}</p>
                        <p>{formatDateTime(request.submittedAt)} · {request.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Card>
        ) : null}

        {portalView === 'clock' ? <p className="mt-4 text-center text-xs text-gray-500">
          Admin access is available in the main app at <Link to="/" className="text-brand-600 hover:underline">dashboard</Link>.
        </p> : null}
      </div>

      <Modal
        open={requiredFormsModalOpen}
        onClose={() => setRequiredFormsModalOpen(false)}
        title="Required Forms Before Continuing"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setRequiredFormsModalOpen(false)}>Cancel</Button>
            <Button onClick={continueAfterRequiredForms} disabled={requiredFormsQueue.length > 0}>Continue</Button>
          </>
        )}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Complete required forms before {pendingAction === 'clock_in' ? 'clocking in' : 'clocking out'}.
          </p>
          {/* TODO: Replace quick-complete with full form question flow and backend-enforced trigger policy before action writes. */}
          {requiredFormsQueue.length === 0 ? (
            <p className="text-sm text-brand-700">All required forms are complete. You can continue.</p>
          ) : (
            requiredFormsQueue.map((form) => (
              <div key={form.id} className="rounded-lg border border-gray-200 p-3">
                <p className="text-sm font-semibold text-gray-900">{form.name}</p>
                <p className="text-xs text-gray-500 mt-1">{form.description || 'No description provided.'}</p>
                <div className="mt-2">
                  <Button size="sm" onClick={() => markRequiredFormComplete(form.id)}>Mark Complete</Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>

      <Modal
        open={correctionModalOpen}
        onClose={() => setCorrectionModalOpen(false)}
        title="Request Time Correction"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setCorrectionModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => void submitCorrection()}
              disabled={
                submittingCorrection
                || !correctionReason.trim()
                || (requestedActivityType === 'non_billable' && !requestedUnbillableCategoryId)
              }
            >
              {submittingCorrection ? 'Submitting...' : 'Submit Request'}
            </Button>
          </>
        )}
      >
        <div className="space-y-3">
          <Select value={requestType} onChange={(event) => setRequestType(event.target.value as TimeCorrectionRequestType)}>
            <option value="forgot_clock_in">Forgot Clock In</option>
            <option value="forgot_clock_out">Forgot Clock Out</option>
            <option value="wrong_time">Wrong Time</option>
            <option value="wrong_job">Wrong Job</option>
            <option value="wrong_activity">Wrong Activity</option>
            <option value="split_activity">Split Activity</option>
            <option value="other">Other</option>
          </Select>
          <Select value={targetTimeEntryId} onChange={(event) => setTargetTimeEntryId(event.target.value)}>
            <option value="">No existing entry selected</option>
            {myHistoricalEntries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {formatDateTime(entry.clockIn)} - {entry.clockOut ? formatDateTime(entry.clockOut) : 'Active'}
              </option>
            ))}
          </Select>
          <Input
            label="Requested Clock In"
            type="datetime-local"
            value={requestedClockInAt}
            onChange={(event) => setRequestedClockInAt(event.target.value)}
          />
          <Input
            label="Requested Clock Out"
            type="datetime-local"
            value={requestedClockOutAt}
            onChange={(event) => setRequestedClockOutAt(event.target.value)}
          />
          <Select value={requestedActivityType} onChange={(event) => setRequestedActivityType(event.target.value as TimeEntryWorkType)}>
            <option value="job">Job Work</option>
            <option value="drive_time">Drive Time</option>
            <option value="non_billable">Non-Billable</option>
          </Select>
          {requestedActivityType === 'non_billable' && (
            <Select
              label="Unbillable Category"
              required
              value={requestedUnbillableCategoryId}
              onChange={(event) => setRequestedUnbillableCategoryId(event.target.value)}
            >
              <option value="">Select category</option>
              {activeUnbillableCategories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </Select>
          )}
          <Select value={requestedJobId} onChange={(event) => setRequestedJobId(event.target.value)}>
            <option value="">Requested Job (optional)</option>
            {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
          </Select>
          <Input
            label="Reason"
            required
            value={correctionReason}
            onChange={(event) => setCorrectionReason(event.target.value)}
            placeholder="Explain what should be corrected"
          />
        </div>
      </Modal>
    </div>
  );
}
