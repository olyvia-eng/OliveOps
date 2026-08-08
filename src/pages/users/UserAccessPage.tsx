import { useMemo, useState } from 'react';
import { PageHeader, Card, Input, Select, Button, Badge } from '../../components/ui';
import type { BusinessUserRole, BusinessUserSummary } from '../../auth/types';
import { Trash2 } from 'lucide-react';

interface UserAccessPageProps {
  users: BusinessUserSummary[];
  currentUserRole: BusinessUserRole;
  onCreateUser: (payload: {
    name: string;
    email: string;
    password: string;
    role: 'admin' | 'foreman' | 'crew_member';
  }) => Promise<{ ok: boolean; error?: string }>;
  onUpdateUser: (userId: string, data: { role?: 'admin' | 'foreman' | 'crew_member'; active?: boolean }) => Promise<{ ok: boolean; error?: string }>;
  onDeleteUser: (userId: string) => Promise<{ ok: boolean; error?: string }>;
}

const roleLabel: Record<BusinessUserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  foreman: 'Foreman',
  crew_member: 'Crew Member',
};

const roleColor: Record<BusinessUserRole, string> = {
  owner: 'bg-accent-100 text-accent-700',
  admin: 'bg-brand-100 text-brand-700',
  foreman: 'bg-accent-200 text-accent-800',
  crew_member: 'bg-brand-200 text-brand-800',
};

export default function UserAccessPage({ users, currentUserRole, onCreateUser, onUpdateUser, onDeleteUser }: UserAccessPageProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<BusinessUserRole>('crew_member');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canCreateAdmins = useMemo(
    () => currentUserRole === 'owner' || currentUserRole === 'admin',
    [currentUserRole]
  );

  const canManageRow = (user: BusinessUserSummary) => user.role !== 'owner';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!name.trim() || !email.trim() || !password) {
      setError('Please complete all fields.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (role === 'owner') {
      setError('Use business signup to create a new owner account.');
      return;
    }

    if (role === 'admin' && !canCreateAdmins) {
      setError('You do not have permission to create admin users.');
      return;
    }

    setSubmitting(true);
    let result: { ok: boolean; error?: string };
    try {
      result = await onCreateUser({
        name,
        email,
        password,
        role,
      });
    } catch {
      setSubmitting(false);
      setError('Unexpected error while creating user. Please try again.');
      return;
    }
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error ?? 'Could not create user.');
      return;
    }

    setName('');
    setEmail('');
    setPassword('');
    setRole('crew_member');
    setSuccess('User created successfully.');
  };

  const handleRoleChange = async (user: BusinessUserSummary, nextRole: 'admin' | 'foreman' | 'crew_member') => {
    setError('');
    setSuccess('');

    const result = await onUpdateUser(user.id, { role: nextRole });
    if (!result.ok) {
      setError(result.error ?? 'Could not update user.');
    }
  };

  const handleDelete = async (user: BusinessUserSummary) => {
    setError('');
    setSuccess('');

    const confirmed = window.confirm(`Delete ${user.name}'s login?`);
    if (!confirmed) return;

    const result = await onDeleteUser(user.id);
    if (!result.ok) {
      setError(result.error ?? 'Could not delete user.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Users & Access"
        subtitle="Manage who can sign in to OliveOps and control their account access."
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="p-4 xl:col-span-1">
          <h2 className="font-semibold text-gray-800 mb-3">Add User</h2>
          <form onSubmit={submit} className="space-y-3">
            <Input label="Full Name" required value={name} onChange={(event) => setName(event.target.value)} />
            <Input label="Email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <Input
              label="Temporary Password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Select
              label="Role"
              required
              value={role}
              onChange={(event) => setRole(event.target.value as BusinessUserRole)}
            >
              <option value="crew_member">Crew Member</option>
              <option value="foreman">Foreman</option>
              <option value="admin" disabled={!canCreateAdmins}>Admin</option>
            </Select>

            {error && <p className="text-sm text-accent-700">{error}</p>}
            {success && <p className="text-sm text-brand-700">{success}</p>}

            <Button type="submit" className="w-full justify-center">
              {submitting ? 'Creating user...' : 'Create User'}
            </Button>
          </form>
        </Card>

        <Card className="xl:col-span-2 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Business Users</h2>
          </div>
          {users.length === 0 ? (
            <p className="text-sm text-gray-400 p-4">No users found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-500 text-left text-xs">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="py-2 font-medium">Email</th>
                    <th className="py-2 font-medium">Role</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Created</th>
                    <th className="py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-800">{user.name}</td>
                      <td className="py-2 text-gray-600">{user.email}</td>
                      <td className="py-2">
                        {canManageRow(user) ? (
                          <select
                            value={user.role}
                            onChange={(event) => void handleRoleChange(user, event.target.value as 'admin' | 'foreman' | 'crew_member')}
                            className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white"
                          >
                            <option value="crew_member">Crew Member</option>
                            <option value="foreman">Foreman</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : (
                          <Badge label={roleLabel[user.role]} className={roleColor[user.role]} />
                        )}
                      </td>
                      <td className="py-2 text-gray-600">{user.active ? 'Active' : 'Inactive'}</td>
                      <td className="py-2 text-gray-500">{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td className="py-2">
                        {canManageRow(user) ? (
                          <Button variant="ghost" size="sm" onClick={() => void handleDelete(user)}>
                            <Trash2 size={13} className="text-accent-700" />
                          </Button>
                        ) : (
                          <span className="text-xs text-gray-400">Protected</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
