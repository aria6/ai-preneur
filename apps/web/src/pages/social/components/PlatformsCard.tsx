import {
  AVAILABLE_SOCIAL_PLATFORMS,
  connectInstagramRequestSchema,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORMS,
  type BatchDetailDto,
  type InstagramAccountOption,
  type SocialAccountDto,
  type SocialPlatform,
} from '@ai-preneur/shared';
import { useState, type FormEvent } from 'react';

import { Button } from '../../../components/ui/Button';
import { PasswordField, SelectField } from '../../../components/ui/fields';
import { Alert, Badge, Card } from '../../../components/ui/feedback';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { cn } from '../../../lib/cn';
import { apiFieldErrors, errorMessage, zodFieldErrors } from '../../../lib/errors';
import * as socialService from '../../../services/social.service';
import { PLATFORM_SHORT } from './PlatformChip';

function InstagramAccountPanel({
  batch,
  account,
  editable,
  onChange,
  onNotice,
}: {
  batch: BatchDetailDto;
  account: SocialAccountDto | undefined;
  editable: boolean;
  onChange: (batch: BatchDetailDto) => void;
  onNotice: (message: string) => void;
}) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  /** Accounts of a token that reaches several (business portfolio); null = not tested yet. */
  const [options, setOptions] = useState<InstagramAccountOption[] | null>(null);
  const [selectedId, setSelectedId] = useState('');

  const changeToken = (value: string) => {
    setToken(value);
    setOptions(null);
    setSelectedId('');
  };

  const finishConnect = async (accessToken: string, instagramAccountId?: string) => {
    const updated = await socialService.connectInstagram(batch.id, accessToken, instagramAccountId);
    setToken('');
    setOptions(null);
    setSelectedId('');
    onChange(updated);
    onNotice('Akun Instagram terhubung.');
  };

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = connectInstagramRequestSchema.safeParse({ accessToken: token });
    if (!parsed.success) {
      setError(zodFieldErrors(parsed.error).accessToken ?? 'Access token tidak valid.');
      return;
    }
    if (options && !selectedId) {
      setError('Pilih akun Instagram yang akan dihubungkan.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { accessToken } = parsed.data;
      if (options) {
        await finishConnect(accessToken, selectedId);
        return;
      }
      const accounts = await socialService.lookupInstagramAccounts(batch.id, accessToken);
      const [only] = accounts;
      if (accounts.length === 1 && only) {
        await finishConnect(accessToken, only.id);
        return;
      }
      setOptions(accounts);
      setSelectedId(accounts.find((option) => !option.usedByOtherBatch)?.id ?? '');
    } catch (err) {
      const fields = apiFieldErrors(err);
      setError(fields.accessToken ?? fields.instagramAccountId ?? errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      onChange(await socialService.disconnectAccount(batch.id, 'instagram'));
      onNotice('Akun Instagram diputus.');
      setConfirmDisconnect(false);
    } catch (err) {
      setError(errorMessage(err));
      setConfirmDisconnect(false);
    } finally {
      setDisconnecting(false);
    }
  };

  if (account) {
    return (
      <div className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">
            @{account.username ?? account.externalAccountId}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <Badge color={account.status === 'connected' ? 'green' : 'red'}>
              {account.status === 'connected' ? 'Terhubung' : 'Bermasalah'}
            </Badge>
            {account.accountType && (
              <span>Akun {account.accountType.toLowerCase().replace('_', ' ')}</span>
            )}
          </p>
          {account.lastError && <p className="mt-1 text-xs text-red-600">{account.lastError}</p>}
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        {editable && (
          <Button variant="dangerGhost" size="sm" onClick={() => setConfirmDisconnect(true)}>
            Putuskan
          </Button>
        )}
        <ConfirmDialog
          open={confirmDisconnect}
          title="Putuskan akun Instagram?"
          message="Token akun akan dihapus dari ide ini. Akun lalu bisa dipakai untuk ide lain."
          confirmLabel="Putuskan"
          loading={disconnecting}
          onConfirm={() => void disconnect()}
          onClose={() => setConfirmDisconnect(false)}
        />
      </div>
    );
  }

  if (!editable) {
    return <p className="mt-3 text-sm text-slate-500">Belum ada akun Instagram yang terhubung.</p>;
  }

  return (
    <form
      onSubmit={connect}
      noValidate
      className="mt-3 space-y-3 rounded-lg border border-slate-200 p-3"
    >
      <PasswordField
        label="Access token Instagram"
        autoComplete="off"
        value={token}
        onChange={(event) => changeToken(event.target.value)}
        error={options ? undefined : (error ?? undefined)}
        hint="Token disimpan terenkripsi dan tidak pernah ditampilkan lagi. Satu akun hanya untuk satu ide."
      />
      {options && (
        <SelectField
          label="Akun Instagram"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          error={error ?? undefined}
          hint="Token ini bisa mengakses beberapa akun. Pilih akun untuk ide ini."
        >
          <option value="" disabled>
            Pilih akun…
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id} disabled={option.usedByOtherBatch}>
              @{option.username}
              {option.usedByOtherBatch ? ' — sudah dipakai ide lain' : ''}
            </option>
          ))}
        </SelectField>
      )}
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer font-medium text-primary-700">
          Cara mendapatkan access token
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Pastikan akun Instagram berjenis Profesional (Bisnis atau Kreator).</li>
          <li>
            Buat business portfolio di Meta Business Suite, lalu tambahkan akun Instagram ke
            portfolio tersebut.
          </li>
          <li>
            Di Meta for Developers, buat app dengan kasus penggunaan &quot;Kelola pesan &amp; konten
            di Instagram&quot; dan hubungkan ke business portfolio.
          </li>
          <li>
            Buka Kasus penggunaan → Sesuaikan → API setup with Unified login, lalu buat konfigurasi
            (token pengguna sistem, tidak kedaluwarsa, aset akun Instagram, izin instagram_basic dan
            instagram_content_publish).
          </li>
          <li>
            Tambahkan akun sebagai Penguji Instagram di Peran aplikasi, lalu terima undangannya di
            instagram.com/accounts/manage_access.
          </li>
          <li>Di langkah &quot;Buat token akses&quot;, klik Tambahkan akun lalu buat token.</li>
          <li>
            Salin token (berawalan EAA…), tempel di sini, lalu klik Tes & hubungkan. Token lama dari
            &quot;API dengan login Instagram&quot; (berawalan IG…) juga tetap bisa dipakai.
          </li>
        </ol>
      </details>
      <div className="flex justify-end gap-2">
        {options && (
          <Button type="button" variant="ghost" size="sm" onClick={() => changeToken(token)}>
            Batal
          </Button>
        )}
        <Button type="submit" size="sm" loading={saving}>
          {options ? 'Hubungkan' : 'Tes & hubungkan'}
        </Button>
      </div>
    </form>
  );
}

