# Spectra — Running Project Analysis Log

> Living document. Updated every analysis pass. Goal: full line-by-line understanding
> of the codebase, current lifecycle stage, risks, gaps, and a prioritized fix list.
> Nothing is skipped — every file is read in full before being marked "reviewed".

---

## Pass 1 — 2026-07-15

### Analysis Progress Tracker

| Area | File | Lines | Status |
|---|---|---|---|
| Docs | `README.md` | 307 | ✅ Reviewed |
| Config | `package.json` | 21 | ✅ Reviewed |
| Config | `wrangler.jsonc` | 20 | ✅ Reviewed |
| Config | `tsconfig.json` | 15 | ✅ Reviewed |
| Config | `vite.config.ts` | 14 | ✅ Reviewed |
| Config | `ecosystem.config.cjs` | 16 | ✅ Reviewed |
| Config | `.gitignore` | 32 | ✅ Reviewed |
| Migration | `migrations/0001_initial.sql` | 90 | ✅ Reviewed |
| Migration | `migrations/0002_upgrade_fields.sql` | 7 | ✅ Reviewed |
| Migration | `migrations/0003_shot_order.sql` | 5 | ✅ Reviewed |
| Migration | `migrations/0004_campaigns.sql` | 18 | ✅ Reviewed |
| Migration | `migrations/0005_distribution.sql` | 66 | ✅ Reviewed |
| Migration | `migrations/0006_distribution_batch.sql` | 4 | ✅ Reviewed |
| Migration | `migrations/0007_platform_connections.sql` | 16 | ✅ Reviewed |
| Worker | `workers/scheduler.ts` | 252 | ✅ Reviewed |
| Worker | `workers/wrangler.toml` | 12 | ✅ Reviewed |
| Backend | `src/renderer.tsx` | 12 | ✅ Reviewed |
| Backend | `src/index.tsx` | 6880 | 🟡 **Lines 1–2300 reviewed (~33%)** |
| Frontend JS | `public/static/video-generator.js` | 5557 | ⬜ Not started |
| Frontend JS | `public/static/distribution.js` | 1998 | ⬜ Not started |
| Frontend JS | `public/static/attention-engine.js` | 1821 | ⬜ Not started |
| Frontend JS | `public/static/main.js` | 1267 | ⬜ Not started |
| Frontend CSS | `public/static/video-generator.css` | 3609 | ⬜ Not started |
| Frontend CSS | `public/static/distribution.css` | 2646 | ⬜ Not started |
| Frontend CSS | `public/static/attention-engine.css` | 2420 | ⬜ Not started |
| Frontend CSS | `public/static/style.css` | 915 | ⬜ Not started |
| Build output | `dist/` (worker + static, generated) | — | ⬜ Not diffed vs source |

**Total project size**: ~27,600 lines (excl. `node_modules`, `.git`, `.wrangler`, `dist`).

---

### Project Identity

- **Codename**: Spectra
- **Category**: AI filmmaking / video production SaaS — full-stack single Cloudflare Pages app
- **Stack**: Hono (backend framework) + Hono/JSX (server-rendered HTML, no separate frontend framework) + vanilla JS/CSS on the client + Cloudflare D1 (SQLite) + Cloudflare R2 (object storage) + OpenAI SDK pointed at OpenRouter (gpt-4o) + Higgsfield (external video-gen API) + Stripe (billing) + Instagram Graph API + YouTube Data API v3, plus a **separate standalone Cloudflare Worker** for cron-based scheduled social posting.
- **Deployment target**: Cloudflare Pages, project name `spectra`, production URL `spectra-b8s.pages.dev`. Deployed via `wrangler pages deploy dist --project-name spectra`.
- **Architecture pattern**: monolithic backend (`src/index.tsx`, 6880 lines) containing **all** API routes AND all page HTML (returned as JSX/raw strings) for 6 sub-tools, backed by hand-rolled Web Crypto auth (no external auth provider), hand-rolled encryption for secrets at rest, and a second independently-deployed Worker (`workers/scheduler.ts`) that shares the same D1 database for the cron publishing job.

### Lifecycle Stage Assessment (based on git log + README + code read so far)

This is **not an early-stage or prototype project** — it is a mature, actively-iterated MVP/beta with substantial completed feature surface area, per the git history (30+ commits shown, feature-by-feature build-out: auth → billing → character memory → distribution engine v1→v3 → attention engine → admin panel → shot comparison/timeline editor). The commit messages show a disciplined, incremental style (`feat:`, `fix:`, `docs:`, `polish:`) with real bug fixes (infinite recursion crash, duplicate const declarations, auth gate bugs) — indicating this has been through real usage/testing cycles, not just written and abandoned.

