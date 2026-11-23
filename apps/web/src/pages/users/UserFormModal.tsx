import {
  createUserRequestSchema,
  updateUserRequestSchema,
  type RoleDto,
  type UpdateUserRequest,
  type UserDto,
} from '@ai-preneur/shared';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { PasswordField, SelectField, TextField, Toggle } from '../../components/ui/fields';
import { Alert } from '../../components/ui/feedback';
import { Modal } from '../../components/ui/Modal';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../../lib/errors';
import * as usersService from '../../services/users.service';

interface UserFormModalProps {
  open: boolean;
  /** Undefined → create mode. */
  user?: UserDto | undefined;
  /** Roles the current user is allowed to assign. */
  roles: RoleDto[];
  onClose: () => void;
  onSaved: (user: UserDto) => void;
}

export function UserFormModal({ open, user, roles, onClose, onSaved }: UserFormModalProps) {
  const isEdit = user !== undefined;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    setPassword('');
    setRoleId(user?.role.id ?? roles.find((role) => !role.isSystem)?.id ?? roles[0]?.id ?? '');
    setIsActive(user?.isActive ?? true);
    setErrors({});
    setFormError(null);
  }, [open, user, roles]);

  // The current role stays selectable when editing even if it is not assignable.
  const roleOptions =
    user && !roles.some((role) => role.id === user.role.id)
      ? [{ id: user.role.id, name: user.role.name }, ...roles]
      : roles;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSaving(true);

    try {
      let saved: UserDto;
      if (user) {
        const patch: UpdateUserRequest = {};
        if (name.trim() !== user.name) patch.name = name;
        if (roleId !== user.role.id) patch.roleId = roleId;
        if (isActive !== user.isActive) patch.isActive = isActive;
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        const parsed = updateUserRequestSchema.safeParse(patch);
        if (!parsed.success) {
          setErrors(zodFieldErrors(parsed.error));
          return;
        }
        saved = await usersService.updateUser(user.id, parsed.data);
      } else {
        const parsed = createUserRequestSchema.safeParse({
          name,
          email,
          password,
          roleId,
          isActive,
        });
        if (!parsed.success) {
          setErrors(zodFieldErrors(parsed.error));
          return;
        }
        saved = await usersService.createUser(parsed.data);
      }
      setErrors({});
      onSaved(saved);
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const formId = 'user-form';

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title={isEdit ? 'Ubah pengguna' : 'Tambah pengguna'}
      description={user ? user.email : 'Buat akun baru dan tentukan role-nya.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {isEdit ? 'Simpan perubahan' : 'Tambah pengguna'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField
          label="Nama"
          data-autofocus
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
          maxLength={100}
        />
        {!isEdit && (
          <>
            <TextField
              label="Email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={errors.email}
            />
            <PasswordField
              label="Password awal"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={errors.password}
              hint="Minimal 8 karakter. Sampaikan ke pengguna melalui saluran yang aman."
            />
          </>
        )}
        <SelectField
          label="Role"
          value={roleId}
          onChange={(event) => setRoleId(event.target.value)}
          error={errors.roleId}
        >
          {roleOptions.length === 0 && (
            <option value="">Tidak ada role yang dapat diberikan</option>
          )}
          {roleOptions.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </SelectField>
        <Toggle
          checked={isActive}
          onChange={setIsActive}
          label="Akun aktif"
          description="Pengguna nonaktif tidak dapat masuk dan sesinya langsung diakhiri."
        />
      </form>
    </Modal>
  );
}
