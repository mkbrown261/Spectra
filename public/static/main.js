/**
 * SPECTRA — Interactive Cinematic Engine v4
 * Pano Marketing Solutions
 *
 * Architecture: ONE unified 3D world, scroll-driven scenes,
 * full bidirectional UI ↔ 3D interactivity.
 *
 * Scene map:
 *   0  HERO       Particle logo formation, atmospheric entry
 *   1  SYSTEM     Clickable color-coded node graph ↔ UI tool list
 *   2  EXPLODE    Icosahedron — hover/rotate, auto-explode/reassemble
 *   3  METRICS    Floating data orbs, animated count-up
 *   4  PORTAL     Convergence CTA, DNA collapse
 */

(function () {
  'use strict';

  /* ═══ DEPENDENCY GATE ═══════════════════════════════════════════ */
  let _deps = 0;
  function onDep() { if (++_deps >= 2) boot(); }
  function waitDeps() {
    const ti = setInterval(() => {
      if (typeof THREE !== 'undefined') { clearInterval(ti); onDep(); }
    }, 20);
    const tg = setInterval(() => {
      if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
        clearInterval(tg);
        gsap.registerPlugin(ScrollTrigger);
        onDep();
      }
    }, 20);
  }

  /* ═══ TOOL DEFINITIONS ══════════════════════════════════════════ */
  const TOOLS = [
    {
      id: 0, name: 'Attention Engine',
      short: 'Analyzes video content for engagement drop-offs and attention patterns',
      color: '#A78BFA', hex: 0xA78BFA, url: '/tools/attention-engine/',
      nodePos: new THREE.Vector3(0, 2.1, 0.2),
    },
    {
      id: 1, name: 'Video Generator',
      short: 'AI-powered video creation and composition from raw scripts',
      color: '#34D399', hex: 0x34D399, url: '/tools/video-generator/',
      nodePos: new THREE.Vector3(-2.3, 0.5, 0.4),
    },
    {
      id: 2, name: 'Distribution Engine',
      short: 'Optimal timing and multi-platform content delivery',
      color: '#60A5FA', hex: 0x60A5FA, url: '/tools/distribution-engine/',
      nodePos: new THREE.Vector3(-1.5, -1.8, -0.3),
    },
    {
      id: 3, name: 'Motion Engine',
      short: 'Cinematic AI motion composition and editing system',
      color: '#FB923C', hex: 0xFB923C, url: '/tools/motion-engine/',
      nodePos: new THREE.Vector3(1.5, -1.8, 0.3),
    },
    {
      id: 4, name: 'Persona Engine',
      short: 'Adaptive brand voice and audience intelligence modeling',
      color: '#F87171', hex: 0xF87171, url: '/tools/persona-engine/',
      nodePos: new THREE.Vector3(2.3, 0.5, -0.4),
    },
  ];

  /* ═══ PALETTE ═══════════════════════════════════════════════════ */
  const PAL = {
    BG:     0x060810,
    GLOW:   new THREE.Color(0xA8D8F0),
    ACCENT: new THREE.Color(0x7BB8D4),
    ICE:    new THREE.Color(0xE8F4FD),
    CREAM:  new THREE.Color(0xF5F0E8),
    DEEP:   new THREE.Color(0x1A3A5C),
  };

  const N_MAIN = 8000;
  const N_AMB  = 2400;

  /* ═══ WORLD STATE ════════════════════════════════════════════════ */
  let scene, camera, renderer, clock, raycaster;
  let mouse = { x: 0, y: 0 }, mouseNDC = new THREE.Vector2();
  let mouseEased = { x: 0, y: 0 };
  let activeScene = -1;
  let selectedTool = -1;
  let hoveredNode  = -1;
  let hoveredFrag  = -1;

  // particles
  let mainParticles, ambParticles;
  let morphFrom, morphTarget, morphTween = null;

  // scene groups
  let nodeGroup, nodeObjects = [], nodeLines = [];
  let icoGroup, icoPieces = [], icoCore, icoWire;
  let dashGroup;
  let portalGroup;

  // morph shape cache
  let pos_logo, pos_sphere, pos_torus, pos_wave, pos_dna, pos_scatter;

  // camera spring
  const camTarget = new THREE.Vector3(0, 0, 6.5);
  const camLook   = new THREE.Vector3(0, 0, 0);
  let camLocked   = false;

  /* ═══ CAMERA WAYPOINTS ══════════════════════════════════════════ */
  const CAM = [
    { pos: new THREE.Vector3(0,    0,    6.5), look: new THREE.Vector3(0,   0,    0),  fov: 58 },
    { pos: new THREE.Vector3(-1.4, 0.3,  5.8), look: new THREE.Vector3(0.2, 0,    0),  fov: 60 },
    { pos: new THREE.Vector3(1.2, -0.2,  5.2), look: new THREE.Vector3(-0.1,0.1,  0),  fov: 62 },
    { pos: new THREE.Vector3(0,    0.8,  6.2), look: new THREE.Vector3(0,  -0.2,  0),  fov: 56 },
    { pos: new THREE.Vector3(0,    0,    4.8), look: new THREE.Vector3(0,   0,    0),  fov: 54 },
  ];

  /* ═══ BOOT ═══════════════════════════════════════════════════════ */
  function boot() {
    initRenderer();
    buildMorphShapes();
    buildMainParticles();
    buildAmbParticles();
    buildNodeSystem();
    buildIcoSystem();
    buildDashSystem();
    buildPortalSystem();
    bindEvents();
    runLoader();
    RAF();
  }

  /* ─── RENDERER ───────────────────────────────────────────────── */
  function initRenderer() {
    const canvas = document.getElementById('world-canvas');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(PAL.BG);
    scene.fog = new THREE.FogExp2(0x060810, 0.024);

    camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 200);
    camera.position.copy(CAM[0].pos);

    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;

    raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.12;
    clock = new THREE.Clock();

    // Lighting rig
    const pl1 = new THREE.PointLight(0xA8D8F0, 2.4, 24); pl1.position.set(3, 5, 4);
    const pl2 = new THREE.PointLight(0x3A6A9A, 1.5, 18); pl2.position.set(-5, -3, 2);
    const pl3 = new THREE.PointLight(0xF5F0E8, 0.6, 12); pl3.position.set(0, 0, 8);
    scene.add(pl1, pl2, pl3);
    scene.add(new THREE.AmbientLight(0x1a2a3a, 1.9));
  }

  /* ─── SHARED PARTICLE MATERIAL ──────────────────────────────── */
  function makeParticleMat(boost = 1.0, opacity = 1.0) {
    return new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: opacity }, uTime: { value: 0 } },
      vertexShader: `
        attribute float pSize;
        attribute vec3  pCol;
        varying   vec3  vCol;
        varying   float vAlpha;
        void main(){
          vCol = pCol;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = max(pSize * ${(boost*420).toFixed(1)} / (-mv.z), 0.5);
          vAlpha = clamp(1.0 + mv.z * 0.06, 0.15, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3  vCol;
        varying float vAlpha;
        uniform float uOpacity;
        void main(){
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if(d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d);
          float g = smoothstep(0.5, 0.0, d * 0.52);
          gl_FragColor = vec4(mix(vCol*0.45, vCol*1.5, g), a * vAlpha * uOpacity * 0.92);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  /* ═══ MORPH SHAPES ══════════════════════════════════════════════ */
  function buildMorphShapes() {
    pos_logo    = buildLogoPos(N_MAIN);
    pos_sphere  = buildFibSphere(N_MAIN, 2.1);
    pos_torus   = buildTorusKnot(N_MAIN);
    pos_wave    = buildWaveGrid(N_MAIN);
    pos_dna     = buildDNA(N_MAIN);
    pos_scatter = buildScatter(N_MAIN, 14);
  }

  const GLYPHS = {
    S:[[0,1,1,0],[1,0,0,0],[0,1,1,0],[0,0,0,1],[1,1,1,0]],
    P:[[1,1,1,0],[1,0,0,1],[1,1,1,0],[1,0,0,0],[1,0,0,0]],
    E:[[1,1,1,1],[1,0,0,0],[1,1,1,0],[1,0,0,0],[1,1,1,1]],
    C:[[0,1,1,1],[1,0,0,0],[1,0,0,0],[1,0,0,0],[0,1,1,1]],
    T:[[1,1,1,1],[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
    R:[[1,1,1,0],[1,0,0,1],[1,1,1,0],[1,0,1,0],[1,0,0,1]],
    A:[[0,1,1,0],[1,0,0,1],[1,1,1,1],[1,0,0,1],[1,0,0,1]],
  };

  function buildLogoPos(N) {
    const word = ['S','P','E','C','T','R','A'];
    const step = 0.82, startX = -(word.length - 1) * step * 0.5;
    const ppt = Math.floor(N / word.length);
    const pts = [];
    word.forEach((ch, wi) => {
      const grid = GLYPHS[ch], ox = startX + wi * step;
      const cells = [];
      grid.forEach((row, r) => row.forEach((on, c) => { if (on) cells.push([c, 4 - r]); }));
      const pp = Math.ceil(ppt / cells.length);
      cells.forEach(([cx, ry]) => {
        for (let k = 0; k < pp; k++) pts.push(
          ox + (cx / 3) * 0.52 + (Math.random() - 0.5) * 0.055,
          (ry / 4) * 0.65 - 0.32 + (Math.random() - 0.5) * 0.055,
          (Math.random() - 0.5) * 0.14
        );
      });
    });
    while (pts.length < N * 3) pts.push(
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.5) * 0.2
    );
    return new Float32Array(pts.slice(0, N * 3));
  }

  function buildFibSphere(N, r) {
    const pts = [], phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, rad = Math.sqrt(1 - y * y);
      const th = phi * i, s = r * (0.95 + Math.random() * 0.10);
      pts.push(Math.cos(th) * rad * s, y * s, Math.sin(th) * rad * s);
    }
    return new Float32Array(pts);
  }

  function buildTorusKnot(N) {
    const geo = new THREE.TorusKnotGeometry(1.6, 0.46, 400, 28, 2, 3);
    const v = geo.attributes.position.array, vc = v.length / 3, pts = [];
    for (let i = 0; i < N; i++) {
      const idx = Math.floor(Math.random() * vc) * 3;
      pts.push(
        v[idx]   + (Math.random() - 0.5) * 0.06,
        v[idx+1] + (Math.random() - 0.5) * 0.06,
        v[idx+2] + (Math.random() - 0.5) * 0.06
      );
    }
    geo.dispose();
    return new Float32Array(pts);
  }

  function buildWaveGrid(N) {
    const pts = [], s = Math.ceil(Math.sqrt(N));
    for (let i = 0; i < N; i++) {
      const col = i % s, row = Math.floor(i / s);
      const x = (col / s - 0.5) * 5.8, z = (row / s - 0.5) * 3.6;
      const y = Math.sin(x * 1.4 + 0.3) * 0.55
              + Math.sin(x * 3.1 - 0.8) * 0.28
              + Math.cos(z * 1.1 + x * 0.4) * 0.22
              + (Math.random() - 0.5) * 0.07;
      pts.push(x, y, z);
    }
    return new Float32Array(pts);
  }

  function buildDNA(N) {
    const pts = [], half = Math.floor(N * 0.47);
    for (let i = 0; i < half; i++) {
      const t = (i / half) * Math.PI * 8, y = (i / half - 0.5) * 4.8;
      pts.push(Math.cos(t) * 1.25 + (Math.random() - 0.5) * 0.05, y, Math.sin(t) * 1.25 + (Math.random() - 0.5) * 0.05);
    }
    for (let i = 0; i < N - half; i++) {
      const t = (i / (N - half)) * Math.PI * 8 + Math.PI, y = (i / (N - half) - 0.5) * 4.8;
      pts.push(Math.cos(t) * 1.25 + (Math.random() - 0.5) * 0.05, y, Math.sin(t) * 1.25 + (Math.random() - 0.5) * 0.05);
    }
    while (pts.length < N * 3) pts.push((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 4.5, 0);
    return new Float32Array(pts.slice(0, N * 3));
  }

  function buildScatter(N, spread) {
    const pts = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pts[i] = (Math.random() - 0.5) * spread;
    return pts;
  }

  /* ═══ MAIN PARTICLES ════════════════════════════════════════════ */
  function buildMainParticles() {
    const sizes  = new Float32Array(N_MAIN);
    const colors = new Float32Array(N_MAIN * 3);
    for (let i = 0; i < N_MAIN; i++) {
      sizes[i] = 0.018 + Math.random() * 0.016;
      const t = Math.random();
      let c;
      if      (t < 0.40) c = PAL.GLOW.clone().lerp(PAL.ACCENT, t * 2.5);
      else if (t < 0.72) c = PAL.ACCENT.clone().lerp(PAL.ICE, (t - 0.40) * 3.1);
      else               c = PAL.ICE.clone().lerp(PAL.CREAM, (t - 0.72) * 3.6);
      colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos_scatter.slice(), 3));
    geo.setAttribute('pSize',    new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('pCol',     new THREE.BufferAttribute(colors, 3));
    mainParticles = new THREE.Points(geo, makeParticleMat(1.0, 1.0));
    mainParticles.frustumCulled = false;
    scene.add(mainParticles);
    morphFrom   = pos_scatter.slice();
    morphTarget = pos_logo;
  }

  function buildAmbParticles() {
    const N = N_AMB;
    const pos = new Float32Array(N * 3);
    const sz  = new Float32Array(N);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i*3]   = (Math.random() - 0.5) * 34;
      pos[i*3+1] = (Math.random() - 0.5) * 24;
      pos[i*3+2] = (Math.random() - 0.5) * 26 - 5;
      sz[i] = 0.004 + Math.random() * 0.009;
      const c = PAL.ACCENT.clone().lerp(PAL.DEEP, Math.random() * 0.80);
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('pSize',    new THREE.BufferAttribute(sz, 1));
    geo.setAttribute('pCol',     new THREE.BufferAttribute(col, 3));
    ambParticles = new THREE.Points(geo, makeParticleMat(0.5, 0.50));
    ambParticles.frustumCulled = false;
    scene.add(ambParticles);
  }

  /* ═══ SCENE 1 — INTERACTIVE NODE GRAPH ═════════════════════════ */
  function buildNodeSystem() {
    nodeGroup = new THREE.Group();
    nodeGroup.visible = false;
    scene.add(nodeGroup);

    // Hub
    const hubGeo = new THREE.SphereGeometry(0.26, 28, 28);
    const hubMat = new THREE.MeshStandardMaterial({
      color: 0xE8F4FD, emissive: 0xA8D8F0, emissiveIntensity: 1.6,
      transparent: true, opacity: 0.96, roughness: 0.08, metalness: 0.45,
    });
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.position.set(0, 0, 0.5);
    hub.userData = { isHub: true };
    nodeGroup.add(hub);

    // hub halo (flat ring)
    const haloGeo = new THREE.RingGeometry(0.40, 0.56, 48);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xA8D8F0, transparent: true, opacity: 0.14,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const hubHalo = new THREE.Mesh(haloGeo, haloMat);
    hubHalo.position.copy(hub.position);
    hubHalo.userData = { isHubHalo: true };
    nodeGroup.add(hubHalo);

    // second outer halo (bigger, fainter)
    const halo2 = new THREE.Mesh(
      new THREE.RingGeometry(0.60, 0.72, 48),
      new THREE.MeshBasicMaterial({
        color: 0xA8D8F0, transparent: true, opacity: 0.06,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      })
    );
    halo2.position.copy(hub.position);
    halo2.userData = { isHubHalo2: true };
    nodeGroup.add(halo2);

    // Tool nodes + lines
    nodeObjects = [];
    nodeLines   = [];

    TOOLS.forEach((tool, i) => {
      // energy line hub → node
      const linePts = [hub.position.clone(), tool.nodePos.clone()];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
      const lineMat = new THREE.LineBasicMaterial({
        color: tool.hex, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.userData = { isLine: true, toolId: i };
      nodeGroup.add(line);
      nodeLines.push(line);

      // node sphere
      const sg = new THREE.SphereGeometry(0.17, 22, 22);
      const sm = new THREE.MeshStandardMaterial({
        color: tool.hex, emissive: tool.hex, emissiveIntensity: 0.85,
        transparent: true, opacity: 0.96,
        roughness: 0.12, metalness: 0.35,
      });
      const mesh = new THREE.Mesh(sg, sm);
      mesh.position.copy(tool.nodePos);
      mesh.scale.setScalar(0);
      mesh.userData = { isNode: true, toolId: i };
      nodeGroup.add(mesh);
      nodeObjects.push(mesh);

      // outer glow ring
      const rg  = new THREE.RingGeometry(0.24, 0.36, 40);
      const rm  = new THREE.MeshBasicMaterial({
        color: tool.hex, transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(rg, rm);
      ring.position.copy(tool.nodePos);
      ring.userData = { isNodeRing: true, toolId: i };
      nodeGroup.add(ring);
    });
  }

  /* ═══ SCENE 2 — CONTAINED ICO SYSTEM ═══════════════════════════ */
  function buildIcoSystem() {
    icoGroup = new THREE.Group();
    icoGroup.visible = false;
    scene.add(icoGroup);

    const icoGeo = new THREE.IcosahedronGeometry(1.38, 1);

    icoCore = new THREE.Mesh(icoGeo, new THREE.MeshStandardMaterial({
      color: 0x7BB8D4, emissive: 0x3A6A8A, emissiveIntensity: 0.75,
      transparent: true, opacity: 0.10, roughness: 0.28, metalness: 0.65,
    }));
    icoCore.userData = { isCore: true };
    icoGroup.add(icoCore);

    icoWire = new THREE.Mesh(icoGeo.clone(), new THREE.MeshBasicMaterial({
      color: 0xA8D8F0, wireframe: true, transparent: true, opacity: 0.38,
      blending: THREE.AdditiveBlending,
    }));
    icoWire.userData = { isWire: true };
    icoGroup.add(icoWire);

    const featureData = [
      { col: 0xA78BFA, axis: new THREE.Vector3(1,   1,  0).normalize() },
      { col: 0x34D399, axis: new THREE.Vector3(-1,  1,  0).normalize() },
      { col: 0x60A5FA, axis: new THREE.Vector3(0,   1,  1).normalize() },
      { col: 0xFB923C, axis: new THREE.Vector3(0,  -1,  1).normalize() },
      { col: 0xF87171, axis: new THREE.Vector3(1,  -1,  0).normalize() },
      { col: 0xA8D8F0, axis: new THREE.Vector3(-1, -1,  0).normalize() },
    ];

    icoPieces = [];
    featureData.forEach(({ col, axis }, i) => {
      const pg = new THREE.IcosahedronGeometry(0.21, 0);
      const pm = new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 1.05,
        transparent: true, opacity: 0.92,
        roughness: 0.18, metalness: 0.42,
      });
      const p = new THREE.Mesh(pg, pm);
      p.position.copy(axis.clone().multiplyScalar(0.1));
      p.scale.setScalar(0);
      p.userData = {
        axis,
        maxDist: 2.05 + Math.random() * 0.38,
        rotSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 2.2,
          (Math.random() - 0.5) * 2.2,
          (Math.random() - 0.5) * 2.2
        ),
      };
      icoPieces.push(p);
      icoGroup.add(p);
    });

    // boundary ring
    const bRing = new THREE.TorusGeometry(2.65, 0.005, 6, 80);
    icoGroup.add(new THREE.Mesh(bRing, new THREE.MeshBasicMaterial({
      color: 0x7BB8D4, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending,
    })));
  }

  /* ═══ SCENE 3 — DATA ORB SYSTEM ════════════════════════════════ */
  function buildDashSystem() {
    dashGroup = new THREE.Group();
    dashGroup.visible = false;
    scene.add(dashGroup);

    const orbData = [
      { r: 0.55, pos: new THREE.Vector3(-2.2,  0.9,  0.2), spd: 0.38 },
      { r: 0.40, pos: new THREE.Vector3(-0.7, -0.6,  0.5), spd: 0.55 },
      { r: 0.65, pos: new THREE.Vector3( 1.0,  0.9, -0.4), spd: 0.30 },
      { r: 0.42, pos: new THREE.Vector3( 2.4, -0.4,  0.1), spd: 0.48 },
    ];

    orbData.forEach(({ r, pos, spd }) => {
      const og  = new THREE.SphereGeometry(r, 18, 18);
      const orb = new THREE.Mesh(og, new THREE.MeshStandardMaterial({
        color: 0x7BB8D4, emissive: 0x3A6A8A, emissiveIntensity: 0.55,
        transparent: true, opacity: 0.13, wireframe: true,
      }));
      orb.position.copy(pos); orb.scale.setScalar(0);
      orb.userData = { basePos: pos.clone(), spd };
      dashGroup.add(orb);

      const cg   = new THREE.SphereGeometry(r * 0.28, 12, 12);
      const core = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({
        color: 0xA8D8F0, emissive: 0xA8D8F0, emissiveIntensity: 2.4,
        transparent: true, opacity: 0.88,
      }));
      core.position.copy(pos); core.scale.setScalar(0);
      core.userData = { basePos: pos.clone(), spd, isCore: true };
      dashGroup.add(core);

      const rg   = new THREE.TorusGeometry(r * 1.42, 0.007, 6, 64);
      const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
        color: 0x7BB8D4, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending,
      }));
      ring.position.copy(pos); ring.scale.setScalar(0);
      ring.rotation.x = Math.random() * Math.PI;
      ring.rotation.z = Math.random() * Math.PI;
      ring.userData = { basePos: pos.clone(), spd, isRing: true, rotAx: Math.random() > 0.5 ? 'y' : 'z' };
      dashGroup.add(ring);
    });
  }

  /* ═══ SCENE 4 — PORTAL ══════════════════════════════════════════ */
  function buildPortalSystem() {
    portalGroup = new THREE.Group();
    portalGroup.visible = false;
    scene.add(portalGroup);

    for (let i = 0; i < 7; i++) {
      const r   = 0.82 + i * 0.40;
      const geo = new THREE.TorusGeometry(r, 0.012, 8, 96);
      const mat = new THREE.MeshBasicMaterial({
        color: i < 3 ? 0xA8D8F0 : 0x7BB8D4,
        transparent: true,
        opacity: Math.max(0.05, 0.44 - i * 0.055),
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.6;
      ring.rotation.y = (Math.random() - 0.5) * 0.4;
      ring.scale.setScalar(0);
      ring.userData = { rotSpeed: (i % 2 === 0 ? 1 : -1) * (0.12 + i * 0.06), baseOpacity: mat.opacity };
      portalGroup.add(ring);
    }

    const disk = new THREE.Mesh(
      new THREE.CircleGeometry(0.92, 72),
      new THREE.MeshBasicMaterial({
        color: 0xA8D8F0, transparent: true, opacity: 0.05,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      })
    );
    disk.scale.setScalar(0);
    disk.userData = { isDisk: true };
    portalGroup.add(disk);
  }

  /* ═══ MORPH ENGINE ══════════════════════════════════════════════ */
  function morphTo(target, dur = 2200) {
    if (morphTween) { morphTween.kill(); morphTween = null; }
    const posAttr = mainParticles.geometry.attributes.position;
    morphFrom   = posAttr.array.slice();
    morphTarget = target;
    const proxy = { t: 0 };
    morphTween = gsap.to(proxy, {
      t: 1, duration: dur / 1000, ease: 'power3.inOut',
      onUpdate() {
        const e = proxy.t;
        for (let i = 0; i < posAttr.array.length; i++)
          posAttr.array[i] = morphFrom[i] + (morphTarget[i] - morphFrom[i]) * e;
        posAttr.needsUpdate = true;
      },
    });
  }

  /* ═══ CAMERA ════════════════════════════════════════════════════ */
  function moveCameraTo(idx, dur = 2.4, lock = false) {
    const wp = CAM[idx];
    if (lock) camLocked = true;
    gsap.to(camera.position, {
      x: wp.pos.x, y: wp.pos.y, z: wp.pos.z,
      duration: dur, ease: 'power3.inOut',
      onComplete: () => { if (lock) camLocked = false; },
    });
    gsap.to(camLook, { x: wp.look.x, y: wp.look.y, z: wp.look.z, duration: dur, ease: 'power3.inOut' });
    gsap.to(camera, {
      fov: wp.fov, duration: dur, ease: 'power2.inOut',
      onUpdate: () => camera.updateProjectionMatrix(),
    });
  }

  function zoomToNode(toolId) {
    const pos = TOOLS[toolId].nodePos;
    gsap.to(camera.position, {
      x: pos.x * 0.52 - 1.0,
      y: pos.y * 0.34,
      z: CAM[1].pos.z - 0.82,
      duration: 1.2, ease: 'power3.inOut',
    });
    gsap.to(camLook, { x: pos.x * 0.28, y: pos.y * 0.18, z: 0, duration: 1.2, ease: 'power3.inOut' });
  }

  /* ═══ SCENE ACTIVATIONS ═════════════════════════════════════════ */
  function activateScene(idx) {
    if (idx === activeScene) return;
    const prev = activeScene;
    activeScene = idx;

    if (prev === 4) onLeaveScene4();

    document.getElementById('nav')?.classList.toggle('scrolled', idx > 0);

    // update scene dot nav
    document.querySelectorAll('.sn-dot').forEach(d => {
      d.classList.toggle('active', parseInt(d.dataset.scene) === idx);
    });

    // update nav-link active state
    const navMap = ['scene-hero','scene-tools','scene-features','scene-about','scene-cta'];
    const linkMap = [null, 'System', 'Architecture', 'Intelligence', 'Launch'];
    document.querySelectorAll('.nav-link').forEach(a => {
      const href = a.getAttribute('href');
      a.classList.toggle('active', href === '#' + navMap[idx]);
    });

    moveCameraTo(idx);
    if (idx !== 1) hideHUD();

    switch (idx) {
      case 0: enterScene0(); break;
      case 1: enterScene1(); break;
      case 2: enterScene2(); break;
      case 3: enterScene3(); break;
      case 4: enterScene4(); break;
    }
  }

  /* ─── Scene 0: HERO ──────────────────────────────────────────── */
  function enterScene0() {
    nodeGroup.visible = false; icoGroup.visible = false;
    dashGroup.visible = false; portalGroup.visible = false;
    mainParticles.visible = true;
    setFog(0x060810, 0.022);
    morphTo(pos_logo, 2800);

    gsap.fromTo('.hero-pre',  { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out', delay: 0.3 });
    gsap.fromTo('.ht-line',   { opacity: 0, y: 65 }, { opacity: 1, y: 0, duration: 1.3, stagger: 0.22, ease: 'power3.out', delay: 0.5 });
    gsap.fromTo('.hero-sub',  { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out', delay: 1.0 });
    gsap.fromTo('.hero-ctas', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.85, ease: 'power2.out', delay: 1.3 });
  }

  /* ─── Scene 1: INTERACTIVE SYSTEM MAP ───────────────────────── */
  function enterScene1() {
    nodeGroup.visible = true; icoGroup.visible = false;
    dashGroup.visible = false; portalGroup.visible = false;
    mainParticles.visible = true;
    setFog(0x060d1c, 0.020);
    morphTo(pos_sphere, 2200);

    // animate nodes in with stagger
    nodeObjects.forEach((mesh, i) => {
      gsap.to(mesh.scale, { x: 1, y: 1, z: 1, duration: 0.9, delay: 0.2 + i * 0.1, ease: 'back.out(1.7)' });
    });

    // energy lines fade in
    nodeGroup.children.forEach(c => {
      if (c.userData.isLine)
        gsap.fromTo(c.material, { opacity: 0 }, { opacity: 0.22, duration: 1.1, delay: 0.5, ease: 'power2.out' });
    });

    // UI
    gsap.fromTo('#ui-tools .section-eyebrow, #ui-tools .section-title',
      { opacity: 0, y: 32 }, { opacity: 1, y: 0, stagger: 0.12, duration: 0.85, ease: 'power2.out', delay: 0.1 });
    gsap.fromTo('.tool-node',
      { opacity: 0, x: 55 }, { opacity: 1, x: 0, stagger: 0.1, duration: 0.65, ease: 'power3.out', delay: 0.25 });

    if (selectedTool >= 0) highlightTool(selectedTool, false);
  }

  /* ─── Scene 2: CONTAINED ICO ─────────────────────────────────── */
  let _explodeTimer = null;
  let icoExploded = false;
  let _icoHovered = false;

  function enterScene2() {
    icoGroup.visible = true; nodeGroup.visible = false;
    dashGroup.visible = false; portalGroup.visible = false;
    mainParticles.visible = true;
    setFog(0x080916, 0.018);
    morphTo(pos_torus, 2000);
    icoExploded = false;

    gsap.to(icoCore.scale, { x: 1, y: 1, z: 1, duration: 1.1, ease: 'back.out(1.4)', delay: 0.2 });
    gsap.to(icoWire.scale, { x: 1, y: 1, z: 1, duration: 1.1, ease: 'back.out(1.4)', delay: 0.2 });

    icoPieces.forEach((p, i) => {
      p.position.copy(p.userData.axis.clone().multiplyScalar(0.1));
      gsap.to(p.scale, { x: 1, y: 1, z: 1, duration: 0.65, delay: 0.3 + i * 0.06, ease: 'back.out(1.3)' });
    });

    gsap.fromTo('.frag',
      { opacity: 0, scale: 0.76, y: 18 },
      { opacity: 1, scale: 1, y: 0, stagger: 0.09, duration: 0.65, ease: 'back.out(1.4)', delay: 0.3 }
    );
    gsap.fromTo('#ui-features .section-eyebrow, #ui-features .section-title',
      { opacity: 0, y: 32 }, { opacity: 1, y: 0, stagger: 0.12, duration: 0.8, ease: 'power2.out', delay: 0.1 });

    scheduleExplode();
  }

  function scheduleExplode() {
    if (_explodeTimer) clearTimeout(_explodeTimer);
    _explodeTimer = setTimeout(() => {
      if (activeScene === 2 && !_icoHovered) explodeIco();
    }, 2800);
  }

  function explodeIco() {
    icoExploded = true;
    icoPieces.forEach((p, i) => {
      const target = p.userData.axis.clone().multiplyScalar(p.userData.maxDist);
      gsap.to(p.position, { x: target.x, y: target.y, z: target.z, duration: 1.35, delay: i * 0.07, ease: 'power4.out' });
      gsap.to(p.material,  { emissiveIntensity: 3.0, duration: 0.5, delay: i * 0.07 });
    });
    gsap.to(icoCore.material, { opacity: 0.03, duration: 0.9, delay: 0.2 });
    gsap.to(icoWire.material, { opacity: 0.06, duration: 0.9, delay: 0.2 });
    _explodeTimer = setTimeout(() => { if (activeScene === 2) reassembleIco(); }, 3200);
  }

  function reassembleIco() {
    icoExploded = false;
    icoPieces.forEach((p, i) => {
      const home = p.userData.axis.clone().multiplyScalar(0.1);
      gsap.to(p.position, { x: home.x, y: home.y, z: home.z, duration: 1.5, delay: i * 0.05, ease: 'power3.inOut' });
      gsap.to(p.material,  { emissiveIntensity: 1.05, duration: 0.4, delay: i * 0.05 });
    });
    gsap.to(icoCore.material, { opacity: 0.10, duration: 0.9, delay: 0.3 });
    gsap.to(icoWire.material, { opacity: 0.38, duration: 0.9, delay: 0.3 });
    _explodeTimer = setTimeout(() => { if (activeScene === 2 && !_icoHovered) explodeIco(); }, 2800);
  }

  /* ─── Scene 3: METRICS ───────────────────────────────────────── */
  function enterScene3() {
    dashGroup.visible = true; nodeGroup.visible = false;
    icoGroup.visible = false; portalGroup.visible = false;
    mainParticles.visible = true;
    setFog(0x050a14, 0.016);
    morphTo(pos_wave, 2400);

    dashGroup.children.forEach((c, i) => {
      gsap.to(c.scale, { x: 1, y: 1, z: 1, duration: 1.05, delay: i * 0.06, ease: 'back.out(1.4)' });
    });

    document.querySelectorAll('.metric-val[data-count]').forEach(el => {
      const target = parseInt(el.dataset.count);
      gsap.fromTo({ val: 0 }, { val: target }, {
        duration: 2.4, ease: 'power2.out', delay: 0.6,
        onUpdate: function () { el.textContent = Math.round(this.targets()[0].val); },
      });
    });

    gsap.fromTo('.metric',
      { opacity: 0, y: 46 }, { opacity: 1, y: 0, stagger: 0.14, duration: 0.8, ease: 'power2.out', delay: 0.4 });
    gsap.fromTo('#ui-about .section-eyebrow, #ui-about .section-title, #ui-about .section-body',
      { opacity: 0, y: 32 }, { opacity: 1, y: 0, stagger: 0.10, duration: 0.8, ease: 'power2.out', delay: 0.15 });
  }

  /* ─── Scene 4: PORTAL ────────────────────────────────────────── */
  function enterScene4() {
    portalGroup.visible = true; dashGroup.visible = false;
    nodeGroup.visible = false; icoGroup.visible = false;
    mainParticles.visible = true;
    setFog(0x04060a, 0.014);
    morphTo(pos_dna, 2800);

    portalGroup.children.forEach((c, i) => {
      gsap.to(c.scale, { x: 1, y: 1, z: 1, duration: 1.3, delay: i * 0.10, ease: 'back.out(1.2)' });
    });
    // particles converge
    gsap.to(mainParticles.scale, { z: 0.52, duration: 3.2, ease: 'power2.inOut' });

    gsap.fromTo('.cta-title',    { opacity: 0, y: 52 }, { opacity: 1, y: 0, duration: 1.1, ease: 'power3.out', delay: 0.4 });
    gsap.fromTo('.cta-body',     { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out', delay: 0.75 });
    gsap.fromTo('.cta-actions',  { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.85, ease: 'power2.out', delay: 1.0 });
    gsap.fromTo('.cta-brand',    { opacity: 0 },        { opacity: 1,        duration: 0.8,  ease: 'power2.out', delay: 1.35 });
  }

  function onLeaveScene4() {
    gsap.to(mainParticles.scale, { z: 1.0, duration: 1.5, ease: 'power2.out' });
  }

  function setFog(hex, density) {
    if (!scene.fog) return;
    gsap.to(scene.fog.color, {
      r: ((hex >> 16) & 255) / 255,
      g: ((hex >> 8)  & 255) / 255,
      b: ((hex)       & 255) / 255,
      duration: 2.4, ease: 'power2.inOut',
    });
    gsap.to(scene.fog, { density, duration: 2.4, ease: 'power2.inOut' });
  }

  /* ═══ TOOL INTERACTION ═══════════════════════════════════════════ */
  function selectTool(toolId) {
    if (selectedTool === toolId) {
      selectedTool = -1;
      resetAllNodes();
      hideHUD();
      moveCameraTo(1, 1.4);
      return;
    }
    selectedTool = toolId;
    highlightTool(toolId, true);
    showHUD(toolId);

    document.querySelectorAll('.tool-node').forEach(el => {
      const n = parseInt(el.dataset.node);
      el.classList.toggle('selected', n === toolId);
      el.classList.toggle('dimmed',   n !== toolId);
    });
  }

  function highlightTool(toolId, withCamera = false) {
    const tool = TOOLS[toolId];

    nodeObjects.forEach((mesh, i) => {
      if (i === toolId) {
        gsap.to(mesh.material, { emissiveIntensity: 3.2, opacity: 1.0, duration: 0.5 });
        gsap.to(mesh.scale,    { x: 1.55, y: 1.55, z: 1.55, duration: 0.5, ease: 'back.out(1.5)' });
      } else {
        gsap.to(mesh.material, { emissiveIntensity: 0.28, opacity: 0.38, duration: 0.5 });
        gsap.to(mesh.scale,    { x: 0.68, y: 0.68, z: 0.68, duration: 0.4, ease: 'power2.inOut' });
      }
    });

    nodeGroup.children.forEach(c => {
      if (c.userData.isLine)
        gsap.to(c.material, { opacity: c.userData.toolId === toolId ? 0.75 : 0.05, duration: 0.5 });
    });

    const hub = nodeGroup.children.find(c => c.userData.isHub);
    if (hub) {
      const col = new THREE.Color(tool.hex);
      gsap.to(hub.material.color,    { r: col.r, g: col.g, b: col.b, duration: 0.6 });
      gsap.to(hub.material.emissive, { r: col.r, g: col.g, b: col.b, duration: 0.6 });
      gsap.to(hub.material,          { emissiveIntensity: 2.8, duration: 0.5 });
    }

    const fog = scene.fog;
    if (fog) {
      const fc = new THREE.Color(tool.hex);
      gsap.to(fog.color, { r: fc.r * 0.06, g: fc.g * 0.06, b: fc.b * 0.06 + 0.04, duration: 1.1 });
    }

    if (withCamera) zoomToNode(toolId);
  }

  function resetAllNodes() {
    nodeObjects.forEach(mesh => {
      gsap.to(mesh.material, { emissiveIntensity: 0.85, opacity: 0.96, duration: 0.5 });
      gsap.to(mesh.scale,    { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(1.3)' });
    });
    nodeGroup.children.forEach(c => {
      if (c.userData.isLine) gsap.to(c.material, { opacity: 0.22, duration: 0.5 });
    });
    const hub = nodeGroup.children.find(c => c.userData.isHub);
    if (hub) {
      gsap.to(hub.material.color,    { r: PAL.ICE.r, g: PAL.ICE.g, b: PAL.ICE.b, duration: 0.6 });
      gsap.to(hub.material.emissive, { r: PAL.GLOW.r, g: PAL.GLOW.g, b: PAL.GLOW.b, duration: 0.6 });
      gsap.to(hub.material,          { emissiveIntensity: 1.6, duration: 0.5 });
    }
    setFog(0x060d1c, 0.020);
    document.querySelectorAll('.tool-node').forEach(el => el.classList.remove('selected', 'dimmed'));
  }

  /* ═══ HUD ════════════════════════════════════════════════════════ */
  function showHUD(toolId) {
    const tool = TOOLS[toolId];
    const hud  = document.getElementById('tool-hud');
    if (!hud) return;
    hud.querySelector('.hud-name').textContent = tool.name;
    hud.querySelector('.hud-desc').textContent = tool.short;
    const link = hud.querySelector('.hud-link');
    link.href = tool.url;
    link.style.borderColor  = tool.color;
    link.style.color        = tool.color;
    hud.querySelector('.hud-color-dot').style.background = tool.color;
    hud.querySelector('.hud-color-dot').style.boxShadow  = `0 0 10px ${tool.color}`;
    hud.style.setProperty('--hud-color', tool.color);
    hud.classList.add('visible');
  }

  function hideHUD() {
    document.getElementById('tool-hud')?.classList.remove('visible');
  }

  /* ═══ TOOLTIP ════════════════════════════════════════════════════ */
  function showTooltip(toolId, screenX, screenY) {
    const tt = document.getElementById('node-tooltip');
    if (!tt) return;
    tt.textContent = TOOLS[toolId].name;
    tt.style.left  = (screenX + 18) + 'px';
    tt.style.top   = (screenY - 12) + 'px';
    tt.style.setProperty('--tc', TOOLS[toolId].color);
    tt.style.borderColor = TOOLS[toolId].color;
    tt.classList.add('visible');
  }

  function hideTooltip() {
    document.getElementById('node-tooltip')?.classList.remove('visible');
  }

  /* ═══ RAYCASTING ════════════════════════════════════════════════ */
  function checkNodeHover(e) {
    if (activeScene !== 1) return;
    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObjects(nodeObjects);

    if (hits.length > 0) {
      const mesh = hits[0].object;
      const tId  = mesh.userData.toolId;
      if (tId !== hoveredNode) {
        hoveredNode = tId;
        document.body.classList.add('cur-hover');
        showTooltip(tId, e.clientX, e.clientY);
        if (tId !== selectedTool) {
          gsap.to(mesh.material, { emissiveIntensity: 2.2, duration: 0.22 });
          gsap.to(mesh.scale,    { x: 1.35, y: 1.35, z: 1.35, duration: 0.22, ease: 'back.out(1.5)' });
        }
      }
    } else {
      if (hoveredNode >= 0) {
        const prev = nodeObjects[hoveredNode];
        if (hoveredNode !== selectedTool) {
          const ei = selectedTool >= 0 ? 0.28 : 0.85;
          const sc = selectedTool >= 0 ? 0.68 : 1.0;
          gsap.to(prev.material, { emissiveIntensity: ei, duration: 0.22 });
          gsap.to(prev.scale,    { x: sc, y: sc, z: sc, duration: 0.22 });
        }
        hoveredNode = -1;
        document.body.classList.remove('cur-hover');
        hideTooltip();
      }
    }
  }

  function checkIcoHover() {
    if (activeScene !== 2) return;
    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObjects([icoCore, icoWire, ...icoPieces]);
    if (hits.length > 0) {
      if (!_icoHovered) {
        _icoHovered = true;
        document.body.classList.add('cur-hover');
        // pause auto-explode while hovered
        if (_explodeTimer) { clearTimeout(_explodeTimer); _explodeTimer = null; }
        // brighten wire on hover
        gsap.to(icoWire.material, { opacity: 0.65, duration: 0.3 });
      }
    } else {
      if (_icoHovered) {
        _icoHovered = false;
        document.body.classList.remove('cur-hover');
        gsap.to(icoWire.material, { opacity: icoExploded ? 0.06 : 0.38, duration: 0.3 });
        // restart explode cycle
        scheduleExplode();
      }
    }
  }

  function handleNodeClick(e) {
    if (activeScene !== 1) return;
    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObjects(nodeObjects);
    if (hits.length > 0) {
      const tId = hits[0].object.userData.toolId;
      selectTool(tId);
    }
  }

  function handleIcoClick() {
    if (activeScene !== 2) return;
    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObjects([icoCore, icoWire, ...icoPieces]);
    if (hits.length > 0) {
      if (icoExploded) reassembleIco();
      else              explodeIco();
    }
  }

  /* ═══ GSAP SCROLL TIMELINE ══════════════════════════════════════ */
  function buildScrollTimeline() {
    const SCENES = ['scene-hero','scene-tools','scene-features','scene-about','scene-cta'];
    SCENES.forEach((id, idx) => {
      const el = document.getElementById(id);
      if (!el) return;
      ScrollTrigger.create({
        trigger:   el,
        start:     'top 62%',
        end:       'bottom 38%',
        onEnter:      () => activateScene(idx),
        onEnterBack:  () => activateScene(idx),
        onLeave:      () => { if (idx === 4) onLeaveScene4(); },
        onLeaveBack:  () => { if (idx === 4) onLeaveScene4(); },
      });
    });

    // scroll progress bar
    ScrollTrigger.create({
      trigger: '#scroll-container', start: 'top top', end: 'bottom bottom', scrub: true,
      onUpdate(self) {
        const fill = document.querySelector('.nav-progress-fill');
        if (fill) fill.style.width = (self.progress * 100) + '%';
      },
    });
  }

  /* ═══ RENDER LOOP ════════════════════════════════════════════════ */
  let _lastFrame = 0;
  const FRAME_MS = 1000 / 62;

  function RAF(now = 0) {
    requestAnimationFrame(RAF);
    if (now - _lastFrame < FRAME_MS) return;
    _lastFrame = now;
    const t = clock.getElapsedTime();

    // mouse easing
    mouseEased.x += (mouse.x * 0.20 - mouseEased.x) * 0.04;
    mouseEased.y += (mouse.y * 0.12 - mouseEased.y) * 0.04;

    // camera look-at with parallax
    if (!camLocked) {
      camera.lookAt(
        camLook.x + mouseEased.x * 0.10,
        camLook.y + mouseEased.y * 0.07,
        camLook.z
      );
    }

    // particle global drift
    if (mainParticles && activeScene !== 4) {
      mainParticles.rotation.y += (mouseEased.x * 0.22 - mainParticles.rotation.y) * 0.03;
      mainParticles.rotation.x += (mouseEased.y * 0.14 - mainParticles.rotation.x) * 0.03;
      mainParticles.rotation.z  = Math.sin(t * 0.07) * 0.025;
    }
    if (ambParticles) {
      ambParticles.rotation.y = t * 0.005;
      ambParticles.rotation.x = Math.sin(t * 0.035) * 0.018;
    }

    if (mainParticles?.material.uniforms) mainParticles.material.uniforms.uTime.value = t;

    if (nodeGroup?.visible)  tickNodes(t);
    if (icoGroup?.visible)   tickIco(t);
    if (dashGroup?.visible)  tickDash(t);
    if (portalGroup?.visible) tickPortal(t);

    renderer.render(scene, camera);
  }

  /* ─── TICK HELPERS ───────────────────────────────────────────── */
  function tickNodes(t) {
    const hub = nodeGroup.children.find(c => c.userData.isHub);
    if (hub && hub.scale.x > 0.05) {
      const pulse = 1 + Math.sin(t * 1.8) * 0.065;
      hub.scale.setScalar(pulse);
    }
    const hubHalo = nodeGroup.children.find(c => c.userData.isHubHalo);
    if (hubHalo) {
      hubHalo.rotation.z = t * 0.36;
      hubHalo.material.opacity = 0.10 + Math.sin(t * 1.6) * 0.055;
    }
    const hubHalo2 = nodeGroup.children.find(c => c.userData.isHubHalo2);
    if (hubHalo2) {
      hubHalo2.rotation.z = -t * 0.18;
      hubHalo2.material.opacity = 0.04 + Math.sin(t * 0.9) * 0.025;
    }

    nodeObjects.forEach((mesh, i) => {
      if (i === selectedTool) return;
      if (mesh.scale.x < 0.08) return;
      const bs    = selectedTool >= 0 ? 0.68 : 1.0;
      const pulse = 1 + Math.sin(t * 1.5 + i * 1.1) * 0.055;
      mesh.scale.setScalar(bs * pulse);
    });

    nodeGroup.children.forEach(c => {
      if (c.userData.isNodeRing) c.rotation.z = t * 0.42 + c.userData.toolId;
    });

    nodeGroup.children.forEach(c => {
      if (c.userData.isLine && c.userData.toolId !== selectedTool) {
        const base = selectedTool >= 0 ? 0.05 : 0.22;
        c.material.opacity = base + Math.sin(t * 1.2 + c.userData.toolId * 0.7) * 0.04;
      }
    });

    nodeGroup.rotation.y = mouseEased.x * 0.30 + t * 0.010;
    nodeGroup.rotation.x = mouseEased.y * 0.14;
  }

  function tickIco(t) {
    icoWire.rotation.y = t * 0.22;
    icoWire.rotation.x = t * 0.14;
    icoCore.rotation.y = -t * 0.16;
    icoCore.rotation.z = t * 0.09;

    if (icoExploded) {
      icoPieces.forEach(p => {
        const rs = p.userData.rotSpeed;
        p.rotation.x += rs.x * 0.014;
        p.rotation.y += rs.y * 0.014;
        p.rotation.z += rs.z * 0.014;
      });
    }

    // mouse parallax on ico group
    icoGroup.rotation.y = mouseEased.x * 0.24 + t * 0.008;
    icoGroup.rotation.x = mouseEased.y * 0.12;
  }

  function tickDash(t) {
    dashGroup.children.forEach(c => {
      if (!c.userData.basePos) return;
      const sp = c.userData.spd || 0.4, bp = c.userData.basePos;
      c.position.y = bp.y + Math.sin(t * sp + bp.x) * 0.20;
      if (c.userData.isRing) c.rotation[c.userData.rotAx] = t * sp * 0.8;
      else { c.rotation.y = t * sp * 0.5; c.rotation.x = t * sp * 0.3; }
    });
    dashGroup.rotation.y = mouseEased.x * 0.18;
    dashGroup.rotation.x = mouseEased.y * 0.10;
  }

  function tickPortal(t) {
    portalGroup.children.forEach(c => {
      if (c.userData.rotSpeed) {
        c.rotation.z += c.userData.rotSpeed * 0.012;
        if (c.userData.baseOpacity)
          c.material.opacity = c.userData.baseOpacity * (0.85 + Math.sin(t * 1.1 + c.userData.rotSpeed) * 0.18);
      }
    });
    portalGroup.rotation.y = mouseEased.x * 0.10 + Math.sin(t * 0.15) * 0.04;
    portalGroup.rotation.x = mouseEased.y * 0.07;
  }

  /* ═══ EVENTS ════════════════════════════════════════════════════ */
  function bindEvents() {

    /* mouse move ───────────────────────────────────────────────── */
    window.addEventListener('mousemove', e => {
      mouse.x = (e.clientX / innerWidth)  *  2 - 1;
      mouse.y = (e.clientY / innerHeight) * -2 + 1;
      mouseNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);

      const dot  = document.getElementById('cursor-dot');
      const ring = document.getElementById('cursor-ring');
      if (dot)  { dot.style.left  = e.clientX + 'px'; dot.style.top  = e.clientY + 'px'; }
      if (ring) { ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; }

      const tt = document.getElementById('node-tooltip');
      if (tt?.classList.contains('visible')) {
        tt.style.left = (e.clientX + 18) + 'px';
        tt.style.top  = (e.clientY - 12) + 'px';
      }

      checkNodeHover(e);
      checkIcoHover();
    }, { passive: true });

    /* click ────────────────────────────────────────────────────── */
    window.addEventListener('click', e => {
      // cursor click flash
      document.body.classList.add('cur-click');
      setTimeout(() => document.body.classList.remove('cur-click'), 150);

      handleNodeClick(e);
      handleIcoClick();
    });

    /* touch ────────────────────────────────────────────────────── */
    window.addEventListener('touchmove', e => {
      if (!e.touches[0]) return;
      const tx = e.touches[0].clientX, ty = e.touches[0].clientY;
      mouse.x  = (tx / innerWidth)  *  2 - 1;
      mouse.y  = (ty / innerHeight) * -2 + 1;
      mouseNDC.set((tx / innerWidth) * 2 - 1, -(ty / innerHeight) * 2 + 1);
    }, { passive: true });

    /* resize ───────────────────────────────────────────────────── */
    let _resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(() => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
      }, 80);
    }, { passive: true });

    /* tool list buttons ────────────────────────────────────────── */
    document.querySelectorAll('.tool-node').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const tId = parseInt(el.dataset.node);
        if (activeScene === 1) {
          selectTool(tId);
        } else {
          document.getElementById('scene-tools')?.scrollIntoView({ behavior: 'smooth' });
          setTimeout(() => selectTool(tId), 820);
        }
      });
      el.addEventListener('mouseenter', () => document.body.classList.add('cur-hover'));
      el.addEventListener('mouseleave', () => document.body.classList.remove('cur-hover'));
    });

    /* HUD close button ─────────────────────────────────────────── */
    document.getElementById('hud-close')?.addEventListener('click', () => {
      if (selectedTool >= 0) {
        selectedTool = -1;
        resetAllNodes();
        hideHUD();
        moveCameraTo(1, 1.4);
      }
    });

    /* frag cards — click to activate ───────────────────────────── */
    document.querySelectorAll('.frag').forEach((el, i) => {
      el.addEventListener('click', () => {
        const isActive = el.classList.contains('frag-active');
        document.querySelectorAll('.frag').forEach(f => f.classList.remove('frag-active'));
        if (!isActive) el.classList.add('frag-active');
      });
      el.addEventListener('mouseenter', () => {
        document.body.classList.add('cur-hover');
        hoveredFrag = i;
      });
      el.addEventListener('mouseleave', () => {
        document.body.classList.remove('cur-hover');
        hoveredFrag = -1;
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
      });
    });

    /* scene dot nav ────────────────────────────────────────────── */
    document.querySelectorAll('.sn-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        const idx  = parseInt(dot.dataset.scene);
        const ids  = ['scene-hero','scene-tools','scene-features','scene-about','scene-cta'];
        document.getElementById(ids[idx])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      dot.addEventListener('mouseenter', () => document.body.classList.add('cur-hover'));
      dot.addEventListener('mouseleave', () => document.body.classList.remove('cur-hover'));
    });

    /* metric cards ─────────────────────────────────────────────── */
    document.querySelectorAll('.metric').forEach(el => {
      el.addEventListener('mouseenter', () => document.body.classList.add('cur-hover'));
      el.addEventListener('mouseleave', () => document.body.classList.remove('cur-hover'));
    });

    /* general hover for interactive elements ───────────────────── */
    document.querySelectorAll('a, button, .btn-primary, .btn-ghost, .hud-link').forEach(el => {
      el.addEventListener('mouseenter', () => document.body.classList.add('cur-hover'));
      el.addEventListener('mouseleave', () => document.body.classList.remove('cur-hover'));
    });

    /* smooth anchor scroll ─────────────────────────────────────── */
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const target = document.querySelector(a.getAttribute('href'));
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ═══ LOADER ════════════════════════════════════════════════════ */
  function runLoader() {
    const loader = document.getElementById('loader');
    const bar    = document.querySelector('.loader-bar-fill');
    const status = document.querySelector('.loader-status');
    if (!loader) return;

    const stages = ['Initializing', 'Loading Engine', 'Building World', 'Syncing Systems', 'Ready'];
    let p = 0, si = 0;

    const iv = setInterval(() => {
      p = Math.min(p + 6 + Math.random() * 14, 100);
      if (bar) bar.style.width = p + '%';
      const s = Math.min(Math.floor(p / 25), stages.length - 1);
      if (s !== si) { si = s; if (status) status.textContent = stages[si]; }

      if (p >= 100) {
        clearInterval(iv);
        if (status) status.textContent = 'Ready';
        setTimeout(() => {
          loader.classList.add('out');
          setTimeout(() => { activateScene(0); buildScrollTimeline(); }, 700);
        }, 380);
      }
    }, 90);
  }

  /* ═══ ENTRY ═════════════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', waitDeps);

})();
