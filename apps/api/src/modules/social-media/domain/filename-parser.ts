/**
 * Turns the files of a Google Drive folder into a draft content queue.
 * Pure functions — no I/O — so the rules are easy to test.
 *
 * Expected layout:
 *   <folder>/2.1-apa-akuaponik.mp4
 *   <folder>/2.2-model-akuaponik-part1.mp4
 *   <folder>/thumbnail/2.1-apa-akuaponik.png
 *   <folder>/caption/2.1-apa-akuaponik.txt
 *
 * File name pattern: `<IDEA_ID>.<TOPIC_ID>-<judul>[-part<N>]`
 */

export interface DriveFileRef {
  id: string;
  name: string;
  mimeType: string;
}

export interface ParsedMediaName {
  ideaNumber: number | null;
  topicNumber: number | null;
  partNumber: number | null;
  title: string;
  /** True when the name follows the `<IDEA>.<TOPIC>-<judul>` pattern. */
  matched: boolean;
}

export interface DraftQueueItem {
  position: number;
  topicNumber: number;
  partNumber: number | null;
  title: string;
  videoFileId: string;
  videoFileName: string;
  thumbnailFileId: string | null;
  thumbnailFileName: string | null;
  caption: string;
  hashtags: string[];
}

export interface QueueWarning {
  fileName: string;
  message: string;
}

const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm|mkv)$/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|webp)$/i;
const TEXT_EXTENSION = /\.txt$/i;
const ANY_EXTENSION = /\.[A-Za-z0-9]{1,5}$/;
const MAX_TITLE = 200;

export function isVideoFile(file: DriveFileRef): boolean {
  return file.mimeType.startsWith('video/') || VIDEO_EXTENSION.test(file.name);
}

export function isImageFile(file: DriveFileRef): boolean {
  return file.mimeType.startsWith('image/') || IMAGE_EXTENSION.test(file.name);
}

export function isTextFile(file: DriveFileRef): boolean {
  return file.mimeType === 'text/plain' || TEXT_EXTENSION.test(file.name);
}

export function baseName(fileName: string): string {
  return fileName.trim().replace(ANY_EXTENSION, '').trim();
}

/** "apa-akuaponik" → "Apa akuaponik" (original casing kept, first letter capitalized). */
export function humanizeSlug(slug: string): string {
  const text = slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'Tanpa judul';
  return (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, MAX_TITLE);
}

export function parseMediaName(fileName: string): ParsedMediaName {
  const base = baseName(fileName);

  const full = /^(\d{1,4})\.(\d{1,4})[-_ ]+(.+?)(?:[-_ ]+part[-_ ]?(\d{1,2}))?$/i.exec(base);
  if (full?.[1] && full[2] && full[3]) {
    return {
      ideaNumber: Number(full[1]),
      topicNumber: Number(full[2]),
      partNumber: full[4] ? Number(full[4]) : null,
      title: humanizeSlug(full[3]),
      matched: true,
    };
  }

  const loose = /^(.+?)(?:[-_ ]+part[-_ ]?(\d{1,2}))?$/i.exec(base);
  return {
    ideaNumber: null,
    topicNumber: null,
    partNumber: loose?.[2] ? Number(loose[2]) : null,
    title: humanizeSlug(loose?.[1] ?? base),
    matched: false,
  };
}

// ---- Caption files ------------------------------------------------------------------

