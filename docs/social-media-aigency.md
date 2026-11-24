# Social Media AIgency

```text
Social Media AIgency
├── Publisher AIgent      Tahap 1 + 2 done — queue, schedule, accounts, real uploads to Instagram
├── Intelligence AIgency  later — comments, DMs, engagement, performance patterns
└── Pengaturan            lock window, confirmation lead time
```

Backend module: `apps/api/src/modules/social-media` · tables: `packages/database/src/schema/social-media.schema.ts`
· contracts: `packages/shared/src/schemas/social.ts` · UI: `apps/web/src/pages/social`.

## Publisher AIgent — how it works

1. **Batch = one idea.** Create a batch with the idea (free text) and a Google Drive folder link.
2. **Generate antrean konten** reads the folder and builds the queue from file names:

   ```text
   <folder>/                      shared as "Siapa saja yang memiliki link"
   ├── 2.1-apa-akuaponik.mp4
   ├── 2.2-model-akuaponik-part1.mp4
   ├── 2.2-model-akuaponik-part2.mp4
   ├── thumbnail/
   │   ├── 2.1-apa-akuaponik.png
   │   └── 2.2-model-akuaponik-part1.png …
   └── caption/
       ├── 2.1-apa-akuaponik.txt
       └── 2.2-model-akuaponik-part1.txt …
   ```

   `2.2-model-akuaponik-part1` → IDEA_ID `2`, TOPIC_ID `2`, part `1`, title "Model akuaponik".
   - IDEA_ID of the batch = the most common prefix; when no file has one, the next free number.
   - Files that don't follow the pattern are still added, with an automatic TOPIC_ID.
   - Thumbnails match videos by identical name (any of png/jpg/jpeg/webp).
   - Captions match videos the same way (`.txt`, UTF-8, max 64 KB; folder `caption/` or
     `captions/`, optional). The **hashtag block at the end of the file** (lines containing only
     hashtags) goes to the hashtag list — de-duplicated, max 30; hashtags inside a sentence stay in
     the caption. The caption is cut at 2,200 characters.

     ```text
     Akuaponik menggabungkan budidaya ikan dan sayur. #hemat air tetap di caption

     #akuaponik #urbanfarming
     #ikan
     ```

   - Every oddity (non-video file, missing/unused thumbnail or caption, non-.txt or unreadable
     caption, caption cut, more than 30 hashtags, IDEA_ID mismatch, duplicate topic/part) is reported
     back — nothing is skipped silently.
   - Regenerating replaces the queue (draft only, and never once something was uploaded).

3. Each row: thumbnail, playable video (Drive player), caption, hashtags (max 30), schedule, and
   upload status per selected platform. Rows can be edited, deleted, added manually (Drive file
   links), paused ("Tunda") and reordered by drag & drop.
4. **Jadwalkan semua**: start time + interval (6 h … 7 days) fills the schedule of every editable,
   active row in queue order.
5. **Media sosial**: Instagram, TikTok, Facebook Reels, YouTube Shorts. Only Instagram is available
   now; the others show "Segera hadir". **One account per platform per idea, and one account can never
   serve two ideas** (unique index on platform + account ID).
6. **Konfirmasi jadwal** (Draft → Terjadwal) only schedules; each row uploads at its own time.
7. **Batalkan jadwal** returns the batch to Draft; uploaded rows stay recorded.

### Rules (enforced by the API, mirrored by the UI)

| Rule                                    | Detail                                                                                                                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lock window                             | While a batch is Terjadwal, a row whose upload is less than **`lockMinutes`** away (default 30) can't be edited, moved, paused or deleted. Uploaded/uploading rows are always read-only. Paused rows never upload, so they aren't time-locked. |
| Confirmation                            | Allowed when every active row has a video and a schedule, every selected platform has a connected account, and the **first upload is at least `minConfirmLeadMinutes`** away (default 60).                                                     |
| Reorder                                 | Time slots stay at their positions: the row dropped at position _n_ takes position _n_'s time. Locked rows can't move or be shifted. In a scheduled batch an active row can't receive an empty or too-close slot.                              |
| Delete / pause                          | Other rows keep their schedules (no shifting). Resuming in a scheduled batch requires a new schedule outside the lock window.                                                                                                                  |
| Edits while scheduled                   | New or changed schedules must be at least `lockMinutes` from now.                                                                                                                                                                              |
| Platform/account/folder/IDEA_ID changes | Draft only. Deselecting a platform disconnects its account.                                                                                                                                                                                    |

