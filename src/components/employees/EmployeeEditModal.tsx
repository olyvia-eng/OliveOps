import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Select } from '../ui';
import { useStore } from '../../store';
import type { BusinessUserSummary } from '../../auth/types';
import type { Employee, EmployeeRole, EmployeeLabourType } from '../../types';

type AccountAccessMode = 'none' | 'link_existing' | 'create_login';

type EmployeeForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: EmployeeRole;
  hourlyRate: number;
  compensationType: 'hourly' | 'salary';
  labourType: EmployeeLabourType;
  labourClassId: string;
  payrollBurdenPct: number;
  benefitsExtraCost: number;
  bonus: number;
  adjustClockInTime: boolean;
  editShiftWorkAreas: boolean;
  active: boolean;
};

type Props = {
  open: boolean;
  employeeId: string | null;
  onClose: () => void;
};

const ROLES: EmployeeRole[] = ['admin', 'foreman', 'crew_member'];
const LABOUR_TYPES: EmployeeLabourType[] = ['field_producing', 'overhead'];

const toOptionLabel = (value: string) => value
  .split('_')
  .join(' ')
  .split(' ')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const parseName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const [firstName, ...rest] = trimmed.split(/\s+/);
  return {
    firstName,
    lastName: rest.join(' '),
  };
};

const emptyForm = (): EmployeeForm => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  role: 'crew_member',
  hourlyRate: 30,
  compensationType: 'hourly',
  labourType: 'field_producing',
  labourClassId: '',
  payrollBurdenPct: 18,
  benefitsExtraCost: 0,
  bonus: 0,
  adjustClockInTime: false,
  editShiftWorkAreas: false,
  active: true,
});

