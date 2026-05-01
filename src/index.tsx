import { Hono } from 'hono'
import { readFileSync } from 'fs'
import { join } from 'path'

const app = new Hono()

/* ── Static file helpers ─────────────────────────────────────────── */
function readStatic(filename: string): string {
  try {
    return readFileSync(join(process.cwd(), 'public', 'static', filename), 'utf-8')
  } catch {
    return ''
  }
}

/* ── Static routes ───────────────────────────────────────────────── */
app.get('/static/style.css', (c) => {
  c.header('Content-Type', 'text/css; charset=utf-8')
  c.header('Cache-Control', 'no-cache')
  return c.body(readStatic('style.css'))
})

app.get('/static/main.js', (c) => {
  c.header('Content-Type', 'application/javascript; charset=utf-8')
  c.header('Cache-Control', 'no-cache')
  return c.body(readStatic('main.js'))
})

app.get('/favicon.svg', (c) => {
  c.header('Content-Type', 'image/svg+xml')
  c.header('Cache-Control', 'public, max-age=86400')
  return c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#060810"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-family="monospace" font-size="18" font-weight="700" fill="#A8D8F0">S</text></svg>`)
})

/* ── Tool shells ─────────────────────────────────────────────────── */
app.get('/tools/attention-engine',  (c) => c.redirect('/tools/attention-engine/'))
app.get('/tools/attention-engine/', (c) => c.html(toolShell('AI Attention Engine', 'attention', '#A78BFA')))
app.get('/tools/video-generator',   (c) => c.redirect('/tools/video-generator/'))
app.get('/tools/video-generator/',  (c) => c.html(toolShell('AI Video Generator', 'video', '#34D399')))
app.get('/tools/distribution-engine',  (c) => c.redirect('/tools/distribution-engine/'))
app.get('/tools/distribution-engine/', (c) => c.html(toolShell('Content Distribution Engine', 'distribution', '#60A5FA')))
app.get('/tools/motion-engine',  (c) => c.redirect('/tools/motion-engine/'))
app.get('/tools/motion-engine/', (c) => c.html(toolShell('Motion Composition Engine', 'motion', '#FB923C')))
app.get('/tools/persona-engine',  (c) => c.redirect('/tools/persona-engine/'))
app.get('/tools/persona-engine/', (c) => c.html(toolShell('Spectra Persona Engine', 'persona', '#F87171')))

app.get('/', (c) => c.html(landingPage()))

export default app

/* ══════════════════════════════════════════════════════════════════
   TOOL SHELL
══════════════════════════════════════════════════════════════════ */
function toolShell(name: string, _id: string, color: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${name} — Spectra</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#060810;--ice:#E8F4FD;--accent:#7BB8D4;--glow:#A8D8F0;--border:rgba(168,216,240,0.10);--tool-color:${color}}
    body{background:var(--bg);color:var(--ice);font-family:'Space Grotesk',sans-serif;min-height:100vh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
    nav{display:flex;align-items:center;justify-content:space-between;padding:1.4rem 3rem;border-bottom:1px solid var(--border)}
    .nav-logo{font-family:'Space Mono',monospace;font-size:0.85rem;letter-spacing:0.30em;color:var(--glow);text-decoration:none;display:flex;align-items:center;gap:0.5rem}
    .nav-logo-mark{width:26px;height:26px;border:1px solid rgba(168,216,240,0.30);border-radius:5px;display:grid;place-items:center;font-size:0.70rem;font-weight:700}
    .nav-back{color:var(--ice-dim,rgba(232,244,253,0.45));text-decoration:none;font-size:0.75rem;letter-spacing:0.08em;transition:color 0.2s;display:flex;align-items:center;gap:0.4rem}
    .nav-back:hover{color:var(--ice)}
    main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5rem 2rem;text-align:center;gap:2rem}
    .tool-badge{
      display:inline-flex;align-items:center;gap:0.55rem;
      font-family:'Space Mono',monospace;font-size:0.58rem;letter-spacing:0.30em;
      text-transform:uppercase;color:var(--tool-color);
      padding:0.35rem 0.85rem;border-radius:20px;
      border:1px solid color-mix(in srgb,var(--tool-color) 35%,transparent);
      background:color-mix(in srgb,var(--tool-color) 8%,transparent);
    }
    .badge-dot{width:5px;height:5px;border-radius:50%;background:var(--tool-color);animation:blink 2.2s ease-in-out infinite;box-shadow:0 0 8px var(--tool-color)}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}
    .pulse-ring{
      width:80px;height:80px;border-radius:50%;
      border:1px solid color-mix(in srgb,var(--tool-color) 40%,transparent);
      box-shadow:0 0 32px color-mix(in srgb,var(--tool-color) 22%,transparent);
      animation:pulse 2.6s ease-in-out infinite
    }
    @keyframes pulse{0%,100%{transform:scale(1);opacity:0.4}50%{transform:scale(1.22);opacity:0.85}}
    h1{font-size:clamp(2.2rem,5vw,3.8rem);font-weight:300;letter-spacing:-0.025em;line-height:1.1}
    h1 em{font-style:italic;font-weight:400;color:var(--tool-color)}
    p{color:rgba(232,244,253,0.45);max-width:420px;line-height:1.78;font-size:0.97rem}
    .actions{display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;margin-top:0.5rem}
    .btn{display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 1.7rem;border-radius:8px;font-size:0.82rem;font-weight:600;letter-spacing:0.04em;text-decoration:none;transition:all 0.25s}
    .btn-back{border:1px solid rgba(168,216,240,0.18);color:rgba(232,244,253,0.55)}
    .btn-back:hover{border-color:rgba(168,216,240,0.35);color:var(--ice);background:rgba(168,216,240,0.05)}
  </style>