Both numbers live in **Social Media AIgency → Pengaturan** (`sm_settings`, single row;
`minConfirmLeadMinutes ≥ lockMinutes`).

## Setup

### Google Drive (read public folders)

1. Google Cloud Console → create/select a project → **APIs & Services → Library → Google Drive API → Enable**.
2. **Credentials → Create credentials → API key**. Restrict it to _Google Drive API_.
3. Put it in `.env` as `GOOGLE_API_KEY`.
4. Share each content folder (and its files) as **"Siapa saja yang memiliki link — Viewer"**.

Without an API key Google offers no way to list a folder's files, even a public one.

### Credential encryption

`SOCIAL_CREDENTIALS_KEY` (AES-256-GCM) encrypts access tokens at rest:

```bash
openssl rand -base64 32
```

Generate it once and back it up. Ciphertexts are bound to their row (batch + platform), and tokens
are never returned by the API.

### Instagram account (per idea)

Requirements: an **Instagram professional account** (Business or Creator). No Facebook Page needed
(Instagram API with Instagram Login).

1. developers.facebook.com → create an app → add the **Instagram** product (API setup with Instagram login).
2. Add the account as an **Instagram Tester**; accept the invite in the Instagram app
   (Settings → Apps and websites → Tester invites).
3. App dashboard → Instagram → API setup → **Generate token** for that account.
4. In the batch: tick Instagram, paste the token, click **Tes & hubungkan**. The API checks the token
   with Instagram and stores the account's username and ID.

When the app has a public HTTPS domain, this can be replaced by a "Login dengan Instagram" button.

### Database

```bash
pnpm db:generate   # creates the 0001 migration for the sm_* tables — commit it
pnpm db:migrate
pnpm db:seed       # syncs the new social.* permissions
```

Then grant the permissions to roles in **Role & Akses**:
`social.publisher.view`, `social.publisher.manage`, `social.settings.manage`.

## API

All under `/api/social`; responses use the standard envelope. Mutations return the full batch.

| Method & path                                                                    | Permission                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------------- |
| `GET /settings` · `PUT /settings`                                                | publisher.view or settings.manage · settings.manage |
| `GET /batches` · `POST /batches`                                                 | publisher.view · publisher.manage                   |
| `GET /batches/:id` · `PATCH /batches/:id` · `DELETE /batches/:id`                | view · manage · manage                              |
| `POST /batches/:id/scan`                                                         | manage — Generate antrean konten                    |
| `POST /batches/:id/auto-schedule`                                                | manage — Jadwalkan semua                            |
| `PUT /batches/:id/order`                                                         | manage — drag & drop (`{ itemIds }`)                |
| `POST /batches/:id/confirm` · `POST /batches/:id/cancel`                         | manage                                              |
| `POST /batches/:id/items` · `PATCH`/`DELETE /batches/:id/items/:itemId`          | manage                                              |
| `POST /batches/:id/items/:itemId/pause` · `/resume`                              | manage                                              |
| `POST /batches/:id/items/:itemId/publish-now`                                    | manage — Unggah sekarang (`{ platform }`)           |
| `PUT /batches/:id/accounts/instagram` · `DELETE /batches/:id/accounts/:platform` | manage                                              |

## Upload engine (worker)

Enabled with `SOCIAL_PUBLISHER_ENABLED=true` (needs `GOOGLE_API_KEY` and `SOCIAL_CREDENTIALS_KEY`).
`publishers/publisher.worker.ts` runs inside the API process and polls PostgreSQL every
`SOCIAL_PUBLISHER_INTERVAL_SECONDS`. Each round:

1. **Recover** attempts left `processing` for > 45 min by a worker that died (see below).
2. **Refresh tokens** (at most hourly): Instagram long-lived tokens of unfinished batches not checked
   for 24 h and expiring within 30 days (or with unknown expiry) are extended by 60 days. A dead token
   puts the account in `error`.
3. **Manual uploads** ("Unggah sekarang", status `queued`) — before any scheduled work.
4. **First uploads**: active rows of Terjadwal batches whose schedule has come — and is **not before
   the batch's confirmation** — that have a selected platform not attempted yet. Each (row, platform) is **claimed by inserting its
   `sm_publications` row** (unique index), so it never runs twice, even with several API instances.
