# SPECTRA
### AI Creative Suite — by Pano Marketing Solutions

> *"AI Powered Production — The Future Delivered"*

---

## Overview

Spectra is Pano Marketing Solutions' proprietary AI-powered creative suite, built as part of the Mason Externship Program. The platform houses five AI tools designed to give Pano and its clients an unfair creative advantage in content creation, analysis, and distribution.

## Live URLs
- **Production (Cloudflare Pages):** https://spectra-b8s.pages.dev
- **GitHub Repo:** https://github.com/mkbrown261/Spectra
- **Dev Sandbox:** `https://3000-ioetnae159awyvdahg3ow-c81df28e.sandbox.novita.ai`

---

## The Five Tools

| # | Tool | Route | Status |
|---|------|--------|--------|
| 01 | AI Attention & Performance Engine | `/tools/attention-engine/` | Active (Week 1 build) |
| 02 | AI Video Generator | `/tools/video-generator/` | In Build (Weeks 3–4) |
| 03 | Content Distribution & Timing Engine | `/tools/distribution-engine/` | In Build (Weeks 5–6) |
| 04 | AI Motion Composition Engine | `/tools/motion-engine/` | In Build (Weeks 7–8) |
| 05 | Spectra Persona Engine | `/tools/persona-engine/` | In Build (Weeks 9–10) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Hono (TypeScript) on Cloudflare Workers |
| 3D Engine | Three.js r158 — custom GLSL shaders |
| Frontend | Vanilla JS + CSS custom properties |
| Fonts | Space Grotesk + Space Mono (Google Fonts) |
| Build | Vite + @hono/vite-build |
| Deploy | Cloudflare Pages |
| Dev | Wrangler Pages Dev via PM2 |

---

## Design System

```
Background:    #0a0e14  (deep space black)
Surface:       #111827  (card layer)
Ice Blue:      #E8F4FD  (primary text)
Cream:         #F5F0E8  (accent text / gradient)
Accent:        #7BB8D4  (mid blue — borders, icons)
Glow:          #A8D8F0  (particles, highlights, logo)

Font Heading:  Space Grotesk — weight 300/400/600
Font Mono:     Space Mono — tags, labels, numbers
```

---

## Three.js Particle System

The hero canvas renders **6,000 particles** using a custom `ShaderMaterial` with:
- **Additive blending** for the glow effect
- **Per-particle size variation** for depth realism
- **Cubic ease-in-out morphing** between 5 shapes

### Shape → Tool Mapping
| Shape | Tool | Motion Metaphor |
|-------|------|----------------|
| Torus Knot | Attention Engine | Looping attention rhythm |
| Icosahedron | Video Generator | Faceted cinematic light |
| Fibonacci Sphere | Distribution Engine | Expanding reach/orbit |
| Waveform Grid | Motion Engine | Flowing motion energy |
| DNA Helix | Persona Engine | Structured intelligence |

Shapes **auto-cycle every 5.5s** and **morph on card hover** (2.2s transition).

---

## Project Structure

```
spectra/
├── src/
│   └── index.tsx          # Hono app — all routes + HTML generation
├── public/
│   ├── favicon.svg        # Inline SVG favicon
│   └── static/
│       ├── style.css      # Full design system CSS
│       └── main.js        # Three.js engine + UI interactions
├── dist/                  # Build output (auto-generated)
├── ecosystem.config.cjs   # PM2 config for sandbox dev
├── wrangler.jsonc         # Cloudflare Pages config
├── vite.config.ts         # Build config
└── package.json
```

---

## Development

```bash
# Install dependencies (already done)
npm install

# Build
npm run build

# Start dev server via PM2
pm2 start ecosystem.config.cjs

# View logs
pm2 logs spectra --nostream

# Rebuild + restart after changes
npm run build && pm2 restart spectra
```

---

## Deployment (Cloudflare Pages)

```bash
# Set up Cloudflare API key first (via Deploy tab)
# Then:
npm run build
npx wrangler pages project create spectra --production-branch main
npx wrangler pages deploy dist --project-name spectra
```

---

## Completed Features (Week 1)

- [x] Three.js particle morphing hero with 5 shapes
- [x] Custom GLSL shader — additive glow particles
- [x] Mouse parallax on particle system
- [x] Loading screen with animated progress bar
- [x] Custom cursor (dot + ring follow)
- [x] Fixed nav with scroll-glass effect
- [x] 5-tool card grid with hover glow + tilt
- [x] Card hover triggers shape morph
- [x] Scroll reveal animations (IntersectionObserver)
- [x] About section with stats grid
- [x] Contact section + footer
- [x] Tool shell pages at each route
- [x] Favicon (inline SVG)
- [x] Mobile responsive layout
- [x] Zero console errors

## Next Steps (Weeks 3–4)

- [ ] Build AI Attention Engine dashboard (OpenAI integration)
- [ ] Video upload system
- [ ] Drop-off timeline visualization
- [ ] Hook strength scoring UI
- [ ] GitHub repo creation + push

---

*Spectra is a strategic asset — not just a tool. Built to position Pano as an AI-driven marketing leader.*
