import {
  BANK_IDEA_CRITERIA,
  BANK_IDEA_MARKET_SCOPE_LABELS,
  BANK_IDEA_RUBRIC,
  BANK_IDEA_SCREENING_DEFINITIONS,
  type BankIdeaMarketScope,
} from '@ai-preneur/shared';

const ANCHOR_RANGES = ['1–2', '3–4', '5–6', '7–8', '9–10'] as const;

export interface ResearchPromptInput {
  title: string;
  summary: string;
  problem: string;
  solution: string;
  marketScope: BankIdeaMarketScope;
  /** Locked target market ("Riset lengkap untuk segmen ini"), or null. */
  focusSegment: string | null;
  /** Target markets the idea already has (from earlier versions), to reuse their wording. */
  existingSegments: readonly string[];
}

export function structurePrompt(rawInput: string): string {
  return `Kamu membantu merapikan ide bisnis mentah menjadi ide terstruktur, dalam Bahasa Indonesia.
Jangan memakai tool apa pun. Jangan menambah fakta, angka, atau klaim yang tidak ada di teks; boleh merumuskan ulang agar jelas.

Teks ide mentah (di antara tanda <ide>):
<ide>
${rawInput}
</ide>

Balas HANYA dengan satu objek JSON (tanpa teks lain, tanpa markdown) dengan format:
{
  "title": "judul singkat dan jelas, maksimal 120 karakter",
  "summary": "ringkasan ide 2–4 kalimat (sertakan calon pembeli jika disebut di teks)",
  "problem": "masalah yang diselesaikan (kosongkan \\"\\" jika tidak disebut)",
  "solution": "solusi/produk yang ditawarkan (kosongkan jika tidak disebut)"
}`;
}

