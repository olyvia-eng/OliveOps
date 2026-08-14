import { useState } from 'react';
import { Leaf, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Card, Input } from '../../components/ui';

const GENERIC_MESSAGE = 'If an account exists for that email address, we’ve sent password reset instructions.';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth?action=forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (response.status === 429) setError('Too many requests. Please try again later.');
      else if (!response.ok) setError('Could not submit the request. Please try again.');
      else setMessage(GENERIC_MESSAGE);
    } catch {
      setError('Could not submit the request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-cream to-accent-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-100 text-brand-700 mb-3"><Leaf size={24} /></div>
          <h1 className="text-2xl font-bold text-gray-900">Reset your password</h1>
          <p className="text-sm text-gray-500 mt-1">Enter the email address you use for OliveOps.</p>
        </div>
        {message ? (
          <div className="space-y-4"><p className="text-sm text-brand-800 rounded-lg bg-brand-50 border border-brand-200 p-3">{message}</p><Link to="/login" className="block text-center text-sm text-brand-600 hover:underline">Back to login</Link></div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Input label="Email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            {error && <p className="text-sm text-accent-700">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full justify-center py-2.5"><Mail size={16} /> {submitting ? 'Sending...' : 'Send Reset Instructions'}</Button>
            <Link to="/login" className="block text-center text-sm text-brand-600 hover:underline">Back to login</Link>
          </form>
        )}
      </Card>
    </div>
  );
}