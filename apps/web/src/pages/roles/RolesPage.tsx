import { PERMISSION_DEFINITIONS, PERMISSIONS, type RoleDto } from '@ai-preneur/shared';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Alert, Badge, Card, EmptyState, PageHeader } from '../../components/ui/feedback';
import { Icon } from '../../components/ui/Icon';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { useAuth } from '../../hooks/use-auth';
import { canActOnRole } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import * as rolesService from '../../services/roles.service';
import { RoleFormModal } from './RoleFormModal';

const LABELS = new Map(
  PERMISSION_DEFINITIONS.map((definition) => [definition.key, definition.label]),
);

export function RolesPage() {
  const { user: me, can } = useAuth();
  const canManage = can(PERMISSIONS.ROLES_MANAGE);

  const [roles, setRoles] = useState<RoleDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [formState, setFormState] = useState<{ open: boolean; role?: RoleDto }>({ open: false });
  const [deleteTarget, setDeleteTarget] = useState<RoleDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    rolesService
      .listRoles(controller.signal)
      .then((loaded) => {
        setRoles(loaded);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      });
    return () => controller.abort();
  }, [reloadKey]);

  /** Matches the API rules: not system roles, not your own role, not more powerful roles. */
  const editable = (role: RoleDto) =>
    canManage && me !== null && !role.isSystem && role.id !== me.role.id && canActOnRole(me, role);

  const onSaved = (saved: RoleDto) => {
    setNotice(
      formState.role ? `Role ${saved.name} diperbarui.` : `Role ${saved.name} ditambahkan.`,
    );
    setFormState({ open: false });
    reload();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await rolesService.deleteRole(deleteTarget.id);
      setNotice(`Role ${deleteTarget.name} dihapus.`);
      setDeleteTarget(null);
      reload();
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Role & Akses"
        description="Setiap pengguna memiliki satu role. Hak akses role menentukan fitur yang bisa digunakan."
        actions={
          canManage && (
            <Button onClick={() => setFormState({ open: true })}>
              <Icon name="plus" className="size-4" /> Tambah role
            </Button>
          )
        }
      />

      {notice && (
        <Alert variant="success" className="mb-4">
          {notice}
        </Alert>
      )}

      {loadError ? (
        <Alert>{loadError}</Alert>
      ) : roles === null ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="size-7" />
        </div>
      ) : roles.length === 0 ? (
        <EmptyState icon="roles" title="Belum ada role" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-slate-900">{role.name}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{role.userCount} pengguna</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {role.isSystem && <Badge color="violet">Sistem</Badge>}
                  {me?.role.id === role.id && <Badge>Role Anda</Badge>}
                </div>
              </div>

              {role.description && (
                <p className="mt-3 text-sm text-slate-600">{role.description}</p>
              )}

              <div className="mt-4 flex flex-wrap gap-1.5">
                {role.isSystem ? (
                  <Badge color="violet">Semua hak akses</Badge>
                ) : role.permissions.length === 0 ? (
                  <span className="text-xs text-slate-400">Tidak ada hak akses</span>
                ) : (
                  role.permissions.map((permission) => (
                    <Badge key={permission}>{LABELS.get(permission) ?? permission}</Badge>
                  ))
                )}
              </div>

              {editable(role) && (
                <div className="mt-5 flex gap-2 border-t border-slate-100 pt-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setFormState({ open: true, role })}
                  >
                    <Icon name="edit" className="size-4" /> Ubah
                  </Button>
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTarget(role);
                    }}
                  >
                    <Icon name="trash" className="size-4" /> Hapus
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <RoleFormModal
        open={formState.open}
        role={formState.role}
        onClose={() => setFormState({ open: false })}
        onSaved={onSaved}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Hapus role?"
        message={
          deleteTarget && deleteTarget.userCount > 0 ? (
            <>
              Role <strong>{deleteTarget.name}</strong> masih dipakai oleh {deleteTarget.userCount}{' '}
              pengguna. Pindahkan mereka ke role lain sebelum menghapus.
            </>
          ) : (
            <>
              Role <strong>{deleteTarget?.name}</strong> akan dihapus permanen.
            </>
          )
        }
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
