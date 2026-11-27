# Social Media AIgency

```text
Social Media AIgency
├── Publisher AIgent      Tahap 1 + 2 done — queue, schedule, accounts, real uploads to Instagram
├── Performance AIgent    lite — live account & post insights per idea (Instagram; others "Segera hadir")
├── Analysis Engine                     (sub-menu with two pages)
│   ├── Data Collection AIgent           comments + DMs per idea collected incrementally (Instagram)
│   └── Audience Insight Analysis AIgent "Segera hadir" — AI analysis of the collected data
└── Pengaturan            lock window, confirmation lead time
```

Backend module: `apps/api/src/modules/social-media` · tables: `packages/database/src/schema/social-media.schema.ts`
· contracts: `packages/shared/src/schemas/social.ts`, `social-performance.ts`, `social-analysis.ts`
· UI: `apps/web/src/pages/social` (Performance AIgent: `pages/social/performance`, Analysis Engine:
`pages/social/analysis`).

## Publisher AIgent — how it works

1. **Batch = one idea.** Create a batch with the idea's **title** (max 200), an optional
   **description** (max 2,000; shown as a 2-line preview in the batch list) and a Google Drive
   folder link.
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
   - IDEA_ID of the batch = the most common prefix; when no file has one, the batch keeps its own.
   - **IDEA_ID is unique per idea** (unique index `sm_batches_idea_number_unique`). A new batch
     gets `max + 1` (serialized by an advisory lock, so parallel creates never collide). Editing it
     to a number another idea uses is refused next to the field; a scan whose file names carry
     another idea's IDEA_ID is refused (409) and the queue is left untouched — rename the files or
     change the other idea's IDEA_ID first. Migration 0004 renumbered existing duplicates: the
     oldest batch kept the number, newer ones got the next free numbers.
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
   - While **nothing has been uploaded**, regenerating replaces the queue. **Once something was
     uploaded**, it only **appends the folder's videos that are not in the queue yet** (by Drive
     file ID) at the end, without a schedule; every existing row stays as it is. The report says how
     many were added and how many were already queued (notes about those are left out). A video
     deleted from the queue earlier comes back if its file is still in the folder.

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
8. **Selesai** only means "every video has been uploaded" — not final. The idea can still get new
   videos (Generate antrean konten / Tambah baris), edits on rows not uploaded yet, a new
   folder/IDEA_ID/platform/account. Such a change turns it back into **Draft**
   (`reopenIfCompleted`), and it needs **Konfirmasi jadwal** again; uploaded rows keep their history
   and stay read-only, and confirmation ignores them. Renaming the idea (title/description) keeps
   the status.
