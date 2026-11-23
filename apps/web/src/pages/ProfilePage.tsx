import { changePasswordRequestSchema, updateProfileRequestSchema } from '@ai-preneur/shared';
import { useState, type FormEvent } from 'react';

import { Button } from '../components/ui/Button';
import { PasswordField, TextField } from '../components/ui/fields';
import { Alert, Badge, Card, PageHeader } from '../components/ui/feedback';
import { useAuth } from '../hooks/use-auth';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../lib/errors';
import * as authService from '../services/auth.service';

function ProfileInfoForm() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    const parsed = updateProfileRequestSchema.safeParse({ name });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const updated = await authService.updateProfile(parsed.data);
      setUser(updated);
      setName(updated.name);
      setStatus({ type: 'success', message: 'Profil berhasil diperbarui.' });
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setStatus({ type: 'error', message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold">Informasi profil</h2>
          <p className="text-sm text-slate-500">Nama yang ditampilkan di aplikasi.</p>
        </div>
        <div className="space-y-4 px-5 py-4">
          {status && <Alert variant={status.type}>{status.message}</Alert>}
          <TextField
            label="Nama"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors.name}
            maxLength={100}
          />
          <TextField
            label="Email"
            value={user.email}
            disabled
            hint="Email tidak dapat diubah sendiri."
          />
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-slate-700">Role</span>
            <Badge color={user.role.isSystem ? 'violet' : 'gray'}>{user.role.name}</Badge>
          </div>
        </div>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <Button type="submit" loading={saving} disabled={name.trim() === user.name}>
            Simpan
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    const parsed = changePasswordRequestSchema.safeParse({ currentPassword, newPassword });
    const nextErrors: FieldErrors = parsed.success ? {} : zodFieldErrors(parsed.error);
    if (newPassword !== confirmPassword)
      nextErrors.confirmPassword = 'Konfirmasi password tidak cocok';
    if (!parsed.success || nextErrors.confirmPassword) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      await authService.changePassword(parsed.data);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatus({
        type: 'success',
        message: 'Password berhasil diubah. Semua sesi di perangkat lain telah dikeluarkan.',
      });
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setStatus({ type: 'error', message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold">Ubah password</h2>
          <p className="text-sm text-slate-500">
            Setelah diubah, Anda tetap masuk di perangkat ini saja.
          </p>
        </div>
        <div className="space-y-4 px-5 py-4">
          {status && <Alert variant={status.type}>{status.message}</Alert>}
          <PasswordField
            label="Password saat ini"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            error={errors.currentPassword}
          />
          <PasswordField
            label="Password baru"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            error={errors.newPassword}
            hint="Minimal 8 karakter. Gunakan kalimat panjang yang mudah Anda ingat."
          />
          <PasswordField
            label="Konfirmasi password baru"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            error={errors.confirmPassword}
          />
        </div>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <Button type="submit" loading={saving}>
            Ubah password
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function ProfilePage() {
  return (
    <>
      <PageHeader title="Profil saya" description="Kelola informasi akun dan keamanan Anda." />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileInfoForm />
        <ChangePasswordForm />
      </div>
    </>
  );
}
