import { z } from 'zod';

/**
 * Instagram API with Instagram Login (graph.instagram.com). Works for Instagram
 * professional accounts (Business/Creator) without a linked Facebook Page.
 *
 * Tahap 1: only the connection check. Publishing lives in the publisher (Tahap 2).
 */
const GRAPH_HOST = 'https://graph.instagram.com';
const REQUEST_TIMEOUT_MS = 15_000;

export class InstagramApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstagramApiError';
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
  error: z.object({ message: z.string().optional(), code: z.number().optional() }),
});

export async function fetchInstagramAccount(accessToken: string): Promise<InstagramAccount> {
  const query = new URLSearchParams({
    fields: 'user_id,username,account_type',
    access_token: accessToken,
  });

  let response: Response;
  try {
    response = await fetch(`${GRAPH_HOST}/me?${query.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // The URL contains the token — never surface it.
    throw new InstagramApiError('Tidak dapat menghubungi Instagram. Coba lagi beberapa saat lagi.');
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsedError = errorSchema.safeParse(body);
    const code = parsedError.success ? parsedError.data.error.code : undefined;
    if (code === 190 || response.status === 401) {
      throw new InstagramApiError('Access token tidak valid atau sudah kedaluwarsa.');
    }
    throw new InstagramApiError(
      'Instagram menolak access token ini. Pastikan token dibuat untuk akun Instagram Profesional.',
    );
  }

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