export function PlatformsCard({
  batch,
  canManage,
  onChange,
  onNotice,
}: {
  batch: BatchDetailDto;
  canManage: boolean;
  onChange: (batch: BatchDetailDto) => void;
  onNotice: (message: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<SocialPlatform | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<SocialPlatform | null>(null);

  const isDraft = batch.status === 'draft';
  const editable = canManage && isDraft;

  const setPlatform = async (platform: SocialPlatform, checked: boolean) => {
    const platforms = checked
      ? [...batch.platforms, platform]
      : batch.platforms.filter((p) => p !== platform);
    setError(null);
    setSaving(platform);
    try {
      onChange(await socialService.updateBatch(batch.id, { platforms }));
    } catch (err) {
      setError(apiFieldErrors(err).platforms ?? errorMessage(err));
    } finally {
      setSaving(null);
      setConfirmRemove(null);
    }
  };

  const onToggle = (platform: SocialPlatform, checked: boolean) => {
    const connected = batch.accounts.some((account) => account.platform === platform);
    if (!checked && connected) setConfirmRemove(platform);
    else void setPlatform(platform, checked);
  };

  return (
    <Card>
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold">Media sosial</h2>
        <p className="text-sm text-slate-500">
          Pilih tujuan unggah. Setiap media sosial memakai satu akun khusus untuk ide ini.
        </p>
      </div>
      <div className="space-y-3 px-5 py-4">
        {error && <Alert>{error}</Alert>}
        {!isDraft && canManage && (
          <Alert variant="info">Media sosial dan akun hanya bisa diubah saat Draft.</Alert>
        )}
        <ul className="space-y-3">
          {SOCIAL_PLATFORMS.map((platform) => {
            const available = AVAILABLE_SOCIAL_PLATFORMS.includes(platform);
            const checked = batch.platforms.includes(platform);
            const account = batch.accounts.find((a) => a.platform === platform);
            return (
              <li
                key={platform}
                className={cn(
                  'rounded-lg border p-3',
                  checked ? 'border-primary-200 bg-primary-50/40' : 'border-slate-200',
                )}
              >
                <label
                  className={cn(
                    'flex items-center gap-3',
                    editable && available ? 'cursor-pointer' : 'cursor-default',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 rounded border-slate-300 accent-primary-600"
                    checked={checked}
                    disabled={!editable || !available || saving !== null}
                    onChange={(event) => onToggle(platform, event.target.checked)}
                  />
                  <span className="flex size-7 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600">
                    {PLATFORM_SHORT[platform]}
                  </span>
                  <span className="flex-1 text-sm font-medium text-slate-800">
                    {SOCIAL_PLATFORM_LABELS[platform]}
                  </span>
                  {!available && <Badge>Segera hadir</Badge>}
                </label>
                {checked && platform === 'instagram' && (
                  <InstagramAccountPanel
                    batch={batch}
                    account={account}
                    editable={editable}
                    onChange={onChange}
                    onNotice={onNotice}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Hapus media sosial ini?"
        message="Akun yang terhubung untuk media sosial ini akan diputus dari ide ini."
        confirmLabel="Hapus"
        loading={saving !== null}
        onConfirm={() => confirmRemove && void setPlatform(confirmRemove, false)}
        onClose={() => setConfirmRemove(null)}
      />
    </Card>
  );
}