9. **Arsip**: an idea in **Draft or Selesai** (not Terjadwal, not while an upload is queued/running)
   can be archived (`archived_at`, migration 0005). Archived ideas are read-only and never upload
   (also no "Unggah sekarang"); they keep their IDEA_ID and accounts (an archived idea's account
   can't serve another idea until the archive is opened and the account disconnected). **Buka arsip**
   returns it to the status it had. The idea lists of Publisher and Performance AIgent have a filter
   **Aktif / Arsip** (default Aktif, `?filter=arsip` in the URL).

### Rules (enforced by the API, mirrored by the UI)

| Rule                                    | Detail                                                                                                                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lock window                             | While a batch is Terjadwal, a row whose upload is less than **`lockMinutes`** away (default 30) can't be edited, moved, paused or deleted. Uploaded/uploading rows are always read-only. Paused rows never upload, so they aren't time-locked. |
| Confirmation                            | Allowed when every active row has a video and a schedule, every selected platform has a connected account, and the **first upload is at least `minConfirmLeadMinutes`** away (default 60).                                                     |
| Reorder                                 | Time slots stay at their positions: the row dropped at position _n_ takes position _n_'s time. Locked rows can't move or be shifted. In a scheduled batch an active row can't receive an empty or too-close slot.                              |
| Delete / pause                          | Other rows keep their schedules (no shifting). Resuming in a scheduled batch requires a new schedule outside the lock window.                                                                                                                  |
| Edits while scheduled                   | New or changed schedules must be at least `lockMinutes` from now.                                                                                                                                                                              |
| Platform/account/folder/IDEA_ID changes | Draft or Selesai (→ Draft). Deselecting a platform disconnects its account.                                                                                                                                                                    |
| Archived                                | Everything refused except **Buka arsip**; title edits too.                                                                                                                                                                                     |

Both numbers live in **Social Media AIgency → Pengaturan** (`sm_settings`, single row;
`minConfirmLeadMinutes ≥ lockMinutes`).

## Performance AIgent (lite)

Shows how each idea's connected accounts perform, read **live from the platform — nothing is
stored** (no tables, no worker). The accounts are the ones connected per idea in Publisher AIgent.

- **List** (`/social/performance`): one card per idea with its account per platform (connected /
  needs reconnecting / not connected / "Segera hadir") and, for Instagram, followers plus 7-day
  views and interactions.
- **Detail** (`/social/performance/:id`): tabs Instagram · TikTok · Facebook Reels · YouTube
  Shorts. Only Instagram works; the other tabs say "Segera hadir".
- **Instagram tab**: range 7 / 14 / 30 days (Instagram accepts at most 30 days per account
  request), "Perbarui", and the time the data was fetched.
  - Profile: username, name, followers, following, posts.
  - Totals over the range: views, reach, accounts engaged, total interactions, likes, comments,
    shares, saves, profile link taps, new follows and unfollows (`follows_and_unfollows` by
    `follow_type`).
  - Daily charts: reach (`metric_type=time_series`) and new followers (`follower_count`).
  - **Every post** of the account (not only Publisher uploads), 20 per page with "Muat lebih
    banyak": views, reach, likes, comments, shares, saves, average watch time and 3-second skip
    rate (Reels), plus a "views per post" chart. Posts uploaded by Publisher AIgent are matched
    through `sm_publications.external_media_id` and show their topic/part and title.
- "—" means Instagram returned nothing for that metric. Several account metrics (e.g. new
  followers) are missing for accounts with fewer than 100 followers; account data only goes back
  ~90 days. A metric Instagram refuses never hides the others: metrics are asked for together and,
  if Instagram rejects the combination, one by one. Newer post metrics (`reels_skip_rate`,
  `reposts`) are asked for separately. A post without insights (e.g. posted before the account
  became professional) keeps its likes/comments and shows "Insight tidak tersedia".
- Answers are cached **5 minutes in memory** per account (and per token, so reconnecting starts
  fresh); "Perbarui" bypasses the cache. Failures are not cached.

**Token permission.** Reading insights needs `instagram_manage_insights` (Unified login, `EAA…`)
or `instagram_business_manage_insights` (Instagram Login, `IG…`). Without it the page says so:
create a new token with that permission and reconnect the account in Publisher AIgent (Terjadwal:
Batalkan jadwal → hubungkan ulang → Konfirmasi; Selesai: hubungkan ulang directly → Draft →
Konfirmasi). Accounts in `error` are not queried. Archived ideas are listed under the **Arsip**
filter and their performance can still be read.

Code: `integrations/instagram-insights.client.ts` (Graph calls),
`services/performance.service.ts` (accounts, cache, errors), routes in `routes/social.routes.ts`.

## Analysis Engine — Data Collection AIgent

Collects the **comments** (text, author, the post it was written on, time, likes, replies) and
**DMs** (conversation partner, text, direction, attachment kinds, time) of each idea's connected
Instagram account **into the database**, so the coming Audience Insight Analysis AIgent can work on
them. Sidebar: Social Media AIgency → **Analysis Engine** (a sub-group) → two menus:
**Data Collection AIgent** (`/social/analysis/collection`, ideas with Aktif/Arsip filter; detail
`/social/analysis/collection/:id`) and **Audience Insight Analysis AIgent**
(`/social/analysis/insight`, "Segera hadir"). `/social/analysis` redirects to the first. Both use
`social.analysis.view` for now. The sidebar supports nested groups (`NavGroupItem.children` may
hold groups; labels of nested items wrap instead of being cut).

**Buttons.** The first press is **Ambil data (90 hari terakhir)**; once that finished, the button is
**Perbarui data**. Both start a background collection inside the API process (`202`); the page polls
`…/status` every 3 s and shows the step (postingan → komentar → DM) and what was added so far. One
collection per account at a time (partial unique index `sm_collection_runs_one_running`). Archived
ideas can still be collected (comments keep coming in on their posts).

**Incremental fetch** (`services/collection.service.ts`):

| Data     | How only new data is read                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Posts    | All posts of the account inside the window (from `windowStart` = first fetch − 90 days), newest first; listing stops at the first older post. New posts are added, known ones get their `comments_count` refreshed.                                                                                                                                                            |
| Comments | Instagram **can't filter comments by time** (max 50 per page). Only posts whose `comments_count` differs from the count last read completely (`comments_synced_count`) are opened. Pages are read until a page is entirely known **and** the stored count reaches the reported one (so a new reply on an old comment is still found). Upsert by comment ID — never duplicated. |
| DMs      | Conversations come most recently active first with `updated_time`; only those newer than `dm_watermark` (the newest conversation fully read) are opened. Messages are inserted by ID.                                                                                                                                                                                          |

Everything is idempotent: a failed or cut-off collection is continued by the next press (posts
already synced are not read again). A collection whose heartbeat stopped for 10 minutes (server
restarted) is marked failed with that explanation.

**Errors.** Token invalid, rate limit or network → the collection fails (data already stored stays,
message on the page and in Riwayat). A DM-only problem (missing `instagram_manage_messages`,
unsupported setup) does **not** fail it: comments are collected and the DM problem becomes a
warning.

**Instagram limits shown to the user** ("Batasan data dari Instagram" on the page):

- Only the **20 latest messages** of a conversation can be read. A conversation with older messages
  that couldn't be read (new conversation with > 20 messages, or > 20 new messages since the last
  fetch) is flagged `possibly_incomplete` ("Tidak lengkap") and the run carries a warning — update
  often.
