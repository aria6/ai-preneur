import {
  BANK_IDEA_CRITERIA,
  BANK_IDEA_MARKET_SCOPE_LABELS,
  BANK_IDEA_RUBRIC,
  type BankIdeaMarketScope,
} from '@ai-preneur/shared';

const ANCHOR_RANGES = ['1–2', '3–4', '5–6', '7–8', '9–10'] as const;

export interface ResearchPromptInput {
  title: string;
  summary: string;
  problem: string;
  solution: string;
  marketScope: BankIdeaMarketScope;
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
Riset siapa saja calon pembeli potensial ide ini, lalu tentukan 2–4 segmen yang paling menjanjikan, diurutkan dari yang terbaik (paling besar, paling mau bayar, paling mudah dijangkau). Dasarkan pada data, bukan tebakan.
Segmen pertama dipakai untuk menghitung SEMUA skor di bawah, dan seluruh isi "summary" (kesimpulan, kekuatan, risiko, langkah validasi) juga WAJIB ditulis untuk segmen pertama itu, bukan untuk ide secara umum.
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
    { "segment": "segmen terbaik (dipakai untuk semua skor)", "reason": "kenapa segmen ini, 2–4 kalimat dengan data", "sizeEstimate": "perkiraan ukuran dengan satuan, atau null", "sources": [{ "title": "...", "url": "https://..." }] },
    { "segment": "segmen potensial berikutnya", "reason": "...", "sizeEstimate": "... atau null", "sources": [] }
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
{ "targetSegments": [{ "segment": "...", "reason": "...", "sizeEstimate": "... atau null", "sources": [] }], "criteria": { "<key>": { "score": 1-10, "confidence": "low|medium|high", "reason": "...", "sources": [{ "title": "...", "url": "..." }] } }, "competitors": [{ "name": "...", "url": "... atau null", "note": "..." }], "summary": { "verdict": "...", "strengths": [], "risks": [], "nextSteps": [] } }
Key kriteria: ${BANK_IDEA_CRITERIA.join(', ')}. Pakai hanya nilai yang ada di teks; jangan mengarang skor untuk kriteria yang tidak ada.
Balas HANYA dengan JSON-nya.

<teks>
${brokenOutput}
</teks>`;
}
