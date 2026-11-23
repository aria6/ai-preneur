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

export type DriveErrorKind =
  'not_configured' | 'not_found' | 'forbidden' | 'invalid' | 'unavailable';

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
}

export function isDriveFolder(file: DriveFileRef): boolean {
  return file.mimeType === FOLDER_MIME;
}

export function createGoogleDriveClient(apiKey: string | null): GoogleDriveClient {
  async function request(path: string, params: Record<string, string>): Promise<unknown> {
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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
    return response.json();
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

  return { getFile, listFolder };
}
