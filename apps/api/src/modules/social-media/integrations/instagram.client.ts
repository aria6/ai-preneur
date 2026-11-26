import { openAsBlob } from 'node:fs';

import { z } from 'zod';

/**
 * Instagram API for professional accounts (Business/Creator), no Facebook Page needed.
 * Two kinds of access token are supported, told apart by their prefix:
 *
 * - `IG…` — Instagram API with Instagram Login (graph.instagram.com). Long-lived user
 *   token, valid 60 days and refreshable. Meta no longer offers this setup to new apps.
 * - `EAA…` — Instagram API with Unified login (graph.facebook.com). System-user token of
 *   a business portfolio that never expires; the Instagram accounts it can use are the
 *   ones assigned to it in that portfolio.
 *
 * Publishing endpoints are the same on both hosts. Covers the connection check, Reels
 * publishing (resumable upload) and the token refresh. Tokens travel in the request
 * body or headers and are never put into error messages or logs.
 */
const INSTAGRAM_GRAPH_HOST = 'https://graph.instagram.com';
const FACEBOOK_GRAPH_HOST = 'https://graph.facebook.com';
const UPLOAD_HOST = 'https://rupload.facebook.com/ig-api-upload';
/** Graph API version for publishing calls. Meta keeps each version ~2 years. */
export const INSTAGRAM_API_VERSION = 'v25.0';
const REQUEST_TIMEOUT_MS = 30_000;

export type InstagramTokenKind = 'instagram_login' | 'unified_login';

/** Which setup issued the token: Unified login tokens are Facebook tokens (`EAA…`). */
export function instagramTokenKind(accessToken: string): InstagramTokenKind {
  return accessToken.startsWith('EAA') ? 'unified_login' : 'instagram_login';
}

function graphHost(accessToken: string): string {
  return instagramTokenKind(accessToken) === 'unified_login'
    ? FACEBOOK_GRAPH_HOST
    : INSTAGRAM_GRAPH_HOST;
}

export class InstagramApiError extends Error {
  /** True when the same request may succeed later (network, server, rate limit). */
  readonly retryable: boolean;
  /** True when the token is invalid or expired (Graph error 190). */
  readonly tokenInvalid: boolean;
  constructor(message: string, options: { retryable?: boolean; tokenInvalid?: boolean } = {}) {
    super(message);
    this.name = 'InstagramApiError';
    this.retryable = options.retryable ?? false;
    this.tokenInvalid = options.tokenInvalid ?? false;
  }
}

export interface InstagramAccount {
  /** Instagram professional account ID — the ID used for publishing. */
  userId: string;
  username: string;
  accountType: string | null;
}

const meSchema = z.object({
  user_id: z.union([z.string(), z.number()]).transform(String),
  username: z.string(),
  account_type: z.string().optional(),
});

const errorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    is_transient: z.boolean().optional(),
    error_user_msg: z.string().optional(),
  }),
});

/** Graph error codes that mean "too many calls, try later". */
const RATE_LIMIT_CODES = new Set([4, 9, 17, 32, 613]);
/** Graph error codes that mean "temporary server problem". */
const TRANSIENT_CODES = new Set([1, 2]);

function toApiError(status: number, body: unknown, action: string): InstagramApiError {
  const parsed = errorSchema.safeParse(body);
  const error = parsed.success ? parsed.data.error : undefined;
  if (error?.code === 190 || status === 401) {
    return new InstagramApiError(
      'Access token Instagram tidak valid atau sudah kedaluwarsa. Hubungkan ulang akun Instagram untuk ide ini.',
      { tokenInvalid: true },
    );
  }
  if (error?.code !== undefined && RATE_LIMIT_CODES.has(error.code)) {
    return new InstagramApiError(
      `Batas penggunaan API Instagram tercapai saat ${action}. Akan dicoba lagi nanti.`,
      { retryable: true },
    );
  }
  if (
    status >= 500 ||
    status === 429 ||
    error?.is_transient === true ||
    (error?.code !== undefined && TRANSIENT_CODES.has(error.code))
  ) {
    return new InstagramApiError(`Instagram sedang bermasalah saat ${action}.`, {
      retryable: true,
    });
  }
  const detail = (error?.error_user_msg ?? error?.message ?? `HTTP ${status}`).slice(0, 300);
  return new InstagramApiError(`Instagram menolak ${action}: ${detail}`);
}

