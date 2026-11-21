import { resetUserPasswordRequestSchema, type UserDto } from '@ai-preneur/shared';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/fields';
import { Alert } from '../../components/ui/feedback';
import { Modal } from '../../components/ui/Modal';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../../lib/errors';
import * as usersService from '../../services/users.service';

export function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: UserDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNewPassword('');
    setErrors({});
    setFormError(null);
  }, [user]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    const parsed = resetUserPasswordRequestSchema.safeParse({ newPassword });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      await usersService.resetUserPassword(user.id, parsed.data);
      onDone();
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      busy={saving}
      title="Reset password"
      description={user?.email}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="reset-password-form" loading={saving}>
            Reset password
          </Button>
        </>
      }
    >
      <form id="reset-password-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Alert variant="info">Semua sesi pengguna ini akan diakhiri. Ia harus masuk dengan password baru.</Alert>
        <PasswordField
          label="Password baru"
          data-autofocus
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          error={errors.newPassword}
          hint="Minimal 8 karakter."
        />
      </form>
    </Modal>
  );
}
