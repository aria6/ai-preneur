import {
  BANK_IDEA_RAW_MAX_LENGTH,
  bankIdeaRawInputSchema,
  createBankIdeaRequestSchema,
  PERMISSIONS,
} from '@ai-preneur/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { Button } from '../../components/ui/Button';
import { TextAreaField } from '../../components/ui/fields';
import { Alert, Card, PageHeader } from '../../components/ui/feedback';
import { Icon } from '../../components/ui/Icon';
import { useAuth } from '../../hooks/use-auth';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../../lib/errors';
import * as bankIdeaService from '../../services/bank-idea.service';
import { EMPTY_IDEA_FORM, IdeaFields, type IdeaFormValues } from './bank-idea-ui';

export function BankIdeaCreatePage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canResearch = can(PERMISSIONS.BANK_IDEA_RESEARCH);

  const [rawInput, setRawInput] = useState('');
  const [rawError, setRawError] = useState<string | undefined>();
  const [structuring, setStructuring] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);

  /** Shown once the raw text was tidied by AI or the user chose to fill it in by hand. */
  const [form, setForm] = useState<IdeaFormValues | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'save' | 'research' | null>(null);

  const tidy = async () => {
    setStructureError(null);
    const parsed = bankIdeaRawInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      setRawError(parsed.error.issues[0]?.message);
      return;
    }
    setRawError(undefined);
    setStructuring(true);
    try {
      const draft = await bankIdeaService.structureIdea(parsed.data);
      setForm({ ...draft, marketScope: form?.marketScope ?? 'indonesia' });
      setErrors({});
    } catch (error) {
      setStructureError(errorMessage(error));
    } finally {
      setStructuring(false);
    }
  };

  const save = async (research: boolean) => {
    if (!form) return;
    setFormError(null);
    const parsed = createBankIdeaRequestSchema.safeParse({ ...form, rawInput, research });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(research ? 'research' : 'save');
    try {
      const idea = await bankIdeaService.createIdea(parsed.data);
      navigate(`/bank-idea/${idea.id}`);
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
      setSaving(null);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(false);
  };

  return (
    <>
      <Link
        to="/bank-idea"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <Icon name="chevronLeft" className="size-4" /> Bank Idea
      </Link>
      <PageHeader
        title="Tambah ide"
        description="Tempel ide mentah apa adanya, rapikan dengan AI, periksa hasilnya, lalu simpan."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold text-slate-900">1. Ide mentah</h2>
          <TextAreaField
            label="Tulis atau tempel idenya"
            rows={10}
            placeholder="Contoh: kepikiran bikin kit hidroponik buat rumah di kota, dijual bareng kelas online, targetnya ibu rumah tangga & pekerja WFH…"
            value={rawInput}
            onChange={(event) => setRawInput(event.target.value)}
            error={rawError}
            maxLength={BANK_IDEA_RAW_MAX_LENGTH}
            hint={`${rawInput.length.toLocaleString('id-ID')}/${BANK_IDEA_RAW_MAX_LENGTH.toLocaleString('id-ID')} karakter`}
          />
          {structureError && <Alert className="mt-3">{structureError}</Alert>}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {canResearch && (
              <Button onClick={() => void tidy()} loading={structuring}>
                <Icon name="sparkles" className="size-4" /> Rapikan dengan AI
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={structuring}
              onClick={() => {
                setForm((current) => current ?? { ...EMPTY_IDEA_FORM });
                setErrors({});
              }}
            >
              Isi manual
            </Button>
          </div>
          {canResearch && (
            <p className="mt-3 text-xs text-slate-500">
              Merapikan tidak memakai web dan biasanya selesai dalam beberapa detik, tapi tetap
              memakai kuota Claude.
            </p>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold text-slate-900">2. Periksa & simpan</h2>
          {form ? (
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              {formError && <Alert>{formError}</Alert>}
              <IdeaFields values={form} onChange={setForm} errors={errors} />
              <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                <Button
                  type="submit"
                  variant="secondary"
                  loading={saving === 'save'}
                  disabled={saving !== null}
                >
                  Simpan
                </Button>
                {canResearch && (
                  <Button
                    onClick={() => void save(true)}
                    loading={saving === 'research'}
                    disabled={saving !== null}
                  >
                    <Icon name="search" className="size-4" /> Simpan & Riset
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <p className="py-10 text-center text-sm text-slate-500">
              Hasil rapikan muncul di sini. Pilih “Isi manual” untuk mengisi sendiri.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
