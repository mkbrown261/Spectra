# Spectra — AI Filmmaking Production Suite

## Project Overview
- **Codename**: `spectra`
- **Goal**: Professional AI video production platform — persistent projects, character memory, encrypted BYOK API keys, multi-model generation via Higgsfield
- **Production URL**: https://spectra-b8s.pages.dev
- **Latest Deploy**: https://40cf9274.spectra-b8s.pages.dev
- **Platform**: Cloudflare Pages + Workers + D1 + R2

---

## Tools

| Tool | Route | Status |
|------|-------|--------|
| Landing (3D Spectra) | `/` | ✅ Live |
| Video Generator | `/tools/video-generator/` | ✅ Live |
| Attention Engine | `/tools/attention-engine/` | ✅ Live |
| Distribution Engine | `/tools/distribution/` | ✅ Live |
| Motion Engine | `/tools/motion-engine/` | 🔲 Shell only |
| Persona Engine | `/tools/persona-engine/` | 🔲 Shell only |

---

## Video Generator — Feature Status

### ✅ Completed
- **Auth system** — register/login/logout, PBKDF2 password hashing, 30-day session tokens in D1
- **Encrypted key storage** — AES-256-GCM, IV + ciphertext in D1, key never returned to client
- **Project CRUD** — create/list/get/patch/delete, tier-gated project count
- **Style bible** — JSON per-project, injected into every prompt enhancement
- **Style presets** — cinematic / realism / motion / storytelling / dreamlike
- **Character memory** — create/edit/delete characters with ref images
- **Character Soul training** — Higgsfield Soul train API, async polling, soul_id stored in D1
- **Higgsfield generation pipeline** — submit → poll → store in D1
- **GPT-4o prompt enhancement** — style bible, cinema language, model context
- **Shot polling** — 4s interval, live card updates
- **R2 video copy** — permanent storage at `videos/{userId}/{shotId}.mp4`
- **Thumbnail capture** — from Higgsfield response fields + manual PATCH
- **Shot drag-and-drop reorder** — sort_order column, PATCH reorder endpoint
- **Multi-shot continuity** — canvas frame extraction, R2 upload, auto pre-fills compose panel
- **AI Creative Director** — scene concept → structured shot list (GPT-4o)
- **Shot grid** — status overlays, video preview on hover, play/download/delete/copy/continue
- **Image upload to R2** — multipart, served via `/api/image/:key`
- **Analytics dashboard** — per-model metrics, daily chart, cost tracking (7d/30d/90d/all)
- **Tier enforcement** — free(1/10), creator(5/100), studio(25/500), pro(∞/∞)
- **Stripe billing** — checkout flow, webhook handler, subscription management
- **Campaigns** — create/list/delete, assign projects, manifest export
- **Settings drawer** — encrypted key save/status, tier limits, upgrade modal
- **Pre-publish prescore** — hook score 0-100, verdict, improved prompt
- **Shot Comparison A/B Viewer** — fullscreen modal, 2–4 video grid, sync playback, metadata diff with highlights, winner selection, export diff JSON
- **Sequence Timeline Editor** — bottom-sheet panel, film-strip drag-to-reorder, ruler, sequence preview player, export manifest JSON
- **Admin Panel** — user management, tier overrides, credit top-ups (`/tools/admin/`)

### ⚠️ Needs Real Config
- **Stripe price IDs** — placeholder strings in `STRIPE_PRICES`, need real IDs from Stripe dashboard
- **Stripe secrets** — `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` not yet set
- **Distribution Engine OAuth** — code complete, needs `INSTAGRAM_CLIENT_SECRET` + `YOUTUBE_CLIENT_SECRET` secrets + registered OAuth apps

---

## Distribution Engine — Feature Status

### ✅ Completed (v3)
- **Account connect** — Instagram + YouTube OAuth2 PKCE flow, popup + postMessage, long-lived token exchange
- **Token encryption** — AES-256-GCM at rest for access + refresh tokens
- **Platform health bar** — token expiry warnings (7d), last post status per platform
- **New Post compose** — video URL / file upload, platform toggles, A/B caption variants, hashtag chips
- **YouTube title field** — dedicated input shown only when YouTube selected, wired to state + API
- **AI caption generation** — platform-aware (IG caption+hashtags, YT title+description+tags)
- **Timing** — Post Now or Schedule with smart optimal-time chips
- **Batch mode** — multi-video drip scheduling (Daily/Weekly/Launch/6h Blitz/Custom templates)
- **R2 video upload** — drag-drop / file picker, XHR progress bar, stored at `dist-uploads/`
- **Queue** — full CRUD, filter by status, batch grouping, countdown timers, momentum scores
- **Edit scheduled post** *(new v3)* — slide-in drawer for caption, title, scheduled time, video swap
- **Auto-poll queue** *(new v3)* — 30s interval when queue tab active, pulsing LIVE indicator
- **Metrics tab** *(rebuilt v3)* — post picker, multi-metric bar chart (views/likes/comments/shares/saves), 24h vs 72h windows, per-post breakdown table with growth %, best posting times analysis
- **Retry / cancel** — failed post retry (max 3), cancel scheduled
- **Pull metrics** — manual trigger for Instagram Insights + YouTube Data API

