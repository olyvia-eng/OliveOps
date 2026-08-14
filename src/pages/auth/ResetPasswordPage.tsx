import { useState } from 'react';
import { KeyRound, Leaf } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Input } from '../../components/ui';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token')?.trim() ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth?action=reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) setError(body.error ?? 'Could not reset password.');
      else navigate('/login?passwordReset=success', { replace: true });
    } catch {
      setError('Could not reset password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-cream to-accent-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-100 text-brand-700 mb-3"><Leaf size={24} /></div>
          <h1 className="text-2xl font-bold text-gray-900">Choose a new password</h1>
        </div>
        {!token ? (
          <div className="space-y-4"><p className="text-sm text-accent-700">This password reset link is invalid.</p><Link to="/forgot-password" className="block text-center text-sm text-brand-600 hover:underline">Request a new link</Link></div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Input label="New Password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            <Input label="Confirm New Password" type="password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
            {error && <p className="text-sm text-accent-700">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full justify-center py-2.5"><KeyRound size={16} /> {submitting ? 'Resetting...' : 'Reset Password'}</Button>
          </form>
        )}
      </Card>
    </div>
  );
}