# Social Media AIgency

```text
Social Media AIgency
├── Publisher AIgent      Tahap 1 done — queue, schedule, accounts (upload engine: Tahap 2)
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
   └── thumbnail/
       ├── 2.1-apa-akuaponik.png
       └── 2.2-model-akuaponik-part1.png …
   ```

   `2.2-model-akuaponik-part1` → IDEA_ID `2`, TOPIC_ID `2`, part `1`, title "Model akuaponik".
   - IDEA_ID of the batch = the most common prefix; when no file has one, the next free number.
   - Files that don't follow the pattern are still added, with an automatic TOPIC_ID.
   - Thumbnails match videos by identical name (any of png/jpg/jpeg/webp).
   - Every oddity (non-video file, missing thumbnail, unused thumbnail, IDEA_ID mismatch, duplicate
     topic/part) is reported back — nothing is skipped silently.
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

| Rule | Detail |
|------|--------|
| Lock window | While a batch is Terjadwal, a row whose upload is less than **`lockMinutes`** away (default 30) can't be edited, moved, paused or deleted. Uploaded/uploading rows are always read-only. Paused rows never upload, so they aren't time-locked. |
| Confirmation | Allowed when every active row has a video and a schedule, every selected platform has a connected account, and the **first upload is at least `minConfirmLeadMinutes`** away (default 60). |
| Reorder | Time slots stay at their positions: the row dropped at position *n* takes position *n*'s time. Locked rows can't move or be shifted. In a scheduled batch an active row can't receive an empty or too-close slot. |
| Delete / pause | Other rows keep their schedules (no shifting). Resuming in a scheduled batch requires a new schedule outside the lock window. |
| Edits while scheduled | New or changed schedules must be at least `lockMinutes` from now. |
| Platform/account/folder/IDEA_ID changes | Draft only. Deselecting a platform disconnects its account. |

Both numbers live in **Social Media AIgency → Pengaturan** (`sm_settings`, single row;
`minConfirmLeadMinutes ≥ lockMinutes`).

## Setup

### Google Drive (read public folders)

1. Google Cloud Console → create/select a project → **APIs & Services → Library → Google Drive API → Enable**.
2. **Credentials → Create credentials → API key**. Restrict it to *Google Drive API*.
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

| Method & path | Permission |
|---|---|
| `GET /settings` · `PUT /settings` | publisher.view or settings.manage · settings.manage |
| `GET /batches` · `POST /batches` | publisher.view · publisher.manage |
| `GET /batches/:id` · `PATCH /batches/:id` · `DELETE /batches/:id` | view · manage · manage |
| `POST /batches/:id/scan` | manage — Generate antrean konten |
| `POST /batches/:id/auto-schedule` | manage — Jadwalkan semua |
| `PUT /batches/:id/order` | manage — drag & drop (`{ itemIds }`) |
| `POST /batches/:id/confirm` · `POST /batches/:id/cancel` | manage |
| `POST /batches/:id/items` · `PATCH`/`DELETE /batches/:id/items/:itemId` | manage |
| `POST /batches/:id/items/:itemId/pause` · `/resume` | manage |
| `PUT /batches/:id/accounts/instagram` · `DELETE /batches/:id/accounts/:platform` | manage |

## Upload engine (worker)

`publishers/publisher.worker.ts` polls PostgreSQL every `SOCIAL_PUBLISHER_INTERVAL_SECONDS` for rows of
scheduled batches whose time has come. Each (row, platform) upload is **claimed by inserting its
`sm_publications` row** (unique index), so an upload can never run twice, even with several API
instances. The worker is **off** (`SOCIAL_PUBLISHER_ENABLED=false`) until a publisher exists.

### Tahap 2 — TODO

- Instagram publisher (`publishers/instagram.publisher.ts`): download from Drive → resumable Reels
  upload → poll container → publish → permalink; long-lived token refresh.
- Retry policy for failed uploads; recovery of rows stuck in `processing`; mark batches `completed`.
- Generate caption & hashtag with AI (button present, disabled — `// TODO` in `QueueSection.tsx`).
- TikTok, Facebook Reels, YouTube Shorts publishers and account connection.
- "Login dengan Instagram" (OAuth) once the app has an HTTPS domain.
- Intelligence AIgency.
