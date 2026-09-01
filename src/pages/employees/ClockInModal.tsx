import { useRef, useState, type ChangeEvent } from 'react';
import { useStore } from '../../store';
import { Button, Modal } from '../../components/ui';
import { Clock, LogOut, UserRound } from 'lucide-react';
import { formatDateTime, durationHours } from '../../utils';
import { uploadFileToStorage } from '../../utils/fileUpload';
import { getTimeEntryWorkLabel } from '../../utils/timeEntryPresentation.js';
import type { TimeEntryWorkType } from '../../types';
import type { PendingClockingWorkflow } from '../../utils/clockingResponse.js';

type Step = 'select_employee' | 'select_job' | 'clocked_in' | 'pending';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ClockInModal({ open, onClose }: Props) {
  const { employees, jobs, unbillableTimeCategories, timeEntries, clockIn, clockOut } = useStore();
  const [step, setStep] = useState<Step>('select_employee');
  const [foundEmployee, setFoundEmployee] = useState<typeof employees[0] | null>(null);
  const [clockType, setClockType] = useState<TimeEntryWorkType>('job');
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [selectedWorkAreaId, setSelectedWorkAreaId] = useState('');
  const [selectedUnbillableCategoryId, setSelectedUnbillableCategoryId] = useState('');
  const [jobNotes, setJobNotes] = useState('');
  const [photoAttachmentFileId, setPhotoAttachmentFileId] = useState('');
  const [photoAttachmentFileName, setPhotoAttachmentFileName] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState('');
  const [clockInSubmitting, setClockInSubmitting] = useState(false);
  const [clockOutSubmitting, setClockOutSubmitting] = useState(false);
  const [pendingWorkflow, setPendingWorkflow] = useState<{ action: 'clock-in' | 'clock-out'; workflow: PendingClockingWorkflow; jobName?: string; workAreaName?: string } | null>(null);
  const photoFileInputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setStep('select_employee');
    setFoundEmployee(null);
    setClockType('job');
    setSelectedJobIds([]);
    setSelectedWorkAreaId('');
    setSelectedUnbillableCategoryId('');
    setJobNotes('');
    setPhotoAttachmentFileId('');
    setPhotoAttachmentFileName('');
    setPhotoUploading(false);
    setPhotoUploadError('');
    setClockInSubmitting(false);
    setClockOutSubmitting(false);
    setPendingWorkflow(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const activeEntry = foundEmployee
    ? timeEntries.find((te) => te.employeeId === foundEmployee.id && te.status === 'clocked_in')
    : null;

  const handleClockIn = () => {
    if (!foundEmployee) return;
    if (clockType === 'job' && selectedJobIds.length === 0) return;
    if (clockInSubmitting) return;

    setClockInSubmitting(true);
    void clockIn(foundEmployee.id, {
      workType: clockType,
      jobIds: clockType === 'job' ? selectedJobIds : [],
      workAreaId: clockType === 'job' ? selectedWorkAreaId || undefined : undefined,
      unbillableCategoryId: clockType === 'non_billable' ? selectedUnbillableCategoryId : undefined,
    }).then((result) => {
      if (!result.ok) return;
      if (result.pending && result.workflow) {
        const pendingJobId = result.workflow.clockInIntent?.jobIds?.[0];
        setPendingWorkflow({
          action: 'clock-in',
          workflow: result.workflow,
          jobName: jobs.find((job) => job.id === pendingJobId)?.title,
          workAreaName: result.workflow.clockInIntent?.workAreaNameSnapshot ?? undefined,
        });
        setStep('pending');
        return;
      }
      setStep('clocked_in');
    }).finally(() => {
      setClockInSubmitting(false);
    });
  };

  const handleClockOut = () => {
    if (!activeEntry) return;
    if (!jobNotes.trim()) return;
    if (photoUploading || clockOutSubmitting) return;
    const nextPhotoAttachmentFileId = photoAttachmentFileId.trim() || undefined;
    setClockOutSubmitting(true);
    void clockOut(activeEntry.id, 0, jobNotes.trim(), nextPhotoAttachmentFileId)
      .then((result) => {
        if (!result.ok) return;
        if (result.pending && result.workflow) {
          setPendingWorkflow({
            action: 'clock-out',
            workflow: result.workflow,
            jobName: jobs.find((job) => job.id === activeEntry.jobId)?.title,
            workAreaName: activeEntry.workAreaNameSnapshot,
          });
          setStep('pending');
          return;
        }
        reset();
        onClose();
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

  const activeJobs = jobs.filter((j) => j.status === 'in_progress' || j.status === 'scheduled');
  const activeUnbillableCategories = unbillableTimeCategories
    .filter((item) => item.active)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const activeEmployees = employees.filter((employee) => employee.active);
  const selectedJob = activeJobs.find((job) => job.id === selectedJobIds[0]);
  const eligibleWorkAreas = (selectedJob?.operationalWorkAreas ?? [])
    .filter((area) => area.id && area.name && (area.status === 'not_started' || area.status === 'in_progress'))
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));

  return (
    <Modal open={open} onClose={handleClose} title="Employee Clock In / Out">
      {step === 'select_employee' && (
        <div className="flex flex-col gap-6 py-4">
          <div className="flex flex-col items-center gap-3">
            <UserRound size={44} className="text-brand-500" />
            <div className="text-center">
              <p className="font-semibold text-gray-900 text-lg">Choose Employee</p>
              <p className="text-sm text-gray-500">Select a team member to clock in or out.</p>
            </div>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto">
            {activeEmployees.map((employee) => {
              const isClockedIn = timeEntries.some(
                (entry) => entry.employeeId === employee.id && entry.status === 'clocked_in'
              );

              return (
                <button
                  key={employee.id}
                  onClick={() => {
                    setFoundEmployee(employee);
                    setStep('select_job');
                  }}
                  className="w-full text-left border border-gray-200 rounded-lg p-3 hover:border-brand-300 hover:bg-brand-50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900">{employee.name}</p>
                      <p className="text-sm text-gray-500">{employee.email}</p>
                    </div>
                    <span className={`text-xs font-semibold ${isClockedIn ? 'text-brand-700' : 'text-gray-400'}`}>
                      {isClockedIn ? 'Clocked In' : 'Available'}
                    </span>
                  </div>
                </button>
              );
            })}
            {activeEmployees.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-4">No active employees.</p>
            )}
          </div>
        </div>
      )}

      {/* Already clocked in → show clock-out option */}
      {step === 'select_job' && foundEmployee && activeEntry && (
        <div className="flex flex-col items-center gap-6 py-4">
          <LogOut size={48} className="text-accent-700" />
          <div className="text-center">
            <p className="font-semibold text-gray-900 text-lg">{foundEmployee.name}</p>
            <p className="mt-1 text-sm font-medium text-gray-700">{getTimeEntryWorkLabel(activeEntry, jobs)}</p>
            <p className="text-gray-500 text-sm mt-1">
              Clocked in since {formatDateTime(activeEntry.clockIn)}
            </p>
            <p className="text-brand-600 font-semibold mt-1">
              {durationHours(activeEntry.clockIn).toFixed(2)} hrs worked
            </p>
          </div>
          <div className="w-full space-y-2">
            <label className="text-sm font-medium text-gray-700">Job Notes <span className="text-accent-700">*</span></label>
            <input
              type="text"
              required
              value={jobNotes}
              onChange={(e) => setJobNotes(e.target.value)}
              placeholder="What was completed on this job?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-xs text-gray-500">Required before clocking out.</p>
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
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
          </div>
          <Button variant="danger" className="w-full justify-center py-3 text-base" onClick={handleClockOut} disabled={!jobNotes.trim() || photoUploading || clockOutSubmitting}>
            <LogOut size={18} /> {clockOutSubmitting ? 'Clocking Out...' : 'Clock Out'}
          </Button>
          {!jobNotes.trim() && <p className="text-xs text-accent-700">Job notes are required before clocking out.</p>}
          <button onClick={reset} className="text-sm text-gray-400 hover:text-gray-600">← Back</button>
        </div>
      )}

      {/* Select job to clock in */}
      {step === 'select_job' && foundEmployee && !activeEntry && (
        <div className="flex flex-col gap-6 py-4">
          <div className="text-center">
            <p className="font-semibold text-gray-900 text-lg">{foundEmployee.name}</p>
            <p className="text-gray-500 text-sm">Choose clock-in type</p>
          </div>
          <div className="space-y-3">
            <select
              value={clockType}
              onChange={(e) => {
                const next = e.target.value as TimeEntryWorkType;
                setClockType(next);
                if (next !== 'job') {
                  setSelectedJobIds([]);
                  setSelectedWorkAreaId('');
                }
                if (next !== 'non_billable') setSelectedUnbillableCategoryId('');
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="job">Job Work</option>
              <option value="drive_time">Drive Time</option>
              <option value="non_billable">Non-Billable Work</option>
            </select>

            {clockType === 'job' && (
              <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
                <label className="block text-sm font-medium text-gray-700" htmlFor="employee-clock-in-job">Job</label>
                <select
                  id="employee-clock-in-job"
                  value={selectedJobIds[0] ?? ''}
                  onChange={(event) => {
                    const nextJobId = event.target.value;
                    const nextJob = activeJobs.find((job) => job.id === nextJobId);
                    const nextEligibleAreas = (nextJob?.operationalWorkAreas ?? []).filter((area) => area.id && area.name && (area.status === 'not_started' || area.status === 'in_progress'));
                    setSelectedJobIds(nextJobId ? [nextJobId] : []);
                    setSelectedWorkAreaId(nextEligibleAreas.length === 1 ? nextEligibleAreas[0].id : '');
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select Job</option>
                  {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                </select>
                {activeJobs.length === 0 && (
                  <p className="text-gray-400 text-sm text-center py-2">No active or scheduled jobs.</p>
                )}
                {selectedJob && (selectedJob.operationalWorkAreas?.length ?? 0) > 0 && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700" htmlFor="employee-clock-in-work-area">Work Area</label>
                    <select
                      id="employee-clock-in-work-area"
                      value={selectedWorkAreaId}
                      onChange={(event) => setSelectedWorkAreaId(event.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option value="">Select Work Area</option>
                      {eligibleWorkAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                    </select>
                    {eligibleWorkAreas.length === 0 && <p className="text-xs text-accent-700">This Job has no Work Areas available for clocking.</p>}
                  </div>
                )}
              </div>
            )}

            {clockType === 'non_billable' && (
              <div className="space-y-2 rounded-lg border border-brand-200 bg-white p-3">
                <p className="text-sm font-medium text-gray-700">Unbillable Category <span className="text-accent-700">*</span></p>
                <select
                  value={selectedUnbillableCategoryId}
                  onChange={(event) => setSelectedUnbillableCategoryId(event.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select category</option>
                  {activeUnbillableCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
                {activeUnbillableCategories.length === 0 && (
                  <p className="text-xs text-accent-700">No active unbillable categories are configured.</p>
                )}
              </div>
            )}
          </div>
          <Button
            disabled={
              clockInSubmitting
              || (clockType === 'job' && selectedJobIds.length === 0)
              || (clockType === 'job' && (selectedJob?.operationalWorkAreas?.length ?? 0) > 0 && !selectedWorkAreaId)
              || (clockType === 'non_billable' && !selectedUnbillableCategoryId)
            }
            className="w-full justify-center py-3 text-base"
            onClick={handleClockIn}
          >
            <Clock size={18} /> {clockInSubmitting ? 'Clocking In...' : 'Clock In'}
          </Button>
          <button onClick={reset} className="text-sm text-gray-400 hover:text-gray-600 text-center">← Back</button>
        </div>
      )}

      {/* Success */}
      {step === 'clocked_in' && foundEmployee && (
        <div className="flex flex-col items-center gap-6 py-8">
          <div className="w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center">
            <Clock size={32} className="text-brand-700" />
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-gray-900">You're clocked in!</p>
            <p className="text-gray-500 mt-1">{foundEmployee.name}</p>
          </div>
          <Button className="w-full justify-center" onClick={handleClose}>Done</Button>
        </div>
      )}

      {step === 'pending' && foundEmployee && pendingWorkflow && (
        <div className="space-y-5 py-4">
          <div>
            <p className="text-xl font-bold text-gray-900">{pendingWorkflow.action === 'clock-in' ? 'Clock-in pending' : 'Clock-out pending'}</p>
            <p className="mt-2 text-sm text-gray-600">
              {foundEmployee.name} has {pendingWorkflow.workflow.remainingRequiredFormCount} required {pendingWorkflow.action === 'clock-in' ? 'pre-shift' : 'post-shift'} {pendingWorkflow.workflow.remainingRequiredFormCount === 1 ? 'form' : 'forms'} to complete before {pendingWorkflow.action} can be finalized.
            </p>
          </div>
          {(pendingWorkflow.jobName || pendingWorkflow.workAreaName) && (
            <dl className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
              {pendingWorkflow.jobName && <div><dt className="text-gray-500">Job</dt><dd className="font-medium text-gray-900">{pendingWorkflow.jobName}</dd></div>}
              {pendingWorkflow.workAreaName && <div><dt className="text-gray-500">Work Area</dt><dd className="font-medium text-gray-900">{pendingWorkflow.workAreaName}</dd></div>}
            </dl>
          )}
          <p className="text-sm text-gray-600">The employee can complete the required {pendingWorkflow.workflow.remainingRequiredFormCount === 1 ? 'form' : 'forms'} in the OliveOps mobile app.</p>
          <Button className="w-full justify-center" onClick={handleClose}>Done</Button>
        </div>
      )}
    </Modal>
  );
}