export function researchPrompt(idea: ResearchPromptInput, today: string): string {
  const scope =
    idea.marketScope === 'indonesia'
      ? 'Indonesia. Utamakan sumber dan data Indonesia (mis. BPS, kementerian, asosiasi industri, media bisnis Indonesia, laporan riset pasar tentang Indonesia). Pakai data global hanya sebagai pembanding dan sebutkan bahwa itu data global.'
      : 'Global. Gunakan data pasar global, sebutkan wilayah datanya bila relevan.';

  const rubric = BANK_IDEA_RUBRIC.map((dimension) => {
    const criteria = dimension.criteria
      .map((criterion) => {
        const anchors = criterion.anchors
          .map((anchor, i) => `      ${ANCHOR_RANGES[i]}: ${anchor}`)
          .join('\n');
        return `  - "${criterion.key}" (${criterion.label}): ${criterion.question}\n${anchors}`;
      })
      .join('\n');
    return `${dimension.label}:\n${criteria}`;
  }).join('\n\n');

  const screening = BANK_IDEA_SCREENING_DEFINITIONS.map(
    (c) => `  - "${c.key}" (${c.label}): ${c.question}`,
  ).join('\n');
  const screeningExample = `{ ${BANK_IDEA_SCREENING_DEFINITIONS.map((c) => `"${c.key}": 1-10`).join(', ')} }`;
  const targetTask = idea.focusSegment
    ? `Target pasar riset ini SUDAH DITENTUKAN: "${idea.focusSegment}". Taruh segmen ini sebagai item PERTAMA "targetSegments" dengan teks "segment" persis sama. Tambahkan 1–3 segmen potensial lain sebagai pembanding.`
    : `Riset siapa saja calon pembeli potensial ide ini, lalu tentukan 2–4 segmen yang paling menjanjikan. Hitung skor saringan tiap segmen; segmen dengan rata-rata skor saringan TERTINGGI ditaruh PERTAMA di "targetSegments".`;
  const existing =
    idea.existingSegments.length > 0
      ? `\nSegmen yang SUDAH ADA di ide ini (dari riset sebelumnya):\n${idea.existingSegments
          .map((segment) => `  - "${segment}"`)
          .join(
            '\n',
          )}\nJika segmen yang kamu maksud sama atau sangat mirip dengan salah satu di atas, WAJIB pakai teks "segment" yang PERSIS sama (jangan ditulis ulang dengan kata lain). Segmen baru hanya boleh ditambahkan jika benar-benar berbeda.`
      : '';
  const firstSegmentExample = idea.focusSegment
    ? JSON.stringify(idea.focusSegment)
    : '"segmen dengan skor saringan tertinggi (dipakai untuk semua skor)"';

  const criteriaExample = BANK_IDEA_CRITERIA.map(
    (key) =>
      `    "${key}": { "score": 1-10, "confidence": "low|medium|high", "reason": "...", "sources": [{ "title": "...", "url": "https://..." }] }`,
  ).join(',\n');

  return `Kamu analis riset pasar. Tanggal hari ini: ${today}.
Tugas: riset ide bisnis di bawah ini di web lalu nilai dengan rubrik yang diberikan. Tulis semua teks dalam Bahasa Indonesia.

IDE
- Judul: ${idea.title}
- Ringkasan: ${idea.summary}
- Masalah: ${idea.problem || '(tidak disebut)'}
- Solusi: ${idea.solution || '(tidak disebut)'}

CAKUPAN PASAR: ${BANK_IDEA_MARKET_SCOPE_LABELS[idea.marketScope]} — ${scope}

TARGET PASAR (langkah pertama)
${targetTask}${existing}
Untuk SETIAP segmen, beri skor saringan 1–10 (dasarkan pada data, bukan tebakan):
${screening}
Seluruh skor kriteria di bawah dan seluruh isi "summary" (kesimpulan, kekuatan, risiko, langkah validasi) WAJIB dihitung/ditulis untuk segmen PERTAMA di "targetSegments", bukan untuk ide secara umum.
Segmen yang baik itu spesifik (mis. "ibu rumah tangga 25–45 tahun di kota besar Jawa yang aktif belanja online"), bukan "semua orang". "sizeEstimate" = perkiraan jumlah/nilai segmen beserta satuannya, atau null jika tidak ada data.

CARA KERJA
1. Pakai WebSearch (dan WebFetch bila perlu membaca halaman) untuk mencari: tren minat/permintaan, ukuran dan pertumbuhan pasar, kompetitor yang ada beserta harganya, dan model monetisasi solusi serupa. Lakukan beberapa pencarian dengan sudut berbeda; utamakan data terbaru.
2. Jangan mengarang angka, nama perusahaan, atau URL. Setiap URL di "sources" harus berasal dari hasil pencarianmu. Jika data tidak ditemukan, katakan begitu di "reason" dan beri "confidence": "low".
3. Nilai setiap kriteria 1–10 memakai patokan di bawah. Jujur: skor tinggi hanya jika ada bukti. Untuk "market_gap", makin sedikit kompetitor yang memadai, makin tinggi skornya.
4. "confidence": high = beberapa sumber kredibel dan konsisten; medium = ada data tapi terbatas/tidak langsung; low = kebanyakan asumsi.
5. "reason": 2–4 kalimat, sebut angka/fakta kunci yang ditemukan.

RUBRIK
${rubric}

FORMAT JAWABAN
Balas HANYA dengan satu objek JSON (tanpa teks lain, tanpa markdown) persis dengan struktur ini:
{
  "criteria": {
${criteriaExample}
  },
  "targetSegments": [
    { "segment": ${firstSegmentExample}, "reason": "kenapa segmen ini, 2–4 kalimat dengan data", "sizeEstimate": "perkiraan ukuran dengan satuan, atau null", "screening": ${screeningExample}, "sources": [{ "title": "...", "url": "https://..." }] },
    { "segment": "segmen potensial lain", "reason": "...", "sizeEstimate": "... atau null", "screening": ${screeningExample}, "sources": [] }
  ],
  "competitors": [{ "name": "...", "url": "https://... atau null", "note": "apa yang mereka tawarkan, harga jika ada" }],
  "summary": {
    "verdict": "kesimpulan 2–3 kalimat untuk segmen #1",
    "strengths": ["kekuatan utama ide di segmen #1"],
    "risks": ["risiko terbesar ide di segmen #1"],
    "nextSteps": ["langkah validasi konkret dan murah untuk segmen #1: sebut ke siapa, di mana/lewat kanal apa, berapa lama, dan kriteria lolosnya (mis. 'pre-order 7 hari di 3 grup Facebook ibu-ibu urban farming Jabodetabek, lolos jika ≥10 pembeli')"]
  }
}
Isi semua ${BANK_IDEA_CRITERIA.length} kriteria. Maksimal 6 sumber per kriteria, maksimal 8 kompetitor, maksimal 5 butir per daftar di summary.`;
}

