import { useState } from 'react';
import { Leaf, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Card, Input, Select } from '../../components/ui';

const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';
const commonTimezones = ['America/St_Johns', 'America/Halifax', 'America/Toronto', 'America/Winnipeg', 'America/Edmonton', 'America/Vancouver', 'America/Whitehorse', 'UTC'];

interface SignupPageProps {
  onSignup: (payload: {
    businessName: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    timezone: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export default function SignupPage({ onSignup }: SignupPageProps) {
  const [businessName, setBusinessName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!businessName.trim() || !firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      setError('Please fill in all required fields.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const result = await onSignup({
      businessName: businessName.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      password,
      timezone,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error ?? 'Could not create account.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-cream to-accent-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-100 text-brand-700 mb-3">
            <Leaf size={24} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Create Business Account</h1>
          <p className="text-sm text-gray-500 mt-1">Set up your company and become the owner admin.</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Input
            label="Business Name *"
            required
            value={businessName}
            onChange={(event) => setBusinessName(event.target.value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="First Name *" required value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" />
            <Input label="Last Name *" required value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" />
          </div>
          <Input
            label="Owner Email *"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          <Select label="Business Timezone *" required value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            {!commonTimezones.includes(timezone) ? <option value={timezone}>{timezone}</option> : null}
            {commonTimezones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
          </Select>
          <Input
            label="Password *"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
          <Input
            label="Confirm Password *"
            type="password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
          />

          {error && <p className="text-sm text-accent-700">{error}</p>}

          <Button type="submit" className="w-full justify-center py-2.5">
            <UserPlus size={16} /> {submitting ? 'Creating account...' : 'Create Account'}
          </Button>
        </form>

        <div className="mt-5 rounded-lg bg-gray-50 border border-gray-200 p-3">
          <p className="text-xs text-gray-600">Already have an account?</p>
          <p className="text-xs text-gray-500 mt-1">
            <Link to="/login" className="text-brand-600 hover:underline">Sign in here</Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