**Current stage: Beta / pre-launch hardening.** Core generation pipeline, auth, billing scaffolding, and one full secondary product (Distribution Engine v3) are functionally complete in code. The project is blocked from full production readiness by **external configuration/secrets**, not by missing code:
1. Stripe price IDs are literal placeholder strings (`price_creator_monthly` etc.) — checkout will fail until real Stripe Dashboard price IDs are substituted.
2. `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` not set as Cloudflare secrets yet (per README; unverified independently — cannot inspect live CF secrets from sandbox).
3. `INSTAGRAM_CLIENT_SECRET` / `YOUTUBE_CLIENT_SECRET` not set — Distribution Engine OAuth code path exists and looks complete, but the callback route (line ~2210) will silently send an empty `client_secret` since it defaults to `''`, causing token exchange to fail at Meta/Google.
4. The Cron Scheduler Worker (`workers/scheduler.ts`) is a **separate deployable** from the Pages app and per README has not been deployed yet — meaning scheduled distribution posts, if created via the app, will never actually fire in production until `cd workers && npx wrangler deploy` is run AND `ENCRYPTION_KEY` is duplicated as a secret on that Worker too (it decrypts the same encrypted tokens using the same key — confirmed by reading `importKey`/`decryptKey` in scheduler.ts, which mirrors the main app's AES-256-GCM implementation exactly).
5. Two tools (Motion Engine, Persona Engine) are UI shells only, no backend routes found yet in the 33% of `index.tsx` reviewed so far (will confirm/deny in next pass).

### Architecture Observations & Early Risk Notes (from Pass 1 code read)

1. **Data model duplication risk — CONFIRMED NEEDS INVESTIGATION**: `migrations/0005_distribution.sql` creates `social_accounts` (id, user_id, platform, access_token, refresh_token, token_expiry, scopes...) specifically for Instagram/YouTube OAuth used by the Distribution Engine. `migrations/0007_platform_connections.sql` (later migration) creates an almost-identical `platform_connections` table (user_id, platform, access_token_enc/iv, refresh_token_enc/iv, channel_id, channel_name) that also targets `youtube`, `bluesky`, `instagram`. This looks like a **second, structurally different OAuth-token table bolted on later** (probably for the Attention Engine's own "platform connections" feature, per git log entry `4524571 feat: YouTube OAuth + Bluesky connect — Attention Engine platform connections`). Two independent encrypted-token stores for overlapping platforms is a maintenance and security-surface risk (two decrypt code paths, two places tokens can go stale/leak, unclear which one is authoritative for a given platform in a given tool). **Action item**: trace all read/write usage of both tables in the unread 67% of `index.tsx` to determine if this is intentional tool-separation (Distribution Engine uses `social_accounts`, Attention Engine uses `platform_connections`) or accidental duplication.

2. **Auth is fully custom, no third-party identity provider.** PBKDF2 (100,000 iterations, SHA-256) for password hashing, random 32-byte base64 session tokens stored server-side in a `sessions` table with 30-day expiry, constant-time comparison via HMAC-based `safeCompare`. This is a reasonable, defensible hand-rolled approach — no glaring flaws spotted yet in what's read (no obvious timing attack, no plaintext password logging observed). Session cookie is `httpOnly`, `secure`, `sameSite: Lax` — correct flags.

3. **Encryption**: AES-256-GCM via Web Crypto, correctly using per-encryption random 12-byte IV, key supplied via `ENCRYPTION_KEY` env secret (expected as a 64-char hex string sliced to 32 bytes). Used consistently for: Higgsfield API keys, OAuth access/refresh tokens (both table variants). No key rotation mechanism visible yet — a single static `ENCRYPTION_KEY` env var is the entire security boundary for every stored secret in the system. If this key is ever leaked, **all** stored user API keys and OAuth tokens across all users are compromised retroactively (no per-user salt visible in the encryption call — only iv changes per encryption, key is global). This is an acceptable pattern for solo/MVP scale but should be flagged for future hardening (e.g., envelope encryption, per-user derived subkeys).

4. **CORS policy** (line ~532): restricts `credentials: true` cross-origin requests to `*.pages.dev` + localhost only — correctly avoids the wildcard-origin + credentials anti-pattern. Good practice.

5. **Tier enforcement** is checked in at least two places for project-count and shot-count (`checkTierLimits()` helper AND inline duplicate logic directly in `POST /api/projects` and `POST /api/generate`) — the helper function `checkTierLimits` appears to be defined but I have not yet found it actually being *called* anywhere in the reviewed 2300 lines; the two route handlers re-implement the same COUNT query inline instead of calling the helper. This is **dead code / DRY violation** to confirm in next pass (grep for `checkTierLimits(` call sites).

6. **Stripe webhook security**: signature verification (`verifyStripeSignature`) is implemented correctly — parses `t=`/`v1=` from header, HMAC-SHA256 over `${timestamp}.${payload}`, hex compare. This is correct per Stripe's documented scheme (though no timestamp-tolerance/replay-window check is present — a very old but validly-signed webhook payload would still be accepted; low real-world risk but worth noting).

7. **`/api/video/:key` and `/api/image/:key` are intentionally public/unauthenticated** (confirmed by git log `547aa3f fix: make /api/image and /api/video serve routes public (no requireAuth)` and by direct code inspection — no `requireAuth` middleware on those two routes). Security relies entirely on R2 keys being unguessable UUIDs embedded in the URL path. This is a reasonable tradeoff (Higgsfield's external API needs to fetch these URLs without auth headers) but means **anyone with a leaked/logged URL has permanent access** to that user's video/image — no expiry, no per-request auth check. Acceptable for MVP, worth flagging for the "known tradeoffs" section.

8. **AI Creative Director (`/api/director`)** and both prompt-enhancement functions degrade gracefully — wrapped in try/catch that falls back to the original unenhanced prompt on any OpenAI/OpenRouter failure. Good defensive design; the app never hard-fails generation just because the enhancement step failed.

9. **Attention Engine scoring math** (`computeWeightedScore`, `baseRetention`, `buildSegments`) is a deliberately-designed heuristic/simulation system, not a raw pass-through of real platform analytics — it uses `Math.random()` inside `baseRetention()` to inject jitter into retention curves per content type (music_video, commercial, short_form_ad, tutorial, vlog, documentary, product_demo, organic_video). This means **retention/drop-off visualizations in the Attention Engine are synthetic/simulated, not measured from real audience data**, unless real per-second retention data is separately fed in elsewhere (need to check the `/api/attention/analyze` route body in unread portion to see if real data can override this simulation, or if it's always synthetic).

10. **Generation pipeline correctness**: `/api/generate` → decrypts Higgsfield credentials → enhances prompt (mode + style-preset aware) → creates `shots` row as `pending` → resolves relative image URLs to absolute (needed because Higgsfield fetches the URL server-side, can't resolve relative paths) → submits to Higgsfield → updates row to `queued` with `hf_request_id` → increments project shot_count. Client is expected to poll `/api/shots/:id/status`, which itself lazily calls Higgsfield's status endpoint, updates D1 on status transitions, and on `completed` triggers the R2 permanent-copy side effect. This is a **pull-based polling architecture**, not push/webhook-based — reasonable given Higgsfield likely has no webhook support, but means status freshness is only as good as client poll frequency (README says 4s interval).

### Files/areas confirmed still to review (unchanged from Pass 0, restated for continuity)
- `src/index.tsx` lines 2300–6880 (Distribution Engine remainder: caption gen, upload, schedule, batch, queue CRUD, metrics pull/live, analytics; Attention Engine remainder: analyze/rewrite/prescore/score-SSE, fetch-url proxy; Admin Panel routes; and **all page-HTML template strings** for every tool — likely the single largest chunk of remaining backend line count)
- 4 frontend JS files (10,643 lines combined)
- 4 frontend CSS files (9,590 lines combined)
- `dist/` build artifacts — not yet diffed against source to check for staleness (i.e., is the committed `dist/` up to date with `src/`, or would a fresh `npm run build` change it materially?)
- No `npm run build`, typecheck, or lint executed yet this session — build health unverified
- Live Cloudflare state (secrets actually set, D1 schema actually migrated, Worker actually deployed) is **not verifiable from this sandbox** — all statements about "still needed" secrets are sourced from README claims, not independently confirmed against live Cloudflare account state

### Next Pass Plan
1. Continue `src/index.tsx` from line 2300 to end (6880) in ~500-line chunks, tracking every route, every helper, every page-template.
2. Grep-confirm `checkTierLimits()` call sites (dead code check).
3. Grep-confirm `platform_connections` vs `social_accounts` usage split.
4. Confirm Motion Engine / Persona Engine backend route existence (or absence).
5. Move to frontend JS files once backend is 100% read.
6. Move to CSS files last (lowest logic risk, but still "every line" per user instruction).
7. Attempt `npm run build` to verify current compile health as an independent check, time permitting.

---

## Pass 2 — 2026-07-15 (continued)

### Analysis Progress Tracker (updated)

| Area | File | Lines | Status |
|---|---|---|---|
| Backend | `src/index.tsx` | 6880 | ✅ **100% reviewed (lines 1–6880)** |
| Frontend JS | `public/static/video-generator.js` | 5557 | ⬜ Not started |
| Frontend JS | `public/static/distribution.js` | 1998 | ⬜ Not started |
| Frontend JS | `public/static/attention-engine.js` | 1821 | ⬜ Not started |
| Frontend JS | `public/static/main.js` | 1267 | ⬜ Not started |
| Frontend CSS | `public/static/video-generator.css` | 3609 | ⬜ Not started |
| Frontend CSS | `public/static/distribution.css` | 2646 | ⬜ Not started |
| Frontend CSS | `public/static/attention-engine.css` | 2420 | ⬜ Not started |
| Frontend CSS | `public/static/style.css` | 915 | ⬜ Not started |
| Build output | `dist/` (worker + static, generated) | — | ⬜ Not diffed vs source |
| Build health | `npm run build` | — | ⬜ Not yet run |

`src/index.tsx` structural map (now fully confirmed):
- Lines 1–4066: all backend logic — bindings, crypto helpers, auth, tier limits, Higgsfield adapter, OpenAI/OpenRouter client, prompt enhancement, Stripe billing, project/character/campaign CRUD, generation pipeline + polling, analytics, AI Creative Director, Distribution Engine (OAuth, caption, upload, schedule, batch, queue, metrics, publish helpers), Attention Engine (analyze/rewrite/prescore/score SSE, YouTube OAuth, Bluesky AT-Proto, fetch-url auto-populate), Shot Comparison, Timeline Editor, Admin Panel, page-route mappings.
- Line 4066: `export default app` — hard boundary between logic and HTML.
- Lines 4068–5359: `videoGeneratorPage()` — full Studio/Analytics/Compare/Timeline SPA shell (nav, auth gate, settings drawer, compose panel, AI Director panel, storyboard, Compare Modal, Timeline Editor with ruler/strip/bank/preview, New Project Modal, Style Bible Modal, Character Modal, Upgrade Modal, Analytics Panel with charts grid + per-model deep-dive).
- Lines 5364–5553: `attentionEnginePage()` — auth gate, Connections drawer (YouTube OAuth block, Bluesky app-password block, Instagram "Coming Soon" block, connection-status summary), main input panel (platform grid, content-type grid, URL/manual tabs, metrics inputs, timeline/dropoff inputs, rewrite settings), output panel (Scores/Timeline/Diagnosis/Optimize/Rewrite tabs).
- Lines 5558–6214: `distributionPage()` — nav, auth gate, Queue/Accounts/New Post/Batch/Metrics tabbed SPA (edit drawer for scheduled posts, Instagram/YouTube OAuth account cards, 5-step compose wizard [Video/Platforms/Caption/Timing/Review], batch drip-schedule panel with 5 templates, metrics tab with live chart + best-times grid).
- Lines 6219–6866: `adminPage()` — entirely self-contained HTML+CSS+`<script>` page (not using the shared `.js`/`.css` static files at all — this page inlines its own styles and its own vanilla-JS admin console logic directly in the template string, including `admApi()`, `admUnlock()`, tab switching, user table pagination/search/tier-filter, edit/delete-user modal, activity feed, model stat bars, growth SVG line charts). This is architecturally inconsistent with the other 3 tool pages (which load external `.js`/`.css`), but not a bug — just a different (self-contained) implementation style for the internal-only admin tool.
- Lines 6871–6873: `toolShell(name, id, color)` — generic "Coming Soon" placeholder page used for Motion Engine and Persona Engine (confirms README claim: these two tools have **zero backend routes**, are pure static placeholders).
- Lines 6878–end (6880): `landingPage()` — marketing/portfolio landing page with Three.js + GSAP ScrollTrigger animated scene sections, tool "orbital" nav linking to the 5 sub-tools (2 marked "Active": Attention Engine, Video Generator; 3 marked "Build": Distribution Engine, Motion Engine, Persona Engine — **note**: landing page's own status badges call Distribution Engine "Build" even though its backend/frontend are the most fully-built secondary feature in the repo; this is a stale/inaccurate marketing label vs. actual code completeness, worth flagging as a docs/UX-copy inconsistency, not a functional bug).

### New Confirmed Findings (Pass 2)

11. **`checkTierLimits()` is definitively dead code.** `grep -n "checkTierLimits"` across the now-fully-read file returns exactly **one** match: the function definition itself at line 498. It is never called. The two real enforcement points (`POST /api/projects`, `POST /api/generate`) each re-implement the same tier/count-limit SQL inline. This is confirmed technical debt — either delete the unused helper or refactor the two call sites to use it (preferred, to keep tier-limit logic in one place going forward).

12. **Confirmed bug — broken Distribution Engine file-upload flow.** `POST /api/distribution/upload` (line 2378) uploads to R2 at key `dist/${userId}/${uuid()}.${ext}`, computes a nonsensical, unused `publicUrl` via `c.env.STORAGE.toString().split(':')[0]` (an R2Bucket binding's `.toString()` does not produce a usable hostname — this line is inert), and returns `serveUrl = /api/media/${key}` (line 2401) as the field the frontend is meant to use. **No route matching `/api/media/:key` exists anywhere in the 6880-line file** — confirmed via full-file grep. Any video uploaded through the Distribution Engine's "Upload File" tab will receive a URL that 404s the moment anything (preview player, Instagram publish call, YouTube publish call, or the cron `scheduler.ts`) tries to fetch it. This is the single most concrete functional bug found in the entire backend so far. Fix requires either: (a) adding a `GET /api/media/:key` route mirroring the existing `/api/video/:key` and `/api/image/:key` public-serve pattern, or (b) changing `serveUrl` to point at one of those two existing routes if the uploaded file type overlaps.

13. **README/code R2-prefix mismatch confirmed.** README documents Distribution Engine uploads living at `dist-uploads/{userId}/{uuid}.mp4`; actual code uses `dist/${userId}/${uuid()}.${ext}` (line ~2390). Either stale documentation or an unlogged refactor. Low severity but adds to "docs can't be trusted as ground truth without code cross-check" theme.

14. **Admin panel brute-force exposure confirmed via full read.** `requireAdmin` gates on a single shared `ADMIN_SECRET` compared via query param or header, with **no rate limiting, no lockout, no logging of failed attempts** anywhere in the admin route block (lines ~3900–4064 logic + full admin page script lines 6544–6863). A weak or guessed secret gives full read access to all user emails/tiers/credits and the ability to hard-delete any user or arbitrarily grant tier/credits. Recommend at minimum: rate-limit by IP, use a long random secret, and log/alert on failed unlock attempts.

15. **Distribution Engine landing-page status label is misleading.** The landing page (`landingPage()`, line ~6878) tags "Distribution Engine" as status **"Build"** (i.e., in-progress) on its tool-selector nav, identically to Motion Engine and Persona Engine (which are confirmed empty placeholders). This is inconsistent with the actual state of the code: Distribution Engine has ~15+ fully implemented API routes, OAuth flows for 2 platforms, a complete 5-tab SPA frontend, and a dedicated cron Worker — it is by far the most complete secondary tool in the repo, yet is marketed identically to features that don't exist yet. This will confuse users/testers about what's actually usable. Recommend updating the landing page copy/badge once Distribution Engine is verified end-to-end (see bug #12) rather than leaving it lumped in with truly unbuilt tools.

16. **Admin page is architecturally siloed from the rest of the app's static-asset pattern.** Every other tool page (`videoGeneratorPage`, `attentionEnginePage`, `distributionPage`) loads shared external `/static/*.css` and `/static/*.js` files. The admin page instead inlines ~320 lines of `<style>` and ~320 lines of `<script>` directly inside the `adminPage()` template string in `index.tsx` itself. Not a bug, but it means any change to admin UI requires editing the giant backend file rather than a small static asset, and there is zero code-sharing/reuse of design tokens between admin and the rest of the suite (admin redeclares its own CSS variable palette that happens to closely match, but is not literally shared with, the other tools' `:root` tokens).

17. **Confirmed via full read: Motion Engine and Persona Engine have absolutely no backend.** `/tools/motion-engine/` and `/tools/persona-engine/` route to `toolShell('Motion Composition Engine', 'motion', '#FB923C')` and `toolShell('Spectra Persona Engine', 'persona', '#F87171')` respectively — a generic "Coming Soon" static page with no API calls, no forms, no JS beyond the shared page-chrome. This matches the README's own admission. Confirmed, not just inferred.

18. **Resolved (carried over from Problem Solving during this pass): `social_accounts` vs `platform_connections` is intentional tool separation, not a duplication bug.** Distribution Engine (`social_accounts`, publish-scope OAuth for Instagram+YouTube) and Attention Engine (`platform_connections`, read-only-scope OAuth for YouTube + Bluesky app-password) are cleanly separated by which route files reference which table — confirmed by re-reading both OAuth callback blocks in full. Residual UX friction: a user must connect YouTube twice (once per tool, different scopes) to get full functionality from both tools — worth a future UX improvement (e.g., a shared "connect once, both tools read from same token store" model) but not a bug as implemented today.

19. **Publish-logic duplication across `src/index.tsx` and `workers/scheduler.ts` reconfirmed after full read.** `publishPost`, `publishToInstagram`, `publishToYouTube`, and `pullMetrics` exist near-verbatim in both files. The only functional difference: the `workers/scheduler.ts` version of the "claim a post" step uses an atomic `UPDATE ... WHERE status='scheduled'` guard (to prevent two concurrent cron ticks from double-publishing the same post), while the main-app version (used for "Post Now" and manual retry) does not need this guard since it's not competing with a concurrent cron run. This split-brain duplication is real technical debt: any future platform API change (e.g., Instagram Graph API version bump, YouTube upload quota field rename) must be patched in two files or the two diverge silently.

### Updated Lifecycle Stage Assessment

Confirms Pass 1's "Beta / pre-launch hardening" verdict, now with full-backend certainty rather than a 33%-read inference. Refined view after 100% backend read:
- **Video Generator + Attention Engine**: feature-complete backend, marketed "Active" on landing page, consistent with code reality.
- **Distribution Engine**: feature-complete backend + frontend + dedicated cron Worker, but (a) has one concrete blocking bug (bug #12, `/api/media/:key` missing) that breaks its own file-upload path, (b) requires the separate `workers/scheduler.ts` Worker to actually be deployed for scheduled posts to fire (unconfirmed live), and (c) is mismarked "Build" on the landing page despite being the most complete secondary feature. This tool is closer to "done but unverified end-to-end" than "in progress."
- **Motion Engine / Persona Engine**: confirmed zero backend, static placeholder only — pre-alpha / not started, correctly marketed as "Build."
- **Admin Panel**: feature-complete, functional, but has a real security hardening gap (finding #14) before it should be trusted with production user data at scale.
- **Billing (Stripe)**: code-complete but non-functional today due to placeholder price IDs (Pass 1 finding #retained) — blocks any real subscription purchase until Stripe Dashboard is configured and `STRIPE_PRICES` is updated with real price IDs.

Overall: **no part of the backend is unfinished/stubbed except Motion Engine and Persona Engine (by design, clearly marked).** Everything else is real, wired-up code. The gap between "looks done" and "is done" is now narrowed to: (1) one concrete code bug (#12), (2) external config/secrets not yet confirmed live (Stripe price IDs, OAuth client secrets, scheduler Worker deployment), (3) one dead-code cleanup item (#11), (4) a handful of security/robustness hardening items (#14, admin brute-force; encryption key rotation from Pass 1 #3; Stripe webhook replay window from Pass 1 #6).

### Files/areas confirmed still to review (updated)
- 4 frontend JS files (10,643 lines combined) — **next up**
- 4 frontend CSS files (9,590 lines combined)
- `dist/` build artifacts — not yet diffed against source
- `npm run build` — not yet run this session; build/compile health still unverified
- Live Cloudflare state (secrets, D1 migrations applied, scheduler Worker deployment status) — still not independently verifiable from this sandbox

### Next Pass Plan (updated)
1. Read `public/static/video-generator.js` in full (5557 lines) — largest remaining single file, drives the most complex page (Studio/Analytics/Compare/Timeline).
2. Read `public/static/distribution.js`, `attention-engine.js`, `main.js` in full.
3. Cross-check frontend JS against backend route inventory above — flag any frontend calls to routes that don't exist (extending the same method that found bug #12), and any backend routes with no frontend caller (dead API surface).
4. Read all 4 CSS files in full (lower logic risk, but per user's explicit "every line" instruction, still required).
5. Run `npm run build` to verify current compile/type health independent of manual reading.
6. Optionally diff `dist/` against `src/`/`public/` for staleness.
7. Produce final consolidated "needs work" prioritized punch list and confirm/refine lifecycle-stage verdict once frontend is included.
