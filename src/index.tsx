import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'

const app = new Hono()

app.use('/static/*', serveStatic({ root: './' }))
app.get('/favicon.svg', (c) => {
  c.header('Content-Type', 'image/svg+xml')
  c.header('Cache-Control', 'public, max-age=86400')
  return c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0a0e14"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-family="monospace" font-size="18" font-weight="700" fill="#A8D8F0">S</text></svg>`)
})

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

app.get('/', (c) => c.html(landingPage()))

export default app

function toolShell(name: string, id: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${name} — Spectra by Pano</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
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
    .pulse-ring{width:80px;height:80px;border-radius:50%;border:1px solid var(--accent);margin:0 auto 3rem;animation:pulse 2s ease-in-out infinite;opacity:0.4}
    @keyframes pulse{0%,100%{transform:scale(1);opacity:0.4}50%{transform:scale(1.2);opacity:0.8}}
  </style>
</head>
<body>
  <nav>
    <a href="/" class="nav-logo">SPECTRA</a>
    <a href="/" class="nav-back">← Back to Suite</a>
  </nav>
  <main>
    <div class="pulse-ring"></div>
    <div class="coming-label">Week 3–10 Build</div>
    <h1>${name.split(' ').slice(0,-1).join(' ')} <span>${name.split(' ').at(-1)}</span></h1>
    <p>This module is currently in active development. The full AI-powered interface will be deployed as part of the Spectra build schedule.</p>
  </main>
</body>
</html>`
}

function landingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Spectra — AI Creative Suite by Pano Marketing</title>
  <meta name="description" content="Spectra is Pano Marketing's AI-powered creative suite. Analyze content, generate video, optimize distribution, and compose motion.">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/style.css"/>
</head>
<body>

<!-- LOADER -->
<div id="loader">
  <div class="loader-inner">
    <div class="loader-word">
      <span>S</span><span>P</span><span>E</span><span>C</span><span>T</span><span>R</span><span>A</span>
    </div>
    <div class="loader-bar-track"><div class="loader-bar-fill"></div></div>
    <div class="loader-status">Initializing AI Suite</div>
  </div>
</div>

<!-- CURSOR -->
<div id="cursor-dot"></div>
<div id="cursor-ring"></div>

<!-- FIXED NAV -->
<nav id="nav">
  <a href="/" class="nav-logo" aria-label="Spectra Home">
    <span class="nav-logo-mark">S</span>
    <span class="nav-logo-text">SPECTRA</span>
  </a>
  <ul class="nav-links" role="list">
    <li><a href="#scene-tools" class="nav-link" data-scene="1">Tools</a></li>
    <li><a href="#scene-about" class="nav-link" data-scene="2">About</a></li>
    <li><a href="#scene-cta" class="nav-link" data-scene="3">Contact</a></li>
  </ul>
  <div class="nav-progress">
    <div class="nav-progress-fill"></div>
  </div>
</nav>

<!-- FULL-PAGE 3D CANVAS — fixed, covers everything -->
<canvas id="world-canvas" aria-hidden="true"></canvas>

<!-- SCROLL CONTAINER — drives the timeline -->
<div id="scroll-container">

  <!-- ═══ SCENE 0 — HERO / LOGO FORMATION ═══════════════════════════ -->
  <section class="scene" id="scene-hero" data-scene="0">
    <div class="scene-ui" id="ui-hero">
      <div class="hero-eyebrow">
        <span class="eyebrow-pip"></span>
        <span class="eyebrow-text">Pano Marketing Solutions</span>
      </div>
      <h1 class="hero-title">
        <span class="ht-line">The Future</span>
        <span class="ht-line ht-accent">Delivered.</span>
      </h1>
      <p class="hero-sub">
        An AI-powered creative suite that analyzes, generates,
        distributes, and transforms content — at the speed of thought.
      </p>
      <div class="hero-ctas">
        <a href="#scene-tools" class="btn-primary cta-scroll">
          <span>Explore the Suite</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <a href="#scene-about" class="btn-ghost cta-scroll">About Spectra</a>
      </div>
    </div>
    <div class="scroll-cue">
      <span class="sc-label">scroll</span>
      <div class="sc-line"></div>
    </div>
  </section>

  <!-- ═══ SCENE 1 — NEURAL TOOL NETWORK ════════════════════════════ -->
  <section class="scene" id="scene-tools" data-scene="1">
    <div class="scene-ui" id="ui-tools">
      <div class="section-eyebrow">
        <span class="eyebrow-pip"></span>AI SUITE
      </div>
      <h2 class="section-title">Five Tools.<br><em>One Platform.</em></h2>
      <div class="tools-orbital" role="list">

        <a href="/tools/attention-engine/" class="tool-node" data-node="0" role="listitem">
          <div class="node-ring"></div>
          <div class="node-core">
            <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/><circle cx="16" cy="16" r="2" fill="currentColor"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num">01</span>
            <span class="node-name">Attention Engine</span>
            <span class="node-status active">Active</span>
          </div>
        </a>

        <a href="/tools/video-generator/" class="tool-node" data-node="1" role="listitem">
          <div class="node-ring"></div>
          <div class="node-core">
            <svg viewBox="0 0 32 32" fill="none"><rect x="3" y="7" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M23 12l6-3v10l-6-3V12z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num">02</span>
            <span class="node-name">Video Generator</span>
            <span class="node-status">In Build</span>
          </div>
        </a>

        <a href="/tools/distribution-engine/" class="tool-node" data-node="2" role="listitem">
          <div class="node-ring"></div>
          <div class="node-core">
            <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="24" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="27" cy="24" r="3" stroke="currentColor" stroke-width="1.5"/><line x1="16" y1="8" x2="5" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="8" x2="27" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="8" x2="16" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num">03</span>
            <span class="node-name">Distribution Engine</span>
            <span class="node-status">In Build</span>
          </div>
        </a>

        <a href="/tools/motion-engine/" class="tool-node" data-node="3" role="listitem">
          <div class="node-ring"></div>
          <div class="node-core">
            <svg viewBox="0 0 32 32" fill="none"><path d="M2 20 C8 12, 14 24, 20 14 S28 6, 30 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="30" cy="10" r="2" fill="currentColor"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num">04</span>
            <span class="node-name">Motion Engine</span>
            <span class="node-status">In Build</span>
          </div>
        </a>

        <a href="/tools/persona-engine/" class="tool-node" data-node="4" role="listitem">
          <div class="node-ring"></div>
          <div class="node-core">
            <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="10" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M4 28c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num">05</span>
            <span class="node-name">Persona Engine</span>
            <span class="node-status">In Build</span>
          </div>
        </a>

      </div>
    </div>
  </section>

  <!-- ═══ SCENE 2 — EXPLODED FEATURE MOMENT ════════════════════════ -->
  <section class="scene" id="scene-features" data-scene="2">
    <div class="scene-ui" id="ui-features">
      <div class="section-eyebrow">
        <span class="eyebrow-pip"></span>ARCHITECTURE
      </div>
      <h2 class="section-title">Built Different.<br><em>By Design.</em></h2>
      <div class="feature-fragments">
        <div class="frag" data-frag="0">
          <div class="frag-icon">⚡</div>
          <div class="frag-label">Real-Time AI Analysis</div>
        </div>
        <div class="frag" data-frag="1">
          <div class="frag-icon">🎯</div>
          <div class="frag-label">Drop-Off Detection</div>
        </div>
        <div class="frag" data-frag="2">
          <div class="frag-icon">✍️</div>
          <div class="frag-label">Script Rewrite Engine</div>
        </div>
        <div class="frag" data-frag="3">
          <div class="frag-icon">📊</div>
          <div class="frag-label">Performance Scoring</div>
        </div>
        <div class="frag" data-frag="4">
          <div class="frag-icon">🌐</div>
          <div class="frag-label">Multi-Platform Distribution</div>
        </div>
        <div class="frag" data-frag="5">
          <div class="frag-icon">🎬</div>
          <div class="frag-label">Cinematic Motion AI</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ═══ SCENE 3 — FLOATING DASHBOARD / METRICS ═══════════════════ -->
  <section class="scene" id="scene-about" data-scene="3">
    <div class="scene-ui" id="ui-about">
      <div class="section-eyebrow">
        <span class="eyebrow-pip"></span>ABOUT SPECTRA
      </div>
      <h2 class="section-title">AI Powered Production.<br><em>The Future Delivered.</em></h2>
      <p class="section-body">Spectra is Pano Marketing Solutions' proprietary AI creative suite — a closed-loop system where content is created, analyzed, optimized, and redistributed at machine speed.</p>
      <div class="metric-row">
        <div class="metric">
          <div class="metric-val" data-count="5">0</div>
          <div class="metric-label">AI Tools</div>
        </div>
        <div class="metric">
          <div class="metric-val" data-count="10">0</div>
          <div class="metric-label">Week Build</div>
        </div>
        <div class="metric">
          <div class="metric-val">∞</div>
          <div class="metric-label">Scale</div>
        </div>
        <div class="metric">
          <div class="metric-val" data-count="1">0</div>
          <div class="metric-label">Platform</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ═══ SCENE 4 — PORTAL CTA ══════════════════════════════════════ -->
  <section class="scene" id="scene-cta" data-scene="4">
    <div class="scene-ui" id="ui-cta">
      <div class="section-eyebrow">
        <span class="eyebrow-pip"></span>PANO MARKETING SOLUTIONS
      </div>
      <h2 class="cta-title">Built by Pano.<br><em>Powered by AI.</em></h2>
      <p class="cta-body">Spectra is an internal platform built during the Mason Externship Program — the foundation of a future SaaS product.</p>
      <div class="cta-actions">
        <a href="/tools/attention-engine/" class="btn-primary btn-glow">
          <span>Launch Attention Engine</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <a href="mailto:team@panomarketing.com" class="btn-ghost">Get in Touch</a>
      </div>
      <div class="cta-footer-note">
        &copy; 2026 Pano Marketing Solutions
      </div>
    </div>
  </section>

</div><!-- /scroll-container -->

<!-- THREE.JS + GSAP -->
<script src="https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
<script src="/static/main.js"></script>

</body>
</html>`
}