### ✅ Cron Scheduler Worker (v3)
- **`workers/scheduler.ts`** + **`workers/wrangler.toml`** — standalone Cloudflare Worker
- Fires every 5 minutes via `[triggers] crons = ["*/5 * * * *"]`
- Polls `distribution_posts WHERE status='scheduled' AND scheduled_at <= now`, up to 20 posts
- Atomic claim with `WHERE status='scheduled'` in UPDATE — prevents double-publish across concurrent runs
- Full publish logic: Instagram 3-step Reels + YouTube multipart upload
- Deploy: `cd workers && npx wrangler deploy`

---

## API Routes

### Auth
```
POST /api/auth/register    { email, password } → { ok, user }
POST /api/auth/login       { email, password } → { ok, user }
POST /api/auth/logout      → { ok }
GET  /api/me               → { id, email, tier, credits, limits }
```

### API Keys
```
POST   /api/keys/save        { provider, key } → { ok }
GET    /api/keys/status      → { higgsfield: { connected, saved_at } }
DELETE /api/keys/:provider   → { ok }
```

### Projects
```
POST   /api/projects             → { ok, id, name }
GET    /api/projects             → [ projects ]
GET    /api/projects/:id         → { ...project, shots, characters }
PATCH  /api/projects/:id         → { ok }
DELETE /api/projects/:id         → { ok }
PATCH  /api/projects/:id/reorder { shots: [{id, sort_order}] } → { ok }
PUT    /api/projects/:id/campaign { campaign_id } → { ok }
```

### Generation
```
GET  /api/models                  → [ models ]
POST /api/generate                → { ok, shot_id, status, prompt_enhanced }
GET  /api/shots/:id/status        → { status, video_url, thumbnail_url }
PATCH /api/shots/:id/thumbnail    → { ok }
DELETE /api/shots/:id             → { ok }
GET  /api/video/:key              → R2 video stream
GET  /api/image/:key              → R2 image stream
POST /api/upload                  multipart → { ok, key, url }
POST /api/enhance-prompt          → { original, enhanced }
POST /api/director                → { shots: [...] }
```

### Analytics
```
GET  /api/analytics?range=7d|30d|90d|all → { overview, models, daily, projects }
```

### Billing
```
GET  /api/billing/status    → { tier, stripe_customer_id }
POST /api/billing/checkout  { tier } → { ok, url }
POST /api/billing/webhook   Stripe webhook
```

### Distribution Engine
```
GET    /api/distribution/accounts               → [ accounts ]
POST   /api/distribution/accounts/connect       { platform, client_id, redirect_uri } → { auth_url }
GET    /api/distribution/oauth/callback         OAuth popup callback
DELETE /api/distribution/accounts/:id          → { ok }
POST   /api/distribution/caption               { platform, prompt } → { caption, hashtags?, title?, tags? }
POST   /api/distribution/upload                multipart → { ok, key, url }
POST   /api/distribution/schedule              { account_id, platform, video_url, caption, title?, scheduled_at? }
POST   /api/distribution/batch                 { items, drip_hours } → { ok, batch_id, count }
GET    /api/distribution/queue                 → [ posts ]
PATCH  /api/distribution/queue/:id             { caption?, title?, scheduled_at?, video_url? } → { ok }  ← NEW v3
DELETE /api/distribution/queue/:id            → { ok }
POST   /api/distribution/queue/:id/retry      → { ok }
GET    /api/distribution/metrics/live         → [ posts with scores ]
GET    /api/distribution/metrics/:postId      → { metrics }
POST   /api/distribution/metrics/:postId/pull → { ok, window, metrics }
GET    /api/distribution/analytics            → { posts, platform_stats, best_times }  ← NEW v3
```

### Attention Engine
```
POST /api/attention/analyze   → { diagnosis, dropoff_analysis, optimization_plan, ... }
POST /api/attention/rewrite   → { hooks, rewrites }
POST /api/attention/prescore  → { hook_score, verdict, fix, improved_prompt }
POST /api/attention/score     → SSE stream
GET  /api/fetch-url           ?url= → proxied content
```

---

## Data Models

### D1: `spectra-production` (ID: `f6f517a3-46eb-4837-bc84-9dbd4b61d66c`)

