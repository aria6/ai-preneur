/**
 * Turns the files of a Google Drive folder into a draft content queue.
 * Pure functions — no I/O — so the rules are easy to test.
 *
 * Expected layout:
 *   <folder>/2.1-apa-akuaponik.mp4
 *   <folder>/2.2-model-akuaponik-part1.mp4
 *   <folder>/thumbnail/2.1-apa-akuaponik.png
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
}

export interface QueueWarning {
  fileName: string;
  message: string;
}

const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm|mkv)$/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|webp)$/i;
const ANY_EXTENSION = /\.[A-Za-z0-9]{1,5}$/;
const MAX_TITLE = 200;

export function isVideoFile(file: DriveFileRef): boolean {
  return file.mimeType.startsWith('video/') || VIDEO_EXTENSION.test(file.name);
}

export function isImageFile(file: DriveFileRef): boolean {
  return file.mimeType.startsWith('image/') || IMAGE_EXTENSION.test(file.name);
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
 */
export function buildQueueFromFolder(
  rootFiles: readonly DriveFileRef[],
  thumbnailFiles: readonly DriveFileRef[],
  fallbackIdeaNumber: number,
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

    items.push({
      position: items.length,
      topicNumber,
      partNumber: parsed.partNumber,
      title: parsed.title,
      videoFileId: file.id,
      videoFileName: file.name.slice(0, 300),
      thumbnailFileId: thumbnail?.id ?? null,
      thumbnailFileName: thumbnail?.name.slice(0, 300) ?? null,
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

  return { ideaNumber, items, warnings };
}
