import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useStore } from '../../store';
import { PageHeader, Button, Card, Badge, Modal, Input, Select, EmptyState } from '../../components/ui';
import { Plus, Pencil, Trash2, Clock, LogOut, Users } from 'lucide-react';
import { formatCurrency, formatDateTime, durationHours } from '../../utils';
import { uploadFileToStorage } from '../../utils/fileUpload';
import type { Employee, EmployeeRole } from '../../types';
import ClockInModal from './ClockInModal';

const ROLES: EmployeeRole[] = ['admin', 'foreman', 'crew_member'];
const COMPENSATION_TYPES = ['hourly', 'salary'] as const;
const LABOUR_TYPES = ['field_producing', 'overhead'] as const;

type CompensationType = (typeof COMPENSATION_TYPES)[number];
type LabourType = (typeof LABOUR_TYPES)[number];

interface EmployeesPageProps {
  onCreateEmployee?: (payload: {
    name: string;
    email: string;
    password: string;
    role: EmployeeRole;
  }) => Promise<{ ok: boolean; error?: string; user?: unknown; employee?: Employee }>;
}

type EmployeeForm = Omit<Employee, 'id' | 'createdAt' | 'name'> & {
  firstName: string;
  lastName: string;
  compensationType: CompensationType;
  labourType: LabourType;
};

const roleLabel: Record<EmployeeRole, string> = {
  admin: 'admin',
  foreman: 'foreman',
  crew_member: 'crew member',
};

const labourTypeLabel: Record<LabourType, string> = {
  field_producing: 'field producing',
  overhead: 'overhead',
};

const roleColor: Record<EmployeeRole, string> = {
  admin: 'bg-accent-50 text-accent-600',
  foreman: 'bg-brand-100 text-brand-700',
  crew_member: 'bg-brand-200 text-brand-800',
};

const compensationTypeLabel: Record<CompensationType, string> = {
  hourly: 'hourly',
  salary: 'salary',
};

const compensationTypeColor: Record<CompensationType, string> = {
  hourly: 'bg-brand-100 text-brand-700',
  salary: 'bg-accent-50 text-accent-600',
};

const toOptionLabel = (value: string) => value
  .split('_')
  .join(' ')
  .split(' ')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const empty = (): EmployeeForm => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  role: 'crew_member',
  hourlyRate: 30,
  compensationType: 'hourly',
  labourType: 'field_producing',
  paidDriveTimeEnabled: false,
  active: true,
});

const parseName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const [firstName, ...rest] = trimmed.split(/\s+/);
  return {
    firstName,
    lastName: rest.join(' '),
  };
};

