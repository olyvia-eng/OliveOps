import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select } from '../ui';
import { useStore } from '../../store';
import type { Employee, EmployeeRole, EmployeeLabourType } from '../../types';
import type { BusinessUserSummary } from '../../auth/types';

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
  active: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (employee: Employee) => void;
};

const ROLES: EmployeeRole[] = ['admin', 'foreman', 'crew_member'];
const LABOUR_TYPES: EmployeeLabourType[] = ['field_producing', 'overhead'];

const toOptionLabel = (value: string) => value
  .split('_')
  .join(' ')
  .split(' ')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

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
  active: true,
});

export default function EmployeeCreateModal({ open, onClose, onCreated }: Props) {
  const labourClasses = useStore((state) => state.labourClasses);
  const [form, setForm] = useState<EmployeeForm>(emptyForm());
  const [accessMode, setAccessMode] = useState<AccountAccessMode>('none');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loginRole, setLoginRole] = useState<EmployeeRole>('crew_member');
  const [availableUsers, setAvailableUsers] = useState<BusinessUserSummary[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setForm(emptyForm());
    setAccessMode('none');
    setSelectedUserId('');
    setLoginEmail('');
    setNewPassword('');
    setLoginRole('crew_member');
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoadingUsers(true);

    void fetch('/api/users', { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;

        if (response.ok && payload && typeof payload === 'object' && Array.isArray((payload as { users?: unknown[] }).users)) {
          setAvailableUsers((payload as { users: BusinessUserSummary[] }).users);
        } else {
          setAvailableUsers([]);
        }
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
    if (accessMode === 'none') {
      return { mode: 'none' as const };
    }

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

  const upsertEmployeeInStore = (employee: Employee) => {
    useStore.setState((state) => {
      const exists = state.employees.some((item) => item.id === employee.id);
      return {
        employees: exists
          ? state.employees.map((item) => (item.id === employee.id ? employee : item))
          : [...state.employees, employee],
      };
    });
  };

  const handleSave = async () => {
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
      const response = await fetch('/api/data?entity=employees', {
        method: 'POST',
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
            active: form.active,
          },
          accountAccess,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const apiError = typeof (payload as { error?: unknown })?.error === 'string'
          ? (payload as { error: string }).error
          : 'Could not create employee.';
        throw new Error(apiError);
      }

      const created = (payload as { employee?: Employee } | null)?.employee;
      if (!created) {
        throw new Error('Employee was created but not returned by API.');
      }

      upsertEmployeeInStore(created);
      onCreated?.(created);
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create employee.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Employee"
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
            {labourClasses.filter((labourClass) => labourClass.active).sort((left, right) => left.name.localeCompare(right.name)).map((labourClass) => <option key={labourClass.id} value={labourClass.id}>{labourClass.name}</option>)}
          </Select>
          <p className="mt-1 text-xs text-gray-500">Used to group employees for Labour Class pricing and estimating.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select label="Role" value={form.role} onChange={(event) => setField('role', event.target.value as EmployeeRole)}>
            {ROLES.map((role) => <option key={role} value={role}>{toOptionLabel(role)}</option>)}
          </Select>
          <Select label="Labour Type" value={form.labourType} onChange={(event) => setField('labourType', event.target.value as EmployeeLabourType)}>
            {LABOUR_TYPES.map((type) => <option key={type} value={type}>{toOptionLabel(type)}</option>)}
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

        <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-700">Account Access</p>
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
        </div>

        {error && <p className="text-sm text-accent-700">{error}</p>}

        <div className="flex items-center gap-2">
          <input type="checkbox" id="employee-create-active" checked={form.active} onChange={(event) => setField('active', event.target.checked)} />
          <label htmlFor="employee-create-active" className="text-sm text-gray-700">Active Employee</label>
        </div>
      </div>
    </Modal>
  );
}
