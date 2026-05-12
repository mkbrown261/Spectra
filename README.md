# Spectra — Intelligent Creative Suite

## Project Overview
- **Name**: Spectra
- **Goal**: A cinematic 5-scene scroll engine landing page housing a full 5-tool AI creative suite for Pano Marketing
- **Platform**: Cloudflare Pages
- **Production URL**: https://spectra-b8s.pages.dev
- **Deployment**: `spectra` project on Cloudflare Pages (account: mkbrown261@gmail.com)

---

## Live URLs

| Route | Status | Description |
|-------|--------|-------------|
| `https://spectra-b8s.pages.dev/` | ✅ Live | Cinematic landing (5-scene Three.js scroll engine) |
| `https://spectra-b8s.pages.dev/tools/attention-engine/` | ✅ Live | Tool 01 — Attention Engine (full) |
| `https://spectra-b8s.pages.dev/tools/video-generator/` | ✅ Live | Tool 02 — Video Generator (full) |
| `https://spectra-b8s.pages.dev/tools/distribution-engine/` | 🔄 Shell | Tool 03 — Coming Soon placeholder |
| `https://spectra-b8s.pages.dev/tools/motion-engine/` | 🔄 Shell | Tool 04 — Coming Soon placeholder |
| `https://spectra-b8s.pages.dev/tools/persona-engine/` | 🔄 Shell | Tool 05 — Coming Soon placeholder |

---

## Tools Status

### ✅ Tool 01 — Attention Engine (`/tools/attention-engine/`)
**Color**: Purple `#A78BFA`

Full functional tool. Features:
- 6-platform selector (TikTok, Instagram, YouTube, Twitter, Facebook, Paid Ads)
- URL auto-population (YouTube API, Meta Graph API via user-provided keys)
- Performance metrics input (views, likes, comments, shares, saves, watch time %)
- Platform-weighted composite scoring (calibrated per-platform algorithm weights)
- Drop-off point detection + timeline segment analysis
- Streaming GPT-4o diagnosis (hook, pacing, visual, messaging, emotion, CTA)
- 6-tab output: Scores, Timeline, Diagnosis, Optimize, Rewrite
- Script Rewrite Engine (3 hooks + 2 full rewrites, streaming)
- API keys drawer (localStorage, YouTube + Meta tokens)
- Export / copy results

**API routes:**
- `POST /api/attention/analyze` — streaming SSE, full diagnosis JSON
- `POST /api/attention/rewrite` — streaming SSE, hooks + rewrites JSON
- `POST /api/attention/score` — instant JSON score
- `GET /api/fetch-url?url=` — YouTube/Instagram/Facebook auto-populate

---

### ✅ Tool 02 — Video Generator (`/tools/video-generator/`)
**Color**: Green `#34D399`

Full functional tool. Features:
- 6-platform selector with auto aspect-ratio mapping
- 8 video style chips (Cinematic, Documentary, Talking Head, UGC, Animation, etc.)
- 4 aspect ratio buttons (9:16, 16:9, 1:1, 4:5)
- Concept textarea, existing script/notes, audience, tone, duration, mood, music inputs
- Generate Brief → streaming GPT-4o production brief (concept, scripts ×2, shot list, music, b-roll, voiceover, technical, captions)
- 5 Hooks Only → streaming GPT-4o, 5 platform-native hook variations
- 6-tab output: Brief, Script, Shot List, Hooks, Production, Captions
- Brief tab: concept card, 8-field brief grid, director's note
- Script tab: 2 full script versions with copy buttons
- Shots tab: numbered shot list (type, description, direction, duration)
- Hooks tab: 5 cards (strategy, text, why-it-works, copy button)
- Production tab: music brief, b-roll suggestions, voiceover direction, technical specs
- Captions tab: per-platform caption copy + hashtags, copy buttons
- Markdown export of full brief
- Re-run button

**API routes:**
- `POST /api/video/generate` — streaming SSE, full production brief JSON
- `POST /api/video/hooks` — streaming SSE, 5 hook variations JSON

---

### 🔄 Tool 03 — Distribution Engine (`/tools/distribution-engine/`)
**Color**: Blue `#60A5FA` — Coming Soon shell

### 🔄 Tool 04 — Motion Engine (`/tools/motion-engine/`)
**Color**: Orange `#FB923C` — Coming Soon shell

### 🔄 Tool 05 — Persona Engine (`/tools/persona-engine/`)
**Color**: Red `#F87171` — Coming Soon shell

---

## Landing Page — 5-Scene Scroll Engine

Built with Three.js + GSAP ScrollTrigger. Five scroll-locked scenes:

| Scene | ID | Content | 3D Object |
|-------|----|---------|-----------|
| 0 | `scene-hero` | Hero — "Intelligent Creative Suite" | Particle field (sparse) |
| 1 | `scene-tools` | Tool selector — 5 node buttons | Particle sphere (`mainParticles` morphed to `pos_sphere`) + `nodeGroup` (5 tool nodes orbiting) |
| 2 | `scene-features` | Architecture — 6 feature fragments | Floating geometric shards (`dashGroup`) |
| 3 | `scene-about` | Metrics — 5/100%/∞/1 counters | Orbit ring system |
| 4 | `scene-cta` | CTA — "The system is ready" | Hyperspace tunnel |