export default function EmployeesPage({ onCreateEmployee }: EmployeesPageProps) {
  const { employees, timeEntries, jobs, updateEmployee, deleteEmployee, clockOut } = useStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState(empty());
  const [newPassword, setNewPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [clockInOpen, setClockInOpen] = useState(false);
  const [clockOutEntry, setClockOutEntry] = useState<string | null>(null);
  const [jobNotes, setJobNotes] = useState('');
  const [photoAttachmentFileId, setPhotoAttachmentFileId] = useState('');
  const [photoAttachmentFileName, setPhotoAttachmentFileName] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState('');
  const [clockOutSubmitting, setClockOutSubmitting] = useState(false);
  const [employeeViewMode, setEmployeeViewMode] = useState<'card' | 'list'>('card');
  const photoFileInputRef = useRef<HTMLInputElement | null>(null);

  const openNew = () => {
    setEditing(null);
    setForm(empty());
    setNewPassword('');
    setFormError('');
    setModalOpen(true);
  };
  const openEdit = (e: Employee) => {
    const parsed = parseName(e.name);
    setEditing(e);
    setForm({
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      email: e.email,
      phone: e.phone,
      role: e.role,
      hourlyRate: e.hourlyRate,
      compensationType: e.compensationType ?? 'hourly',
      labourType: e.labourType ?? 'field_producing',
      paidDriveTimeEnabled: e.paidDriveTimeEnabled === true,
      active: e.active,
    });
    setNewPassword('');
    setFormError('');
    setModalOpen(true);
  };

  const handleSave = async () => {
    setFormError('');

    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();

    if (!form.firstName.trim() || !form.lastName.trim()) {
      setFormError('First and last name are required.');
      return;
    }

    if (!form.email.trim()) {
      setFormError('Email is required.');
      return;
    }

    const employeePayload: Omit<Employee, 'id' | 'createdAt'> = {
      name: fullName,
      email: form.email,
      phone: form.phone,
      role: form.role,
      hourlyRate: form.hourlyRate,
      compensationType: form.compensationType,
      labourType: form.labourType,
      paidDriveTimeEnabled: form.paidDriveTimeEnabled === true,
      active: form.active,
    };

    if (editing) {
      updateEmployee(editing.id, employeePayload);
      setModalOpen(false);
      return;
    }

    if (newPassword.length < 8) {
      setFormError('Password must be at least 8 characters for employee login.');
      return;
    }

    const result = await (onCreateEmployee ? onCreateEmployee({
      name: fullName,
      email: form.email,
      password: newPassword,
      role: form.role,
    }) : fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        name: fullName,
        email: form.email,
        password: newPassword,
        role: form.role,
      }),
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, error: typeof payload?.error === 'string' ? payload.error : 'Could not create employee login.' };
      }
      return {
        ok: true,
        employee: payload?.employee as Employee | undefined,
      };
    }));

    if (!result?.ok) {
      setFormError(result?.error ?? 'Could not create employee login.');
      return;
    }

    if (result.employee) {
      useStore.setState((state) => {
        const exists = state.employees.some((item) => item.id === result.employee!.id);
        return {
          employees: exists
            ? state.employees.map((item) => (item.id === result.employee!.id ? result.employee! : item))
            : [...state.employees, result.employee!],
        };
      });
    }
    setModalOpen(false);
  };

  useEffect(() => {
    if (!modalOpen) {
      setFormError('');
      setNewPassword('');
    }
  }, [modalOpen]);

  const set = (key: keyof typeof form, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  const getActiveEntry = (empId: string) =>
    timeEntries.find((te) => te.employeeId === empId && te.status === 'clocked_in');

  const entryWorkLabel = (entry: { workType?: string; jobId?: string; jobIds?: string[] }) => {
    if (entry.workType === 'drive_time') return 'Drive Time';
    if (entry.workType === 'non_billable') return 'Non-Billable Work';

    const ids = Array.isArray(entry.jobIds) && entry.jobIds.length > 0
      ? entry.jobIds
      : (entry.jobId ? [entry.jobId] : []);
    const titles = ids
      .map((id) => jobs.find((job) => job.id === id)?.title)
      .filter((value): value is string => Boolean(value));
    return titles.length > 0 ? titles.join(', ') : 'Job Work';
  };

  const renderEmployeeCard = (emp: Employee, activeEntry: ReturnType<typeof getActiveEntry>, activeWorkLabel: string | null, todayHours: number) => {
    const compensationType = emp.compensationType ?? 'hourly';

    return (
      <Card key={emp.id} className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="font-semibold text-gray-900">{emp.name}</p>
            <p className="text-sm text-gray-500">{emp.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge label={compensationTypeLabel[compensationType]} className={compensationTypeColor[compensationType]} />
            <Badge label={roleLabel[emp.role]} className={roleColor[emp.role]} />
          </div>
        </div>
        <div className="text-sm text-gray-600 space-y-1">
          <p>{formatCurrency(emp.hourlyRate)}{compensationType === 'salary' ? '/yr' : '/hr'}</p>
          <p className="text-xs text-gray-500 capitalize">{labourTypeLabel[emp.labourType ?? 'field_producing']}</p>
          <p className="text-xs text-gray-400">Today: {todayHours.toFixed(2)} hrs</p>
        </div>

        {activeEntry ? (
          <div className="mt-3 bg-brand-50 border border-brand-200 rounded-lg p-2 text-xs">
            <p className="font-semibold text-brand-700">Clocked In</p>
            <p className="text-brand-700">{activeWorkLabel}</p>
            <p className="text-brand-600">Since {formatDateTime(activeEntry.clockIn)}</p>
            <button
              onClick={() => setClockOutEntry(activeEntry.id)}
              className="mt-2 flex items-center gap-1 text-accent-700 hover:text-accent-800 font-medium"
            >
              <LogOut size={12} /> Clock Out
            </button>
          </div>
        ) : (
          <div className="mt-3 text-xs text-gray-400">Not clocked in</div>
        )}

        <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
          <Button variant="secondary" size="sm" onClick={() => openEdit(emp)}><Pencil size={13} /> Edit</Button>
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(emp.id)}><Trash2 size={13} /></Button>
        </div>
      </Card>
    );
  };

  const renderEmployeeListRow = (emp: Employee, activeEntry: ReturnType<typeof getActiveEntry>, activeWorkLabel: string | null, todayHours: number) => {
    const compensationType = emp.compensationType ?? 'hourly';

    return (
      <tr key={emp.id} className="border-b border-gray-100 hover:bg-gray-50">
        <td className="px-4 py-3">
          <div>
            <p className="font-semibold text-gray-900">{emp.name}</p>
            <p className="text-sm text-gray-500">{emp.email}</p>
          </div>
        </td>
        <td className="px-4 py-3 text-left">
          <div className="flex flex-wrap gap-2">
            <Badge label={compensationTypeLabel[compensationType]} className={compensationTypeColor[compensationType]} />
            <Badge label={roleLabel[emp.role]} className={roleColor[emp.role]} />
          </div>
        </td>
        <td className="px-4 py-3 text-right text-gray-700">
          {formatCurrency(emp.hourlyRate)}{compensationType === 'salary' ? '/yr' : '/hr'}
        </td>
        <td className="px-4 py-3 text-gray-600 capitalize">
          {labourTypeLabel[emp.labourType ?? 'field_producing']}
        </td>
        <td className="px-4 py-3 text-right text-gray-600">
          {todayHours.toFixed(2)} hrs
        </td>
        <td className="px-4 py-3 text-gray-600">
          {activeEntry ? (
            <div className="space-y-1">
              <p className="font-medium text-brand-700">Clocked In</p>
              <p className="text-xs text-gray-500">{activeWorkLabel}</p>
              <p className="text-xs text-gray-500">Since {formatDateTime(activeEntry.clockIn)}</p>
            </div>
          ) : (
            <span className="text-gray-400">Not clocked in</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex justify-end gap-1">
            <Button variant="secondary" size="sm" onClick={() => openEdit(emp)}><Pencil size={13} /></Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(emp.id)}><Trash2 size={13} /></Button>
          </div>
        </td>
      </tr>
    );
  };

  const handleClockOut = () => {
    if (!clockOutEntry) return;
    if (!jobNotes.trim()) return;
    if (photoUploading || clockOutSubmitting) return;
    const nextPhotoAttachmentFileId = photoAttachmentFileId.trim() || undefined;
    setClockOutSubmitting(true);
    void clockOut(clockOutEntry, 0, jobNotes.trim(), nextPhotoAttachmentFileId)
      .then((result) => {
        if (!result.ok) return;
        setClockOutEntry(null);
        setJobNotes('');
        setPhotoAttachmentFileId('');
        setPhotoAttachmentFileName('');
        setPhotoUploading(false);
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
        entityId: clockOutEntry ?? '',
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

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Manage your team and track time."
        action={
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setEmployeeViewMode('card')}
                className={`px-3 py-1 text-xs font-medium rounded ${employeeViewMode === 'card' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                Card View
              </button>
              <button
                type="button"
                onClick={() => setEmployeeViewMode('list')}
                className={`px-3 py-1 text-xs font-medium rounded ${employeeViewMode === 'list' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                List View
              </button>
            </div>
            <Button variant="secondary" onClick={() => setClockInOpen(true)}><Clock size={16} /> Clock In/Out</Button>
            <Button onClick={openNew}><Plus size={16} /> New Employee</Button>
          </div>
        }
      />

      {employees.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden="true" />}
          title="Build your crew"
          description="Add employees so you can assign work, manage access, and track time."
          action={<Button onClick={openNew}><Plus size={16} /> Add Employee</Button>}
          helpText="Crew setup is optional for solo contractors."
        />
      ) : employeeViewMode === 'card' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {employees.map((emp) => {
            const activeEntry = getActiveEntry(emp.id);
            const activeWorkLabel = activeEntry ? entryWorkLabel(activeEntry) : null;
            const todayEntries = timeEntries.filter(
              (te) => te.employeeId === emp.id && te.clockIn.startsWith(new Date().toISOString().slice(0, 10))
            );
            const todayHours = todayEntries.reduce(
              (s, te) => s + durationHours(te.clockIn, te.clockOut, te.breakMinutes),
              0
            );

            return renderEmployeeCard(emp, activeEntry, activeWorkLabel, todayHours);
          })}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium text-right">Pay</th>
                  <th className="px-4 py-3 font-medium">Labour</th>
                  <th className="px-4 py-3 font-medium text-right">Today</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {employees.map((emp) => {
                  const activeEntry = getActiveEntry(emp.id);
                  const activeWorkLabel = activeEntry ? entryWorkLabel(activeEntry) : null;
                  const todayEntries = timeEntries.filter(
                    (te) => te.employeeId === emp.id && te.clockIn.startsWith(new Date().toISOString().slice(0, 10))
                  );
                  const todayHours = todayEntries.reduce(
                    (s, te) => s + durationHours(te.clockIn, te.clockOut, te.breakMinutes),
                    0
                  );

                  return renderEmployeeListRow(emp, activeEntry, activeWorkLabel, todayHours);
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Employee form modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Employee' : 'New Employee'}
        footer={<>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={() => void handleSave()}>Save</Button>
        </>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="First Name *" required value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
            <Input label="Last Name *" required value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Role" value={form.role} onChange={(e) => set('role', e.target.value as EmployeeRole)}>
              {ROLES.map((r) => <option key={r} value={r}>{toOptionLabel(roleLabel[r])}</option>)}
            </Select>
            <Select label="Labour Type" value={form.labourType} onChange={(e) => set('labourType', e.target.value as LabourType)}>
              {LABOUR_TYPES.map((type) => <option key={type} value={type}>{toOptionLabel(labourTypeLabel[type])}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
            <Input label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Pay Type</p>
            <div className="inline-flex border border-gray-200 rounded-lg p-0.5 bg-white">
              {COMPENSATION_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => set('compensationType', type)}
                  className={`px-3 py-1 text-xs rounded ${form.compensationType === type ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  {type === 'salary' ? 'Salary' : 'Hourly'}
                </button>
              ))}
            </div>
          </div>
          <Input
            label={form.compensationType === 'salary' ? 'Salary Rate ($)' : 'Hourly Rate ($)'}
            type="number"
            min={0}
            value={form.hourlyRate}
            onChange={(e) => set('hourlyRate', Number(e.target.value))}
          />
          <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-sm font-medium text-gray-700">Time Tracking</p>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Paid Drive Time</p>
                <p className="text-xs text-gray-500">Allow this employee to record paid drive/travel time.</p>
              </div>
              <input
                type="checkbox"
                checked={form.paidDriveTimeEnabled === true}
                onChange={(e) => set('paidDriveTimeEnabled', e.target.checked)}
                aria-label="Paid Drive Time"
              />
            </div>
          </div>
          {!editing && (
            <Input
              label="Employee Login Password *"
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          )}
          {formError && <p className="text-sm text-accent-700">{formError}</p>}
          <div className="flex items-center gap-2">
            <input type="checkbox" id="active" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
            <label htmlFor="active" className="text-sm text-gray-700">Active Employee</label>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete Employee"
        footer={<>
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { deleteEmployee(confirmDelete!); setConfirmDelete(null); }}>Delete</Button>
        </>}
      >
        <p className="text-gray-600">Delete this employee record?</p>
      </Modal>

      {/* Clock Out confirm */}
      <Modal open={!!clockOutEntry} onClose={() => {
        setClockOutEntry(null);
        setPhotoAttachmentFileId('');
        setPhotoAttachmentFileName('');
        setPhotoUploading(false);
        setPhotoUploadError('');
      }} title="Clock Out"
        footer={<>
          <Button variant="secondary" onClick={() => {
            setClockOutEntry(null);
            setPhotoAttachmentFileId('');
            setPhotoAttachmentFileName('');
            setPhotoUploading(false);
            setPhotoUploadError('');
            setClockOutSubmitting(false);
          }}>Cancel</Button>
          <Button variant="danger" onClick={handleClockOut} disabled={!jobNotes.trim() || photoUploading || clockOutSubmitting}>
            {clockOutSubmitting ? 'Clocking Out...' : 'Clock Out'}
          </Button>
        </>}
      >
        <div className="space-y-4">
          <p className="text-gray-600">Add job notes before clocking out.</p>
          <Input label="Job Notes" required value={jobNotes} onChange={(e) => setJobNotes(e.target.value)} placeholder="Required before clocking out" />
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
          {!jobNotes.trim() && <p className="text-xs text-accent-700">Job notes are required before clocking out.</p>}
        </div>
      </Modal>

      {/* Clock In modal (mobile-friendly) */}
      <ClockInModal open={clockInOpen} onClose={() => setClockInOpen(false)} />
    </div>
  );
}