</head>
<body>
  <nav>
    <a href="/" class="nav-logo"><span class="nav-logo-mark">S</span>SPECTRA</a>
    <a href="/" class="nav-back">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Back to Suite
    </a>
  </nav>
  <main>
    <div class="pulse-ring"></div>
    <div class="tool-badge"><span class="badge-dot"></span>Coming Soon</div>
    <h1>${name.split(' ').slice(0,-1).join(' ')} <em>${name.split(' ').at(-1)}</em></h1>
    <p>This module is under active development and will be available in the next Spectra release.</p>
    <div class="actions">
      <a href="/" class="btn btn-back">← Return to Spectra</a>
    </div>
  </main>
</body>
</html>`
}

/* ══════════════════════════════════════════════════════════════════
   LANDING PAGE
══════════════════════════════════════════════════════════════════ */
function landingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Spectra — AI Creative Suite</title>
  <meta name="description" content="Spectra — Five AI systems. One unified platform. Infinite creative output.">
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
    <div class="loader-status">Initializing</div>
  </div>
</div>

<!-- CURSOR -->
<div id="cursor-dot"></div>
<div id="cursor-ring"></div>

<!-- TOOLTIP -->
<div id="node-tooltip"></div>

<!-- NAV -->
<nav id="nav" role="navigation" aria-label="Main navigation">
  <a href="/" class="nav-logo" aria-label="Spectra Home">
    <span class="nav-logo-mark" aria-hidden="true">S</span>
    <span class="nav-logo-text">SPECTRA</span>
  </a>
  <ul class="nav-links" role="list">
    <li><a href="#scene-tools"    class="nav-link">System</a></li>
    <li><a href="#scene-features" class="nav-link">Architecture</a></li>
    <li><a href="#scene-about"    class="nav-link">Metrics</a></li>
    <li><a href="#scene-cta"      class="nav-link">Launch</a></li>
  </ul>
  <div class="nav-progress" aria-hidden="true"><div class="nav-progress-fill"></div></div>
</nav>

<!-- CANVAS -->
<canvas id="world-canvas" aria-hidden="true"></canvas>

<!-- TOOL HUD -->
<div id="tool-hud" role="complementary" aria-label="Tool details">
  <div class="hud-label">ACTIVE SYSTEM</div>
  <div class="hud-name"></div>
  <div class="hud-desc"></div>
  <a class="hud-link" href="#">Open Tool
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </a>
</div>

<div id="scroll-container">

  <!-- ═══ SCENE 0 — HERO ══════════════════════════════════════════ -->
  <section class="scene" id="scene-hero" data-scene="0">
    <div class="scene-ui" id="ui-hero">
      <p class="hero-pre">AI Creative Suite</p>
      <h1 class="hero-title">
        <span class="ht-line ht-main">Spectra</span>
      </h1>
      <p class="hero-sub">
        Five AI systems. One platform.<br>Infinite creative output.
      </p>
      <div class="hero-ctas">
        <a href="#scene-tools" class="btn-primary btn-glow cta-scroll" aria-label="Enter the System">
          <span>Enter the System</span>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <a href="#scene-about" class="btn-ghost cta-scroll">Learn More</a>
      </div>
    </div>
    <div class="scroll-cue" aria-hidden="true">
      <span class="sc-label">scroll</span>
      <div class="sc-line"></div>
    </div>
  </section>

  <!-- ═══ SCENE 1 — INTERACTIVE SYSTEM MAP ════════════════════════ -->
  <section class="scene" id="scene-tools" data-scene="1">
    <div class="scene-ui" id="ui-tools">
      <div class="section-eyebrow"><span class="eyebrow-pip" aria-hidden="true"></span>AI SUITE — SELECT A SYSTEM</div>
      <h2 class="section-title">Five Tools.<br><em>One Platform.</em></h2>

      <div class="tools-orbital" role="list" id="tools-list">

        <button class="tool-node" data-node="0" data-color="purple" role="listitem" aria-label="Attention Engine — Analyzes video content for engagement drop-offs">
          <div class="node-accent-bar" aria-hidden="true"></div>
          <div class="node-core" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3" opacity="0.5"/><circle cx="16" cy="16" r="2" fill="currentColor"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num" aria-hidden="true">01</span>
            <span class="node-name">Attention Engine</span>
          </div>
          <span class="node-status active">Active</span>
        </button>

        <button class="tool-node" data-node="1" data-color="green" role="listitem" aria-label="Video Generator — AI-powered video creation from scripts">
          <div class="node-accent-bar" aria-hidden="true"></div>
          <div class="node-core" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none"><rect x="3" y="7" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M23 12l6-3v10l-6-3V12z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num" aria-hidden="true">02</span>
            <span class="node-name">Video Generator</span>
          </div>
          <span class="node-status">Build</span>
        </button>

        <button class="tool-node" data-node="2" data-color="blue" role="listitem" aria-label="Distribution Engine — Optimal timing and multi-platform delivery">
          <div class="node-accent-bar" aria-hidden="true"></div>
          <div class="node-core" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="24" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="27" cy="24" r="3" stroke="currentColor" stroke-width="1.5"/><line x1="16" y1="8" x2="5" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="8" x2="27" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="8" x2="16" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num" aria-hidden="true">03</span>
            <span class="node-name">Distribution Engine</span>
          </div>
          <span class="node-status">Build</span>
        </button>

        <button class="tool-node" data-node="3" data-color="orange" role="listitem" aria-label="Motion Engine — Cinematic AI motion composition">
          <div class="node-accent-bar" aria-hidden="true"></div>
          <div class="node-core" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none"><path d="M2 20 C8 12, 14 24, 20 14 S28 6, 30 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="30" cy="10" r="2" fill="currentColor"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num" aria-hidden="true">04</span>
            <span class="node-name">Motion Engine</span>
          </div>
          <span class="node-status">Build</span>
        </button>

        <button class="tool-node" data-node="4" data-color="red" role="listitem" aria-label="Persona Engine — Adaptive brand voice and audience intelligence">
          <div class="node-accent-bar" aria-hidden="true"></div>
          <div class="node-core" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="10" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M4 28c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num" aria-hidden="true">05</span>
            <span class="node-name">Persona Engine</span>
          </div>
          <span class="node-status">Build</span>
        </button>

      </div>
    </div>
  </section>

  <!-- ═══ SCENE 2 — ARCHITECTURE / FEATURE EXPLODE ════════════════ -->
  <section class="scene" id="scene-features" data-scene="2">
    <div class="scene-ui" id="ui-features">
      <div class="section-eyebrow"><span class="eyebrow-pip" aria-hidden="true"></span>ARCHITECTURE</div>
      <h2 class="section-title">Built Different.<br><em>By Design.</em></h2>
      <div class="feature-fragments" id="feature-grid">

        <button class="frag" data-frag="0" aria-label="Real-Time Analysis">
          <div class="frag-icon-wrap" style="--fc:#A78BFA" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 10V3L4 14h7v7l9-11h-7z" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="frag-body">
            <div class="frag-title">Real-Time Analysis</div>
            <div class="frag-label">AI processes content at inference speed</div>
          </div>
        </button>

        <button class="frag" data-frag="1" aria-label="Drop-Off Detection">
          <div class="frag-icon-wrap" style="--fc:#34D399" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
          </div>
          <div class="frag-body">
            <div class="frag-title">Drop-Off Detection</div>
            <div class="frag-label">Pinpoints engagement loss moments</div>
          </div>
        </button>

        <button class="frag" data-frag="2" aria-label="Script Rewrite Engine">
          <div class="frag-icon-wrap" style="--fc:#60A5FA" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </div>
          <div class="frag-body">
            <div class="frag-title">Script Rewrite Engine</div>
            <div class="frag-label">GPT-powered content optimization</div>
          </div>
        </button>

        <button class="frag" data-frag="3" aria-label="Performance Scoring">
          <div class="frag-icon-wrap" style="--fc:#FB923C" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          </div>
          <div class="frag-body">
            <div class="frag-title">Performance Scoring</div>
            <div class="frag-label">Quantified content quality metrics</div>
          </div>
        </button>

        <button class="frag" data-frag="4" aria-label="Multi-Platform Distribution">
          <div class="frag-icon-wrap" style="--fc:#F472B6" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
          </div>
          <div class="frag-body">
            <div class="frag-title">Multi-Platform Distribution</div>
            <div class="frag-label">Optimal timing across all channels</div>
          </div>
        </button>

        <button class="frag" data-frag="5" aria-label="Cinematic Motion AI">
          <div class="frag-icon-wrap" style="--fc:#A8D8F0" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          </div>
          <div class="frag-body">
            <div class="frag-title">Cinematic Motion AI</div>
            <div class="frag-label">AI-composed video motion systems</div>
          </div>
        </button>

      </div>
    </div>
  </section>

  <!-- ═══ SCENE 3 — METRICS ════════════════════════════════════════ -->
  <section class="scene" id="scene-about" data-scene="3">
    <div class="scene-ui" id="ui-about">
      <div class="section-eyebrow"><span class="eyebrow-pip" aria-hidden="true"></span>SPECTRA</div>
      <h2 class="section-title">AI at the Speed<br><em>of Thought.</em></h2>
      <p class="section-body">A closed-loop AI creative system — content is analyzed, generated, optimized, and distributed at machine speed. No bottlenecks. No guesswork.</p>
      <div class="metric-row" role="list">
        <div class="metric" role="listitem">
          <div class="metric-val" data-count="5">0</div>
          <div class="metric-label">AI Engines</div>
        </div>
        <div class="metric" role="listitem">
          <div class="metric-val" data-count="100">0</div>
          <div class="metric-label">% Automated</div>
        </div>
        <div class="metric" role="listitem">
          <div class="metric-val">∞</div>
          <div class="metric-label">Scale</div>
        </div>
        <div class="metric" role="listitem">
          <div class="metric-val" data-count="1">0</div>
          <div class="metric-label">Unified Platform</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ═══ SCENE 4 — PORTAL CTA ════════════════════════════════════ -->
  <section class="scene" id="scene-cta" data-scene="4">
    <div class="scene-ui" id="ui-cta">
      <div class="section-eyebrow"><span class="eyebrow-pip" aria-hidden="true"></span>BEGIN</div>
      <h2 class="cta-title">The system<br><em>is ready.</em></h2>
      <p class="cta-body">Launch the AI Attention Engine — your first portal into the Spectra suite.</p>
      <div class="cta-actions">
        <a href="/tools/attention-engine/" class="btn-primary btn-glow">
          <span>Launch Attention Engine</span>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <a href="#scene-tools" class="btn-ghost cta-scroll">Explore Systems</a>
      </div>
      <div class="cta-brand" aria-label="Spectra brand">
        <div class="cta-brand-mark" aria-hidden="true">S</div>
        <span class="cta-brand-name">SPECTRA</span>
      </div>
    </div>
  </section>

</div><!-- /scroll-container -->

<script src="https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
<script src="/static/main.js"></script>

</body>
</html>`
}
