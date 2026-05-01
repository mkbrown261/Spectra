import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'

const app = new Hono()

app.use('/static/*', serveStatic({ root: './' }))
app.get('/favicon.svg', (c) => {
  c.header('Content-Type', 'image/svg+xml')
  c.header('Cache-Control', 'public, max-age=86400')
  return c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#060810"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-family="monospace" font-size="18" font-weight="700" fill="#A8D8F0">S</text></svg>`)
})

app.get('/tools/attention-engine', (c) => c.redirect('/tools/attention-engine/'))
app.get('/tools/attention-engine/', (c) => c.html(toolShell('AI Attention Engine', 'attention', '#A78BFA')))
app.get('/tools/video-generator', (c) => c.redirect('/tools/video-generator/'))
app.get('/tools/video-generator/', (c) => c.html(toolShell('AI Video Generator', 'video', '#34D399')))
app.get('/tools/distribution-engine', (c) => c.redirect('/tools/distribution-engine/'))
app.get('/tools/distribution-engine/', (c) => c.html(toolShell('Content Distribution Engine', 'distribution', '#60A5FA')))
app.get('/tools/motion-engine', (c) => c.redirect('/tools/motion-engine/'))
app.get('/tools/motion-engine/', (c) => c.html(toolShell('Motion Composition Engine', 'motion', '#FB923C')))
app.get('/tools/persona-engine', (c) => c.redirect('/tools/persona-engine/'))
app.get('/tools/persona-engine/', (c) => c.html(toolShell('Spectra Persona Engine', 'persona', '#F87171')))

app.get('/', (c) => c.html(landingPage()))

export default app

