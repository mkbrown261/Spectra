# Spectra — AI Filmmaking Production Suite

## Project Overview
- **Codename**: `spectra`
- **Goal**: Professional AI video production platform — persistent projects, character memory, encrypted BYOK API keys, multi-model generation via Higgsfield
- **Production URL**: https://spectra-b8s.pages.dev
- **Latest Deploy**: https://c5a4022c.spectra-b8s.pages.dev
- **Platform**: Cloudflare Pages + Workers + D1 + R2

---

## Tools

| Tool | Route | Status |
|------|-------|--------|
| Landing (3D Spectra) | `/` | ✅ Live |
| Video Generator | `/tools/video-generator/` | ✅ Live |
| Attention Engine | `/tools/attention-engine/` | ✅ Live |
| Distribution Engine | `/tools/distribution-engine/` | ✅ Live |
| Motion Engine | `/tools/motion-engine/` | 🔲 Shell only |
| Persona Engine | `/tools/persona-engine/` | 🔲 Shell only |

---

## Video Generator — Feature Status

### ✅ Completed
- **Auth system** — register/login/logout, PBKDF2 password hashing (Web Crypto), 30-day session tokens in D1
- **Encrypted key storage** — AES-256-GCM via Web Crypto, IV + ciphertext stored in D1, key NEVER returned to client
- **Project CRUD** — create/list/get/patch/delete, tier-gated project count
- **Style bible** — JSON per-project (style, mood, palette, camera language), injected into every prompt enhancement
- **Style presets** — cinematic / realism / motion / storytelling / dreamlike system with per-preset prompt modifiers
- **Character memory** — create/edit/delete characters per project with ref image URLs
- **Character Soul training** — `POST /api/projects/:id/characters/train` → Higgsfield Soul train API, async polling via `GET /api/projects/:id/characters/:charId/soul-status`, soul_id stored in D1, UI shows Train/Check/Ready/Pending badges
- **Higgsfield generation pipeline** — submit job → poll to completion → store in D1
- **GPT-4o prompt enhancement** — style bible injection, cinema camera language, model/aspect context, style preset modifiers
- **Shot polling** — 4s interval, updates card live on completion/failure/NSFW
- **R2 video copy** — on shot completion, video copied from Higgsfield CDN to R2 (`videos/{userId}/{shotId}.mp4`), served via `/api/video/:key`, permanent storage
- **Thumbnail capture** — on shot completion, captures `thumbnail/preview/poster` field from Higgsfield response + manual PATCH endpoint `/api/shots/:shotId/thumbnail`
- **Shot drag-and-drop reorder** — `sort_order` column, `PATCH /api/projects/:projectId/reorder`, frontend drag handles with live reorder commit
- **Multi-shot continuity** — "Continue from last frame" button: canvas frame extraction, R2 upload, auto-pre-fills compose panel as next reference image
- **AI Creative Director** — `POST /api/director`: scene concept → structured shot list (GPT-4o), configurable shot count, director notes per shot
- **Shot grid** — cards with status overlays (queued/generating/failed), video preview on hover, play/download/delete/copy/continue actions
- **Image upload to R2** — `POST /api/upload` (multipart), served via `/api/image/:key`, used for reference images and last-frame continuity
- **Analytics dashboard** — per-model metrics, daily activity chart (SVG), generation speed, estimated cost tracking (7d/30d/90d/all range filter)
- **Tier enforcement** — free(1 proj/10 shots), creator(5/100), studio(25/500), pro(∞/∞)
- **Stripe billing** — full checkout flow: `GET /api/billing/status`, `POST /api/billing/checkout` (creates Stripe customer + Checkout session), `POST /api/billing/webhook` (handles `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`), HMAC webhook signature verification
- **Campaigns** — create/list/delete campaigns (D1), assign projects to campaigns, campaign manifest export (JSON)
- **Settings drawer** — encrypted key save/status, account info, tier limits grid, upgrade modal
- **Auth gate** — login/register with tab switch, tier info strip
- **Full frontend JS** — auth flow, project management, shot submission, polling, DOM rendering
- **Model hint** — warns when i2v model needs reference image, clears for text-to-image models
- **Pre-publish prescore** — `POST /api/attention/prescore`: hook score 0-100, verdict, fix suggestion, improved prompt, platform fit score

