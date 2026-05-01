/**
 * SPECTRA — Three.js Particle Engine
 * Pano Marketing Solutions
 *
 * Particle morphing system inspired by brainit.es
 * Shapes: Torus Knot → Icosahedron → Sphere → Wave → DNA Helix
 * One shape per tool. Cycles automatically, changes on card hover.
 */

(function () {
  'use strict';

  // ─── WAIT FOR THREE.JS ──────────────────────────────────────────────
  function waitForThree(cb) {
    if (typeof THREE !== 'undefined') { cb(); }
    else { setTimeout(() => waitForThree(cb), 50); }
  }

  // ─── CONFIG ─────────────────────────────────────────────────────────
  const CONFIG = {
    PARTICLE_COUNT: 6000,
    PARTICLE_SIZE:  0.018,
    MORPH_DURATION: 2200,      // ms to morph between shapes
    CYCLE_INTERVAL: 5500,      // ms between auto-cycles
    COLORS: {
      base:    new THREE.Color(0x7BB8D4),  // --accent
      bright:  new THREE.Color(0xA8D8F0),  // --glow
      cream:   new THREE.Color(0xF5F0E8),  // --cream
      deep:    new THREE.Color(0x3A6A84),  // deep blue
    },
    BG:     0x0a0e14,
  };

  // ─── SHAPE DEFINITIONS ──────────────────────────────────────────────
  const SHAPES = [
    {
      name:  'Attention Engine',
      id:    'attention',
      build: buildTorusKnot,
      color: new THREE.Color(0xA8D8F0),
    },
    {
      name:  'Video Generator',
      id:    'video',
      build: buildIcosahedron,
      color: new THREE.Color(0xE8F4FD),
    },
    {
      name:  'Distribution Engine',
      id:    'distribution',
      build: buildSphere,
      color: new THREE.Color(0x7BB8D4),
    },
    {
      name:  'Motion Engine',
      id:    'motion',
      build: buildWaveform,
      color: new THREE.Color(0xF5F0E8),
    },
    {
      name:  'Persona Engine',
      id:    'persona',
      build: buildDNA,
      color: new THREE.Color(0xB8D8F0),
    },
  ];

  // ─── STATE ──────────────────────────────────────────────────────────
  let scene, camera, renderer, particles, positions, targetPositions;
  let currentShape  = 0;
  let morphProgress = 1;   // 0..1, 1 = complete
  let morphFrom     = null;
  let cycleTimer    = null;
  let mouse         = { x: 0, y: 0 };
  let targetRotX    = 0;
  let targetRotY    = 0;
  let canvas;

  // ─── INIT ────────────────────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('hero-canvas');
    if (!canvas) return;

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.BG);

    // Fog for depth
    scene.fog = new THREE.FogExp2(CONFIG.BG, 0.035);

    // Camera
    camera = new THREE.PerspectiveCamera(
      60,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 0, 5.5);

    // Renderer
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // Ambient light (for any future meshes)
    const ambientLight = new THREE.AmbientLight(0x7BB8D4, 0.5);
    scene.add(ambientLight);

    // Build particle system
    buildParticles();

    // Load first shape
    loadShape(0, true);

    // Events
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    // Card hover events — switch shape on hover
    hookCardHovers();

    // Auto-cycle
    startCycle();

    // Animate
    requestAnimationFrame(animate);

    // Loader
    runLoader();
  }

  // ─── PARTICLES ──────────────────────────────────────────────────────
  function buildParticles() {
    const n = CONFIG.PARTICLE_COUNT;
    positions       = new Float32Array(n * 3);
    targetPositions = new Float32Array(n * 3);

    // Start at origin
    for (let i = 0; i < n * 3; i++) positions[i] = (Math.random() - 0.5) * 0.1;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));

    // Per-particle color
    const colors = new Float32Array(n * 3);
    const colorBase   = CONFIG.COLORS.base;
    const colorBright = CONFIG.COLORS.bright;
    const colorCream  = CONFIG.COLORS.cream;
    for (let i = 0; i < n; i++) {
      const t = Math.random();
      let c;
      if (t < 0.5)      c = colorBase.clone().lerp(colorBright, t * 2);
      else if (t < 0.85) c = colorBright.clone().lerp(colorCream, (t - 0.5) * 2.85);
      else               c = colorCream;
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('pColor', new THREE.BufferAttribute(colors, 3));

    // Per-particle size variation
    const sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      sizes[i] = CONFIG.PARTICLE_SIZE * (0.4 + Math.random() * 1.2);
    }
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float size;
        attribute vec3 pColor;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uTime;
        void main() {
          vColor = pColor;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (400.0 / -mvPos.z);
          vAlpha = clamp(1.0 - (-mvPos.z - 3.0) * 0.15, 0.3, 1.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          float alpha = smoothstep(0.5, 0.1, d) * vAlpha;
          float glow = smoothstep(0.5, 0.0, d);
          vec3 col = mix(vColor * 0.6, vColor, glow);
          gl_FragColor = vec4(col, alpha * 0.85);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
      },
    });

    particles = new THREE.Points(geo, mat);
    scene.add(particles);
  }

  // ─── SHAPE BUILDERS ─────────────────────────────────────────────────
  // Returns Float32Array of length PARTICLE_COUNT * 3

  function buildTorusKnot() {
    const pts = [];
    const n = CONFIG.PARTICLE_COUNT;
    const geom = new THREE.TorusKnotGeometry(1.4, 0.42, 300, 30, 2, 3);
    const verts = geom.attributes.position.array;
    const vertCount = verts.length / 3;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * vertCount);
      const jitter = 0.055;
      pts.push(
        verts[idx * 3]     + (Math.random() - 0.5) * jitter,
        verts[idx * 3 + 1] + (Math.random() - 0.5) * jitter,
        verts[idx * 3 + 2] + (Math.random() - 0.5) * jitter
      );
    }
    return new Float32Array(pts);
  }

  function buildIcosahedron() {
    const pts = [];
    const n = CONFIG.PARTICLE_COUNT;
    const geom = new THREE.IcosahedronGeometry(1.8, 4);
    const verts = geom.attributes.position.array;
    const vertCount = verts.length / 3;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * vertCount);
      const jitter = 0.04;
      pts.push(
        verts[idx * 3]     + (Math.random() - 0.5) * jitter,
        verts[idx * 3 + 1] + (Math.random() - 0.5) * jitter,
        verts[idx * 3 + 2] + (Math.random() - 0.5) * jitter
      );
    }
    return new Float32Array(pts);
  }

  function buildSphere() {
    const pts = [];
    const n = CONFIG.PARTICLE_COUNT;
    // Fibonacci sphere for even distribution
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y      = 1 - (i / (n - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta  = goldenAngle * i;
      const scale  = 1.8 + (Math.random() - 0.5) * 0.15;
      pts.push(
        Math.cos(theta) * radius * scale,
        y * scale,
        Math.sin(theta) * radius * scale
      );
    }
    return new Float32Array(pts);
  }

  function buildWaveform() {
    const pts = [];
    const n = CONFIG.PARTICLE_COUNT;
    const cols = Math.ceil(Math.sqrt(n * 2));
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = (col / cols - 0.5) * 5.5;
      const z = (row / rows - 0.5) * 3.5;
      const wave1 = Math.sin(x * 1.8 + 0.5) * 0.55;
      const wave2 = Math.sin(x * 3.2 - 0.8) * 0.28;
      const wave3 = Math.cos(x * 0.9 + z * 0.4) * 0.22;
      const y = wave1 + wave2 + wave3 + (Math.random() - 0.5) * 0.08;
      pts.push(x, y, z);
    }
    return new Float32Array(pts);
  }

  function buildDNA() {
    const pts = [];
    const n = CONFIG.PARTICLE_COUNT;
    const half = Math.floor(n / 2);

    for (let i = 0; i < half; i++) {
      const t     = (i / half) * Math.PI * 6;
      const y     = (i / half - 0.5) * 4.5;
      const r     = 1.1;
      const jitter = 0.05;
      // Strand A
      pts.push(
        Math.cos(t) * r + (Math.random() - 0.5) * jitter,
        y + (Math.random() - 0.5) * jitter,
        Math.sin(t) * r + (Math.random() - 0.5) * jitter
      );
    }

    for (let i = 0; i < n - half; i++) {
      const t     = (i / (n - half)) * Math.PI * 6 + Math.PI;
      const y     = (i / (n - half) - 0.5) * 4.5;
      const r     = 1.1;
      const jitter = 0.05;
      // Strand B
      pts.push(
        Math.cos(t) * r + (Math.random() - 0.5) * jitter,
        y + (Math.random() - 0.5) * jitter,
        Math.sin(t) * r + (Math.random() - 0.5) * jitter
      );
    }

    // Add rungs (connecting dots) sparsely
    const rungs = 28;
    for (let i = 0; i < rungs; i++) {
      const t = (i / rungs) * Math.PI * 6;
      const y = (i / rungs - 0.5) * 4.5;
      const steps = 6;
      for (let s = 0; s < steps; s++) {
        const frac = s / (steps - 1);
        const x1 = Math.cos(t) * 1.1;
        const z1 = Math.sin(t) * 1.1;
        const x2 = Math.cos(t + Math.PI) * 1.1;
        const z2 = Math.sin(t + Math.PI) * 1.1;
        // These will just overwrite some positions; good enough
        pts.push(
          x1 + (x2 - x1) * frac,
          y,
          z1 + (z2 - z1) * frac
        );
      }
    }

    // Trim or pad to exact count
    while (pts.length < n * 3) pts.push((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 0.5);
    return new Float32Array(pts.slice(0, n * 3));
  }

  // ─── LOAD SHAPE ─────────────────────────────────────────────────────
  function loadShape(index, immediate = false) {
    currentShape = ((index % SHAPES.length) + SHAPES.length) % SHAPES.length;
    const shape  = SHAPES[currentShape];

    // Snapshot current positions as morph source
    if (!immediate) {
      morphFrom = particles.geometry.attributes.position.array.slice();
    }

    targetPositions = shape.build();

    if (immediate) {
      const pos = particles.geometry.attributes.position;
      for (let i = 0; i < pos.array.length; i++) {
        pos.array[i] = targetPositions[i];
      }
      pos.needsUpdate = true;
      morphProgress = 1;
    } else {
      morphProgress = 0;
    }

    // Update shape label
    const label = document.getElementById('shape-name');
    if (label) {
      label.style.opacity = 0;
      setTimeout(() => {
        label.textContent = shape.name;
        label.style.transition = 'opacity 0.5s';
        label.style.opacity = 1;
      }, 300);
    }
  }

  // ─── EASING ─────────────────────────────────────────────────────────
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ─── ANIMATE ────────────────────────────────────────────────────────
  let lastTime  = 0;
  const FRAME_CAP = 1000 / 60;

  function animate(now) {
    requestAnimationFrame(animate);
    if (now - lastTime < FRAME_CAP) return;
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    const t = now * 0.001;

    // Particle morph
    if (morphProgress < 1 && morphFrom) {
      morphProgress = Math.min(morphProgress + delta / (CONFIG.MORPH_DURATION / 1000), 1);
      const easedT = easeInOutCubic(morphProgress);
      const pos    = particles.geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i++) {
        pos[i] = morphFrom[i] + (targetPositions[i] - morphFrom[i]) * easedT;
      }
      particles.geometry.attributes.position.needsUpdate = true;
    }

    // Mouse parallax — gentle rotation
    targetRotY += (mouse.x * 0.35 - targetRotY) * 0.04;
    targetRotX += (mouse.y * 0.2  - targetRotX) * 0.04;

    particles.rotation.y = targetRotY + t * 0.04;
    particles.rotation.x = targetRotX;
    particles.rotation.z = Math.sin(t * 0.12) * 0.04;

    // Update time uniform
    if (particles.material.uniforms) {
      particles.material.uniforms.uTime.value = t;
    }

    renderer.render(scene, camera);
  }

  // ─── CYCLE ──────────────────────────────────────────────────────────
  function startCycle() {
    clearInterval(cycleTimer);
    cycleTimer = setInterval(() => {
      loadShape(currentShape + 1);
    }, CONFIG.CYCLE_INTERVAL);
  }

  function resetCycle() {
    startCycle();
  }

  // ─── CARD HOVERS ────────────────────────────────────────────────────
  function hookCardHovers() {
    document.querySelectorAll('.tool-card[data-tool]').forEach((card) => {
      card.addEventListener('mouseenter', () => {
        const toolId = card.dataset.tool;
        const idx    = SHAPES.findIndex((s) => s.id === toolId);
        if (idx !== -1 && idx !== currentShape) {
          loadShape(idx);
          resetCycle();
        }

        // Glow follow cursor within card
        const glow = card.querySelector('.card-glow');
        if (glow) {
          card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            glow.style.transform = `translate(${x - 100}px, ${y - 100}px)`;
          }, { passive: true });
        }
      });
    });
  }

  // ─── EVENTS ─────────────────────────────────────────────────────────
  function onMouseMove(e) {
    mouse.x = (e.clientX / window.innerWidth)  * 2 - 1;
    mouse.y = (e.clientY / window.innerHeight) * 2 - 1;

    // Custom cursor
    const dot  = document.getElementById('cursor-dot');
    const ring = document.getElementById('cursor-ring');
    if (dot)  { dot.style.left  = e.clientX + 'px'; dot.style.top  = e.clientY + 'px'; }
    if (ring) { ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; }
  }

  function onTouchMove(e) {
    if (!e.touches[0]) return;
    mouse.x = (e.touches[0].clientX / window.innerWidth)  * 2 - 1;
    mouse.y = (e.touches[0].clientY / window.innerHeight) * 2 - 1;
  }

  function onResize() {
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  // ─── NAV SCROLL ─────────────────────────────────────────────────────
  function initNav() {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 40);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ─── CURSOR HOVER STATE ──────────────────────────────────────────────
  function initCursorHover() {
    const interactables = document.querySelectorAll('a, button, .tool-card, .card-cta, .btn-primary, .btn-ghost, .nav-cta');
    interactables.forEach((el) => {
      el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
      el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
    });
  }

  // ─── SCROLL REVEAL ──────────────────────────────────────────────────
  function initScrollReveal() {
    const revealEls = document.querySelectorAll(
      '.section-header, .tool-card, .about-text, .about-stats, .stat-card, .contact-inner'
    );

    revealEls.forEach((el, i) => {
      el.classList.add('reveal');
      if (i % 5 > 0) el.classList.add(`reveal-delay-${i % 5}`);
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    revealEls.forEach((el) => io.observe(el));
  }

  // ─── LOADER ─────────────────────────────────────────────────────────
  function runLoader() {
    const loader = document.getElementById('loader');
    const bar    = document.querySelector('.loader-bar');
    if (!loader || !bar) return;

    let progress = 0;
    const tick = setInterval(() => {
      progress = Math.min(progress + Math.random() * 18, 100);
      bar.style.width = progress + '%';
      if (progress >= 100) {
        clearInterval(tick);
        setTimeout(() => {
          loader.classList.add('hidden');
        }, 400);
      }
    }, 120);
  }

  // ─── SMOOTH ANCHOR SCROLL ────────────────────────────────────────────
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener('click', (e) => {
        const target = document.querySelector(anchor.getAttribute('href'));
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ─── BOOT ────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initCursorHover();
    initScrollReveal();
    initSmoothScroll();
    waitForThree(init);
  });

})();