- Conversations in the Requests folder inactive for 30 days are not returned.
- Deleted comments/messages stay stored (the API doesn't report deletions).
- **DMs with a Unified login token (`EAA…`)**: Meta documents reading Instagram conversations on
  `graph.facebook.com` through a **Facebook Page** linked to the Instagram account. The app asks
  `/{ig-user-id}/conversations?platform=instagram`; if Instagram refuses, the warning says so and
  suggests linking a Page. Not verified against the real API yet.

**Permissions on the token**: `instagram_manage_comments` and `instagram_manage_messages` (Unified
login) or `instagram_business_manage_comments` and `instagram_business_manage_messages` (Instagram
Login). After adding them, reconnect the account in Publisher AIgent. Collected data is keyed by
idea + platform + **platform account ID** (`sm_collection_sources`), not by the `sm_accounts` row,
so reconnecting (even disconnect + connect) the same account keeps everything; when no account is
connected, the idea's latest collected data is still shown (read-only).

**Views**: Komentar (search text/username, filter by post and by author: all / audience / own
account; 50 per page; replies marked, own account's comments badged "Akun ini"), DM (conversation
list with search over username and message text, chat view), Riwayat pengambilan (last 20 runs:
type, status, what was added, errors/warnings).

Tables (migration `0006`): `sm_collection_sources`, `sm_collection_runs`, `sm_collected_posts`,
`sm_comments`, `sm_dm_conversations`, `sm_dm_messages`. DM text is stored as plain text in the
database — treat database backups accordingly.

Code: `integrations/instagram-engagement.client.ts` (Graph calls),
`repositories/collection.repository.ts`, `services/collection.service.ts`,
`services/instagram-access.ts` (account + token for the read-only agents, shared with Performance
AIgent).

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

Requirements: an **Instagram professional account** (Business or Creator). No Facebook Page needed.
Two kinds of token work; the API tells them apart by prefix (`instagramTokenKind`):

| Token  | Setup in the Meta app                       | Host                  | Expiry                                   |
| ------ | ------------------------------------------- | --------------------- | ---------------------------------------- |
| `EAA…` | **API setup with Unified login** (new apps) | `graph.facebook.com`  | Never (system-user token), checked daily |
| `IG…`  | API setup with Instagram login (legacy)     | `graph.instagram.com` | 60 days, refreshed automatically         |

Since late October 2026 Meta no longer offers "API setup with Instagram login" to new apps, so new
apps use **Unified login**:

1. Create a **business portfolio** (business.facebook.com) and add the Instagram account to it
   (Settings → Accounts → Instagram accounts), with yourself assigned to it.
2. developers.facebook.com → create an app with the use case **"Manage messaging & content on
   Instagram"** and connect it to that portfolio.
3. Use cases → Customize → **API setup with Unified login** → **Create configuration**: system-user
   access token, never expires, asset = Instagram account, permissions `instagram_basic` and
   `instagram_content_publish`, plus `instagram_manage_insights` for Performance AIgent and
   `instagram_manage_comments` + `instagram_manage_messages` for the Data Collection AIgent. The
   redirect URL is only needed for a future OAuth button.
4. App roles → Roles → add the account as **Instagram Tester**; accept the invite at
   instagram.com/accounts/manage_access (Tester invites).
5. Back in step 2 of that page ("Buat token akses") → **Add account** → generate the token (`EAA…`).
   Check it with
   `curl "https://graph.facebook.com/v25.0/me/assigned_instagram_accounts?fields=id,username&access_token=TOKEN"`.
6. In the batch: tick Instagram, paste the token, click **Tes & hubungkan**. The API lists the
   accounts the token can reach (`POST …/accounts/instagram/lookup`, nothing stored). One account →
   connected right away; several (one portfolio token, many accounts) → pick one in the dropdown,
   then **Hubungkan**. Accounts already used by another idea are disabled in the list.

When the app has a public HTTPS domain, this can be replaced by a "Login dengan Instagram" button.

### Database

```bash
pnpm db:generate   # only after a schema change; the sm_* migrations (0001–0006) are committed
pnpm db:migrate
pnpm db:seed       # syncs the new social.* permissions
```

Then grant the permissions to roles in **Role & Akses**:
`social.publisher.view`, `social.publisher.manage`, `social.settings.manage`,
`social.performance.view` (Performance AIgent), `social.analysis.view` and
`social.analysis.collect` (Analysis Engine: view data · Ambil/Perbarui data). Super Admin has every
permission automatically.

## API

All under `/api/social`; responses use the standard envelope. Mutations return the full batch.

| Method & path                                                                    | Permission                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------------- |
| `GET /settings` · `PUT /settings`                                                | publisher.view or settings.manage · settings.manage |
| `GET /batches?filter=active\|archived` · `POST /batches`                         | publisher.view · publisher.manage                   |
| `GET /batches/:id` · `PATCH /batches/:id` · `DELETE /batches/:id`                | view · manage · manage                              |
| `POST /batches/:id/scan`                                                         | manage — Generate antrean konten                    |
| `POST /batches/:id/auto-schedule`                                                | manage — Jadwalkan semua                            |
| `PUT /batches/:id/order`                                                         | manage — drag & drop (`{ itemIds }`)                |
| `POST /batches/:id/confirm` · `POST /batches/:id/cancel`                         | manage                                              |
| `POST /batches/:id/archive` · `POST /batches/:id/unarchive`                      | manage — Arsipkan (Draft/Selesai) · Buka arsip      |
| `POST /batches/:id/items` · `PATCH`/`DELETE /batches/:id/items/:itemId`          | manage                                              |
| `POST /batches/:id/items/:itemId/pause` · `/resume`                              | manage                                              |
| `POST /batches/:id/items/:itemId/publish-now`                                    | manage — Unggah sekarang (`{ platform }`)           |
| `POST /batches/:id/accounts/instagram/lookup`                                    | manage — Tes token (`{ accessToken }` → accounts)   |
| `PUT /batches/:id/accounts/instagram` · `DELETE /batches/:id/accounts/:platform` | manage (`{ accessToken, instagramAccountId? }`)     |
| `GET /performance/ideas?filter=active\|archived` · `GET /performance/ideas/:id`  | performance.view                                    |
| `GET /performance/ideas/:id/instagram/overview?days=7\|14\|30&refresh=true`      | performance.view — profile, totals, daily charts    |
| `GET /performance/ideas/:id/instagram/media?after=<cursor>&refresh=true`         | performance.view — posts with metrics (20/page)     |
| `GET /analysis/ideas?filter=active\|archived` · `GET /analysis/ideas/:id`        | analysis.view — ideas with collected counts         |
| `GET /analysis/ideas/:id/instagram/status`                                       | analysis.view — summary, running/last run           |
| `POST /analysis/ideas/:id/instagram/collect`                                     | analysis.collect — Ambil data / Perbarui data (202) |
| `GET /analysis/ideas/:id/instagram/runs`                                         | analysis.view — Riwayat (last 20)                   |
| `GET /analysis/ideas/:id/instagram/posts`                                        | analysis.view — collected posts (filter list)       |
| `GET /analysis/ideas/:id/instagram/comments?page&q&postId&author`                | analysis.view — 50/page                             |
| `GET /analysis/ideas/:id/instagram/conversations?page&q` · `…/:conversationId`   | analysis.view — 30/page · messages                  |

## Upload engine (worker)

Enabled with `SOCIAL_PUBLISHER_ENABLED=true` (needs `GOOGLE_API_KEY` and `SOCIAL_CREDENTIALS_KEY`).
`publishers/publisher.worker.ts` runs inside the API process and polls PostgreSQL every
`SOCIAL_PUBLISHER_INTERVAL_SECONDS`. Each round:

1. **Recover** attempts left `processing` for > 45 min by a worker that died (see below).
2. **Refresh tokens** (at most hourly): Instagram Login tokens (`IG…`) of unfinished batches not
   checked for 24 h and expiring within 30 days (or with unknown expiry) are extended by 60 days.
   Unified login tokens (`EAA…`) never expire; they are only checked every 24 h (token still valid and
   still reaching an account). A dead token puts the account in `error`.
3. **Manual uploads** ("Unggah sekarang", status `queued`) — before any scheduled work.
4. **First uploads**: active rows of Terjadwal batches whose schedule has come — and is **not before
   the batch's confirmation** — that have a selected platform not attempted yet. Each (row, platform) is **claimed by inserting its
   `sm_publications` row** (unique index), so it never runs twice, even with several API instances.
5. **Retries**: failed uploads whose `next_attempt_at` has come, claimed with a guarded update.
6. **Completion**: a Terjadwal batch whose every row is published on every selected platform becomes
   **Selesai** (`completed`). Paused rows keep the batch open.

### Instagram publisher

`publishers/instagram.publisher.ts` (`graph.facebook.com` for Unified login tokens,
`graph.instagram.com` for Instagram Login tokens — same endpoints; version in
`INSTAGRAM_API_VERSION`):

Drive video → temp file (`$TMPDIR/ai-preneur-publisher`, max 1 GB, deleted right after) → Reels
container (`upload_type=resumable`, caption + hashtag block cut to 2,200 characters, `share_to_feed`,
`cover_url` = the Drive thumbnail) → bytes to `rupload.facebook.com` (it often answers 400
`ProcessingFailedError` although the file arrived; the container status then decides — FINISHED /
IN_PROGRESS = continue, otherwise the error shows rupload's own `debug_info.type — message`; the
bytes are never sent twice) → poll every 10 s until
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
- Performance AIgent: TikTok / Facebook / YouTube tabs once those accounts can be connected;
  stored snapshots (history beyond Instagram's ~90 days) to be re-evaluated later.
- Audience Insight Analysis AIgent (what to analyse is still to be decided).
- Data Collection AIgent for TikTok / Facebook / YouTube; replying to comments/DMs.