### ⚠️ Partially Implemented / Needs Real Config
- **Stripe price IDs** — `price_creator_monthly` / `price_studio_monthly` / `price_pro_monthly` are **placeholder strings** — must be replaced with real IDs from Stripe dashboard before billing works
- **Stripe secrets** — `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` not yet set as Cloudflare secrets
- **Thumbnail extraction** — captures from Higgsfield `thumbnail/preview/poster` response fields; manual PATCH exists; no server-side frame extraction (Higgsfield doesn't consistently return these fields)
- **Distribution Engine OAuth** — full code implemented (Instagram + YouTube OAuth flow, token exchange, long-lived token, encrypted storage), but requires `INSTAGRAM_CLIENT_SECRET` and `YOUTUBE_CLIENT_SECRET` Cloudflare secrets + registered OAuth apps

### 🔲 Not Yet Built
- Shot comparison / A/B viewer
- Full sequence / timeline editor (drag shots into ordered sequence for export)
- Admin panel (user management, credit top-ups)
- Dreamina / second video provider adapter
- Motion Engine (shell only)
- Persona Engine (shell only)

---

## API Routes

### Auth
```
POST /api/auth/register    { email, password } → { ok, user: { id, email, tier, credits } }
POST /api/auth/login       { email, password } → { ok, user: { ... } }
POST /api/auth/logout      → { ok }
GET  /api/auth/me          → { id, email, tier, credits, limits }
```

### API Keys (encrypted at rest)
```
POST   /api/keys/save        { provider, key } → { ok, provider }
GET    /api/keys/status      → { higgsfield: { connected, saved_at } }
DELETE /api/keys/:provider   → { ok }
```

### Projects
```
POST   /api/projects             { name, style_bible, default_model } → { ok, id, name }
GET    /api/projects             → [ { id, name, shot_count, default_model, campaign_id, ... } ]
GET    /api/projects/:id         → { ...project, shots: [...], characters: [...] }
PATCH  /api/projects/:id         { name?, style_bible?, default_model? } → { ok }
DELETE /api/projects/:id         → { ok }
PATCH  /api/projects/:projectId/reorder    { shots: [{id, sort_order}] } → { ok }
PUT    /api/projects/:id/campaign          { campaign_id } → { ok }
```

### Campaigns
```
GET    /api/campaigns        → [ { id, name, created_at } ]
POST   /api/campaigns        { name } → { ok, id, name }
DELETE /api/campaigns/:id    → { ok }
```

### Characters
```
POST   /api/projects/:id/characters                               { name, description, ref_image_url }
PATCH  /api/projects/:projectId/characters/:characterId           { name?, description?, ref_image_url? }
DELETE /api/projects/:projectId/characters/:charId
POST   /api/projects/:id/characters/train                         { character_id } → { ok, soul_id, status }
GET    /api/projects/:id/characters/:charId/soul-status           → { status, soul_id }
```

### Generation
```
GET  /api/models                        → [ { id, label, category, type, requires_image } ]
POST /api/generate                      { project_id, prompt, model, aspect_ratio, duration, image_url?,
                                          motion_strength?, style_strength?, detail_strength? }
                                        → { ok, shot_id, request_id, status: 'queued', prompt_enhanced }
GET  /api/shots/:shotId/status          → { id, status, video_url, thumbnail_url, error_message }
PATCH /api/shots/:shotId/thumbnail      { thumbnail_url } → { ok }
DELETE /api/shots/:shotId               → { ok }
GET  /api/video/:key                    → R2 video stream (auth required)
GET  /api/image/:key                    → R2 image stream (auth required)
POST /api/upload                        multipart/form-data { file } → { ok, key, url, absoluteUrl }
POST /api/enhance-prompt                { prompt, model, aspect_ratio, style_bible? } → { original, enhanced }
POST /api/director                      { scene, shot_count, style_bible? } → { shots: [...] }
```

### Analytics
```
GET  /api/analytics?range=7d|30d|90d|all
     → { overview, models: [...], daily: [...], projects: [...], total_cost_usd }
```

### Billing (Stripe)
```
GET  /api/billing/status      → { tier, stripe_customer_id, stripe_subscription_id }
POST /api/billing/checkout    { tier } → { ok, url, session_id }
POST /api/billing/webhook     Stripe webhook (checkout.session.completed, subscription events)
```

### Distribution Engine
```
GET    /api/distribution/accounts                  → [ connected accounts ]
POST   /api/distribution/accounts/connect          { platform, client_id, redirect_uri } → { ok, auth_url }
GET    /api/distribution/oauth/callback            OAuth callback (popup postMessage)
DELETE /api/distribution/accounts/:id             → { ok }
POST   /api/distribution/caption                   { platform, video_url?, context? } → { caption, hashtags?, title?, tags? }
POST   /api/distribution/upload                    multipart { file } → { ok, key, url }
POST   /api/distribution/schedule                  { account_id, platform, video_url, caption, scheduled_at? }
POST   /api/distribution/batch                     { items: [...] } → { ok, batch_id, count }
GET    /api/distribution/queue                     → [ queue items ]
DELETE /api/distribution/queue/:id                 → { ok }
POST   /api/distribution/queue/:id/retry           → { ok }
GET    /api/distribution/metrics/live              → [ recent posts with scores ]
GET    /api/distribution/metrics/:postId           → { metrics, scores }
POST   /api/distribution/metrics/:postId/pull      → { ok, window, metrics }
```

### Attention Engine
```
POST /api/attention/analyze    { platform, content_url, metrics, dropoff_points, ... }
POST /api/attention/rewrite    { content, platform, ... }
POST /api/attention/prescore   { prompt, platform } → { hook_score, verdict, fix, improved_prompt }
POST /api/attention/score      { content, platform, metrics } → SSE stream of scored segments
GET  /api/fetch-url            ?url= → proxied content
```

---

## Data Models

### D1 Database: `spectra-production` (ID: f6f517a3-46eb-4837-bc84-9dbd4b61d66c)

| Table | Key Fields | Migration |
|-------|-----------|-----------|
| `users` | id, email, password_hash, tier, credits, stripe fields | 0001 |
| `api_keys` | user_id, provider, encrypted_key (AES-GCM), iv | 0001 |
| `projects` | user_id, name, style_bible (JSON), default_model, shot_count, campaign_id | 0001, 0004 |
| `characters` | project_id, name, description, ref_image_url, soul_id | 0001 |
| `shots` | project_id, user_id, prompt_raw, prompt_enhanced, model, aspect_ratio, hf_request_id, status, video_url, hf_video_url, thumbnail_url, sort_order, seed, style_preset, quality, image_r2_key | 0001, 0002, 0003 |
| `sessions` | id (token), user_id, expires_at | 0001 |
| `campaigns` | id, user_id, name | 0004 |
| `social_accounts` | user_id, platform, handle, access_token (AES-GCM), refresh_token (AES-GCM) | 0005 |
| `distribution_posts` | user_id, project_id, platform, video_url, caption, status, batch_id, batch_position | 0005, 0006 |
| `post_metrics` | post_id, pull_window (24h/72h), views, likes, comments, shares, reach, saves | 0005 |

### R2 Bucket: `spectra-assets` (binding: `STORAGE`)
- `videos/{userId}/{shotId}.mp4` — permanent video copies from Higgsfield CDN
- `uploads/{userId}/{uuid}.{ext}` — reference images (characters, i2v inputs)
- `dist-uploads/{userId}/{uuid}.mp4` — distribution video uploads

---

## Higgsfield Models (Validated)

| Model ID | Label | Type | Requires Image |
|----------|-------|------|----------------|
| `higgsfield-ai/dop/lite` | DoP Lite | image-to-video | ✅ |
| `higgsfield-ai/dop/standard` | DoP Standard | image-to-video | ✅ |
| `higgsfield-ai/dop/turbo` | DoP Turbo | image-to-video | ✅ |
| `kling-video/v2.1/pro/image-to-video` | Kling 2.1 Pro | image-to-video | ✅ |
| `kling-video/v2.1/standard/image-to-video` | Kling 2.1 Std | image-to-video | ✅ |
| `bytedance/seedance/v1/pro/image-to-video` | Seedance Pro | image-to-video | ✅ |
| `bytedance/seedance/v1/lite/image-to-video` | Seedance Lite | image-to-video | ✅ |
| `higgsfield-ai/soul/standard` | Soul | text-to-image | ❌ |
| `flux-pro/kontext/max/text-to-image` | Flux Kontext Max | text-to-image | ❌ |

**API format**: `POST https://platform.higgsfield.ai/{model_id}`
**Auth**: `Authorization: Key KEY_ID:KEY_SECRET`
**Poll**: `GET https://platform.higgsfield.ai/requests/{request_id}/status`

---

## Cloudflare Secrets

### Currently Set (Production)
| Secret | Purpose |
|--------|---------|
| `ENCRYPTION_KEY` | 32-byte hex — AES-256-GCM key for encrypting user API keys at rest |
| `JWT_SECRET` | 32-byte hex — reserved |
| `OPENAI_API_KEY` | GPT-4o prompt enhancement (via OpenRouter) |
| `OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` |

### Still Needed (Not Yet Set)
| Secret | Purpose |
|--------|---------|
| `STRIPE_SECRET_KEY` | `sk_live_...` or `sk_test_...` — required for billing |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` — required for billing webhook |
| `INSTAGRAM_CLIENT_SECRET` | Required for Instagram OAuth connect |
| `YOUTUBE_CLIENT_SECRET` | Required for YouTube OAuth connect |

Set via: `npx wrangler pages secret put SECRET_NAME --project-name spectra`

---

## Security Architecture

- **Passwords**: PBKDF2 (100k iterations, SHA-256, random 16-byte salt) — pure Web Crypto
- **Sessions**: 32-byte random tokens stored in D1, `httpOnly Secure SameSite=Lax` cookie
- **API keys**: AES-256-GCM encrypted before storage, IV stored alongside. Decrypted server-side ONLY at generation time. Never returned to client.
- **OAuth tokens**: AES-256-GCM encrypted, stored as `{encrypted, iv}` JSON in D1
- **Constant-time compare**: HMAC-based safeCompare for session token validation
- **Stripe webhooks**: HMAC-SHA256 signature verification (constant-time)

---

## Known Issues / Config Gaps

| Issue | Impact | Fix |
|-------|--------|-----|
| `wrangler.jsonc` `"name"` is `"webapp"` not `"spectra"` | Cosmetic — deployment uses `--project-name spectra` flag explicitly | Change to `"spectra"` |
| `ecosystem.config.cjs` missing `--d1=spectra-production --local` | Local dev has NO database access | Add flag to args |
| Stripe price IDs are placeholder strings | Upgrade flow broken until real IDs set | Replace in `STRIPE_PRICES` map in `src/index.tsx` |
| Distribution Engine needs OAuth app credentials | Cannot connect social accounts | Set `INSTAGRAM_CLIENT_SECRET` + `YOUTUBE_CLIENT_SECRET` secrets |

---

## File Structure

```
src/
  index.tsx             — Full backend: auth, keys, projects, characters, generation,
                          analytics, billing, distribution, attention engine, all page HTML
  renderer.tsx          — JSX renderer

public/static/
  video-generator.css   — Video Generator styles (auth gate, drawer, shot grid, modals)
  video-generator.js    — Video Generator frontend (auth, projects, shots, polling,
                          reorder DnD, soul training, last-frame continuity, director,
                          analytics, campaigns, upgrade modal)
  distribution.css      — Distribution Engine styles
  distribution.js       — Distribution Engine frontend
  attention-engine.css  — Attention Engine styles
  attention-engine.js   — Attention Engine frontend
  main.js               — Landing page Three.js particle engine
  style.css             — Global / landing styles

migrations/
  0001_initial.sql           — users, api_keys, projects, characters, shots, sessions ✅
  0002_upgrade_fields.sql    — shots: seed, style_preset, quality, image_r2_key ✅
  0003_shot_order.sql        — shots: sort_order + index ✅
  0004_campaigns.sql         — campaigns table, projects.campaign_id FK ✅
  0005_distribution.sql      — social_accounts, distribution_posts, post_metrics ✅
  0006_distribution_batch.sql — distribution_posts: batch_id, batch_position ✅

wrangler.jsonc          — D1 (DB → spectra-production) + R2 (STORAGE → spectra-assets)
                          ⚠️ name field still says "webapp" — should be "spectra"
ecosystem.config.cjs    — PM2: app=spectra, wrangler pages dev dist :3000
                          ⚠️ missing --d1=spectra-production --local flag
.dev.vars               — Local secrets (gitignored)
```

---

## Dev Commands

```bash
# Build
npm run build

# Local dev — WITH database (correct command)
npm run build && pm2 start ecosystem.config.cjs
# ⚠️ ecosystem.config.cjs is missing --d1=spectra-production --local
# Until fixed, run directly:
# npx wrangler pages dev dist --d1=spectra-production --local --ip 0.0.0.0 --port 3000

# Apply DB migrations locally
npx wrangler d1 migrations apply spectra-production --local

# Apply DB migrations to production
npx wrangler d1 migrations apply spectra-production

# Query local DB
npx wrangler d1 execute spectra-production --local --command="SELECT * FROM users"

# Deploy
npx wrangler pages deploy dist --project-name spectra

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

Monetization model: BYOK (user provides Higgsfield key) + infrastructure upcharge via tiers.

---

## Remaining Work

### High Priority
1. **Fix `wrangler.jsonc` name** — change `"webapp"` → `"spectra"`
2. **Fix `ecosystem.config.cjs`** — add `--d1=spectra-production --local` to args so local dev has DB
3. **Stripe real price IDs** — replace placeholder strings in `STRIPE_PRICES` in `src/index.tsx`, set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` secrets
4. **Distribution OAuth secrets** — register Instagram + YouTube OAuth apps, set `INSTAGRAM_CLIENT_SECRET` + `YOUTUBE_CLIENT_SECRET`

### Medium Priority
5. **Shot comparison / A/B viewer** — side-by-side shot comparison UI
6. **Sequence / timeline editor** — drag shots into ordered sequence, export as manifest or storyboard
7. **Admin panel** — user management, tier overrides, credit top-ups

### Low Priority
8. **Dreamina adapter** — add second video provider behind VideoProvider interface
9. **Motion Engine** — build out from shell
10. **Persona Engine** — build out from shell
