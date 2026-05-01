/**
 * SPECTRA — Full Cinematic Scroll Engine v2
 * Pano Marketing Solutions
 *
 * Architecture:
 *   ┌─ One persistent WebGL world (fixed canvas, always rendering)
 *   ├─ GSAP ScrollTrigger → global progress 0→1 drives everything
 *   ├─ Scene 0  HERO       Particles scatter → form SPECTRA logo → camera pushes through
 *   ├─ Scene 1  NEURAL     Floating node network, energy pulses, scroll expands graph
 *   ├─ Scene 2  EXPLODED   Icosahedron assembles → explodes into feature pieces
 *   ├─ Scene 3  DASHBOARD  Floating data orbs, animated metrics, space visualization
 *   └─ Scene 4  PORTAL     Dark convergence, glowing portal, particles collapse inward
 *
 *   Performance rules:
 *   - Single draw call per particle system (BufferGeometry + ShaderMaterial)
 *   - Objects hidden when off-screen via .visible flag
 *   - 62fps cap via RAF timestamp gate
 *   - No per-frame heap allocations in hot path
 */

(function () {
  'use strict';

  /* ═══ dependency gate ═══════════════════════════════════════════ */
  let _depsReady = 0;
  function onDep() { if (++_depsReady >= 2) boot(); }

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

  /* ═══ palette / constants ═══════════════════════════════════════ */
  const PAL = {
    BG:     0x060810,
    GLOW:   new THREE.Color(0xA8D8F0),
    ACCENT: new THREE.Color(0x7BB8D4),
    CREAM:  new THREE.Color(0xF5F0E8),
    ICE:    new THREE.Color(0xE8F4FD),
    DEEP:   new THREE.Color(0x1A3A5C),
    GREEN:  new THREE.Color(0x64DC96),
  };

  const N_MAIN   = 8000;  // hero/morph particle count
  const N_AMB    = 2500;  // ambient bg particles
  const N_DUST   = 1200;  // per-scene dust

  /* ═══ world globals ═════════════════════════════════════════════ */
  let scene, camera, renderer, clock;
  let mouse   = { x: 0, y: 0 };
  let mouseEased = { x: 0, y: 0 };

  // particle systems
  let mainParticles, ambParticles, dustParticles;
  let morphFrom, morphTarget, morphTween = null;

  // scene groups
  let nodeGroup, icoGroup, dashGroup, portalGroup;

  // icosahedron pieces for explode
  let icoPieces = [];

  // energy line mesh (scene 1)
  let energyLines;

  // scrolled progress 0→1
  let scrollProgress = 0;
  let activeScene    = -1;

  // camera spring
  const camTarget = new THREE.Vector3(0, 0, 6.5);
  const camLookAt = new THREE.Vector3(0, 0, 0);
  const camLookAtTarget = new THREE.Vector3(0, 0, 0);

  // pre-built morph targets
  let pos_logo, pos_sphere, pos_torus, pos_wave, pos_dna, pos_scatter;

  /* ═══ camera waypoints ══════════════════════════════════════════ */
  const CAM_WP = [
    // scene 0 — hero: straight on
    { pos: new THREE.Vector3(0,    0,    6.5),  look: new THREE.Vector3(0,   0,   0),    fov: 58 },
    // scene 1 — neural: slight left tilt
    { pos: new THREE.Vector3(-1.8, 0.4,  5.8),  look: new THREE.Vector3(0.3, 0,   0),    fov: 60 },
    // scene 2 — exploded: closer, angled
    { pos: new THREE.Vector3(1.6, -0.3,  5.0),  look: new THREE.Vector3(-0.2,0.1, 0),    fov: 62 },
    // scene 3 — dashboard: elevated
    { pos: new THREE.Vector3(0,    1.0,  6.2),  look: new THREE.Vector3(0,  -0.2, 0),    fov: 56 },
    // scene 4 — portal: centered, compressed
    { pos: new THREE.Vector3(0,    0,    4.8),  look: new THREE.Vector3(0,   0,   0),    fov: 54 },
  ];

  /* ═══════════════════════════════════════════════════════════════ */
  /*  BOOT                                                           */
  /* ═══════════════════════════════════════════════════════════════ */
  function boot() {
    initRenderer();
    buildMorphShapes();
    buildMainParticles();
    buildAmbParticles();
    buildDustParticles();
    buildNodeNetwork();
    buildIcoSystem();
    buildDashGroup();
    buildPortalSystem();
    bindEvents();
    runLoader();
    RAF();
  }

  /* ─── renderer ──────────────────────────────────────────────── */
  function initRenderer() {
    const canvas = document.getElementById('world-canvas');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(PAL.BG);
    scene.fog = new THREE.FogExp2(PAL.BG, 0.024);

    camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 200);
    camera.position.copy(CAM_WP[0].pos);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    clock = new THREE.Clock();

    // lighting rig
    const pl1 = new THREE.PointLight(0xA8D8F0, 2.2, 22);
    pl1.position.set(3, 5, 4);
    scene.add(pl1);

    const pl2 = new THREE.PointLight(0x3A6A9A, 1.4, 16);
    pl2.position.set(-5, -3, 2);
    scene.add(pl2);

    const pl3 = new THREE.PointLight(0xF5F0E8, 0.6, 10);
    pl3.position.set(0, 0, 8);
    scene.add(pl3);

    scene.add(new THREE.AmbientLight(0x1a2a3a, 1.8));
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  PARTICLE SHADER (shared)                                       */
  /* ═══════════════════════════════════════════════════════════════ */
  function makeParticleMat(sizeBoost = 1.0, opacity = 1.0) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: opacity },
        uTime:    { value: 0 },
      },
      vertexShader: `
        attribute float pSize;
        attribute vec3  pCol;
        varying   vec3  vCol;
        varying   float vAlpha;
        uniform   float uTime;
        void main(){
          vCol = pCol;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          float size = pSize * ${(sizeBoost * 420.0).toFixed(1)} / (-mv.z);
          gl_PointSize = max(size, 0.5);
          vAlpha = clamp(1.0 + mv.z * 0.06, 0.15, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3  vCol;
        varying float vAlpha;
        uniform float uOpacity;
        void main(){
          vec2  uv = gl_PointCoord - 0.5;
          float d  = length(uv);
          if(d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d);
          float g = smoothstep(0.5, 0.0, d * 0.6);
          vec3  c = mix(vCol * 0.5, vCol * 1.3, g);
          gl_FragColor = vec4(c, a * vAlpha * uOpacity * 0.92);
        }
      `,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  MORPH SHAPE BUILDERS                                           */
  /* ═══════════════════════════════════════════════════════════════ */
  function buildMorphShapes() {
    pos_logo    = buildLogoPositions(N_MAIN);
    pos_sphere  = buildFibSphere(N_MAIN, 2.1);
    pos_torus   = buildTorusKnot(N_MAIN);
    pos_wave    = buildWaveGrid(N_MAIN);
    pos_dna     = buildDNA(N_MAIN);
    pos_scatter = buildScatter(N_MAIN, 14);
  }

  /* ── SPECTRA logo in particle-bitmap space ─────────────────── */
  const GLYPHS = {
    S:[[0,1,1,0],[1,0,0,0],[0,1,1,0],[0,0,0,1],[1,1,1,0]],
    P:[[1,1,1,0],[1,0,0,1],[1,1,1,0],[1,0,0,0],[1,0,0,0]],
    E:[[1,1,1,1],[1,0,0,0],[1,1,1,0],[1,0,0,0],[1,1,1,1]],
    C:[[0,1,1,1],[1,0,0,0],[1,0,0,0],[1,0,0,0],[0,1,1,1]],
    T:[[1,1,1,1],[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
    R:[[1,1,1,0],[1,0,0,1],[1,1,1,0],[1,0,1,0],[1,0,0,1]],
    A:[[0,1,1,0],[1,0,0,1],[1,1,1,1],[1,0,0,1],[1,0,0,1]],
  };

  function buildLogoPositions(N) {
    const word = ['S','P','E','C','T','R','A'];
    const step = 0.82;
    const startX = -(word.length - 1) * step * 0.5;
    const ppt = Math.floor(N / word.length);
    const pts = [];

    word.forEach((ch, wi) => {
      const grid = GLYPHS[ch];
      const ox = startX + wi * step;
      const cells = [];
      grid.forEach((row, r) => row.forEach((on, c) => { if (on) cells.push([c, 4 - r]); }));
      const pp = Math.ceil(ppt / cells.length);
      cells.forEach(([cx, ry]) => {
        for (let k = 0; k < pp; k++) {
          pts.push(
            ox + (cx / 3) * 0.52 + (Math.random() - 0.5) * 0.055,
            (ry / 4) * 0.65 - 0.32 + (Math.random() - 0.5) * 0.055,
            (Math.random() - 0.5) * 0.14
          );
        }
      });
    });

    // pad to N
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
      const y = 1 - (i / (N - 1)) * 2;
      const rad = Math.sqrt(1 - y * y);
      const th  = phi * i;
      const s   = r * (0.96 + Math.random() * 0.08);
      pts.push(Math.cos(th) * rad * s, y * s, Math.sin(th) * rad * s);
    }
    return new Float32Array(pts);
  }

  function buildTorusKnot(N) {
    const geo = new THREE.TorusKnotGeometry(1.6, 0.46, 400, 28, 2, 3);
    const v = geo.attributes.position.array, vc = v.length / 3;
    const pts = [];
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
      const x = (col / s - 0.5) * 5.8;
      const z = (row / s - 0.5) * 3.6;
      const y = Math.sin(x * 1.4 + 0.3) * 0.55
              + Math.sin(x * 3.1 - 0.8) * 0.28
              + Math.cos(z * 1.1 + x * 0.4) * 0.22
              + (Math.random() - 0.5) * 0.07;
      pts.push(x, y, z);
    }
    return new Float32Array(pts);
  }

  function buildDNA(N) {
    const pts = [];
    const half = Math.floor(N * 0.47);
    for (let i = 0; i < half; i++) {
      const t = (i / half) * Math.PI * 8;
      const y = (i / half - 0.5) * 4.8;
      pts.push(
        Math.cos(t) * 1.25 + (Math.random() - 0.5) * 0.05,
        y,
        Math.sin(t) * 1.25 + (Math.random() - 0.5) * 0.05
      );
    }
    for (let i = 0; i < N - half; i++) {
      const t = (i / (N - half)) * Math.PI * 8 + Math.PI;
      const y = (i / (N - half) - 0.5) * 4.8;
      pts.push(
        Math.cos(t) * 1.25 + (Math.random() - 0.5) * 0.05,
        y,
        Math.sin(t) * 1.25 + (Math.random() - 0.5) * 0.05
      );
    }
    while (pts.length < N * 3) pts.push((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 4.5, 0);
    return new Float32Array(pts.slice(0, N * 3));
  }

  function buildScatter(N, spread) {
    const pts = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pts[i] = (Math.random() - 0.5) * spread;
    return pts;
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  MAIN PARTICLE SYSTEM                                           */
  /* ═══════════════════════════════════════════════════════════════ */
  function buildMainParticles() {
    const sizes  = new Float32Array(N_MAIN);
    const colors = new Float32Array(N_MAIN * 3);

    for (let i = 0; i < N_MAIN; i++) {
      sizes[i] = 0.018 + Math.random() * 0.016;
      const t = Math.random();
      let c;
      if      (t < 0.40) c = PAL.GLOW.clone().lerp(PAL.ACCENT, t * 2.5);
      else if (t < 0.72) c = PAL.ACCENT.clone().lerp(PAL.ICE,  (t - 0.40) * 3.1);
      else               c = PAL.ICE.clone().lerp(PAL.CREAM,   (t - 0.72) * 3.6);
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
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

  /* ═══════════════════════════════════════════════════════════════ */
  /*  AMBIENT + DUST PARTICLES                                       */
  /* ═══════════════════════════════════════════════════════════════ */
  function buildAmbParticles() {
    const pos = new Float32Array(N_AMB * 3);
    const sz  = new Float32Array(N_AMB);
    const col = new Float32Array(N_AMB * 3);
    for (let i = 0; i < N_AMB; i++) {
      pos[i*3]   = (Math.random() - 0.5) * 32;
      pos[i*3+1] = (Math.random() - 0.5) * 22;
      pos[i*3+2] = (Math.random() - 0.5) * 24 - 5;
      sz[i] = 0.005 + Math.random() * 0.009;
      const c = PAL.ACCENT.clone().lerp(PAL.DEEP, Math.random() * 0.75);
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('pSize',    new THREE.BufferAttribute(sz, 1));
    geo.setAttribute('pCol',     new THREE.BufferAttribute(col, 3));
    ambParticles = new THREE.Points(geo, makeParticleMat(0.5, 0.65));
    ambParticles.frustumCulled = false;
    scene.add(ambParticles);
  }

  function buildDustParticles() {
    const pos = new Float32Array(N_DUST * 3);
    const sz  = new Float32Array(N_DUST);
    const col = new Float32Array(N_DUST * 3);
    for (let i = 0; i < N_DUST; i++) {
      pos[i*3]   = (Math.random() - 0.5) * 18;
      pos[i*3+1] = (Math.random() - 0.5) * 12;
      pos[i*3+2] = (Math.random() - 0.5) * 6;
      sz[i] = 0.003 + Math.random() * 0.005;
      const c = PAL.GLOW.clone().lerp(PAL.ICE, Math.random());
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('pSize',    new THREE.BufferAttribute(sz, 1));
    geo.setAttribute('pCol',     new THREE.BufferAttribute(col, 3));
    dustParticles = new THREE.Points(geo, makeParticleMat(0.4, 0.4));
    dustParticles.frustumCulled = false;
    scene.add(dustParticles);
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  SCENE 1 — NEURAL NODE NETWORK                                 */
  /* ═══════════════════════════════════════════════════════════════ */
  function buildNodeNetwork() {
    nodeGroup = new THREE.Group();
    nodeGroup.visible = false;
    scene.add(nodeGroup);

    const nodePos = [
      new THREE.Vector3( 0,    2.2,   0),
      new THREE.Vector3(-2.4,  0.5,   0.4),
      new THREE.Vector3(-1.5, -1.8,  -0.2),
      new THREE.Vector3( 1.5, -1.8,   0.3),
      new THREE.Vector3( 2.4,  0.5,  -0.4),
      new THREE.Vector3( 0,    0,     0.6),  // center hub
    ];

    // outer orbit rings per node
    nodePos.forEach((pos, idx) => {
      const isCentral = idx === 5;
      const r = isCentral ? 0.28 : idx === 0 ? 0.20 : 0.13;

      // core sphere
      const sg  = new THREE.SphereGeometry(r, 20, 20);
      const sm  = new THREE.MeshStandardMaterial({
        color:           isCentral ? 0xE8F4FD : 0x7BB8D4,
        emissive:        isCentral ? 0xA8D8F0 : 0x3A6A8A,
        emissiveIntensity: isCentral ? 1.8 : 0.9,
        transparent: true,
        opacity: 0.95,
        roughness: 0.1,
        metalness: 0.3,
      });
      const mesh = new THREE.Mesh(sg, sm);
      mesh.position.copy(pos);
      mesh.scale.setScalar(0);
      mesh.userData = { baseScale: 1.0, idx, isCentral, basePos: pos.clone() };
      nodeGroup.add(mesh);

      // glow halo
      const rg = new THREE.RingGeometry(r * 1.7, r * 2.5, 36);
      const rm = new THREE.MeshBasicMaterial({
        color: isCentral ? 0xA8D8F0 : 0x7BB8D4,
        transparent: true,
        opacity: isCentral ? 0.18 : 0.10,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const halo = new THREE.Mesh(rg, rm);
      halo.position.copy(pos);
      halo.userData = { isHalo: true };
      nodeGroup.add(halo);
    });

    // energy lines (all pairs)
    const linePts = [];
    for (let i = 0; i < nodePos.length; i++) {
      for (let j = i + 1; j < nodePos.length; j++) {
        linePts.push(nodePos[i].x, nodePos[i].y, nodePos[i].z);
        linePts.push(nodePos[j].x, nodePos[j].y, nodePos[j].z);
      }
    }
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePts), 3));
    energyLines = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({
      color: 0x7BB8D4,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
    }));
    energyLines.userData = { baseOpacity: 0.18 };
    nodeGroup.add(energyLines);
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  SCENE 2 — ICOSAHEDRON EXPLODE                                 */
  /* ═══════════════════════════════════════════════════════════════ */
  function buildIcoSystem() {
    icoGroup = new THREE.Group();
    icoGroup.visible = false;
    scene.add(icoGroup);

    // central icosahedron (wireframe)
    const ig = new THREE.IcosahedronGeometry(1.4, 1);

    // solid inner
    const solidMat = new THREE.MeshStandardMaterial({
      color: 0x7BB8D4,
      emissive: 0x3A6A8A,
      emissiveIntensity: 0.7,
      transparent: true,
      opacity: 0.12,
      wireframe: false,
      roughness: 0.3,
      metalness: 0.6,
    });
    const solid = new THREE.Mesh(ig, solidMat);
    solid.userData = { isCore: true };
    icoGroup.add(solid);

    // wireframe overlay
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xA8D8F0,
      wireframe: true,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
    });
    const wire = new THREE.Mesh(ig.clone(), wireMat);
    wire.userData = { isWire: true };
    icoGroup.add(wire);

    // 6 explodable feature pieces (small icosahedra that fly out)
    const featureColors = [0xA8D8F0, 0x64DC96, 0xF5F0E8, 0x7BB8D4, 0xE8F4FD, 0x3A9AD9];
    const featureAxes = [
      new THREE.Vector3( 1,  1,  0).normalize(),
      new THREE.Vector3(-1,  1,  0).normalize(),
      new THREE.Vector3( 0,  1,  1).normalize(),
      new THREE.Vector3( 0, -1,  1).normalize(),
      new THREE.Vector3( 1, -1,  0).normalize(),
      new THREE.Vector3(-1, -1,  0).normalize(),
    ];

    icoPieces = [];
    featureColors.forEach((col, i) => {
      const pg   = new THREE.IcosahedronGeometry(0.22, 0);
      const pm   = new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 1.0,
        transparent: true,
        opacity: 0.9,
        roughness: 0.2,
        metalness: 0.4,
      });
      const piece = new THREE.Mesh(pg, pm);
      piece.position.copy(featureAxes[i].clone().multiplyScalar(0.1));
      piece.scale.setScalar(0);
      piece.userData = {
        axis: featureAxes[i],
        explodeDist: 2.6 + Math.random() * 0.8,
        homePos: piece.position.clone(),
        rotSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2
        ),
      };
      icoPieces.push(piece);
      icoGroup.add(piece);
    });
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  SCENE 3 — FLOATING DASHBOARDS                                  */
  /* ═══════════════════════════════════════════════════════════════ */
  function buildDashGroup() {
    dashGroup = new THREE.Group();
    dashGroup.visible = false;
    scene.add(dashGroup);

    // 4 wireframe data orbs in 3D space
    const orbData = [
      { r: 0.58, pos: new THREE.Vector3(-2.4,  1.0,  0.2), spd: 0.38 },
      { r: 0.42, pos: new THREE.Vector3(-0.8, -0.7,  0.5), spd: 0.55 },
      { r: 0.68, pos: new THREE.Vector3( 1.1,  0.9, -0.4), spd: 0.30 },
      { r: 0.44, pos: new THREE.Vector3( 2.5, -0.4,  0.1), spd: 0.48 },
    ];

    orbData.forEach(({ r, pos, spd }) => {
      // outer wireframe sphere
      const og  = new THREE.SphereGeometry(r, 18, 18);
      const om  = new THREE.MeshStandardMaterial({
        color: 0x7BB8D4, emissive: 0x3A6A8A, emissiveIntensity: 0.5,
        transparent: true, opacity: 0.12, wireframe: true,
      });
      const orb = new THREE.Mesh(og, om);
      orb.position.copy(pos);
      orb.scale.setScalar(0);
      orb.userData = { basePos: pos.clone(), spd };
      dashGroup.add(orb);

      // inner glow core
      const cg  = new THREE.SphereGeometry(r * 0.3, 12, 12);
      const cm  = new THREE.MeshStandardMaterial({
        color: 0xA8D8F0, emissive: 0xA8D8F0, emissiveIntensity: 2.0,
        transparent: true, opacity: 0.85,
      });
      const core = new THREE.Mesh(cg, cm);
      core.position.copy(pos);
      core.scale.setScalar(0);
      core.userData = { basePos: pos.clone(), spd, isCore: true };
      dashGroup.add(core);

      // orbit ring
      const rg  = new THREE.TorusGeometry(r * 1.4, 0.008, 6, 60);
      const rm  = new THREE.MeshBasicMaterial({
        color: 0x7BB8D4, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(rg, rm);
      ring.position.copy(pos);
      ring.rotation.x = Math.random() * Math.PI;
      ring.rotation.z = Math.random() * Math.PI;
      ring.scale.setScalar(0);
      ring.userData = { basePos: pos.clone(), spd, isRing: true, rotAx: Math.random() > 0.5 ? 'y' : 'z' };
      dashGroup.add(ring);
    });
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  SCENE 4 — PORTAL                                               */
  /* ═══════════════════════════════════════════════════════════════ */
  function buildPortalSystem() {
    portalGroup = new THREE.Group();
    portalGroup.visible = false;
    scene.add(portalGroup);

    // concentric rotating rings
    for (let i = 0; i < 7; i++) {
      const r    = 0.8 + i * 0.38;
      const geo  = new THREE.TorusGeometry(r, 0.012, 8, 90);
      const mat  = new THREE.MeshBasicMaterial({
        color: i < 3 ? 0xA8D8F0 : 0x7BB8D4,
        transparent: true,
        opacity: Math.max(0.06, 0.42 - i * 0.055),
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.6;
      ring.rotation.y = (Math.random() - 0.5) * 0.4;
      ring.scale.setScalar(0);
      ring.userData = {
        rotSpeed: (i % 2 === 0 ? 1 : -1) * (0.12 + i * 0.06),
        baseOpacity: mat.opacity,
      };
      portalGroup.add(ring);
    }

    // central glow disk
    const dg  = new THREE.CircleGeometry(0.9, 64);
    const dm  = new THREE.MeshBasicMaterial({
      color: 0xA8D8F0, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const disk = new THREE.Mesh(dg, dm);
    disk.scale.setScalar(0);
    disk.userData = { isDisk: true };
    portalGroup.add(disk);

    // outer radiance halo
    const hg  = new THREE.CircleGeometry(2.2, 64);
    const hm  = new THREE.MeshBasicMaterial({
      color: 0x7BB8D4, transparent: true, opacity: 0.025,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const halo = new THREE.Mesh(hg, hm);
    halo.scale.setScalar(0);
    halo.userData = { isHalo: true };
    portalGroup.add(halo);
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  MORPH ENGINE                                                   */
  /* ═══════════════════════════════════════════════════════════════ */
  function morphTo(target, dur = 2200) {
    if (morphTween) { morphTween.kill(); morphTween = null; }

    const posAttr = mainParticles.geometry.attributes.position;
    morphFrom = posAttr.array.slice();
    morphTarget = target;

    const proxy = { t: 0 };
    morphTween = gsap.to(proxy, {
      t: 1,
      duration: dur / 1000,
      ease: 'power3.inOut',
      onUpdate() {
        const e = proxy.t;
        for (let i = 0; i < posAttr.array.length; i++) {
          posAttr.array[i] = morphFrom[i] + (morphTarget[i] - morphFrom[i]) * e;
        }
        posAttr.needsUpdate = true;
      },
    });
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  CAMERA CINEMATIC MOVE                                          */
  /* ═══════════════════════════════════════════════════════════════ */
  function moveCameraTo(idx, dur = 2.4) {
    const wp = CAM_WP[idx];
    gsap.to(camera.position, {
      x: wp.pos.x, y: wp.pos.y, z: wp.pos.z,
      duration: dur,
      ease: 'power3.inOut',
    });
    gsap.to(camLookAtTarget, {
      x: wp.look.x, y: wp.look.y, z: wp.look.z,
      duration: dur,
      ease: 'power3.inOut',
    });
    gsap.to(camera, {
      fov: wp.fov,
      duration: dur,
      ease: 'power2.inOut',
      onUpdate: () => camera.updateProjectionMatrix(),
    });
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  SCENE ACTIVATIONS                                              */
  /* ═══════════════════════════════════════════════════════════════ */
  function activateScene(idx) {
    if (idx === activeScene) return;
    const prev = activeScene;
    activeScene = idx;

    // toggle nav style
    document.getElementById('nav')?.classList.toggle('scrolled', idx > 0);

    // camera move
    moveCameraTo(idx);

    // scene 3D transitions
    switch (idx) {
      case 0: enterScene0(prev); break;
      case 1: enterScene1(prev); break;
      case 2: enterScene2(prev); break;
      case 3: enterScene3(prev); break;
      case 4: enterScene4(prev); break;
    }
  }

  /* ── Scene 0: HERO — logo formation ────────────────────────── */
  function enterScene0(from) {
    nodeGroup.visible  = false;
    icoGroup.visible   = false;
    dashGroup.visible  = false;
    portalGroup.visible= false;
    mainParticles.visible = true;

    setFog(0x060810, 0.022);

    if (from < 0) {
      // first entry: scatter → logo
      morphTo(pos_logo, 2800);
    } else {
      // returning from scene 1+
      morphTo(pos_logo, 2000);
    }

    // UI entrance
    gsap.fromTo('.hero-eyebrow',
      { opacity: 0, y: 15 },
      { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out', delay: 0.3 }
    );
    gsap.fromTo('.ht-line',
      { opacity: 0, y: 55 },
      { opacity: 1, y: 0, duration: 1.2, stagger: 0.2, ease: 'power3.out', delay: 0.55 }
    );
    gsap.fromTo('.hero-sub',
      { opacity: 0, y: 22 },
      { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out', delay: 1.05 }
    );
    gsap.fromTo('.hero-ctas',
      { opacity: 0, y: 18 },
      { opacity: 1, y: 0, duration: 0.85, ease: 'power2.out', delay: 1.30 }
    );
  }

  /* ── Scene 1: NEURAL ────────────────────────────────────────── */
  function enterScene1(from) {
    nodeGroup.visible  = true;
    icoGroup.visible   = false;
    dashGroup.visible  = false;
    portalGroup.visible= false;
    mainParticles.visible = true;

    setFog(0x060d1c, 0.020);
    morphTo(pos_sphere, 2200);

    // animate nodes in
    nodeGroup.children.forEach((child, i) => {
      if (child.type === 'Mesh' && !child.userData.isHalo) {
        const bs = child.userData.baseScale || 1;
        gsap.to(child.scale, {
          x: bs, y: bs, z: bs,
          duration: 0.85,
          delay: i * 0.07,
          ease: 'back.out(1.7)',
        });
      }
    });

    // animate energy lines opacity
    if (energyLines) {
      gsap.fromTo(energyLines.material, { opacity: 0 }, { opacity: 0.18, duration: 1.2, delay: 0.3, ease: 'power2.out' });
    }

    // UI
    gsap.fromTo('.tool-node',
      { opacity: 0, x: 55 },
      { opacity: 1, x: 0, stagger: 0.12, duration: 0.7, ease: 'power3.out', delay: 0.25 }
    );
    gsap.fromTo('#ui-tools .section-eyebrow, #ui-tools .section-title',
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, stagger: 0.1, duration: 0.8, ease: 'power2.out', delay: 0.1 }
    );
  }

  /* ── Scene 2: EXPLODED ICOSAHEDRON ──────────────────────────── */
  let icoExploded = false;

  function enterScene2(from) {
    icoGroup.visible   = true;
    nodeGroup.visible  = false;
    dashGroup.visible  = false;
    portalGroup.visible= false;
    mainParticles.visible = true;

    setFog(0x080916, 0.018);
    morphTo(pos_torus, 2000);
    icoExploded = false;

    // assemble icosahedron core first
    icoGroup.children.forEach(child => {
      if (child.userData.isCore || child.userData.isWire) {
        gsap.to(child.scale, { x: 1, y: 1, z: 1, duration: 1.1, ease: 'back.out(1.4)', delay: 0.2 });
        if (child.rotation) gsap.to(child.rotation, { y: Math.PI * 2, duration: 3.5, ease: 'power2.inOut', delay: 0.2 });
      }
    });

    // scale pieces back to center first
    icoPieces.forEach((piece, i) => {
      piece.position.copy(piece.userData.axis.clone().multiplyScalar(0.1));
      gsap.to(piece.scale, { x: 1, y: 1, z: 1, duration: 0.6, delay: 0.3 + i * 0.06, ease: 'back.out(1.3)' });
    });

    // UI
    gsap.fromTo('.frag',
      { opacity: 0, scale: 0.6, y: 25 },
      { opacity: 1, scale: 1, y: 0, stagger: 0.1, duration: 0.7, ease: 'back.out(1.4)', delay: 0.3 }
    );
    gsap.fromTo('#ui-features .section-eyebrow, #ui-features .section-title',
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, stagger: 0.12, duration: 0.8, ease: 'power2.out', delay: 0.1 }
    );

    // auto-explode after 2.5s then reassemble
    scheduleExplode();
  }

  let _explodeTimeout = null;
  function scheduleExplode() {
    if (_explodeTimeout) clearTimeout(_explodeTimeout);
    _explodeTimeout = setTimeout(() => {
      if (activeScene === 2) explodeIco();
    }, 2500);
  }

  function explodeIco() {
    icoExploded = true;
    icoPieces.forEach((piece, i) => {
      const target = piece.userData.axis.clone().multiplyScalar(piece.userData.explodeDist);
      gsap.to(piece.position, {
        x: target.x, y: target.y, z: target.z,
        duration: 1.4,
        delay: i * 0.08,
        ease: 'power4.out',
      });
      gsap.to(piece.material, { emissiveIntensity: 2.5, duration: 0.6, delay: i * 0.08 });
    });
    // core fades
    icoGroup.children.forEach(c => {
      if (c.userData.isCore || c.userData.isWire) {
        gsap.to(c.material, { opacity: c.userData.isCore ? 0.03 : 0.08, duration: 1.0, delay: 0.2 });
      }
    });
    // reassemble after 3.5s
    _explodeTimeout = setTimeout(() => {
      if (activeScene === 2) reassembleIco();
    }, 3500);
  }

  function reassembleIco() {
    icoExploded = false;
    icoPieces.forEach((piece, i) => {
      const home = piece.userData.axis.clone().multiplyScalar(0.1);
      gsap.to(piece.position, {
        x: home.x, y: home.y, z: home.z,
        duration: 1.6,
        delay: i * 0.06,
        ease: 'power3.inOut',
      });
      gsap.to(piece.material, { emissiveIntensity: 1.0, duration: 0.5, delay: i * 0.06 });
    });
    icoGroup.children.forEach(c => {
      if (c.userData.isCore || c.userData.isWire) {
        gsap.to(c.material, { opacity: c.userData.isCore ? 0.12 : 0.4, duration: 1.0, delay: 0.3 });
      }
    });
    // loop
    _explodeTimeout = setTimeout(() => {
      if (activeScene === 2) explodeIco();
    }, 3000);
  }

  /* ── Scene 3: DASHBOARD / METRICS ──────────────────────────── */
  function enterScene3(from) {
    dashGroup.visible  = true;
    nodeGroup.visible  = false;
    icoGroup.visible   = false;
    portalGroup.visible= false;
    mainParticles.visible = true;

    setFog(0x050a14, 0.016);
    morphTo(pos_wave, 2400);

    // orbs scale in
    dashGroup.children.forEach((child, i) => {
      gsap.to(child.scale, {
        x: 1, y: 1, z: 1,
        duration: 1.0,
        delay: i * 0.06,
        ease: 'back.out(1.4)',
      });
    });

    // count-up metrics
    document.querySelectorAll('.metric-val[data-count]').forEach(el => {
      const target = parseInt(el.dataset.count);
      gsap.fromTo({ val: 0 }, { val: target },
        { duration: 2.0, ease: 'power2.out', delay: 0.5,
          onUpdate: function () { el.textContent = Math.round(this.targets()[0].val); }
        }
      );
    });

    gsap.fromTo('.metric',
      { opacity: 0, y: 45 },
      { opacity: 1, y: 0, stagger: 0.14, duration: 0.8, ease: 'power2.out', delay: 0.4 }
    );
    gsap.fromTo('#ui-about .section-eyebrow, #ui-about .section-title, #ui-about .section-body',
      { opacity: 0, y: 32 },
      { opacity: 1, y: 0, stagger: 0.12, duration: 0.8, ease: 'power2.out', delay: 0.15 }
    );
  }

  /* ── Scene 4: PORTAL CTA ────────────────────────────────────── */
  function enterScene4(from) {
    portalGroup.visible = true;
    dashGroup.visible   = false;
    nodeGroup.visible   = false;
    icoGroup.visible    = false;
    mainParticles.visible = true;

    setFog(0x04060a, 0.014);
    morphTo(pos_dna, 2800);

    // portal rings spiral in
    portalGroup.children.forEach((child, i) => {
      gsap.to(child.scale, {
        x: 1, y: 1, z: 1,
        duration: 1.3,
        delay: i * 0.1,
        ease: 'back.out(1.2)',
      });
    });

    // main particles converge inward (reduce rotation, tighten)
    gsap.to(mainParticles.rotation, {
      z: Math.PI * 0.5,
      duration: 3.0,
      ease: 'power2.inOut',
    });

    // CTA UI
    gsap.fromTo('.cta-title',
      { opacity: 0, y: 48 },
      { opacity: 1, y: 0, duration: 1.1, ease: 'power3.out', delay: 0.4 }
    );
    gsap.fromTo('.cta-body',
      { opacity: 0, y: 24 },
      { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out', delay: 0.7 }
    );
    gsap.fromTo('.cta-actions',
      { opacity: 0, y: 18 },
      { opacity: 1, y: 0, duration: 0.85, ease: 'power2.out', delay: 0.95 }
    );
    gsap.fromTo('.cta-footer-note',
      { opacity: 0 },
      { opacity: 1, duration: 0.8, ease: 'power2.out', delay: 1.25 }
    );
  }

  /* ─── fog helper ────────────────────────────────────────────── */
  function setFog(hex, density) {
    if (!scene.fog) return;
    gsap.to(scene.fog.color, {
      r: ((hex >> 16) & 255) / 255,
      g: ((hex >> 8)  & 255) / 255,
      b:  (hex        & 255) / 255,
      duration: 2.2, ease: 'power2.inOut',
    });
    gsap.to(scene.fog, { density, duration: 2.2, ease: 'power2.inOut' });
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  GSAP SCROLL TIMELINE                                           */
  /* ═══════════════════════════════════════════════════════════════ */
  function buildScrollTimeline() {
    const SCENE_IDS = ['scene-hero', 'scene-tools', 'scene-features', 'scene-about', 'scene-cta'];

    SCENE_IDS.forEach((id, idx) => {
      const el = document.getElementById(id);
      if (!el) return;
      ScrollTrigger.create({
        trigger:    el,
        start:      'top 62%',
        end:        'bottom 38%',
        onEnter:      () => activateScene(idx),
        onEnterBack:  () => activateScene(idx),
      });
    });

    // global scroll progress → nav bar
    ScrollTrigger.create({
      trigger: '#scroll-container',
      start:   'top top',
      end:     'bottom bottom',
      scrub:   true,
      onUpdate(self) {
        scrollProgress = self.progress;
        const fill = document.querySelector('.nav-progress-fill');
        if (fill) fill.style.width = (self.progress * 100) + '%';
      },
    });

    // Section UI fade-in on scroll reveal (sections other than hero)
    ['#ui-tools','#ui-features','#ui-about','#ui-cta'].forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) return;
      ScrollTrigger.create({
        trigger: el,
        start:   'top 75%',
        once:    true,
        onEnter() {
          gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out' });
        },
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  RENDER LOOP                                                    */
  /* ═══════════════════════════════════════════════════════════════ */
  let _lastFrame = 0;
  const FRAME_MS = 1000 / 62;

  function RAF(now = 0) {
    requestAnimationFrame(RAF);
    if (now - _lastFrame < FRAME_MS) return;
    _lastFrame = now;
    const dt = clock.getDelta();
    const t  = clock.elapsedTime;

    // mouse parallax — always smooth
    mouseEased.x += (mouse.x * 0.20 - mouseEased.x) * 0.04;
    mouseEased.y += (mouse.y * 0.12 - mouseEased.y) * 0.04;

    // camera spring look-at
    camera.lookAt(
      camLookAtTarget.x + mouseEased.x * 0.12,
      camLookAtTarget.y + mouseEased.y * 0.08,
      camLookAtTarget.z
    );

    // main particles gentle drift
    if (mainParticles) {
      mainParticles.rotation.y += (mouseEased.x * 0.22 - mainParticles.rotation.y) * 0.03;
      mainParticles.rotation.x += (mouseEased.y * 0.14 - mainParticles.rotation.x) * 0.03;
      if (activeScene !== 4) {
        mainParticles.rotation.z = Math.sin(t * 0.07) * 0.03;
      }
    }

    // ambient drift
    if (ambParticles) {
      ambParticles.rotation.y = t * 0.005;
      ambParticles.rotation.x = Math.sin(t * 0.035) * 0.018;
    }
    if (dustParticles) {
      dustParticles.rotation.y  = t * 0.009;
      dustParticles.rotation.x  = Math.cos(t * 0.028) * 0.014;
      dustParticles.position.y  = Math.sin(t * 0.12) * 0.08;
    }

    // update shader time uniform
    if (mainParticles?.material.uniforms) mainParticles.material.uniforms.uTime.value = t;

    // scene-specific animations
    if (nodeGroup?.visible) tickNodes(t);
    if (dashGroup?.visible)  tickDash(t);
    if (portalGroup?.visible) tickPortal(t);
    if (icoGroup?.visible)   tickIco(t);

    renderer.render(scene, camera);
  }

  /* ─── scene tick helpers ────────────────────────────────────── */
  function tickNodes(t) {
    nodeGroup.children.forEach((c, i) => {
      if (c.userData.isHalo) {
        c.rotation.z = t * 0.35 + i;
        c.material.opacity = 0.10 + Math.sin(t * 1.2 + i) * 0.04;
      } else if (c.type === 'Mesh' && c.scale.x > 0.05) {
        const bs = c.userData.baseScale || 1;
        const pulse = 1 + Math.sin(t * 1.6 + i * 1.05) * 0.055;
        c.scale.setScalar(bs * pulse);
        if (c.userData.isCentral) {
          c.rotation.y = t * 0.4;
          c.rotation.x = t * 0.2;
        }
      }
    });
    nodeGroup.rotation.y = mouseEased.x * 0.3 + t * 0.012;
    nodeGroup.rotation.x = mouseEased.y * 0.15;
    if (energyLines) {
      const pulse = 0.14 + Math.sin(t * 1.4) * 0.06;
      energyLines.material.opacity = pulse;
    }
  }

  function tickIco(t) {
    icoGroup.children.forEach(c => {
      if (c.userData.isWire) {
        c.rotation.y = t * 0.25;
        c.rotation.x = t * 0.15;
      }
      if (c.userData.isCore) {
        c.rotation.y = -t * 0.18;
        c.rotation.z =  t * 0.10;
      }
    });
    icoPieces.forEach((piece, i) => {
      if (icoExploded) {
        const rs = piece.userData.rotSpeed;
        piece.rotation.x += rs.x * 0.015;
        piece.rotation.y += rs.y * 0.015;
        piece.rotation.z += rs.z * 0.015;
      }
    });
    icoGroup.rotation.y = mouseEased.x * 0.25 + t * 0.008;
    icoGroup.rotation.x = mouseEased.y * 0.12;
  }

  function tickDash(t) {
    dashGroup.children.forEach(c => {
      if (c.userData.basePos) {
        const sp = c.userData.spd || 0.4;
        const bp = c.userData.basePos;
        c.position.y = bp.y + Math.sin(t * sp + bp.x) * 0.20;
        if (c.userData.isRing) {
          c.rotation[c.userData.rotAx] = t * sp * 0.8;
        } else {
          c.rotation.y = t * sp * 0.5;
          c.rotation.x = t * sp * 0.3;
        }
      }
    });
    dashGroup.rotation.y = mouseEased.x * 0.18;
    dashGroup.rotation.x = mouseEased.y * 0.10;
  }

  function tickPortal(t) {
    portalGroup.children.forEach(c => {
      if (c.userData.rotSpeed) {
        c.rotation.z += c.userData.rotSpeed * 0.012;
        // pulse opacity
        if (c.userData.baseOpacity) {
          c.material.opacity = c.userData.baseOpacity * (0.85 + Math.sin(t * 1.1 + c.userData.rotSpeed) * 0.18);
        }
      }
    });
    // converge: portal tilts toward mouse
    portalGroup.rotation.y = mouseEased.x * 0.12 + Math.sin(t * 0.15) * 0.04;
    portalGroup.rotation.x = mouseEased.y * 0.08;
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  EVENTS                                                         */
  /* ═══════════════════════════════════════════════════════════════ */
  function bindEvents() {
    // mouse
    window.addEventListener('mousemove', e => {
      mouse.x = (e.clientX / innerWidth)  * 2 - 1;
      mouse.y = (e.clientY / innerHeight) * 2 - 1;
      const dot  = document.getElementById('cursor-dot');
      const ring = document.getElementById('cursor-ring');
      if (dot)  { dot.style.left  = e.clientX + 'px'; dot.style.top  = e.clientY + 'px'; }
      if (ring) { ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; }
    }, { passive: true });

    window.addEventListener('touchmove', e => {
      if (!e.touches[0]) return;
      mouse.x = (e.touches[0].clientX / innerWidth)  * 2 - 1;
      mouse.y = (e.touches[0].clientY / innerHeight) * 2 - 1;
    }, { passive: true });

    // resize
    window.addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    }, { passive: true });

    // hover state for custom cursor
    document.querySelectorAll('a,button,.tool-node,.frag,.btn-primary,.btn-ghost').forEach(el => {
      el.addEventListener('mouseenter', () => document.body.classList.add('cur-hover'));
      el.addEventListener('mouseleave', () => document.body.classList.remove('cur-hover'));
    });

    // smooth anchor scroll
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const t = document.querySelector(a.getAttribute('href'));
        if (!t) return;
        e.preventDefault();
        t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // node click → camera zoom to node
    document.querySelectorAll('.tool-node').forEach((el, i) => {
      el.addEventListener('click', () => {
        if (activeScene !== 1) return;
        // mini camera punch toward node
        const wp = CAM_WP[1];
        gsap.to(camera.position, {
          z: wp.pos.z - 0.9,
          duration: 0.5,
          ease: 'power2.inOut',
          yoyo: true,
          repeat: 1,
        });
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /*  LOADER → HERO KICKOFF                                          */
  /* ═══════════════════════════════════════════════════════════════ */
  function runLoader() {
    const loader = document.getElementById('loader');
    const bar    = document.querySelector('.loader-bar-fill');
    const status = document.querySelector('.loader-status');
    if (!loader) return;

    const stages = [
      'Initializing AI Suite',
      'Loading 3D Engine',
      'Calibrating Particles',
      'Syncing Modules',
      'Ready',
    ];
    let p = 0, stageIdx = 0;

    const iv = setInterval(() => {
      p = Math.min(p + 7 + Math.random() * 16, 100);
      if (bar) bar.style.width = p + '%';

      const si = Math.floor(p / 25);
      if (si !== stageIdx && si < stages.length) {
        stageIdx = si;
        if (status) status.textContent = stages[stageIdx];
      }

      if (p >= 100) {
        clearInterval(iv);
        if (status) status.textContent = 'Ready';
        setTimeout(() => {
          loader.classList.add('out');
          setTimeout(() => {
            activateScene(0);
            buildScrollTimeline();
          }, 700);
        }, 380);
      }
    }, 90);
  }

  /* ─── kick off ──────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', waitDeps);

})();
