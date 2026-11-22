import { loginRequestSchema } from '@ai-preneur/shared';
import { useState, type FormEvent } from 'react';

import { Button } from '../components/ui/Button';
import { PasswordField, TextField } from '../components/ui/fields';
import { Alert } from '../components/ui/feedback';
import { useAuth } from '../hooks/use-auth';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../lib/errors';

export function LoginPage() {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const parsed = loginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      // On success the auth state flips to "authenticated" and <RedirectIfAuthenticated>
      // navigates to the originally requested page (or the user's home page).
      await login(parsed.data);
    } catch (error) {
      setFieldErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
      setPassword('');
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary-600 text-lg font-bold text-white">
            AP
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Masuk ke AI Preneur</h1>
          <p className="mt-1 text-sm text-slate-500">Gunakan email dan password akun Anda.</p>
        </div>

        <form
          onSubmit={onSubmit}
          noValidate
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        >
          {formError && <Alert>{formError}</Alert>}

          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={fieldErrors.email}
            disabled={submitting}
          />
          <PasswordField
            label="Password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
            disabled={submitting}
          />

          <Button type="submit" className="w-full" loading={submitting}>
            Masuk
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Lupa password? Hubungi administrator untuk mereset akun Anda.
        </p>
      </div>
    </div>
  );
}