/** Same limits as `captionSchema` / `hashtagsSchema` in @ai-preneur/shared. */
const MAX_CAPTION = 2200;
const MAX_HASHTAGS = 30;
const MAX_HASHTAG_LENGTH = 100;
const HASHTAG_LINE = /^(?:#[\p{L}\p{N}_]+[\s,]*)+$/u;
const HASHTAG = /#([\p{L}\p{N}_]+)/gu;

export interface ParsedCaption {
  caption: string;
  hashtags: string[];
  /** Human-readable problems, already in Indonesian. */
  warnings: string[];
}

/**
 * Splits a caption file into caption text and hashtags.
 *
 * Only the hashtag block at the **end** of the file (lines that contain nothing but
 * hashtags) moves to the hashtag list; hashtags inside a sentence stay in the caption
 * so the text still reads correctly. Hashtags are de-duplicated (case-insensitive) and
 * capped at 30; the caption is cut at 2.200 characters.
 */
export function parseCaptionText(raw: string): ParsedCaption {
  const warnings: string[] = [];
  const lines = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  // Walk up from the end: blank lines and hashtag-only lines form the hashtag block.
  let start = lines.length;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = (lines[i] ?? '').trim();
    if (line === '') continue;
    if (!HASHTAG_LINE.test(line)) break;
    start = i;
  }
  const tagBlock = lines.slice(start).join(' ');
  let caption = lines.slice(0, start).join('\n').trim();

  const seen = new Set<string>();
  const hashtags: string[] = [];
  let tooLong = 0;
  let overflow = 0;
  for (const match of tagBlock.matchAll(HASHTAG)) {
    const tag = match[1] ?? '';
    if (tag.length > MAX_HASHTAG_LENGTH) {
      tooLong += 1;
      continue;
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (hashtags.length < MAX_HASHTAGS) hashtags.push(tag);
    else overflow += 1;
  }
  if (tooLong > 0) {
    warnings.push(`${tooLong} hashtag lebih dari ${MAX_HASHTAG_LENGTH} karakter, dilewati.`);
  }
  if (overflow > 0) {
    warnings.push(
      `Hashtag lebih dari ${MAX_HASHTAGS}; ${overflow} hashtag terakhir tidak dipakai.`,
    );
  }

  if (caption.length > MAX_CAPTION) {
    warnings.push(
      `Caption ${caption.length.toLocaleString('id-ID')} karakter, dipotong menjadi ${MAX_CAPTION.toLocaleString('id-ID')}.`,
    );
    caption = caption.slice(0, MAX_CAPTION).trimEnd();
  }
  if (caption === '' && hashtags.length === 0) warnings.push('File caption kosong.');

  return { caption, hashtags, warnings };
}

/** Caption files of the `caption/` sub-folder, with the text of each readable one. */
export interface CaptionSource {
  files: readonly DriveFileRef[];
  /** File ID → content. A text file missing here could not be downloaded. */
  texts: ReadonlyMap<string, string>;
  /** File ID → reason it could not be read (e.g. too large). */
  errors: ReadonlyMap<string, string>;
}

/** Most frequent value; ties resolved by the smallest number. */
function mode(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, total] of counts) {
    if (total > bestCount || (total === bestCount && best !== null && value < best)) {
      best = value;
      bestCount = total;
    }
  }
  return best;
}

export interface BuildQueueResult {
  ideaNumber: number;
  items: DraftQueueItem[];
  warnings: QueueWarning[];
}

/**
 * @param rootFiles      files directly inside the shared folder (sub-folders excluded)
 * @param thumbnailFiles files inside its `thumbnail/` sub-folder
 * @param fallbackIdeaNumber used when no file name carries an IDEA_ID
 * @param captionSource  contents of its `caption/` sub-folder; `null` when there is none
 */
