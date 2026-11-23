import {
  createRoleRequestSchema,
  PERMISSION_DEFINITIONS,
  updateRoleRequestSchema,
  type Permission,
  type PermissionDefinition,
  type RoleDto,
} from '@ai-preneur/shared';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/fields';
import { Alert } from '../../components/ui/feedback';
import { Modal } from '../../components/ui/Modal';
import { useAuth } from '../../hooks/use-auth';
import { cn } from '../../lib/cn';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../../lib/errors';
import * as rolesService from '../../services/roles.service';

function groupByCategory(
  definitions: readonly PermissionDefinition[],
): [string, PermissionDefinition[]][] {
  const groups = new Map<string, PermissionDefinition[]>();
  for (const definition of definitions) {
    const list = groups.get(definition.category) ?? [];
    list.push(definition);
    groups.set(definition.category, list);
  }
  return [...groups.entries()];
}

export function RoleFormModal({
  open,
  role,
  onClose,
  onSaved,
}: {
  open: boolean;
  role?: RoleDto | undefined;
  onClose: () => void;
  onSaved: (role: RoleDto) => void;
}) {
  const { user: me } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<Permission>>(new Set());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const groups = useMemo(() => groupByCategory(PERMISSION_DEFINITIONS), []);

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setSelected(new Set(role?.permissions ?? []));
    setErrors({});
    setFormError(null);
  }, [open, role]);

  /** You can only grant what you have (system roles have everything). */
  const canGrant = (permission: Permission) =>
    Boolean(me?.role.isSystem || me?.permissions.includes(permission));

  const toggle = (permission: Permission, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(permission);
      else next.delete(permission);
      return next;
    });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const permissions = [...selected];
    const payload = { name, description, permissions };

    setSaving(true);
    try {
      let saved: RoleDto;
      if (role) {
        const parsed = updateRoleRequestSchema.safeParse(payload);
        if (!parsed.success) {
          setErrors(zodFieldErrors(parsed.error));
          return;
        }
        saved = await rolesService.updateRole(role.id, parsed.data);
      } else {
        const parsed = createRoleRequestSchema.safeParse(payload);
        if (!parsed.success) {
          setErrors(zodFieldErrors(parsed.error));
          return;
        }
        saved = await rolesService.createRole(parsed.data);
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

  const formId = 'role-form';

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="lg"
      title={role ? `Ubah role ${role.name}` : 'Tambah role'}
      description="Tentukan fitur apa saja yang dapat diakses oleh pengguna dengan role ini."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {role ? 'Simpan perubahan' : 'Tambah role'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Nama role"
            data-autofocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors.name}
            maxLength={100}
          />
          <TextAreaField
            label="Deskripsi (opsional)"
            rows={1}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            error={errors.description}
            maxLength={500}
          />
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Hak akses</legend>
          {errors.permissions && <p className="mt-1 text-xs text-red-600">{errors.permissions}</p>}
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {groups.map(([category, definitions]) => (
              <div key={category} className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {category}
                </p>
                <div className="space-y-2">
                  {definitions.map((definition) => {
                    const grantable = canGrant(definition.key);
                    return (
                      <label
                        key={definition.key}
                        className={cn(
                          'flex items-start gap-2.5',
                          grantable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                        )}
                        title={
                          grantable
                            ? undefined
                            : 'Anda tidak memiliki hak akses ini, sehingga tidak dapat memberikannya.'
                        }
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 rounded border-slate-300 accent-primary-600"
                          checked={selected.has(definition.key)}
                          disabled={!grantable}
                          onChange={(event) => toggle(definition.key, event.target.checked)}
                        />
                        <span>
                          <span className="block text-sm text-slate-800">{definition.label}</span>
                          <span className="block text-xs text-slate-500">
                            {definition.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
