import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { z } from 'zod';

import type { DriveFileRef } from '../domain/filename-parser.js';

/**
 * Minimal Google Drive v3 client for **publicly shared** files and folders,
 * authenticated with an API key only (no OAuth). Folder and file IDs come from
 * `extractDrive*Id`, which restricts them to [A-Za-z0-9_-], so they are safe to
 * embed in the `q` expression and the URL path.
 */
const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGES = 10; // 10 × 1000 files is far beyond any realistic content folder
/** Caption files are a few KB; anything far larger is not a caption. */
const MAX_TEXT_BYTES = 64 * 1024;

export type DriveErrorKind =
  'not_configured' | 'not_found' | 'forbidden' | 'invalid' | 'unavailable' | 'too_large';

export class DriveError extends Error {
  readonly kind: DriveErrorKind;
  constructor(kind: DriveErrorKind, message: string) {
    super(message);
    this.name = 'DriveError';
    this.kind = kind;
  }
}

const fileSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  name: z.string(),
  mimeType: z.string(),
  trashed: z.boolean().optional(),
});
const listSchema = z.object({
  nextPageToken: z.string().optional(),
  files: z.array(fileSchema).default([]),
});

export interface DriveFolderContents {
  files: DriveFileRef[];
  folders: DriveFileRef[];
}

export interface GoogleDriveClient {
  /** Metadata of a public file or folder. Throws DriveError when missing or private. */
  getFile(fileId: string): Promise<DriveFileRef>;
  /** Direct children (files and sub-folders) of a public folder. */
  listFolder(folderId: string): Promise<DriveFolderContents>;
  /** Content of a public plain-text file (UTF-8). Throws DriveError `too_large` above 64 KB. */
  readTextFile(fileId: string): Promise<string>;
  /**
   * Streams a public file to `destination` and returns its size in bytes.
   * Throws DriveError `too_large` above `maxBytes` (the partial file is left for the caller to delete).
   */
  downloadToFile(
    fileId: string,
    destination: string,
    options: {
      maxBytes: number;
      signal: AbortSignal;
      /** Bytes received so far and the total when Drive announces it. */
      onProgress?: (received: number, total: number | null) => void;
    },
  ): Promise<number>;
}

export function isDriveFolder(file: DriveFileRef): boolean {
  return file.mimeType === FOLDER_MIME;
}

export function createGoogleDriveClient(apiKey: string | null): GoogleDriveClient {
  async function send(
    path: string,
    params: Record<string, string>,
    signal: AbortSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  ): Promise<Response> {
    if (!apiKey) {
      throw new DriveError(
        'not_configured',
        'GOOGLE_API_KEY belum diatur di server. Hubungi administrator.',
      );
    }
    const query = new URLSearchParams({ ...params, key: apiKey, supportsAllDrives: 'true' });

    let response: Response;
    try {
      response = await fetch(`${DRIVE_FILES_API}${path}?${query.toString()}`, {
        headers: { Accept: 'application/json' },
        signal,
      });
    } catch {
      // Never include the URL: it carries the API key.
      throw new DriveError(
        'unavailable',
        'Tidak dapat menghubungi Google Drive. Coba lagi beberapa saat lagi.',
      );
    }

    if (response.status === 404) {
      throw new DriveError(
        'not_found',
        'File/folder tidak ditemukan. Pastikan link benar dan aksesnya "Siapa saja yang memiliki link".',
      );
    }
    if (response.status === 400) {
      throw new DriveError(
        'invalid',
        'Permintaan ke Google Drive ditolak. Periksa kembali link-nya.',
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new DriveError(
        'forbidden',
        'Akses ke Google Drive ditolak. Pastikan folder dibagikan ke "Siapa saja yang memiliki link" dan Google Drive API aktif untuk API key server.',
      );
    }
    if (!response.ok) {
      throw new DriveError(
        'unavailable',
        `Google Drive sedang bermasalah (HTTP ${response.status}).`,
      );
    }
    return response;
  }

  async function request(path: string, params: Record<string, string>): Promise<unknown> {
    return (await send(path, params)).json();
  }

  async function getFile(fileId: string): Promise<DriveFileRef> {
    const parsed = fileSchema.safeParse(
      await request(`/${fileId}`, { fields: 'id,name,mimeType,trashed' }),
    );
    if (!parsed.success)
      throw new DriveError('unavailable', 'Respons Google Drive tidak dikenali.');
    if (parsed.data.trashed)
      throw new DriveError('not_found', 'File berada di sampah Google Drive.');
    return { id: parsed.data.id, name: parsed.data.name, mimeType: parsed.data.mimeType };
  }

  async function listFolder(folderId: string): Promise<DriveFolderContents> {
    const files: DriveFileRef[] = [];
    const folders: DriveFileRef[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params: Record<string, string> = {
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType)',
        pageSize: '1000',
        includeItemsFromAllDrives: 'true',
        orderBy: 'name',
      };
      if (pageToken) params.pageToken = pageToken;

      const parsed = listSchema.safeParse(await request('', params));
      if (!parsed.success)
        throw new DriveError('unavailable', 'Respons Google Drive tidak dikenali.');

      for (const file of parsed.data.files) {
        const ref = { id: file.id, name: file.name, mimeType: file.mimeType };
        (isDriveFolder(ref) ? folders : files).push(ref);
      }
      pageToken = parsed.data.nextPageToken;
      if (!pageToken) break;
    }
    return { files, folders };
  }

  async function readTextFile(fileId: string): Promise<string> {
    const response = await send(`/${fileId}`, { alt: 'media' });
    const tooLarge = () =>
      new DriveError('too_large', `File lebih dari ${MAX_TEXT_BYTES / 1024} KB.`);

    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_TEXT_BYTES) {
      await response.body?.cancel();
      throw tooLarge();
    }

    // Read with a hard cap: the declared length may be missing or wrong.
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_TEXT_BYTES) {
          await reader.cancel();
          throw tooLarge();
        }
        chunks.push(value);
      }
    }
    return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
  }

  async function downloadToFile(
    fileId: string,
    destination: string,
    options: {
      maxBytes: number;
      signal: AbortSignal;
      onProgress?: (received: number, total: number | null) => void;
    },
  ): Promise<number> {
    const response = await send(`/${fileId}`, { alt: 'media' }, options.signal);
    const tooLarge = () =>
      new DriveError(
        'too_large',
        `File video lebih dari ${Math.round(options.maxBytes / (1024 * 1024))} MB.`,
      );

    const declared = Number(response.headers.get('content-length'));
    if (declared > options.maxBytes) {
      await response.body?.cancel();
      throw tooLarge();
    }
    if (!response.body) throw new DriveError('unavailable', 'Google Drive mengirim file kosong.');

    let total = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += chunk.byteLength;
        if (total > options.maxBytes) return callback(tooLarge());
        options.onProgress?.(total, declared > 0 ? declared : null);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
        limiter,
        createWriteStream(destination),
        { signal: options.signal },
      );
    } catch (error) {
      if (error instanceof DriveError) throw error;
      throw new DriveError(
        'unavailable',
        'Unduhan video dari Google Drive terputus. Coba lagi beberapa saat lagi.',
      );
    }
    if (total === 0) throw new DriveError('invalid', 'File video di Google Drive kosong.');
    return total;
  }

  return { getFile, listFolder, readTextFile, downloadToFile };
}
