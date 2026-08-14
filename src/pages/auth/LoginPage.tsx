import { useState } from 'react';
import { Lock, Leaf } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, Input } from '../../components/ui';

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<boolean>;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    setSubmitting(true);
    setError('');

    const ok = await onLogin(email, password);
    setSubmitting(false);

    if (!ok) {
      setError('Invalid email or password, or login service is unavailable.');
      return;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-cream to-accent-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-100 text-brand-700 mb-3">
            <Leaf size={24} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">OliveOps Login</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to access your dashboard.</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {searchParams.get('passwordReset') === 'success' && (
            <p className="text-sm text-brand-700 rounded-lg bg-brand-50 border border-brand-200 p-3">
              Your password has been reset. You can now sign in with your new password.
            </p>
          )}
          <Input
            label="Email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          <Input
            label="Password"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
          <div className="text-right">
            <Link to="/forgot-password" className="text-sm text-brand-600 hover:underline">Forgot password?</Link>
          </div>

          {error && <p className="text-sm text-accent-700">{error}</p>}

          <Button type="submit" className="w-full justify-center py-2.5">
            <Lock size={16} /> {submitting ? 'Logging in...' : 'Log In'}
          </Button>
        </form>

        <div className="mt-5 rounded-lg bg-gray-50 border border-gray-200 p-3">
          <p className="text-xs text-gray-600">Need a new business account?</p>
          <p className="text-xs text-gray-500 mt-1">
            <Link to="/signup" className="text-brand-600 hover:underline">Create your business owner account</Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