5. **Retries**: failed uploads whose `next_attempt_at` has come, claimed with a guarded update.
6. **Completion**: a Terjadwal batch whose every row is published on every selected platform becomes
   **Selesai** (`completed`). Paused rows keep the batch open.

### Instagram publisher

`publishers/instagram.publisher.ts` (Instagram API with Instagram Login, `graph.instagram.com`,
version in `INSTAGRAM_API_VERSION`):

Drive video → temp file (`$TMPDIR/ai-preneur-publisher`, max 1 GB, deleted right after) → Reels
container (`upload_type=resumable`, caption + hashtag block cut to 2,200 characters, `share_to_feed`,
`cover_url` = the Drive thumbnail) → bytes to `rupload.facebook.com` → poll every 10 s until
`FINISHED` (max 15 min) → `media_publish` → permalink. If the container fails while a cover was set,
it is created again **without the cover** (Instagram could not fetch it). One attempt is aborted
after 30 min.

### Retries and failures

| Error                                                        | What happens                                                                                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temporary (network, Instagram 5xx/rate limit, Drive down)    | Retry after 5 min, 30 min, 2 h — **4 attempts in total**                                                                                                                                      |
| Permanent (video rejected, file missing/private, no account) | Failed, no automatic retry                                                                                                                                                                    |
| Token invalid/expired                                        | Failed, account → `error`; other rows of the idea fail                                                                                                                                        |
| Server stopped mid-upload, before "publish"                  | Retried on the next round                                                                                                                                                                     |
| Server stopped during "publish"                              | Container checked: published → the post is looked up among the account's latest media (same caption) to get its link; otherwise retried; unknown → failed without retry ("periksa Instagram") |

**Published with a caveat** (`warning_message`): the row is published, and an amber "!" next to the
platform chip explains what the user should check — the video went up **without the cover**
(Instagram could not fetch the Drive thumbnail) and/or **the link could not be retrieved**. Instagram
gives no explicit confirmation that a cover was applied; only a rejected cover is detectable.

In Draft, giving a failed row a new schedule (edit or resume) clears its failed uploads so it uploads
afresh. An account in `error` needs: Batalkan jadwal → hubungkan ulang → Konfirmasi.

### Unggah manual ("Unggah sekarang")

Every row shows a chip **per selected platform**. Clicking it opens one dialog that follows the
upload live (the page polls every 3 s while something uploads):

| Chip                | Meaning                                   | Click                                  |
| ------------------- | ----------------------------------------- | -------------------------------------- |
| Brand colour + link | Published                                 | Opens the video ("!" = caveat)         |
| Grey, spinning      | Queued / uploading                        | Progress (steps, download %)           |
| Red / amber         | Failed (amber = automatic retry pending)  | Error, retry info, **Unggah sekarang** |
| White, dashed       | **Terlewat**: never uploads automatically | **Unggah sekarang?** (title + confirm) |
| White               | Not uploaded yet                          | **Unggah sekarang?** when allowed      |

Rules (`manualUploadBlock` in `domain/queue-rules.ts`, enforced by `POST …/publish-now`):

- Batch **Terjadwal or Selesai** (not Draft); worker enabled (`SOCIAL_PUBLISHER_ENABLED=true`).
- Row **not paused**, has a video, account connected; not published/queued/uploading there.
- A **future** schedule less than `lockMinutes` away locks it (like every edit). A past schedule
  does not — that is the failed/missed case. A future schedule further away = upload early; the
  schedule then no longer triggers an upload.
- No re-upload of a published row (it would post twice).
- If a manual upload **fails ahead of a future schedule**, the row uploads automatically at that
  schedule; with a past schedule the normal retry policy applies.
- **Terlewat**: a row never attempted on a platform whose schedule is before the batch's
  confirmation (e.g. a platform added later, on rows already published elsewhere) is skipped by the
  worker and only uploads manually.
- "Batalkan jadwal" is refused while an upload is queued or running.

Progress steps (`sm_publications.progress_stage` / `progress_percent`): Antre → Mengunduh dari Google
Drive (%) → Mengunggah video → Diproses platform → Mempublikasikan.

### Next

- Generate caption & hashtag with AI (button present, disabled — `// TODO` in `QueueSection.tsx`).
- TikTok, Facebook Reels, YouTube Shorts publishers and account connection.
- "Login dengan Instagram" (OAuth) once the app has an HTTPS domain.
- Intelligence AIgency.