export default function EmployeeEditModal({ open, employeeId, onClose }: Props) {
  const employees = useStore((state) => state.employees);
  const labourClasses = useStore((state) => state.labourClasses);
  const employee = useMemo(
    () => (employeeId ? employees.find((value) => value.id === employeeId) ?? null : null),
    [employeeId, employees]
  );

  const [form, setForm] = useState<EmployeeForm>(emptyForm());
  const [accessMode, setAccessMode] = useState<AccountAccessMode>('none');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loginRole, setLoginRole] = useState<EmployeeRole>('crew_member');
  const [availableUsers, setAvailableUsers] = useState<BusinessUserSummary[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [sessionUserId, setSessionUserId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !employee) return;
    const parsed = parseName(employee.name);
    setForm({
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      email: employee.email,
      phone: employee.phone,
      role: employee.role,
      hourlyRate: employee.hourlyRate,
      compensationType: employee.compensationType ?? 'hourly',
      labourType: employee.labourType ?? 'field_producing',
      labourClassId: employee.labourClassId ?? '',
      payrollBurdenPct: employee.payrollBurdenPct ?? 18,
      benefitsExtraCost: employee.benefitsExtraCost ?? 0,
      bonus: employee.bonus ?? 0,
      adjustClockInTime: employee.mobileTimePermissions?.adjustClockInTime === true,
      editShiftWorkAreas: employee.mobileTimePermissions?.editShiftWorkAreas === true,
      active: employee.active,
    });
    setAccessMode(employee.userId ? 'link_existing' : 'none');
    setSelectedUserId(employee.userId ?? '');
    setLoginEmail(employee.email ?? '');
    setNewPassword('');
    setLoginRole(employee.role);
    setError('');
  }, [employee, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingUsers(true);

    void Promise.all([
      fetch('/api/users', { credentials: 'include' }),
      fetch('/api/auth?action=session', { credentials: 'include' }),
    ])
      .then(async ([usersRes, sessionRes]) => {
        const usersPayload = await usersRes.json().catch(() => ({}));
        const sessionPayload = await sessionRes.json().catch(() => ({}));
        if (cancelled) return;

        if (usersRes.ok && Array.isArray((usersPayload as { users?: unknown[] }).users)) {
          setAvailableUsers((usersPayload as { users: BusinessUserSummary[] }).users);
        } else {
          setAvailableUsers([]);
        }

        const currentId = (sessionPayload as { user?: { id?: string } })?.user?.id;
        setSessionUserId(typeof currentId === 'string' ? currentId : '');
      })
      .finally(() => {
        if (!cancelled) setLoadingUsers(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const setField = (key: keyof EmployeeForm, value: string | number | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const buildAccountAccessPayload = () => {
    if (accessMode === 'none') return { mode: 'none' as const };

    if (accessMode === 'link_existing') {
      if (!selectedUserId.trim()) {
        setError('Select an existing OliveOps account to link.');
        return null;
      }
      return {
        mode: 'link_existing' as const,
        userId: selectedUserId.trim(),
      };
    }

    if (!loginEmail.trim()) {
      setError('Login email is required when creating access.');
      return null;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters for employee login.');
      return null;
    }
    return {
      mode: 'create_login' as const,
      loginEmail: loginEmail.trim(),
      password: newPassword,
      role: loginRole,
    };
  };

  const handleSave = async () => {
    if (!employee) return;
    setError('');

    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('First and last name are required.');
      return;
    }

    const accountAccess = buildAccountAccessPayload();
    if (!accountAccess) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/data?entity=employees&id=${encodeURIComponent(employee.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          data: {
            name: fullName,
            email: form.email.trim(),
            phone: form.phone,
            role: form.role,
            hourlyRate: form.hourlyRate,
            compensationType: form.compensationType,
            labourType: form.labourType,
            labourClassId: form.labourClassId || null,
            payrollBurdenPct: form.payrollBurdenPct,
            benefitsExtraCost: form.benefitsExtraCost,
            bonus: form.bonus,
            mobileTimePermissions: {
              adjustClockInTime: form.adjustClockInTime,
              editShiftWorkAreas: form.editShiftWorkAreas,
            },
            active: form.active,
          },
          accountAccess,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const apiError = typeof (payload as { error?: unknown })?.error === 'string'
          ? (payload as { error: string }).error
          : 'Could not save employee changes.';
        throw new Error(apiError);
      }

      const updated = (payload as { employee?: Employee })?.employee;
      if (updated) {
        useStore.setState((state) => ({
          employees: state.employees.map((item) => (item.id === updated.id ? updated : item)),
        }));
      }

      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save employee changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Employee"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={() => void handleSave()} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
      </>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="First Name *" required value={form.firstName} onChange={(event) => setField('firstName', event.target.value)} />
          <Input label="Last Name *" required value={form.lastName} onChange={(event) => setField('lastName', event.target.value)} />
        </div>

        <div>
          <Select label="Labour Class" value={form.labourClassId} onChange={(event) => setField('labourClassId', event.target.value)}>
            <option value="">Unassigned</option>
            {labourClasses.filter((labourClass) => labourClass.active || labourClass.id === form.labourClassId).sort((left, right) => left.name.localeCompare(right.name)).map((labourClass) => <option key={labourClass.id} value={labourClass.id}>{labourClass.name}{labourClass.active ? '' : ' (Inactive)'}</option>)}
          </Select>
          <p className="mt-1 text-xs text-gray-500">Used for estimating and Labour Class pricing. This does not affect the employee's OliveOps permissions.</p>
          {form.labourType === 'field_producing' && !form.labourClassId ? <p className="mt-1 text-xs font-medium text-amber-700">Recommended for field Employees so their planned hours can contribute to estimating rates.</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select label="Role" value={form.role} onChange={(event) => setField('role', event.target.value as EmployeeRole)}>
            {ROLES.map((role) => <option key={role} value={role}>{toOptionLabel(role)}</option>)}
          </Select>
          <Select label="Labour Type" value={form.labourType} onChange={(event) => setField('labourType', event.target.value as EmployeeLabourType)}>
            {LABOUR_TYPES.map((labourType) => <option key={labourType} value={labourType}>{toOptionLabel(labourType)}</option>)}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Email" type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} />
          <Input label="Phone" value={form.phone} onChange={(event) => setField('phone', event.target.value)} />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Pay Type</p>
          <div className="inline-flex border border-gray-200 rounded-lg p-0.5 bg-white">
            {(['hourly', 'salary'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setField('compensationType', type)}
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
          onChange={(event) => setField('hourlyRate', Number(event.target.value))}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input label="Payroll Burden (%)" type="number" min={0} value={form.payrollBurdenPct} onChange={(event) => setField('payrollBurdenPct', Number(event.target.value))} />
          <Input label="Annual Benefits / Extra Cost ($)" type="number" min={0} value={form.benefitsExtraCost} onChange={(event) => setField('benefitsExtraCost', Number(event.target.value))} />
          <Input label="Annual Bonus ($)" type="number" min={0} value={form.bonus} onChange={(event) => setField('bonus', Number(event.target.value))} />
        </div>

        <section className="space-y-3 border-t border-gray-200 pt-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Mobile Time Permissions</h3>
            <p className="mt-1 text-xs text-gray-500">Controls employee-specific mobile time capabilities.</p>
          </div>
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-gray-200 p-3">
            <span>
              <span className="block text-sm font-medium text-gray-800">Allow clock-in time adjustment</span>
              <span className="mt-1 block text-xs text-gray-500">Allows this employee to choose an earlier start time when clocking in from the mobile app.</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Allow clock-in time adjustment"
              checked={form.adjustClockInTime}
              onChange={(event) => setField('adjustClockInTime', event.target.checked)}
              className="relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-gray-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform checked:bg-brand-600 checked:after:translate-x-4 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-gray-200 p-3">
            <span>
              <span className="block text-sm font-medium text-gray-800">Allow shift/work-area editing</span>
              <span className="mt-1 block text-xs text-gray-500">Allows this employee to adjust how their current shift was divided between Work Areas before clocking out.</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Allow shift/work-area editing"
              checked={form.editShiftWorkAreas}
              onChange={(event) => setField('editShiftWorkAreas', event.target.checked)}
              className="relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-gray-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform checked:bg-brand-600 checked:after:translate-x-4 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            />
          </label>
        </section>

        <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-700">Account Access</p>
          <p className="text-xs text-gray-600">
            Current: {employee?.userId ? 'Linked OliveOps account' : 'No OliveOps access'}
          </p>
          <Select label="Access Mode" value={accessMode} onChange={(event) => setAccessMode(event.target.value as AccountAccessMode)}>
            <option value="none">No OliveOps access</option>
            <option value="link_existing">Link existing account</option>
            <option value="create_login">Create login access</option>
          </Select>

          {accessMode === 'link_existing' && (
            <Select label="Existing Account *" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
              <option value="">{loadingUsers ? 'Loading accounts...' : 'Select account'}</option>
              {availableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email}) {user.active ? '' : '[inactive]'}
                </option>
              ))}
            </Select>
          )}

          {accessMode === 'create_login' && (
            <>
              <Input
                label="Login Email *"
                type="email"
                required
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
              />
              <Select label="Login Role" value={loginRole} onChange={(event) => setLoginRole(event.target.value as EmployeeRole)}>
                {ROLES.map((role) => (
                  <option key={role} value={role}>{toOptionLabel(role)}</option>
                ))}
              </Select>
              <Input
                label="Employee Login Password *"
                type="password"
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </>
          )}

          {employee?.userId && accessMode === 'none' && employee.userId === sessionUserId && (
            <p className="text-xs text-accent-700">Owner self-unlink is blocked by policy.</p>
          )}
          {employee?.userId && accessMode === 'none' && employee.userId !== sessionUserId && (
            <p className="text-xs text-gray-600">Saving with this mode will unlink this employee from their OliveOps account.</p>
          )}
        </div>

        {error && <p className="text-sm text-accent-700">{error}</p>}

        <div className="flex items-center gap-2">
          <input type="checkbox" id="employee-edit-active" checked={form.active} onChange={(event) => setField('active', event.target.checked)} />
          <label htmlFor="employee-edit-active" className="text-sm text-gray-700">Active Employee</label>
        </div>
      </div>
    </Modal>
  );
}