**Drag-to-spin**: Scene 1 only — drags `mainParticles.rotation` and `nodeGroup.rotation` in sync. Momentum decay + idle auto-rotation.

---

## Architecture

### Tech Stack
- **Framework**: Hono v4 on Cloudflare Workers (edge runtime)
- **Build**: Vite + `@hono/vite-cloudflare-pages`
- **3D**: Three.js r158 (CDN), GSAP 3.12.5 + ScrollTrigger (CDN)
- **Fonts**: Space Grotesk + Space Mono (Google Fonts)
- **AI**: OpenAI SDK (`openai` npm) — GPT-4o, streaming SSE

### Cloudflare Workers Compatibility
- **No Node.js APIs**: No `fs`, `path`, `os`, `child_process` — pure Workers runtime
- **Static files**: Served by Cloudflare Pages CDN from `public/` automatically — no routes needed
- **Env vars**: `c.env.OPENAI_API_KEY` pattern via `Hono<{ Bindings: T }>`
- **Streaming**: `ReadableStream` + `TextEncoder` SSE pattern

### Required Environment Variables (Cloudflare Secrets)
```
OPENAI_API_KEY       # OpenAI API key
OPENAI_BASE_URL      # Optional custom base URL (default: https://api.openai.com/v1)
YOUTUBE_API_KEY      # Optional — YouTube Data API v3 (for URL auto-populate)
FB_ACCESS_TOKEN      # Optional — Meta Graph API token (for Instagram/Facebook)
```

Set via: `npx wrangler pages secret put OPENAI_API_KEY --project-name spectra`

---

## File Structure

```
webapp/
├── src/
│   └── index.tsx                    # All Hono routes + page HTML functions
├── public/
│   ├── favicon.svg
│   └── static/
│       ├── style.css                # Landing page styles (5-scene scroll engine)
│       ├── main.js                  # Landing page Three.js + GSAP engine
│       ├── attention-engine.css     # Tool 01 stylesheet
│       ├── attention-engine.js      # Tool 01 frontend logic
│       ├── video-generator.css      # Tool 02 stylesheet (green #34D399)
│       └── video-generator.js       # Tool 02 frontend logic
├── dist/                            # Built output (wrangler deploy target)
├── ecosystem.config.cjs             # PM2 config (app name: spectra, port: 3000)
├── wrangler.jsonc                   # Cloudflare Pages config
├── vite.config.ts                   # Vite build config
├── tsconfig.json                    # TypeScript config
└── package.json                     # Dependencies
```

---

## Development

```bash
# Build
cd /home/user/webapp
node -e "const cp=require('child_process');const p=cp.spawn('npx',['vite','build'],{cwd:process.cwd(),env:{...process.env},stdio:'inherit'});p.on('exit',c=>process.exit(c||0));setTimeout(()=>{p.kill();process.exit(1)},60000);"

# Start local dev server (port 3000)
fuser -k 3000/tcp 2>/dev/null || true
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.cjs

# Test
curl http://localhost:3000/
curl http://localhost:3000/tools/video-generator/
```

## Deploy to Cloudflare

```bash
CLOUDFLARE_API_TOKEN="<token>" node -e "
const cp=require('child_process');
const p=cp.spawn('npx',['wrangler','pages','deploy','dist','--project-name','spectra'],{
  env:{...process.env,CLOUDFLARE_API_TOKEN:process.env.CLOUDFLARE_API_TOKEN},stdio:'inherit'
});
p.on('exit',c=>{setTimeout(()=>process.exit(0),300)});
setTimeout(()=>{p.kill();process.exit(1)},120000);
"
```

---

## Git History (recent)
| Commit | Message |
|--------|---------|
| `1c84723` | feat: Tool 02 Video Generator — full page, CSS, JS, streaming API routes |
| `e47b3d3` | fix: Cloudflare compatibility — remove Node.js imports, pure Workers runtime, gpt-4o model |
| *(earlier)* | fix: drag-to-spin — target Scene 1 mainParticles + nodeGroup |

---

## Recommended Next Steps

1. **Tool 03 — Distribution Engine**: Multi-platform scheduling, optimal post time analysis, cross-channel content adaptation
2. **Tool 04 — Motion Engine**: AI-driven motion composition briefs, keyframe suggestions, transition planning
3. **Tool 05 — Persona Engine**: Audience persona builder, content voice calibration, brand tone analysis
4. **Landing page node links**: Wire tool node buttons in Scene 1 to navigate to their respective `/tools/` routes on click
5. **OpenAI key UI on Video Generator**: Add an API key drawer (same pattern as Attention Engine) so users can supply their own key client-side
6. **Error state polish**: Surface cleaner error messages when OpenAI key is missing or rate-limited

---

*Last updated: 2026-05-12 — Tool 02 Video Generator deployed*