| Table | Key Fields | Migration |
|-------|-----------|-----------|
| `users` | id, email, password_hash, tier, credits, stripe fields | 0001 |
| `api_keys` | user_id, provider, encrypted_key, iv | 0001 |
| `projects` | user_id, name, style_bible, default_model, campaign_id | 0001, 0004 |
| `characters` | project_id, name, description, ref_image_url, soul_id | 0001 |
| `shots` | project_id, prompt_raw/enhanced, model, status, video_url, sort_order | 0001–0003 |
| `sessions` | id (token), user_id, expires_at | 0001 |
| `campaigns` | id, user_id, name | 0004 |
| `social_accounts` | user_id, platform, handle, access_token (AES-GCM), refresh_token (AES-GCM) | 0005 |
| `distribution_posts` | user_id, platform, video_url, caption, title, status, scheduled_at, batch_id | 0005, 0006 |
| `post_metrics` | post_id, pull_window (24h/72h), views, likes, comments, shares, reach, saves | 0005 |

### R2: `spectra-assets` (binding: `STORAGE`)
- `videos/{userId}/{shotId}.mp4` — permanent video copies from Higgsfield CDN
- `uploads/{userId}/{uuid}.{ext}` — reference images
- `dist-uploads/{userId}/{uuid}.mp4` — distribution video uploads

---

## Cloudflare Secrets

### Currently Set
| Secret | Purpose |
|--------|---------|
| `ENCRYPTION_KEY` | AES-256-GCM key for encrypting API keys + OAuth tokens at rest |
| `JWT_SECRET` | Reserved |
| `OPENAI_API_KEY` | GPT-4o via OpenRouter |
| `OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` |

### Still Needed
| Secret | Purpose |
|--------|---------|
| `STRIPE_SECRET_KEY` | Billing |
| `STRIPE_WEBHOOK_SECRET` | Billing webhook |
| `INSTAGRAM_CLIENT_SECRET` | Instagram OAuth |
| `YOUTUBE_CLIENT_SECRET` | YouTube OAuth |

```bash
npx wrangler pages secret put SECRET_NAME --project-name spectra
```

---

## File Structure

```
src/
  index.tsx             — Full backend (6100+ lines): all routes, all page HTML
  renderer.tsx          — JSX renderer

public/static/
  video-generator.css   — Video Generator + Compare + Timeline styles
  video-generator.js    — Video Generator + Compare + Timeline frontend
  distribution.css      — Distribution Engine styles (2646 lines)
  distribution.js       — Distribution Engine frontend (1998 lines)
  attention-engine.css  — Attention Engine styles
  attention-engine.js   — Attention Engine frontend
  main.js               — Landing page Three.js particle engine
  style.css             — Global / landing styles

workers/
  scheduler.ts          — Cron Worker: fires scheduled posts every 5 min ← NEW v3
  wrangler.toml         — Scheduler Worker config (D1 binding + cron trigger) ← NEW v3

migrations/
  0001_initial.sql
  0002_upgrade_fields.sql
  0003_shot_order.sql
  0004_campaigns.sql
  0005_distribution.sql
  0006_distribution_batch.sql

wrangler.jsonc          — Pages config: D1 + R2 bindings, name = "spectra"
ecosystem.config.cjs    — PM2: wrangler pages dev dist --d1=spectra-production --local :3000
```

---

## Dev Commands

```bash
# Build
npm run build

# Local dev (with D1)
npm run build && pm2 start ecosystem.config.cjs

# Apply migrations locally
npx wrangler d1 migrations apply spectra-production --local

# Apply migrations to production
npx wrangler d1 migrations apply spectra-production

# Deploy Pages app
npx wrangler pages deploy dist --project-name spectra

# Deploy Scheduler Worker (separate)
cd workers && npx wrangler deploy

# Set secret
npx wrangler pages secret put ENCRYPTION_KEY --project-name spectra
```

---

## Tier System

| Tier | Price | Projects | Shots/mo | Storage |
|------|-------|----------|----------|---------|
| Free | $0 | 1 | 10 | 500 MB |
| Creator | $29/mo | 5 | 100 | 5 GB |
| Studio | $79/mo | 25 | 500 | 25 GB |
| Pro | $149/mo | ∞ | ∞ | 100 GB |

---

## Remaining Work

### High Priority
1. **Distribution OAuth secrets** — register Instagram + YouTube apps, set `INSTAGRAM_CLIENT_SECRET` + `YOUTUBE_CLIENT_SECRET`
2. **Deploy Scheduler Worker** — `cd workers && npx wrangler deploy` (requires `ENCRYPTION_KEY` secret on the Worker too)
3. **Stripe real price IDs** — replace placeholders in `STRIPE_PRICES` map, set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`

### Medium Priority
4. **YouTube token refresh** — in `publishPost()`: detect 401, use `enc_refresh` to call `https://oauth2.googleapis.com/token`, update `social_accounts`, retry publish
5. **Dreamina adapter** — add second video provider
6. **Motion Engine** — build from shell
7. **Persona Engine** — build from shell
