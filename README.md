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
| Video Generator | `/tools/video-generator/` | ✅ Live — Auth + Projects + Higgsfield |
| Attention Engine | `/tools/attention-engine/` | ✅ Live |
| Distribution Engine | `/tools/distribution-engine/` | 🔲 Shell only |
| Motion Engine | `/tools/motion-engine/` | 🔲 Shell only |
| Persona Engine | `/tools/persona-engine/` | 🔲 Shell only |

---

## Video Generator — Feature Status

### ✅ Completed
- **Auth system** — register/login/logout, PBKDF2 password hashing (Web Crypto), 30-day session tokens in D1
- **Encrypted key storage** — AES-256-GCM via Web Crypto, IV + ciphertext stored in D1, key NEVER returned to client
- **Project CRUD** — create/list/get/patch/delete, tier-gated project count
- **Style bible** — JSON per-project (style, mood, palette, camera language), injected into every prompt enhancement
- **Character memory** — create/delete characters per project with ref image URLs (Soul ID ready)
- **Higgsfield generation pipeline** — submit job → poll to completion → store in D1
- **GPT-4o prompt enhancement** — style bible injection, cinema camera language, model/aspect context
- **Shot polling** — 4s interval, updates card live on completion/failure/NSFW
- **Shot grid** — cards with status overlays (queued/generating/failed), video preview on hover, play/download/delete/copy actions
- **Tier enforcement** — free(1 proj/10 shots), creator(5/100), studio(25/500), pro(∞/∞)
- **Settings drawer** — encrypted key save/status, account info, tier limits grid, upgrade teaser
- **Auth gate** — login/register with tab switch, tier info strip
- **Full frontend JS** — auth flow, project management, shot submission, polling, DOM rendering
- **Model hint** — warns when i2v model needs reference image, clears for text-to-image models

### 🔲 Not Yet Built
- Stripe payment integration (upgrade tiers)
- R2 permanent video copy (videos currently served direct from Higgsfield CDN)
- Character Soul training flow
- Shot comparison / reorder
- Thumbnail extraction from completed videos
- Export / sequence editor

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
GET    /api/projects             → [ { id, name, shot_count, default_model, ... } ]
GET    /api/projects/:id         → { ...project, shots: [...], characters: [...] }
PATCH  /api/projects/:id         { name?, style_bible?, default_model? } → { ok }
DELETE /api/projects/:id         → { ok }
```

### Characters
```
POST   /api/projects/:id/characters                  { name, description, ref_image_url }
DELETE /api/projects/:projectId/characters/:charId
```

### Generation
```
GET  /api/models                    → [ { id, label, category, type, requires_image } ]
POST /api/generate                  { project_id, prompt, model, aspect_ratio, duration, image_url? }
                                    → { ok, shot_id, request_id, status: 'queued', prompt_enhanced }
GET  /api/shots/:shotId/status      → { id, status, video_url, hf_video_url, error_message }
DELETE /api/shots/:shotId           → { ok }
POST /api/enhance-prompt            { prompt, model, aspect_ratio, style_bible? }
                                    → { original, enhanced }
```

### Attention Engine (preserved)
```
POST /api/attention/analyze
POST /api/attention/rewrite
POST /api/attention/score
GET  /api/fetch-url
```

---

## Data Models

### D1 Database: `spectra-production` (ID: f6f517a3-46eb-4837-bc84-9dbd4b61d66c)

| Table | Key Fields |
|-------|-----------|
| `users` | id, email, password_hash, tier, credits, stripe fields |
| `api_keys` | user_id, provider, encrypted_key (AES-GCM), iv — UNIQUE(user_id, provider) |
| `projects` | user_id, name, style_bible (JSON), default_model, shot_count |
| `characters` | project_id, name, description, ref_image_url, soul_id |
| `shots` | project_id, user_id, prompt_raw, prompt_enhanced, model, aspect_ratio, hf_request_id, status, video_url, hf_video_url |
| `sessions` | id (token), user_id, expires_at |

### R2 Bucket: `spectra-assets` (binding: `STORAGE`)
- Future: permanent video copies, thumbnails, character ref images

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

## Cloudflare Secrets (Production)

| Secret | Purpose |
|--------|---------|
| `ENCRYPTION_KEY` | 32-byte hex — AES-256-GCM key for encrypting user API keys at rest |
| `JWT_SECRET` | 32-byte hex — reserved for future JWT use |
| `OPENAI_API_KEY` | GPT-4o prompt enhancement |
| `OPENAI_BASE_URL` | OpenAI base URL (default: https://api.openai.com/v1) |

Set via: `npx wrangler pages secret put SECRET_NAME --project-name spectra`

---

## Security Architecture

- **Passwords**: PBKDF2 (100k iterations, SHA-256, random 16-byte salt) — pure Web Crypto
- **Sessions**: 32-byte random tokens stored in D1, `httpOnly Secure SameSite=Lax` cookie
- **API keys**: AES-256-GCM encrypted before storage, IV stored alongside. Key is decrypted server-side ONLY at generation time. Never returned to client in any response.
- **Constant-time compare**: HMAC-based safeCompare for session token validation

---

## File Structure

```
src/
  index.tsx             — Full backend: auth, keys, projects, characters, generation,
                          Attention Engine, all page HTML functions
  renderer.tsx          — JSX renderer

public/static/
  video-generator.css   — Complete new CSS: auth gate, drawer, project selector,
                          shot grid with status states, modals, usage bar
  video-generator.js    — Complete new frontend JS: auth flow, project CRUD,
                          shot generation + polling, settings drawer, model hints
  attention-engine.css  — Attention Engine styles
  attention-engine.js   — Attention Engine frontend
  main.js               — Landing page Three.js particle engine

migrations/
  0001_initial.sql      — Full schema applied to production D1 ✅

wrangler.jsonc          — D1 (DB → spectra-production) + R2 (STORAGE → spectra-assets)
ecosystem.config.cjs    — PM2: app=spectra, wrangler pages dev dist :3000
.dev.vars               — Local secrets (gitignored)
```

---

## Dev Commands

```bash
# Build
npm run build

# Local dev (with DB + STORAGE bindings)
npm run build && pm2 start ecosystem.config.cjs
# or: npx wrangler pages dev dist --d1=spectra-production --local --ip 0.0.0.0 --port 3000

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

## Next Steps

1. **Stripe integration** — upgrade flow, webhook for tier changes
2. **R2 video copy** — copy HF CDN videos to R2 after completion for permanence
3. **Thumbnail extraction** — generate poster frame from completed video
4. **Shot reorder / sequence editor** — drag to arrange shots into timeline
5. **Character Soul training** — UI to train Higgsfield Soul from reference images
6. **Dreamina adapter** — add second provider behind VideoProvider interface
7. **Admin panel** — user management, credit top-ups
