import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'

const app = new Hono()

// Serve static assets
app.use('/static/*', serveStatic({ root: './' }))
app.get('/favicon.svg', (c) => {
  c.header('Content-Type', 'image/svg+xml')
  c.header('Cache-Control', 'public, max-age=86400')
  return c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0a0e14"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-family="monospace" font-size="18" font-weight="700" fill="#A8D8F0">S</text></svg>`)
})

// Tool routes — each returns the full SPA shell
app.get('/tools/attention-engine', (c) => c.redirect('/tools/attention-engine/'))
app.get('/tools/attention-engine/', (c) => c.html(toolShell('AI Attention Engine', 'attention')))

app.get('/tools/video-generator', (c) => c.redirect('/tools/video-generator/'))
app.get('/tools/video-generator/', (c) => c.html(toolShell('AI Video Generator', 'video')))

app.get('/tools/distribution-engine', (c) => c.redirect('/tools/distribution-engine/'))
app.get('/tools/distribution-engine/', (c) => c.html(toolShell('Content Distribution Engine', 'distribution')))

app.get('/tools/motion-engine', (c) => c.redirect('/tools/motion-engine/'))
app.get('/tools/motion-engine/', (c) => c.html(toolShell('Motion Composition Engine', 'motion')))

app.get('/tools/persona-engine', (c) => c.redirect('/tools/persona-engine/'))
app.get('/tools/persona-engine/', (c) => c.html(toolShell('Spectra Persona Engine', 'persona')))

// Landing page — main entry
app.get('/', (c) => c.html(landingPage()))

export default app

// ─── Tool Shell (placeholder for future builds) ───────────────────────────────
function toolShell(name: string, id: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name} — Spectra by Pano</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#0a0e14;--ice:#E8F4FD;--cream:#F5F0E8;--accent:#7BB8D4;--glow:#A8D8F0;--surface:#111827;--border:rgba(168,216,240,0.15)}
    body{background:var(--bg);color:var(--ice);font-family:'Space Grotesk',sans-serif;min-height:100vh;display:flex;flex-direction:column}
    nav{display:flex;align-items:center;justify-content:space-between;padding:1.5rem 3rem;border-bottom:1px solid var(--border)}
    .nav-logo{font-family:'Space Mono',monospace;font-size:1.1rem;letter-spacing:0.3em;color:var(--glow);text-decoration:none}
    .nav-back{color:var(--accent);text-decoration:none;font-size:0.85rem;letter-spacing:0.1em;opacity:0.7;transition:opacity 0.2s}
    .nav-back:hover{opacity:1}
    main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem 2rem;text-align:center}
    .coming-label{font-family:'Space Mono',monospace;font-size:0.7rem;letter-spacing:0.3em;color:var(--accent);text-transform:uppercase;margin-bottom:2rem;opacity:0.6}
    h1{font-size:clamp(2rem,5vw,3.5rem);font-weight:300;letter-spacing:-0.02em;line-height:1.1;margin-bottom:1.5rem}
    h1 span{color:var(--glow)}
    p{color:rgba(232,244,253,0.5);max-width:500px;line-height:1.7;font-size:1.05rem}
    .pulse{width:80px;height:80px;border-radius:50%;border:1px solid var(--accent);margin:0 auto 3rem;animation:pulse 2s ease-in-out infinite;opacity:0.4}
    @keyframes pulse{0%,100%{transform:scale(1);opacity:0.4}50%{transform:scale(1.2);opacity:0.8}}
  </style>
</head>
<body>
  <nav>
    <a href="/" class="nav-logo">SPECTRA</a>
    <a href="/" class="nav-back">← Back to Suite</a>
  </nav>
  <main>
    <div class="pulse"></div>
    <div class="coming-label">Week 3–10 Build</div>
    <h1>${name.split(' ').slice(0, -1).join(' ')} <span>${name.split(' ').at(-1)}</span></h1>
    <p>This module is currently in active development. The full AI-powered interface will be deployed as part of the Spectra build schedule.</p>
  </main>