/** Asks (without tools) to turn a malformed answer into the requested JSON. */
export function repairPrompt(brokenOutput: string, problem: string): string {
  return `Teks di bawah seharusnya berupa satu objek JSON hasil riset ide, tetapi tidak valid: ${problem}.
Jangan memakai tool apa pun dan jangan menambah data baru. Ubah menjadi JSON valid dengan struktur:
{ "targetSegments": [{ "segment": "...", "reason": "...", "sizeEstimate": "... atau null", "screening": { "size": 1-10, "willingness_to_pay": 1-10, "reach": 1-10, "competition": 1-10 }, "sources": [] }], "criteria": { "<key>": { "score": 1-10, "confidence": "low|medium|high", "reason": "...", "sources": [{ "title": "...", "url": "..." }] } }, "competitors": [{ "name": "...", "url": "... atau null", "note": "..." }], "summary": { "verdict": "...", "strengths": [], "risks": [], "nextSteps": [] } }
Key kriteria: ${BANK_IDEA_CRITERIA.join(', ')}. Pakai hanya nilai yang ada di teks; jangan mengarang skor untuk kriteria yang tidak ada.
Balas HANYA dengan JSON-nya.

<teks>
${brokenOutput}
</teks>`;
}

export interface SynthesisPromptInput {
  title: string;
  summary: string;
  marketScopeLabel: string;
  runs: {
    version: number;
    segment: string;
    locked: boolean;
    totalScore: number;
    labelText: string;
    dimensions: string;
    verdict: string;
    strengths: string[];
    risks: string[];
    nextSteps: string[];
    competitors: string[];
  }[];
  segments: { segment: string; screening: string; full: string }[];
}

/** "Kesimpulan gabungan": one conclusion over every version, no tools. */
export function synthesisPrompt(input: SynthesisPromptInput): string {
  const runs = input.runs
    .map((run) =>
      [
        `### Versi ${run.version}: dihitung untuk "${run.segment}"${run.locked ? ' (segmen dipilih manual)' : ''}`,
        `Skor total ${run.totalScore}/100 (${run.labelText}). Dimensi: ${run.dimensions}.`,
        `Kesimpulan: ${run.verdict || '-'}`,
        `Kekuatan: ${run.strengths.join(' | ') || '-'}`,
        `Risiko: ${run.risks.join(' | ') || '-'}`,
        `Langkah validasi: ${run.nextSteps.join(' | ') || '-'}`,
        `Kompetitor: ${run.competitors.join(', ') || '-'}`,
      ].join('\n'),
    )
    .join('\n\n');
  const segments = input.segments
    .map((s) => `- "${s.segment}" — saringan ${s.screening}; riset lengkap ${s.full}`)
    .join('\n');

  return `Kamu analis bisnis. Jangan memakai tool apa pun dan jangan menambah data baru di luar yang diberikan.
Tugas: gabungkan semua versi riset ide di bawah menjadi SATU kesimpulan untuk pemilik ide yang ingin memutuskan apakah dan bagaimana menjalankan bisnis ini. Tulis dalam Bahasa Indonesia.

IDE: ${input.title}
Ringkasan: ${input.summary}
Cakupan pasar: ${input.marketScopeLabel}

DAFTAR TARGET PASAR (semua versi digabung)
${segments}

HASIL RISET PER VERSI
${runs}

ATURAN
1. "recommendedSegment": segmen yang paling layak dimulai, ditulis PERSIS sama dengan salah satu teks di DAFTAR TARGET PASAR. Utamakan segmen yang sudah diriset lengkap dengan skor tertinggi; boleh memilih yang lain jika alasannya kuat. null jika tidak ada yang layak.
2. "verdict": 2–4 kalimat: kenapa segmen itu, dan bagaimana posisi segmen lain (mis. cocok sebagai tahap berikutnya).
3. "strengths", "risks", "nextSteps": gabungan dari semua versi untuk segmen yang direkomendasikan, tanpa duplikat, masing-masing maksimal 4 butir. Langkah validasi harus konkret: ke siapa, lewat kanal apa, berapa lama, kriteria lolos.
4. "notes": maksimal 4 catatan penting: hasil yang bertentangan antar versi (sebut versinya), segmen di daftar yang sebenarnya sama, atau data yang tipis. [] jika tidak ada.

Balas HANYA dengan satu objek JSON:
{ "recommendedSegment": "... atau null", "verdict": "...", "strengths": [], "risks": [], "nextSteps": [], "notes": [] }`;
}
