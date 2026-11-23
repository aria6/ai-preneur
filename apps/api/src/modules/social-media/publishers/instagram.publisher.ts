import { PublishError, type PlatformPublisher } from './publisher.js';

/**
 * Instagram Reels publisher — Tahap 2.
 *
 * TODO (Tahap 2): implement with the Instagram API with Instagram Login:
 *   1. Download the video from Google Drive (files/{id}?alt=media&key=…) to a temp file.
 *   2. POST /{ig-user-id}/media  media_type=REELS, upload_type=resumable, caption = caption + "\n\n" + #hashtags
 *      (+ cover_url / thumb_offset for the thumbnail) → container ID.
 *   3. POST https://rupload.facebook.com/ig-api-upload/{version}/{container-id} with the bytes.
 *   4. Poll GET /{container-id}?fields=status_code until FINISHED (or ERROR → PublishError).
 *   5. POST /{ig-user-id}/media_publish creation_id=… → media ID.
 *   6. GET /{media-id}?fields=permalink → externalUrl.
 *   7. Refresh the long-lived token (GET /refresh_access_token) before it expires.
 */
export const instagramPublisher: PlatformPublisher = {
  platform: 'instagram',
  publish() {
    return Promise.reject(
      new PublishError('Unggah otomatis ke Instagram belum diaktifkan (Tahap 2).'),
    );
  },
};