</body>
</html>`
}

// ─── Landing Page ──────────────────────────────────────────────────────────────
function landingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Spectra — AI Creative Suite by Pano Marketing</title>
  <meta name="description" content="Spectra is Pano Marketing's AI-powered creative suite. Analyze content, generate video, optimize distribution, and compose motion — all in one platform.">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/style.css" />
</head>
<body>

<!-- ── LOADING SCREEN ─────────────────────────────────────────────────── -->
<div id="loader">
  <div class="loader-inner">
    <div class="loader-logo">SPECTRA</div>
    <div class="loader-bar-wrap"><div class="loader-bar"></div></div>
    <div class="loader-text">Initializing AI Suite</div>
  </div>
</div>

<!-- ── CURSOR ─────────────────────────────────────────────────────────── -->
<div id="cursor-dot"></div>
<div id="cursor-ring"></div>

<!-- ── NAV ────────────────────────────────────────────────────────────── -->
<nav id="nav">
  <a href="/" class="nav-logo" aria-label="Spectra Home">
    <span class="nav-logo-mark">S</span>
    <span class="nav-logo-text">SPECTRA</span>
  </a>
  <ul class="nav-links" role="list">
    <li><a href="#tools" class="nav-link">Tools</a></li>
    <li><a href="#about" class="nav-link">About</a></li>
    <li><a href="#contact" class="nav-link">Contact</a></li>
  </ul>
  <a href="#tools" class="nav-cta">Launch Suite</a>
</nav>

<!-- ── HERO ───────────────────────────────────────────────────────────── -->
<section id="hero">
  <canvas id="hero-canvas" aria-hidden="true"></canvas>

  <div class="hero-content">
    <div class="hero-eyebrow">
      <span class="eyebrow-dot"></span>
      <span>Pano Marketing Solutions</span>
    </div>
    <h1 class="hero-title">
      <span class="hero-title-line" data-text="The Future">The Future</span>
      <span class="hero-title-line accent" data-text="Delivered.">Delivered.</span>
    </h1>
    <p class="hero-sub">
      Spectra is an AI-powered creative suite that analyzes, generates, distributes,
      and transforms your content — at the speed of thought.
    </p>
    <div class="hero-actions">
      <a href="#tools" class="btn-primary">
        <span>Explore the Suite</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </a>
      <a href="#about" class="btn-ghost">Learn More</a>
    </div>
  </div>

  <div class="hero-shape-label" id="shape-label">
    <span id="shape-name">Initializing</span>
    <span class="shape-label-line"></span>
  </div>

  <div class="scroll-cue" aria-hidden="true">
    <span class="scroll-cue-text">scroll</span>
    <div class="scroll-cue-line"></div>
  </div>
</section>

<!-- ── TOOLS GRID ─────────────────────────────────────────────────────── -->
<section id="tools">
  <div class="section-header">
    <div class="section-tag">
      <span class="tag-dot"></span>AI SUITE
    </div>
    <h2 class="section-title">Five Tools.<br><em>One Platform.</em></h2>
    <p class="section-sub">Every tool engineered to give Pano and its clients an unfair creative advantage.</p>
  </div>

  <div class="tools-grid" role="list">

    <article class="tool-card" data-tool="attention" role="listitem">
      <div class="card-glow"></div>
      <header class="card-header">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" r="10" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="1" stroke-dasharray="3 3" opacity="0.5"/>
            <line x1="24" y1="4" x2="24" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="24" y1="38" x2="24" y2="44" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="4" y1="24" x2="10" y2="24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="38" y1="24" x2="44" y2="24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="24" cy="24" r="3" fill="currentColor"/>
          </svg>
        </div>
        <div class="card-num">01</div>
      </header>
      <div class="card-body">
        <h3 class="card-title">AI Attention <span>&amp;</span> Performance Engine</h3>
        <p class="card-desc">Identifies exact drop-off points in video content, diagnoses engagement issues, and generates optimized hooks, scripts, and performance scores.</p>
        <ul class="card-features" aria-label="Features">
          <li>Drop-off Detection</li>
          <li>Hook Rewrite Engine</li>
          <li>Performance Scoring</li>
        </ul>
      </div>
      <footer class="card-footer">
        <a href="/tools/attention-engine/" class="card-cta">
          Open Tool
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7h9M8 3.5L11.5 7 8 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <span class="card-status status-active">Active</span>
      </footer>
    </article>

    <article class="tool-card" data-tool="video" role="listitem">
      <div class="card-glow"></div>
      <header class="card-header">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="10" width="32" height="22" rx="3" stroke="currentColor" stroke-width="1.5"/>
            <path d="M36 18l8-5v16l-8-5V18z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <line x1="4" y1="38" x2="36" y2="38" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="16" cy="21" r="4" stroke="currentColor" stroke-width="1.5"/>
            <path d="M14.5 21l2 1.2-2 1.2V21z" fill="currentColor"/>
          </svg>
        </div>
        <div class="card-num">02</div>
      </header>
      <div class="card-body">
        <h3 class="card-title">AI Video <span>Generator</span></h3>
        <p class="card-desc">Converts text into structured video prompts and extracts captions or scripts from existing video content for production-ready outputs.</p>
        <ul class="card-features" aria-label="Features">
          <li>Text-to-Video Prompts</li>
          <li>Auto Transcription</li>
          <li>Caption Generation</li>
        </ul>
      </div>
      <footer class="card-footer">
        <a href="/tools/video-generator/" class="card-cta">
          Open Tool
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7h9M8 3.5L11.5 7 8 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <span class="card-status status-build">In Build</span>
      </footer>
    </article>

    <article class="tool-card" data-tool="distribution" role="listitem">
      <div class="card-glow"></div>
      <header class="card-header">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="8" r="4" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="8" cy="36" r="4" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="40" cy="36" r="4" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="24" cy="36" r="4" stroke="currentColor" stroke-width="1.5"/>
            <line x1="24" y1="12" x2="8" y2="32" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="24" y1="12" x2="24" y2="32" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="24" y1="12" x2="40" y2="32" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="card-num">03</div>
      </header>
      <div class="card-body">
        <h3 class="card-title">Content Distribution <span>&amp; Timing Engine</span></h3>
        <p class="card-desc">AI-powered recommendations for when, where, and how to distribute content — maximizing reach, engagement, and platform-specific performance.</p>
        <ul class="card-features" aria-label="Features">
          <li>Platform Strategy</li>
          <li>Timing Optimization</li>
          <li>Distribution Plans</li>
        </ul>
      </div>
      <footer class="card-footer">
        <a href="/tools/distribution-engine/" class="card-cta">
          Open Tool
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7h9M8 3.5L11.5 7 8 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <span class="card-status status-build">In Build</span>
      </footer>
    </article>

    <article class="tool-card" data-tool="motion" role="listitem">
      <div class="card-glow"></div>
      <header class="card-header">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 32 C12 20, 20 36, 28 22 S40 10, 44 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M4 36 C12 24, 20 40, 28 26 S40 14, 44 20" stroke="currentColor" stroke-width="1" opacity="0.4" stroke-linecap="round"/>
            <path d="M4 28 C12 16, 20 32, 28 18 S40 6, 44 12" stroke="currentColor" stroke-width="1" opacity="0.4" stroke-linecap="round"/>
            <circle cx="44" cy="16" r="3" fill="currentColor"/>
          </svg>
        </div>
        <div class="card-num">04</div>
      </header>
      <div class="card-body">
        <h3 class="card-title">AI Motion <span>Composition Engine</span></h3>
        <p class="card-desc">Transforms static images and existing video into cinematic motion experiences with depth, camera movement, environmental effects, and style presets.</p>
        <ul class="card-features" aria-label="Features">
          <li>Image-to-Motion</li>
          <li>Cinematic Style Presets</li>
          <li>Prompt-Based Control</li>
        </ul>
      </div>
      <footer class="card-footer">
        <a href="/tools/motion-engine/" class="card-cta">
          Open Tool
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7h9M8 3.5L11.5 7 8 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <span class="card-status status-build">In Build</span>
      </footer>
    </article>

    <article class="tool-card card-featured" data-tool="persona" role="listitem">
      <div class="card-glow"></div>
      <header class="card-header">
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="16" r="8" stroke="currentColor" stroke-width="1.5"/>
            <path d="M6 42c0-9.941 8.059-18 18-18s18 8.059 18 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M30 20l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
          </svg>
        </div>
        <div class="card-num">05</div>
      </header>
      <div class="card-body">
        <h3 class="card-title">Spectra <span>Persona Engine</span></h3>
        <p class="card-desc">The core of the Spectra platform — AI persona generation, simulation workflows, structured prompt libraries, and scalable backend AI modules.</p>
        <ul class="card-features" aria-label="Features">
          <li>Persona Generation</li>
          <li>Simulation Workflows</li>
          <li>Prompt Library</li>
        </ul>
      </div>
      <footer class="card-footer">
        <a href="/tools/persona-engine/" class="card-cta">
          Open Tool
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7h9M8 3.5L11.5 7 8 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <span class="card-status status-build">In Build</span>
      </footer>
    </article>

  </div>
</section>

<!-- ── ABOUT ───────────────────────────────────────────────────────────── -->
<section id="about">
  <div class="about-grid">
    <div class="about-text">
      <div class="section-tag">
        <span class="tag-dot"></span>ABOUT SPECTRA
      </div>
      <h2 class="about-title">AI Powered Production.<br><em>The Future Delivered.</em></h2>
      <p class="about-desc">Spectra is Pano Marketing Solutions' proprietary AI creative suite — built to give clients and internal teams an unfair advantage in content creation, analysis, and distribution.</p>
      <p class="about-desc">Every tool in the suite is designed to work together, creating a closed-loop system where content is created, analyzed, optimized, and redistributed at machine speed.</p>
      <a href="#tools" class="btn-primary">
        <span>Explore the Suite</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </a>
    </div>
    <div class="about-stats">
      <div class="stat-card">
        <div class="stat-num">5</div>
        <div class="stat-label">AI-Powered Tools</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">10<span>wk</span></div>
        <div class="stat-label">Build Timeline</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">∞</div>
        <div class="stat-label">Scale Potential</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">1</div>
        <div class="stat-label">Unified Platform</div>
      </div>
    </div>
  </div>
</section>

<!-- ── CONTACT ─────────────────────────────────────────────────────────── -->
<section id="contact">
  <div class="contact-inner">
    <div class="section-tag"><span class="tag-dot"></span>PANO MARKETING</div>
    <h2 class="contact-title">Built by Pano.<br><em>Powered by AI.</em></h2>
    <p class="contact-sub">Spectra is an internal platform developed during the Mason Externship Program. Questions? Reach the team.</p>
    <a href="mailto:team@panomarketing.com" class="btn-primary">
      <span>Get in Touch</span>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4l6 5 6-5M2 4h12v9H2V4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </a>
  </div>
</section>

<!-- ── FOOTER ──────────────────────────────────────────────────────────── -->
<footer id="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <span class="footer-logo">SPECTRA</span>
      <span class="footer-by">by Pano Marketing Solutions</span>
    </div>
    <div class="footer-links">
      <a href="#tools">Suite</a>
      <a href="#about">About</a>
      <a href="#contact">Contact</a>
    </div>
    <div class="footer-copy">
      &copy; 2026 Pano Marketing Solutions. All rights reserved.
    </div>
  </div>
</footer>

<!-- ── THREE.JS + SCRIPTS ─────────────────────────────────────────────── -->
<script src="https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js"></script>
<script src="/static/main.js"></script>

</body>
</html>`
}