function toolShell(name: string, id: string, accent: string): string {
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
    :root{--bg:#060810;--ice:#E8F4FD;--accent:${accent};--glow:${accent};--border:rgba(168,216,240,0.12)}
    body{background:var(--bg);color:var(--ice);font-family:'Space Grotesk',sans-serif;min-height:100vh;display:flex;flex-direction:column}
    nav{display:flex;align-items:center;justify-content:space-between;padding:1.5rem 3rem;border-bottom:1px solid var(--border)}
    .nav-logo{font-family:'Space Mono',monospace;font-size:1rem;letter-spacing:0.3em;color:#A8D8F0;text-decoration:none}
    .nav-back{color:var(--accent);text-decoration:none;font-size:0.8rem;letter-spacing:0.1em;opacity:0.6;transition:opacity 0.2s}
    .nav-back:hover{opacity:1}
    main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem 2rem;text-align:center}
    .status-badge{font-family:'Space Mono',monospace;font-size:0.62rem;letter-spacing:0.3em;color:var(--accent);text-transform:uppercase;margin-bottom:2.5rem;opacity:0.7;display:inline-flex;align-items:center;gap:0.5rem}
    .status-dot{width:5px;height:5px;border-radius:50%;background:var(--glow);animation:blink 2s ease-in-out infinite;box-shadow:0 0 8px var(--glow)}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}
    h1{font-size:clamp(2rem,5vw,3.5rem);font-weight:300;letter-spacing:-0.02em;line-height:1.1;margin-bottom:1.5rem}
    h1 span{color:var(--glow)}
    p{color:rgba(232,244,253,0.45);max-width:480px;line-height:1.75;font-size:1rem}
    .pulse-ring{width:72px;height:72px;border-radius:50%;border:1px solid var(--accent);margin:0 auto 3rem;animation:pulse 2.4s ease-in-out infinite;opacity:0.4;box-shadow:0 0 28px var(--accent)22}
    @keyframes pulse{0%,100%{transform:scale(1);opacity:0.3}50%{transform:scale(1.25);opacity:0.7}}
  </style>
</head>
<body>
  <nav>
    <a href="/" class="nav-logo">SPECTRA</a>
    <a href="/" class="nav-back">← Suite</a>
  </nav>
  <main>
    <div class="pulse-ring"></div>
    <div class="status-badge"><span class="status-dot"></span>In Development</div>
    <h1>${name.split(' ').slice(0,-1).join(' ')} <span>${name.split(' ').at(-1)}</span></h1>
    <p>This module is currently in active development and will be deployed as part of the Spectra build schedule.</p>
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
  <title>Spectra — AI Creative Suite</title>
  <meta name="description" content="Spectra is an AI-powered creative suite. Five engines. One platform. Infinite creative output.">
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

<!-- FIXED NAV -->
<nav id="nav">
  <a href="/" class="nav-logo" aria-label="Spectra Home">
    <span class="nav-logo-mark">S</span>
    <span class="nav-logo-text">SPECTRA</span>
  </a>
  <ul class="nav-links" role="list">
    <li><a href="#scene-tools"    class="nav-link">System</a></li>
    <li><a href="#scene-features" class="nav-link">Architecture</a></li>
    <li><a href="#scene-about"    class="nav-link">Intelligence</a></li>
    <li><a href="#scene-cta"      class="nav-link">Launch</a></li>
  </ul>
  <div class="nav-progress"><div class="nav-progress-fill"></div></div>
</nav>

<!-- FIXED CANVAS -->
<canvas id="world-canvas" aria-hidden="true"></canvas>

<!-- SELECTED TOOL HUD -->
<div id="tool-hud">
  <div class="hud-header">
    <div class="hud-color-dot"></div>
    <div class="hud-label">ACTIVE SYSTEM</div>
  </div>
  <div class="hud-name"></div>
  <div class="hud-desc"></div>
  <div class="hud-actions">
    <a class="hud-link" href="#">Open Tool →</a>
    <button class="hud-close" id="hud-close" aria-label="Close">✕</button>
  </div>
</div>

<!-- SCENE INDICATOR DOTS -->
<div id="scene-nav" aria-label="Scene navigation">
  <button class="sn-dot active" data-scene="0" aria-label="Hero"></button>
  <button class="sn-dot" data-scene="1" aria-label="System"></button>
  <button class="sn-dot" data-scene="2" aria-label="Architecture"></button>
  <button class="sn-dot" data-scene="3" aria-label="Intelligence"></button>
  <button class="sn-dot" data-scene="4" aria-label="Launch"></button>
</div>

<div id="scroll-container">

  <!-- ═══ SCENE 0 — HERO ═══════════════════════════════════════════ -->
  <section class="scene" id="scene-hero" data-scene="0">
    <div class="scene-ui" id="ui-hero">
      <p class="hero-pre">AI Creative Suite</p>
      <h1 class="hero-title">
        <span class="ht-line">Spectra</span>
      </h1>
      <p class="hero-sub">
        Five AI systems. One platform.<br>Infinite creative output.
      </p>
      <div class="hero-ctas">
        <a href="#scene-tools" class="btn-primary cta-scroll">
          <span>Enter the System</span>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <a href="#scene-about" class="btn-ghost cta-scroll">Learn More</a>
      </div>
    </div>
    <div class="scroll-cue">
      <span class="sc-label">scroll</span>
      <div class="sc-line"></div>
    </div>
  </section>

  <!-- ═══ SCENE 1 — INTERACTIVE SYSTEM MAP ═════════════════════════ -->
  <section class="scene" id="scene-tools" data-scene="1">
    <div class="scene-ui" id="ui-tools">
      <div class="section-eyebrow"><span class="eyebrow-pip"></span>AI SUITE — SELECT A SYSTEM</div>
      <h2 class="section-title">Five Tools.<br><em>One Platform.</em></h2>

      <div class="tools-orbital" role="list" id="tools-list">

        <button class="tool-node" data-node="0" data-color="purple" role="listitem" aria-label="Attention Engine">
          <div class="node-accent-bar"></div>
          <div class="node-core">
            <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3" opacity="0.5"/><circle cx="16" cy="16" r="2" fill="currentColor"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num">01</span>
            <span class="node-name">Attention Engine</span>
          </div>
          <span class="node-status active">Active</span>
        </button>

        <button class="tool-node" data-node="1" data-color="green" role="listitem" aria-label="Video Generator">
          <div class="node-accent-bar"></div>
          <div class="node-core">
            <svg viewBox="0 0 32 32" fill="none"><rect x="3" y="7" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M23 12l6-3v10l-6-3V12z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num">02</span>
            <span class="node-name">Video Generator</span>
          </div>
          <span class="node-status">Build</span>
        </button>

        <button class="tool-node" data-node="2" data-color="blue" role="listitem" aria-label="Distribution Engine">
          <div class="node-accent-bar"></div>
          <div class="node-core">
            <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="24" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="27" cy="24" r="3" stroke="currentColor" stroke-width="1.5"/><line x1="16" y1="8" x2="5" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="8" x2="27" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="8" x2="16" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num">03</span>
            <span class="node-name">Distribution Engine</span>
          </div>
          <span class="node-status">Build</span>
        </button>

        <button class="tool-node" data-node="3" data-color="orange" role="listitem" aria-label="Motion Engine">
          <div class="node-accent-bar"></div>
          <div class="node-core">
            <svg viewBox="0 0 32 32" fill="none"><path d="M2 20 C8 12, 14 24, 20 14 S28 6, 30 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="30" cy="10" r="2" fill="currentColor"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num">04</span>
            <span class="node-name">Motion Engine</span>
          </div>
          <span class="node-status">Build</span>
        </button>

        <button class="tool-node" data-node="4" data-color="red" role="listitem" aria-label="Persona Engine">
          <div class="node-accent-bar"></div>
          <div class="node-core">
            <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="10" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M4 28c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
          <div class="node-label">
            <span class="node-num">05</span>
            <span class="node-name">Persona Engine</span>
          </div>
          <span class="node-status">Build</span>
        </button>

      </div>
    </div>
  </section>

  <!-- ═══ SCENE 2 — ARCHITECTURE / FEATURE EXPLODE ═════════════════ -->
  <section class="scene" id="scene-features" data-scene="2">
    <div class="scene-ui" id="ui-features">
      <div class="section-eyebrow"><span class="eyebrow-pip"></span>ARCHITECTURE</div>
      <h2 class="section-title">Built Different.<br><em>By Design.</em></h2>
      <div class="feature-fragments" id="feature-grid">

        <div class="frag" data-frag="0" tabindex="0" role="button" aria-label="Real-Time Analysis">
          <div class="frag-icon-wrap" style="--fc:#A78BFA">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 10V3L4 14h7v7l9-11h-7z" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="frag-content">
            <div class="frag-title">Real-Time Analysis</div>
            <div class="frag-label">AI processes content at inference speed</div>
          </div>
          <div class="frag-glow"></div>
        </div>

        <div class="frag" data-frag="1" tabindex="0" role="button" aria-label="Drop-Off Detection">
          <div class="frag-icon-wrap" style="--fc:#34D399">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
          </div>
          <div class="frag-content">
            <div class="frag-title">Drop-Off Detection</div>
            <div class="frag-label">Pinpoints engagement loss moments</div>
          </div>
          <div class="frag-glow"></div>
        </div>

        <div class="frag" data-frag="2" tabindex="0" role="button" aria-label="Script Rewrite Engine">
          <div class="frag-icon-wrap" style="--fc:#60A5FA">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </div>
          <div class="frag-content">
            <div class="frag-title">Script Rewrite Engine</div>
            <div class="frag-label">GPT-powered content optimization</div>
          </div>
          <div class="frag-glow"></div>
        </div>

        <div class="frag" data-frag="3" tabindex="0" role="button" aria-label="Performance Scoring">
          <div class="frag-icon-wrap" style="--fc:#FB923C">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          </div>
          <div class="frag-content">
            <div class="frag-title">Performance Scoring</div>
            <div class="frag-label">Quantified content quality metrics</div>
          </div>
          <div class="frag-glow"></div>
        </div>

        <div class="frag" data-frag="4" tabindex="0" role="button" aria-label="Multi-Platform Distribution">
          <div class="frag-icon-wrap" style="--fc:#F472B6">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
          </div>
          <div class="frag-content">
            <div class="frag-title">Multi-Platform Distribution</div>
            <div class="frag-label">Optimal timing across all channels</div>
          </div>
          <div class="frag-glow"></div>
        </div>

        <div class="frag" data-frag="5" tabindex="0" role="button" aria-label="Cinematic Motion AI">
          <div class="frag-icon-wrap" style="--fc:#A8D8F0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          </div>
          <div class="frag-content">
            <div class="frag-title">Cinematic Motion AI</div>
            <div class="frag-label">AI-composed video motion systems</div>
          </div>
          <div class="frag-glow"></div>
        </div>

      </div>
    </div>
  </section>

  <!-- ═══ SCENE 3 — METRICS ════════════════════════════════════════ -->
  <section class="scene" id="scene-about" data-scene="3">
    <div class="scene-ui" id="ui-about">
      <div class="section-eyebrow"><span class="eyebrow-pip"></span>INTELLIGENCE</div>
      <h2 class="section-title">AI at the Speed<br><em>of Thought.</em></h2>
      <p class="section-body">A closed-loop AI creative system — content is analyzed, generated, optimized, and distributed at machine speed. No bottlenecks. No guesswork.</p>
      <div class="metric-row">
        <div class="metric">
          <div class="metric-val" data-count="5">0</div>
          <div class="metric-label">AI Engines</div>
        </div>
        <div class="metric">
          <div class="metric-val" data-count="100">0</div>
          <div class="metric-label">% Automated</div>
        </div>
        <div class="metric">
          <div class="metric-val">∞</div>
          <div class="metric-label">Scale</div>
        </div>
        <div class="metric">
          <div class="metric-val" data-count="1">0</div>
          <div class="metric-label">Unified Platform</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ═══ SCENE 4 — PORTAL CTA ══════════════════════════════════════ -->
  <section class="scene" id="scene-cta" data-scene="4">
    <div class="scene-ui" id="ui-cta">
      <div class="section-eyebrow"><span class="eyebrow-pip"></span>BEGIN</div>
      <h2 class="cta-title">The system<br><em>is ready.</em></h2>
      <p class="cta-body">Launch the AI Attention Engine — your first portal into the Spectra suite.</p>
      <div class="cta-actions">
        <a href="/tools/attention-engine/" class="btn-primary btn-glow">
          <span>Launch Attention Engine</span>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <a href="mailto:team@panomarketing.com" class="btn-ghost">Get in Touch</a>
      </div>
      <div class="cta-brand">
        <div class="cta-brand-mark">S</div>
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