export function buildQueueFromFolder(
  rootFiles: readonly DriveFileRef[],
  thumbnailFiles: readonly DriveFileRef[],
  fallbackIdeaNumber: number,
  captionSource: CaptionSource | null = null,
): BuildQueueResult {
  const warnings: QueueWarning[] = [];

  const thumbnails = new Map<string, DriveFileRef>();
  for (const file of thumbnailFiles) {
    if (!isImageFile(file)) {
      warnings.push({
        fileName: `thumbnail/${file.name}`,
        message: 'Bukan file gambar, dilewati.',
      });
      continue;
    }
    const key = baseName(file.name).toLowerCase();
    if (!thumbnails.has(key)) thumbnails.set(key, file);
  }

  const captions = new Map<string, { file: DriveFileRef; parsed: ParsedCaption }>();
  for (const file of captionSource?.files ?? []) {
    const fileName = `caption/${file.name}`;
    if (!isTextFile(file)) {
      warnings.push({ fileName, message: 'Bukan file .txt, dilewati.' });
      continue;
    }
    const text = captionSource?.texts.get(file.id);
    if (text === undefined) {
      const reason = captionSource?.errors.get(file.id) ?? 'File tidak dapat dibaca.';
      warnings.push({ fileName, message: `${reason} Caption dari file ini tidak dipakai.` });
      continue;
    }
    const key = baseName(file.name).toLowerCase();
    if (captions.has(key)) {
      warnings.push({ fileName, message: 'Nama sama dengan file caption lain, dilewati.' });
      continue;
    }
    const parsed = parseCaptionText(text);
    for (const message of parsed.warnings) warnings.push({ fileName, message });
    captions.set(key, { file, parsed });
  }

  const videos: { file: DriveFileRef; parsed: ParsedMediaName }[] = [];
  for (const file of rootFiles) {
    if (!isVideoFile(file)) {
      warnings.push({ fileName: file.name, message: 'Bukan file video, dilewati.' });
      continue;
    }
    videos.push({ file, parsed: parseMediaName(file.name) });
  }

  const parsedIdeas = videos.flatMap((video) =>
    video.parsed.ideaNumber === null ? [] : [video.parsed.ideaNumber],
  );
  const ideaNumber = mode(parsedIdeas) ?? fallbackIdeaNumber;

  const matched = videos
    .filter((video) => video.parsed.matched)
    .sort(
      (a, b) =>
        (a.parsed.topicNumber ?? 0) - (b.parsed.topicNumber ?? 0) ||
        (a.parsed.partNumber ?? 0) - (b.parsed.partNumber ?? 0) ||
        a.file.name.localeCompare(b.file.name),
    );
  const unmatched = videos
    .filter((video) => !video.parsed.matched)
    .sort((a, b) => a.file.name.localeCompare(b.file.name));

  let nextTopic = Math.max(0, ...matched.map((video) => video.parsed.topicNumber ?? 0)) + 1;
  const usedThumbnails = new Set<string>();
  const usedCaptions = new Set<string>();
  const seenTopicParts = new Set<string>();
  const items: DraftQueueItem[] = [];

  for (const { file, parsed } of [...matched, ...unmatched]) {
    let topicNumber = parsed.topicNumber;
    if (topicNumber === null) {
      topicNumber = nextTopic++;
      warnings.push({
        fileName: file.name,
        message: `Nama file tidak sesuai pola <IDEA>.<TOPIK>-judul. Nomor topik diisi otomatis (${topicNumber}).`,
      });
    } else if (parsed.ideaNumber !== null && parsed.ideaNumber !== ideaNumber) {
      warnings.push({
        fileName: file.name,
        message: `IDEA_ID ${parsed.ideaNumber} berbeda dari IDEA_ID batch (${ideaNumber}).`,
      });
    }

    const topicPart = `${topicNumber}:${parsed.partNumber ?? 0}`;
    if (seenTopicParts.has(topicPart)) {
      warnings.push({ fileName: file.name, message: 'Nomor topik/part sama dengan file lain.' });
    }
    seenTopicParts.add(topicPart);

    const key = baseName(file.name).toLowerCase();
    const thumbnail = thumbnails.get(key) ?? null;
    if (thumbnail) usedThumbnails.add(key);
    else
      warnings.push({
        fileName: file.name,
        message: 'Thumbnail dengan nama yang sama tidak ditemukan di folder thumbnail/.',
      });

    const caption = captions.get(key)?.parsed ?? null;
    if (caption) usedCaptions.add(key);
    else if (captionSource)
      warnings.push({
        fileName: file.name,
        message: 'Caption dengan nama yang sama tidak ditemukan di folder caption/.',
      });

    items.push({
      position: items.length,
      topicNumber,
      partNumber: parsed.partNumber,
      title: parsed.title,
      videoFileId: file.id,
      videoFileName: file.name.slice(0, 300),
      thumbnailFileId: thumbnail?.id ?? null,
      thumbnailFileName: thumbnail?.name.slice(0, 300) ?? null,
      caption: caption?.caption ?? '',
      hashtags: caption?.hashtags ?? [],
    });
  }

  for (const [key, file] of thumbnails) {
    if (!usedThumbnails.has(key)) {
      warnings.push({
        fileName: `thumbnail/${file.name}`,
        message: 'Tidak ada video dengan nama yang sama.',
      });
    }
  }

  for (const [key, { file }] of captions) {
    if (!usedCaptions.has(key)) {
      warnings.push({
        fileName: `caption/${file.name}`,
        message: 'Tidak ada video dengan nama yang sama.',
      });
    }
  }

  return { ideaNumber, items, warnings };
}