async function graphRequest(
  method: 'GET' | 'POST',
  path: string,
  accessToken: string,
  params: Record<string, string>,
  action: string,
): Promise<unknown> {
  const query = new URLSearchParams({ ...params, access_token: accessToken });
  const url = `${graphHost(accessToken)}/${INSTAGRAM_API_VERSION}${path}`;

  let response: Response;
  try {
    response =
      method === 'GET'
        ? await fetch(`${url}?${query.toString()}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          })
        : await fetch(url, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: query.toString(),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
  } catch {
    // The URL/body contains the token — never surface it.
    throw new InstagramApiError(`Tidak dapat menghubungi Instagram saat ${action}.`, {
      retryable: true,
    });
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toApiError(response.status, body, action);
  return body;
}

const idSchema = z.object({ id: z.union([z.string(), z.number()]).transform(String) });

const assignedAccountsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).transform(String),
        username: z.string().optional(),
      }),
    )
    .default([]),
});

/** Turns a failed connection check into a message for the token field. */
function connectionError(status: number, body: unknown): InstagramApiError {
  const parsedError = errorSchema.safeParse(body);
  const code = parsedError.success ? parsedError.data.error.code : undefined;
  if (code === 190 || status === 401) {
    return new InstagramApiError('Access token tidak valid atau sudah kedaluwarsa.', {
      tokenInvalid: true,
    });
  }
  const apiError = toApiError(status, body, 'memeriksa token');
  if (apiError.retryable) return apiError;
  return new InstagramApiError(
    'Instagram menolak access token ini. Pastikan token dibuat untuk akun Instagram Profesional.',
  );
}

async function getJson(url: string, action: string): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // The URL contains the token — never surface it.
    throw new InstagramApiError(`Tidak dapat menghubungi Instagram saat ${action}.`, {
      retryable: true,
    });
  }
  const body: unknown = await response.json().catch(() => null);
  return { status: response.ok ? 200 : response.status, body };
}

/** Instagram Login token: the token belongs to exactly one account (`/me`). */
async function fetchInstagramLoginAccount(accessToken: string): Promise<InstagramAccount> {
  const query = new URLSearchParams({
    fields: 'user_id,username,account_type',
    access_token: accessToken,
  });
  const { status, body } = await getJson(
    `${INSTAGRAM_GRAPH_HOST}/me?${query.toString()}`,
    'memeriksa token',
  );
  if (status !== 200) throw connectionError(status, body);

  const parsed = meSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali.');

  const accountType = parsed.data.account_type ?? null;
  if (accountType === 'PERSONAL') {
    throw new InstagramApiError(
      'Akun ini akun pribadi. Ubah ke akun Instagram Profesional (Bisnis atau Kreator).',
    );
  }
  return { userId: parsed.data.user_id, username: parsed.data.username, accountType };
}

/** Unified login token: the Instagram accounts assigned to the system user. */
async function fetchAssignedAccounts(accessToken: string): Promise<InstagramAccount[]> {
  const query = new URLSearchParams({
    fields: 'id,username',
    limit: '100',
    access_token: accessToken,
  });
  const { status, body } = await getJson(
    `${FACEBOOK_GRAPH_HOST}/${INSTAGRAM_API_VERSION}/me/assigned_instagram_accounts?${query.toString()}`,
    'memeriksa token',
  );
  if (status !== 200) throw connectionError(status, body);

  const parsed = assignedAccountsSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali.');
  return parsed.data.data.map((account) => ({
    userId: account.id,
    username: account.username ?? account.id,
    accountType: null,
  }));
}

/**
 * The Instagram accounts this token can publish to: always one for an Instagram Login
 * token, one or more for a Unified login token. Throws when there are none.
 */
export async function listInstagramAccounts(accessToken: string): Promise<InstagramAccount[]> {
  if (instagramTokenKind(accessToken) === 'instagram_login') {
    return [await fetchInstagramLoginAccount(accessToken)];
  }
  const accounts = await fetchAssignedAccounts(accessToken);
  if (accounts.length === 0) {
    throw new InstagramApiError(
      'Token ini tidak punya akses ke akun Instagram mana pun. Pastikan token dibuat dari "API setup with Unified login" dan akun Instagram sudah ada di business portfolio.',
      { tokenInvalid: true },
    );
  }
  return accounts;
}

// ---- Reels publishing ------------------------------------------------------------------

export interface CreateReelsContainerInput {
  accessToken: string;
  igUserId: string;
  caption: string;
  /** Public image URL used as the Reel cover. */
  coverUrl?: string;
}

/** Step 1: creates a resumable Reels container and returns its ID. */
export async function createReelsContainer(input: CreateReelsContainerInput): Promise<string> {
  const params: Record<string, string> = {
    media_type: 'REELS',
    upload_type: 'resumable',
    caption: input.caption,
    share_to_feed: 'true',
  };
  if (input.coverUrl) params.cover_url = input.coverUrl;

  const body = await graphRequest(
    'POST',
    `/${input.igUserId}/media`,
    input.accessToken,
    params,
    'membuat kontainer Reels',
  );
  const parsed = idSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali (kontainer).');
  return parsed.data.id;
}

/**
 * rupload.facebook.com answers errors in its own shape, not the Graph `error` object:
 * `{"debug_info":{"retriable":false,"type":"ProcessingFailedError","message":"…"}}`.
 */
const uploadErrorSchema = z.object({
  debug_info: z.object({
    retriable: z.boolean().optional(),
    type: z.string().optional(),
    message: z.string().optional(),
  }),
});

/**
 * Meta's upload server often answers 400 ProcessingFailedError even though it received
 * the whole file: the container then reports FINISHED (or IN_PROGRESS while it is still
 * processing), and sending the bytes again is refused with "The ig container is not in
 * the status to upload a video". So after a 400 the container status decides, a few
 * seconds later, whether the upload actually landed.
 */
const UPLOAD_CHECK_DELAY_MS = 3_000;

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new InstagramApiError('Unggahan video ke Instagram terputus.', { retryable: true }));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new InstagramApiError('Unggahan video ke Instagram terputus.', { retryable: true }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * After a rupload 400: did the container get the file anyway? FINISHED / IN_PROGRESS /
 * ERROR all mean Instagram has the video (the processing wait reports ERROR with its
 * reason); EXPIRED, PUBLISHED, a status saying nothing was uploaded, or a failed check
 * mean it did not.
 */
async function uploadLanded(accessToken: string, containerId: string): Promise<boolean> {
  try {
    const status = await getContainerStatus(accessToken, containerId);
    if (status.code === 'EXPIRED' || status.code === 'PUBLISHED') return false;
    if (
      /not\s+(yet\s+)?(been\s+)?(started|uploaded)|no\s+upload|upload\s+not/i.test(
        status.detail ?? '',
      )
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Turns a failed rupload answer into an error that says what Meta reported, and tells
 * whether the container is worth checking (a plain 400, not auth/rate limit).
 */
function toUploadError(
  status: number,
  body: unknown,
): { error: InstagramApiError; checkContainer: boolean } {
  const graphError = errorSchema.safeParse(body);
  if (graphError.success) {
    const error = toApiError(status, body, 'mengunggah video');
    return { error, checkContainer: status === 400 && !error.tokenInvalid && !error.retryable };
  }

  const parsed = uploadErrorSchema.safeParse(body);
  const info = parsed.success ? parsed.data.debug_info : undefined;
  if (status === 401 || /unauthori[sz]ed/i.test(info?.message ?? '')) {
    return {
      error: new InstagramApiError(
        'Instagram menolak mengunggah video: token tidak diizinkan mengunggah ke akun ini. Pastikan token punya izin instagram_content_publish untuk akun tersebut.',
      ),
      checkContainer: false,
    };
  }
  if (status >= 500 || status === 429 || info?.retriable === true) {
    return {
      error: new InstagramApiError('Instagram sedang bermasalah saat mengunggah video.', {
        retryable: true,
      }),
      checkContainer: false,
    };
  }
  const detail = info ? [info.type, info.message].filter(Boolean).join(' — ') : `HTTP ${status}`;
  return {
    error: new InstagramApiError(
      `Instagram menolak mengunggah video: ${(detail || `HTTP ${status}`).slice(0, 300)}`,
    ),
    checkContainer: status === 400,
  };
}

/**
 * Step 2: uploads the video bytes of a local file to the container. On a 400 the
 * container status is checked before giving up (see UPLOAD_CHECK_DELAY_MS); the bytes
 * are never sent twice.
 */
export async function uploadReelsVideo(input: {
  accessToken: string;
  containerId: string;
  filePath: string;
  fileSize: number;
  signal: AbortSignal;
}): Promise<void> {
  const blob = await openAsBlob(input.filePath, { type: 'video/mp4' });

  let response: Response;
  try {
    response = await fetch(`${UPLOAD_HOST}/${INSTAGRAM_API_VERSION}/${input.containerId}`, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${input.accessToken}`,
        offset: '0',
        file_size: String(input.fileSize),
      },
      body: blob,
      signal: input.signal,
    });
  } catch {
    throw new InstagramApiError('Unggahan video ke Instagram terputus.', { retryable: true });
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const { error, checkContainer } = toUploadError(response.status, body);
    if (!checkContainer) throw error;
    await waitFor(UPLOAD_CHECK_DELAY_MS, input.signal);
    if (await uploadLanded(input.accessToken, input.containerId)) return;
    throw error;
  }
  const parsed = z.object({ success: z.boolean().optional() }).safeParse(body);
  if (parsed.success && parsed.data.success === false) {
    throw new InstagramApiError('Instagram menolak file video yang diunggah.');
  }
}

