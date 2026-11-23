import { updateSocialSettingsRequestSchema, type SocialSettings } from '@ai-preneur/shared';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/fields';
import { Alert, Card, PageHeader } from '../../components/ui/feedback';
import { Spinner } from '../../components/ui/Spinner';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../../lib/errors';
import * as socialService from '../../services/social.service';

/** Social Media AIgency → Pengaturan. */
export function SocialSettingsPage() {
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [lockMinutes, setLockMinutes] = useState('');
  const [leadMinutes, setLeadMinutes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    socialService
      .getSocialSettings(controller.signal)
      .then((loaded) => {
        setSettings(loaded);
        setLockMinutes(String(loaded.lockMinutes));
        setLeadMinutes(String(loaded.minConfirmLeadMinutes));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setStatus({ type: 'error', message: errorMessage(error) });
      });
    return () => controller.abort();
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    const parsed = updateSocialSettingsRequestSchema.safeParse({
      lockMinutes: Number(lockMinutes),
      minConfirmLeadMinutes: Number(leadMinutes),
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const saved = await socialService.updateSocialSettings(parsed.data);
      setSettings(saved);
      setStatus({ type: 'success', message: 'Pengaturan disimpan.' });
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setStatus({ type: 'error', message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Pengaturan" description="Social Media AIgency" />

      {!settings && !status ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="size-7" />
        </div>
      ) : (
        <Card className="max-w-2xl">
          <form onSubmit={onSubmit} noValidate>
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold">Publisher AIgent</h2>
              <p className="text-sm text-slate-500">
                Aturan waktu untuk antrean dan konfirmasi jadwal.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              {status && <Alert variant={status.type}>{status.message}</Alert>}
              <TextField
                label="Batas kunci edit (menit)"
                type="number"
                min={5}
                max={1440}
                inputMode="numeric"
                value={lockMinutes}
                onChange={(event) => setLockMinutes(event.target.value)}
                error={errors.lockMinutes}
                hint="Baris tidak bisa diubah, dipindah, ditunda, atau dihapus jika jadwal unggahnya kurang dari angka ini."
                disabled={!settings}
              />
              <TextField
                label="Jeda minimal konfirmasi (menit)"
                type="number"
                min={5}
                max={10080}
                inputMode="numeric"
                value={leadMinutes}
                onChange={(event) => setLeadMinutes(event.target.value)}
                error={errors.minConfirmLeadMinutes}
                hint="Saat konfirmasi jadwal, konten pertama harus dijadwalkan minimal sejauh ini dari sekarang. Tidak boleh lebih kecil dari batas kunci edit."
                disabled={!settings}
              />
            </div>
            <div className="flex justify-end border-t border-slate-100 px-5 py-3">
              <Button type="submit" loading={saving} disabled={!settings}>
                Simpan
              </Button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
