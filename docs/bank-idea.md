# Bank Idea

Menampung semua ide, merapikan ide mentah dengan AI, lalu meriset tiap ide di web
(tren, ukuran pasar, kompetitor, monetisasi) menjadi **skor 0–100 + alasan + sumber**.

- Menu: **Bank Idea** (menu utama di sidebar) → `/bank-idea`, `/bank-idea/baru`, `/bank-idea/:id`
- Backend: `apps/api/src/modules/bank-idea/` · API: `/api/bank-ideas`
- Tabel: `bank_ideas`, `bank_idea_research_runs` (`packages/database/src/schema/bank-idea.schema.ts`)
- Kontrak + rubrik: `packages/shared/src/schemas/bank-idea.ts`

## Alur

1. **Ide mentah** → "Rapikan dengan AI" (tanpa web) → draf: judul, ringkasan, masalah,
   solusi. Bisa juga "Isi manual".
2. User mengedit → **Simpan** atau **Simpan & Riset**.
3. Riset masuk **antrean**; worker menjalankan **1 riset sekaligus** di seluruh platform.
4. Hasil disimpan per **versi** (riset ulang = versi baru, versi lama tetap ada).

Cakupan pasar per ide: Indonesia (default) atau Global. Status: Baru → Diriset (otomatis setelah riset
pertama berhasil) → Dieksekusi (manual). Arsip = read-only; Hapus permanen menghapus ide + riwayatnya.
Mengubah isi ide setelah riset menandai "Berubah sejak riset".

## Target pasar

Ide tidak punya isian target pasar. Setiap riset dimulai dengan mencari 2–4 **target pasar potensial**.
Tiap segmen diberi **skor saringan**: Ukuran, Kemauan bayar, Kemudahan dijangkau, Persaingan (1–10, bobot
sama; rata-rata dihitung backend). Daftar diurutkan dari skor saringan tertinggi.

- AI menaruh segmen dengan saringan tertinggi pertama dan menilai segmen itu lengkap (9 sub-poin + kesimpulan,
  kekuatan, risiko, langkah validasi) → `scored: true`, tampil sebagai "Dihitung untuk".
- **Riset lengkap untuk segmen ini** (modal Target pasar potensial): riset baru yang dikunci ke satu segmen
  (`bank_idea_research_runs.focus_segment`, body `{ focusSegment }`), masuk riwayat sebagai versi baru.
  Segmen yang sudah punya riset lengkap menampilkan "Lihat hasil vN" untuk membandingkan.
- `result.targetSegments`; riset lama tidak punya skor saringan (segmen pertama dianggap yang dinilai).

## Segmen per ide & kesimpulan gabungan

- **Daftar segmen per ide** = gabungan segmen dari semua versi yang berhasil (`domain/segments.ts`),
  disatukan dengan `bankIdeaSegmentKey` (huruf besar-kecil, spasi, gaya tanda hubung, tanda baca akhir).
  Setiap riset diberi daftar segmen yang sudah ada dan wajib memakai teks persis untuk segmen yang sama;
  backend juga menyamakan teks yang cocok ke teks lama. Segmen baru boleh bertambah.
- **Tampilan Gabungan | Per versi** (default Gabungan jika ≥2 versi berhasil): kesimpulan gabungan +
  tabel perbandingan segmen (saringan terbaru, skor lengkap terbaru, "Lihat vN" / "Riset").
- **Kesimpulan gabungan** (`POST /:id/synthesis`, izin research): AI tanpa web membaca semua versi →
  segmen yang direkomendasikan (harus salah satu dari daftar), kesimpulan, kekuatan, risiko, langkah
  validasi, catatan. Dibuat manual, jalan di background (kolom `synthesis_*` di `bank_ideas`, migrasi 0011),
  1 sekaligus; ditandai "ada riset baru" jika ada versi berhasil yang lebih baru.

## Halaman detail

Kolom utama = ringkasan: skor + label + "Dihitung untuk: segmen #1" + kesimpulan, 4 bar dimensi,
kekuatan / risiko / langkah validasi (semuanya di kartu skor, ditulis untuk segmen #1). "Lihat detail
penilaian" di kartu skor membuka modal 9 sub-poin.
Panel kanan "Lihat detail" membuka modal: Target pasar potensial, Kompetitor, Isi ide.

## Skoring (rubrik v1)

AI hanya memberi skor 1–10 untuk 9 sub-poin, plus alasan, sumber, dan tingkat keyakinan. **Semua
perhitungan dilakukan backend** (`domain/scoring.ts`), jadi deterministik.

| Dimensi (bobot)     | Sub-poin                                                    |
| ------------------- | ----------------------------------------------------------- |
| Tren & Timing (25%) | Arah tren · Momentum                                        |
| Ukuran Pasar (20%)  | Besar pasar · Pertumbuhan pasar                             |
| Kompetisi (25%)     | Celah pasar (makin kosong makin tinggi) · Diferensiasi      |
| Monetisasi (30%)    | Kemauan bayar · Model & harga · Waktu ke pendapatan pertama |

- Skor dimensi = rata-rata sub-poin (1 desimal).
- **Total = Σ(skor dimensi × bobot) × 10** → 0–100.
- Label: ≥75 **Layak dieksekusi**, 50–74 **Perlu validasi**, <50 **Simpan dulu**.
- **Red flag**: dimensi ≤3 → label paling tinggi "Perlu validasi".
- Tiap angka 1–10 punya patokan tertulis (`BANK_IDEA_RUBRIC`) yang ikut dikirim ke AI.
- Mengubah rubrik/bobot: naikkan `BANK_IDEA_RUBRIC_VERSION`; hasil lama menyimpan versi rubriknya.

## AI provider: Claude Code CLI

`ai/claude-cli.runner.ts` menjalankan:

```text
claude -p "<prompt>" --output-format json --max-turns N [--allowedTools=WebSearch,WebFetch] [--model X]
```

di folder kosong (`$TMPDIR/ai-preneur-bank-idea`), hanya dengan tool web. Output JSON divalidasi Zod;
kalau rusak, ada 1× perbaikan murah tanpa tool. Hanya URL http(s) yang disimpan.

Prompt, parsing, dan skoring tidak bergantung provider (`ai/llm-runner.ts`), jadi pindah ke Anthropic API
nanti cukup menambah `LlmRunner` baru + nilai `BANK_IDEA_AI_PROVIDER`.

### Setup di VPS

1. Pasang Claude Code dan login sekali sebagai **user OS yang menjalankan API** (`claude`, lalu `/login`).
   Riset memakai kuota akun itu. Jika `ANTHROPIC_API_KEY` ada di environment API, CLI memakai API key itu.
2. `pnpm db:migrate` lalu `pnpm db:seed` (sinkron 3 permission baru: `bank_idea.view`, `.manage`, `.research`).
3. Env (lihat `.env.example`): `BANK_IDEA_WORKER_ENABLED`, `BANK_IDEA_CLAUDE_BIN`, `BANK_IDEA_CLAUDE_MODEL`,
   `BANK_IDEA_RESEARCH_TIMEOUT_MINUTES` (default 15).

## Worker

`research.worker.ts` — in-process, polling PostgreSQL (tanpa Redis/queue):

- Index unik parsial menjamin **1 riset `running` global** dan **1 riset aktif per ide**.
- Heartbeat tiap 30 dtk; run tanpa heartbeat >3 mnt (server mati) dikembalikan ke antrean, gagal setelah 2 kali.
- Server berhenti dengan rapi → riset yang berjalan dihentikan dan dikembalikan ke antrean.
- "Batalkan riset": antre → dibatalkan; berjalan → proses CLI dihentikan.