export type ContainerStatusCode = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';

const containerStatusSchema = z.object({
  status_code: z.enum(['EXPIRED', 'ERROR', 'FINISHED', 'IN_PROGRESS', 'PUBLISHED']),
  status: z.string().optional(),
});

/** Processing state of a container (poll until FINISHED before publishing). */
export async function getContainerStatus(
  accessToken: string,
  containerId: string,
): Promise<{ code: ContainerStatusCode; detail: string | null }> {
  const body = await graphRequest(
    'GET',
    `/${containerId}`,
    accessToken,
    { fields: 'status_code,status' },
    'memeriksa status video',
  );
  const parsed = containerStatusSchema.safeParse(body);
  if (!parsed.success) {
    throw new InstagramApiError('Respons Instagram tidak dikenali (status kontainer).', {
      retryable: true,
    });
  }
  return { code: parsed.data.status_code, detail: parsed.data.status ?? null };
}

/** Step 3: publishes a FINISHED container and returns the media ID. */
export async function publishContainer(
  accessToken: string,
  igUserId: string,
  containerId: string,
): Promise<string> {
  const body = await graphRequest(
    'POST',
    `/${igUserId}/media_publish`,
    accessToken,
    { creation_id: containerId },
    'memublikasikan video',
  );
  const parsed = idSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali (publikasi).');
  return parsed.data.id;
}

