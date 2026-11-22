import { PERMISSIONS, type RoleDto, type UserDto, type UserListResponse } from '@ai-preneur/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Button } from '../../components/ui/Button';
import { Alert, Badge, Card, EmptyState, PageHeader } from '../../components/ui/feedback';
import { Icon } from '../../components/ui/Icon';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { useAuth } from '../../hooks/use-auth';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { canActOnRole } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, initials } from '../../lib/format';
import * as rolesService from '../../services/roles.service';
import * as usersService from '../../services/users.service';
import { ResetPasswordModal } from './ResetPasswordModal';
import { UserFormModal } from './UserFormModal';

const PAGE_SIZE = 20;

export function UsersPage() {
  const { user: me, can } = useAuth();
  const canCreate = can(PERMISSIONS.USERS_CREATE);
  const canUpdate = can(PERMISSIONS.USERS_UPDATE);
  const canDelete = can(PERMISSIONS.USERS_DELETE);

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 300);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [data, setData] = useState<UserListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [roles, setRoles] = useState<RoleDto[]>([]);

  const [formState, setFormState] = useState<{ open: boolean; user?: UserDto }>({ open: false });
  const [resetTarget, setResetTarget] = useState<UserDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => setPage(1), [search]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    usersService
      .listUsers({ page, pageSize: PAGE_SIZE, ...(search ? { search } : {}) }, controller.signal)
      .then(setData)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, search, reloadKey]);

  useEffect(() => {
    if (!canCreate && !canUpdate) return;
    const controller = new AbortController();
    rolesService
      .listRoles(controller.signal)
      .then(setRoles)
      .catch(() => undefined);
    return () => controller.abort();
  }, [canCreate, canUpdate]);

  const assignableRoles = useMemo(() => (me ? roles.filter((role) => canActOnRole(me, role)) : []), [me, roles]);
  const roleById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

  /** Self and more powerful users are managed elsewhere / not at all. */
  const canManage = (target: UserDto): boolean => {
    if (!me || target.id === me.id) return false;
    const role = roleById.get(target.role.id);
    return role ? canActOnRole(me, role) : !target.role.isSystem || me.role.isSystem;
  };

  const onSaved = (saved: UserDto) => {
    setNotice(formState.user ? `Pengguna ${saved.name} diperbarui.` : `Pengguna ${saved.name} ditambahkan.`);
    setFormState({ open: false });
    reload();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await usersService.deleteUser(deleteTarget.id);
      setNotice(`Pengguna ${deleteTarget.name} dihapus.`);
      setDeleteTarget(null);
      reload();
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Pengguna"
        description="Kelola akun pengguna beserta role dan status aksesnya."
        actions={
          canCreate && (
            <Button onClick={() => setFormState({ open: true })}>
              <Icon name="plus" className="size-4" /> Tambah pengguna
            </Button>
          )
        }
      />

      {notice && (
        <Alert variant="success" className="mb-4">
          {notice}
        </Alert>
      )}

      <div className="relative mb-4 max-w-sm">
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Cari nama atau email…"
          aria-label="Cari pengguna"
          maxLength={100}
          className="block w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm focus:border-primary-500 focus:outline-2 focus:outline-primary-100"
        />
      </div>

      {loadError ? (
        <Alert>{loadError}</Alert>
      ) : !data && loading ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="size-7" />
        </div>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon="users"
          title={search ? 'Tidak ada hasil' : 'Belum ada pengguna'}
          description={search ? `Tidak ada pengguna yang cocok dengan “${search}”.` : undefined}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">Pengguna</th>
                  <th scope="col" className="hidden px-4 py-3 sm:table-cell">Role</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="hidden px-4 py-3 lg:table-cell">Login terakhir</th>
                  <th scope="col" className="px-4 py-3 text-right">
                    <span className="sr-only">Aksi</span>
                  </th>
                </tr>
              </thead>
              <tbody className={loading ? 'divide-y divide-slate-100 opacity-60' : 'divide-y divide-slate-100'}>
                {data?.items.map((user) => {
                  const manageable = canManage(user);
                  const isMe = user.id === me?.id;
                  return (
                    <tr key={user.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="hidden size-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-semibold text-primary-700 sm:flex">
                            {initials(user.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">
                              {user.name} {isMe && <span className="text-xs font-normal text-slate-400">(Anda)</span>}
                            </p>
                            <p className="truncate text-xs text-slate-500">{user.email}</p>
                            <p className="mt-1 sm:hidden">
                              <Badge color={user.role.isSystem ? 'violet' : 'gray'}>{user.role.name}</Badge>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <Badge color={user.role.isSystem ? 'violet' : 'gray'}>{user.role.name}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={user.isActive ? 'green' : 'red'}>{user.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
                      </td>
                      <td className="hidden px-4 py-3 whitespace-nowrap text-slate-500 lg:table-cell">
                        {formatDateTime(user.lastLoginAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {isMe ? (
                            <Link to="/profile" className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
                              Profil
                            </Link>
                          ) : (
                            manageable && (
                              <>
                                {canUpdate && (
                                  <>
                                    <Button variant="ghost" size="icon" title="Ubah" aria-label={`Ubah ${user.name}`} onClick={() => setFormState({ open: true, user })}>
                                      <Icon name="edit" className="size-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" title="Reset password" aria-label={`Reset password ${user.name}`} onClick={() => setResetTarget(user)}>
                                      <Icon name="key" className="size-4" />
                                    </Button>
                                  </>
                                )}
                                {canDelete && (
                                  <Button
                                    variant="dangerGhost"
                                    size="icon"
                                    title="Hapus"
                                    aria-label={`Hapus ${user.name}`}
                                    onClick={() => {
                                      setDeleteError(null);
                                      setDeleteTarget(user);
                                    }}
                                  >
                                    <Icon name="trash" className="size-4" />
                                  </Button>
                                )}
                              </>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-500 sm:flex-row">
            <span>
              {from}–{to} dari {total} pengguna
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                <Icon name="chevronLeft" className="size-4" /> Sebelumnya
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
                Berikutnya <Icon name="chevronRight" className="size-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      <UserFormModal
        open={formState.open}
        user={formState.user}
        roles={assignableRoles}
        onClose={() => setFormState({ open: false })}
        onSaved={onSaved}
      />
      <ResetPasswordModal
        user={resetTarget}
        onClose={() => setResetTarget(null)}
        onDone={() => {
          setNotice(`Password ${resetTarget?.name ?? 'pengguna'} berhasil direset.`);
          setResetTarget(null);
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Hapus pengguna?"
        message={
          <>
            Akun <strong>{deleteTarget?.name}</strong> ({deleteTarget?.email}) akan dihapus permanen. Tindakan ini tidak
            dapat dibatalkan. Untuk menonaktifkan sementara, ubah status akun menjadi nonaktif.
          </>
        }
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