/** Public link of a published media, or null when Instagram does not return one. */
export async function getMediaPermalink(
  accessToken: string,
  mediaId: string,
): Promise<string | null> {
  try {
    const body = await graphRequest(
      'GET',
      `/${mediaId}`,
      accessToken,
      { fields: 'permalink' },
      'mengambil link video',
    );
    const parsed = z.object({ permalink: z.string().url().optional() }).safeParse(body);
    return parsed.success ? (parsed.data.permalink ?? null) : null;
  } catch {
    return null; // the post is live; a missing link is not a failure
  }
}

const recentMediaSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).transform(String),
        caption: z.string().optional(),
        permalink: z.string().optional(),
        timestamp: z.string().optional(),
      }),
    )
    .default([]),
});

export interface RecentMedia {
  id: string;
  caption: string;
  permalink: string | null;
  timestamp: Date | null;
}

/** The account's latest posts, newest first (used to find a post whose ID got lost). */
export async function listRecentMedia(
  accessToken: string,
  igUserId: string,
  limit = 25,
): Promise<RecentMedia[]> {
  const body = await graphRequest(
    'GET',
    `/${igUserId}/media`,
    accessToken,
    { fields: 'id,caption,permalink,timestamp', limit: String(limit) },
    'membaca postingan terbaru',
  );
  const parsed = recentMediaSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali (media).');
  return parsed.data.data.map((media) => {
    const time = media.timestamp ? new Date(media.timestamp) : null;
    return {
      id: media.id,
      caption: media.caption ?? '',
      permalink: media.permalink ?? null,
      timestamp: time && !Number.isNaN(time.getTime()) ? time : null,
    };
  });
}

// ---- Token refresh ---------------------------------------------------------------------

const refreshSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
});

/**
 * Extends a long-lived Instagram Login token by 60 days. Instagram only accepts tokens
 * that are at least 24 hours old and not yet expired. (Unified login tokens never
 * expire and are not refreshed.)
 */
export async function refreshLongLivedToken(
  accessToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const query = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: accessToken });

  let response: Response;
  try {
    response = await fetch(`${INSTAGRAM_GRAPH_HOST}/refresh_access_token?${query.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new InstagramApiError('Tidak dapat menghubungi Instagram saat memperbarui token.', {
      retryable: true,
    });
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toApiError(response.status, body, 'memperbarui token');
  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) throw new InstagramApiError('Respons Instagram tidak dikenali (token).');
  return {
    accessToken: parsed.data.access_token,
    expiresAt: new Date(Date.now() + parsed.data.expires_in * 1000),
  };
}
