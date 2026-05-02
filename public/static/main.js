/**
 * SPECTRA — Cinematic Engine v5
 * Hero cleanup · Color-coded tools · Clickable 3D living graph
 * Viewport-contained ico/frag interaction · Footer cleanup
 * Consistent hover/click/active states · Cinematic transitions
 */
(function () {
  'use strict';

  /* ── Dependency gate ─────────────────────────────────────────── */
  let _deps = 0;
  function onDep() { if (++_deps >= 2) boot(); }
  function waitDeps() {
    const ti = setInterval(() => { if (typeof THREE !== 'undefined') { clearInterval(ti); onDep(); } }, 20);
    const tg = setInterval(() => {
      if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
        clearInterval(tg); gsap.registerPlugin(ScrollTrigger); onDep();
      }
    }, 20);
  }

  /* ── Tool definitions ────────────────────────────────────────── */
  const TOOLS = [
    { id:0, name:'Attention Engine',    short:'Analyzes video content for engagement drop-offs in real time', color:'#A78BFA', hex:0xA78BFA, url:'/tools/attention-engine/',    nodePos:null },
    { id:1, name:'Video Generator',     short:'Intelligent video creation from scripts and prompts',           color:'#34D399', hex:0x34D399, url:'/tools/video-generator/',     nodePos:null },
    { id:2, name:'Distribution Engine', short:'Optimal timing and multi-platform content delivery',           color:'#60A5FA', hex:0x60A5FA, url:'/tools/distribution-engine/', nodePos:null },
    { id:3, name:'Motion Engine',       short:'Cinematic intelligent motion composition system',                       color:'#FB923C', hex:0xFB923C, url:'/tools/motion-engine/',       nodePos:null },
    { id:4, name:'Persona Engine',      short:'Adaptive brand voice and audience intelligence',               color:'#F87171', hex:0xF87171, url:'/tools/persona-engine/',      nodePos:null },
  ];

  const PAL = {
    BG:     0x060810,
    GLOW:   null, ACCENT: null, ICE: null, CREAM: null, DEEP: null,
  };

  const N_MAIN = 8000, N_AMB = 2200;

  let scene, camera, renderer, clock, raycaster;
  let mouse = {x:0,y:0}, mouseNDC = new THREE.Vector2(), mouseEased = {x:0,y:0};
  let activeScene = -1, selectedTool = -1, hoveredNode = -1, hoveredFrag = -1;
  let mainParticles, ambParticles, morphFrom, morphTarget, morphTween = null;
  let nodeGroup, nodeObjects = [], nodeLines = [], nodeRings = [], nodeHub, nodeHubHalo;
  let icoGroup, icoPieces = [], icoCore, icoWire;
  let dashGroup, portalGroup;

  /* ── DRAG-TO-SPIN state (scene 1 — big particle sphere) ──────────── */
  const drag = {
    active:    false,
    lastX:     0,
    lastY:     0,
    velX:      0,    // momentum X
    velY:      0,    // momentum Y
    spinX:     0,    // accumulated rotation X
    spinY:     0,    // accumulated rotation Y
    touch:     false,
  };
  let pos_logo, pos_sphere, pos_torus, pos_wave, pos_dna, pos_scatter;
  const camPos  = new THREE.Vector3();
  const camLook = new THREE.Vector3(0,0,0);
  const camTarget = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 58 };

  /* ── Camera waypoints ────────────────────────────────────────── */
  const CAM = [
    { pos: new THREE.Vector3(0,    0,    6.5), look: new THREE.Vector3(0,    0,   0), fov:58 },
    { pos: new THREE.Vector3(-1.4, 0.3,  5.8), look: new THREE.Vector3(0.2,  0,   0), fov:60 },
    { pos: new THREE.Vector3(1.2, -0.2,  5.0), look: new THREE.Vector3(-0.1, 0.1, 0), fov:62 },
    { pos: new THREE.Vector3(0,    0.8,  6.2), look: new THREE.Vector3(0,   -0.2, 0), fov:56 },
    { pos: new THREE.Vector3(0,    0,    4.8), look: new THREE.Vector3(0,    0,   0), fov:54 },
  ];

  /* ══════════════════════════════════════════════════════════════
     BOOT
  ══════════════════════════════════════════════════════════════ */
  function boot() {
    PAL.GLOW   = new THREE.Color(0xA8D8F0);
    PAL.ACCENT = new THREE.Color(0x7BB8D4);
    PAL.ICE    = new THREE.Color(0xE8F4FD);
    PAL.CREAM  = new THREE.Color(0xF5F0E8);
    PAL.DEEP   = new THREE.Color(0x1A3A5C);

    TOOLS[0].nodePos = new THREE.Vector3( 0,    2.0,   0  );
    TOOLS[1].nodePos = new THREE.Vector3(-2.2,  0.4,   0.3);
    TOOLS[2].nodePos = new THREE.Vector3(-1.4, -1.7,  -0.2);
    TOOLS[3].nodePos = new THREE.Vector3( 1.4, -1.7,   0.2);
    TOOLS[4].nodePos = new THREE.Vector3( 2.2,  0.4,  -0.3);

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

  /* ══════════════════════════════════════════════════════════════
     RENDERER
  ══════════════════════════════════════════════════════════════ */
  function initRenderer() {
    const canvas = document.getElementById('world-canvas');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(PAL.BG);
    scene.fog = new THREE.FogExp2(PAL.BG, 0.024);
    camera = new THREE.PerspectiveCamera(58, innerWidth/innerHeight, 0.05, 200);
    camera.position.copy(CAM[0].pos);
    camLook.copy(CAM[0].look);
    renderer = new THREE.WebGLRenderer({
      canvas, antialias:true, alpha:false, powerPreference:'high-performance'
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    raycaster = new THREE.Raycaster();
    raycaster.params.Points = {threshold:0.12};
    clock = new THREE.Clock();

    const pl1 = new THREE.PointLight(0xA8D8F0, 2.2, 22); pl1.position.set( 3,  5,  4);
    const pl2 = new THREE.PointLight(0x3A6A9A, 1.4, 16); pl2.position.set(-5, -3,  2);
    const pl3 = new THREE.PointLight(0xF5F0E8, 0.6, 10); pl3.position.set( 0,  0,  8);
    scene.add(pl1, pl2, pl3, new THREE.AmbientLight(0x1a2a3a, 1.8));
  }

  /* ══════════════════════════════════════════════════════════════
     PARTICLE MATERIAL
  ══════════════════════════════════════════════════════════════ */
  function makeParticleMat(boost, opacity) {
    boost = boost||1; opacity = opacity||1;
    return new THREE.ShaderMaterial({
      uniforms: { uOpacity:{value:opacity}, uTime:{value:0} },
      vertexShader:`
        attribute float pSize; attribute vec3 pCol;
        varying vec3 vCol; varying float vAlpha;
        void main(){
          vCol = pCol;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = max(pSize*${(boost*420).toFixed(1)}/(-mv.z), 0.5);
          vAlpha = clamp(1.0 + mv.z*0.06, 0.15, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader:`
        varying vec3 vCol; varying float vAlpha; uniform float uOpacity;
        void main(){
          vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
          if(d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d);
          float g = smoothstep(0.5, 0.0, d*0.55);
          gl_FragColor = vec4(mix(vCol*0.5, vCol*1.4, g), a*vAlpha*uOpacity*0.92);
        }`,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending
    });
  }

  /* ══════════════════════════════════════════════════════════════
     MORPH SHAPES
  ══════════════════════════════════════════════════════════════ */
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
    const word=['S','P','E','C','T','R','A'], step=0.82;
    const startX = -(word.length-1)*step*0.5;
    const ppt = Math.floor(N/word.length), pts = [];
    word.forEach((ch,wi) => {
      const grid=GLYPHS[ch], ox=startX+wi*step, cells=[];
      grid.forEach((row,r) => row.forEach((on,c) => { if(on) cells.push([c,4-r]); }));
      const pp = Math.ceil(ppt/cells.length);
      cells.forEach(([cx,ry]) => {
        for(let k=0;k<pp;k++) pts.push(
          ox+(cx/3)*0.52+(Math.random()-0.5)*0.055,
          (ry/4)*0.65-0.32+(Math.random()-0.5)*0.055,
          (Math.random()-0.5)*0.14);
      });
    });
    while(pts.length<N*3) pts.push((Math.random()-0.5)*4,(Math.random()-0.5)*0.8,(Math.random()-0.5)*0.2);
    return new Float32Array(pts.slice(0,N*3));
  }

  function buildFibSphere(N,r) {
    const pts=[], phi=Math.PI*(3-Math.sqrt(5));
    for(let i=0;i<N;i++){
      const y=1-(i/(N-1))*2, rad=Math.sqrt(1-y*y), th=phi*i, s=r*(0.96+Math.random()*0.08);
      pts.push(Math.cos(th)*rad*s, y*s, Math.sin(th)*rad*s);
    }
    return new Float32Array(pts);
  }

  function buildTorusKnot(N) {
    const geo=new THREE.TorusKnotGeometry(1.6,0.46,400,28,2,3);
    const v=geo.attributes.position.array, vc=v.length/3, pts=[];
    for(let i=0;i<N;i++){
      const idx=Math.floor(Math.random()*vc)*3;
      pts.push(v[idx]+(Math.random()-0.5)*0.06, v[idx+1]+(Math.random()-0.5)*0.06, v[idx+2]+(Math.random()-0.5)*0.06);
    }
    geo.dispose(); return new Float32Array(pts);
  }

  function buildWaveGrid(N) {
    const pts=[], s=Math.ceil(Math.sqrt(N));
    for(let i=0;i<N;i++){
      const col=i%s, row=Math.floor(i/s);
      const x=(col/s-0.5)*5.8, z=(row/s-0.5)*3.6;
      const y=Math.sin(x*1.4+0.3)*0.55+Math.sin(x*3.1-0.8)*0.28+Math.cos(z*1.1+x*0.4)*0.22+(Math.random()-0.5)*0.07;
      pts.push(x,y,z);
    }
    return new Float32Array(pts);
  }

  function buildDNA(N) {
    const pts=[], half=Math.floor(N*0.47);
    for(let i=0;i<half;i++){
      const t=(i/half)*Math.PI*8, y=(i/half-0.5)*4.8;
      pts.push(Math.cos(t)*1.25+(Math.random()-0.5)*0.05, y, Math.sin(t)*1.25+(Math.random()-0.5)*0.05);
    }
    for(let i=0;i<N-half;i++){
      const t=(i/(N-half))*Math.PI*8+Math.PI, y=(i/(N-half)-0.5)*4.8;
      pts.push(Math.cos(t)*1.25+(Math.random()-0.5)*0.05, y, Math.sin(t)*1.25+(Math.random()-0.5)*0.05);
    }
    while(pts.length<N*3) pts.push((Math.random()-0.5)*0.5,(Math.random()-0.5)*4.5,0);
    return new Float32Array(pts.slice(0,N*3));
  }

  function buildScatter(N,spread) {
    const pts=new Float32Array(N*3);
    for(let i=0;i<N*3;i++) pts[i]=(Math.random()-0.5)*spread;
    return pts;
  }

  /* ══════════════════════════════════════════════════════════════
     PARTICLES
  ══════════════════════════════════════════════════════════════ */
  function buildMainParticles() {
    const sizes=new Float32Array(N_MAIN), colors=new Float32Array(N_MAIN*3);
    for(let i=0;i<N_MAIN;i++){
      sizes[i]=0.018+Math.random()*0.016;
      const t=Math.random(); let c;
      if(t<0.40) c=PAL.GLOW.clone().lerp(PAL.ACCENT,t*2.5);
      else if(t<0.72) c=PAL.ACCENT.clone().lerp(PAL.ICE,(t-0.40)*3.1);
      else c=PAL.ICE.clone().lerp(PAL.CREAM,(t-0.72)*3.6);
      colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b;
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos_scatter.slice(),3));
    geo.setAttribute('pSize',    new THREE.BufferAttribute(sizes,1));
    geo.setAttribute('pCol',     new THREE.BufferAttribute(colors,3));
    mainParticles = new THREE.Points(geo, makeParticleMat(1.0,1.0));
    mainParticles.frustumCulled = false;
    scene.add(mainParticles);
    morphFrom=pos_scatter.slice(); morphTarget=pos_logo;
  }

  function buildAmbParticles() {
    const N=N_AMB, pos=new Float32Array(N*3), sz=new Float32Array(N), col=new Float32Array(N*3);
    for(let i=0;i<N;i++){
      pos[i*3]=(Math.random()-0.5)*32; pos[i*3+1]=(Math.random()-0.5)*22; pos[i*3+2]=(Math.random()-0.5)*24-5;
      sz[i]=0.005+Math.random()*0.009;
      const c=PAL.ACCENT.clone().lerp(PAL.DEEP,Math.random()*0.75);
      col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b;
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setAttribute('pSize',    new THREE.BufferAttribute(sz,1));
    geo.setAttribute('pCol',     new THREE.BufferAttribute(col,3));
    ambParticles = new THREE.Points(geo, makeParticleMat(0.5,0.55));
    ambParticles.frustumCulled = false;
    scene.add(ambParticles);
  }

  /* ══════════════════════════════════════════════════════════════
     NODE SYSTEM — Living graph (scene 1)
     Central hub sphere + 5 tool nodes + connecting energy lines
     Nodes: clickable, glow on select, scale on hover, pulse lines
  ══════════════════════════════════════════════════════════════ */
  function buildNodeSystem() {
    nodeGroup = new THREE.Group(); nodeGroup.visible=false; scene.add(nodeGroup);
    nodeObjects=[]; nodeLines=[]; nodeRings=[];

    /* central hub */
    const hubGeo = new THREE.SphereGeometry(0.26,32,32);
    const hubMat = new THREE.MeshStandardMaterial({
      color:0xE8F4FD, emissive:0xA8D8F0, emissiveIntensity:1.8,
      transparent:true, opacity:0.95, roughness:0.08, metalness:0.45
    });
    nodeHub = new THREE.Mesh(hubGeo, hubMat);
    nodeHub.position.set(0,0,0.5); nodeHub.userData={isHub:true};
    nodeGroup.add(nodeHub);

    const haloMat = new THREE.MeshBasicMaterial({
      color:0xA8D8F0, transparent:true, opacity:0.12,
      blending:THREE.AdditiveBlending, side:THREE.DoubleSide
    });
    nodeHubHalo = new THREE.Mesh(new THREE.RingGeometry(0.40,0.56,48), haloMat);
    nodeHubHalo.position.copy(nodeHub.position); nodeHubHalo.userData={isHubHalo:true};
    nodeGroup.add(nodeHubHalo);

    /* outer hub corona ring */
    const coronaMat = new THREE.MeshBasicMaterial({
      color:0xA8D8F0, transparent:true, opacity:0.055,
      blending:THREE.AdditiveBlending, side:THREE.DoubleSide
    });
    const corona = new THREE.Mesh(new THREE.RingGeometry(0.60,0.78,48), coronaMat);
    corona.position.copy(nodeHub.position); corona.userData={isCorona:true};
    nodeGroup.add(corona);

    TOOLS.forEach((tool,i) => {
      /* connection line hub→node */
      const linePts=[nodeHub.position.clone(), tool.nodePos.clone()];
      const lineMat = new THREE.LineBasicMaterial({
        color:tool.hex, transparent:true, opacity:0,
        blending:THREE.AdditiveBlending
      });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePts), lineMat);
      line.userData={isLine:true, toolId:i};
      nodeGroup.add(line); nodeLines.push(line);

      /* node sphere */
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.17,24,24),
        new THREE.MeshStandardMaterial({
          color:tool.hex, emissive:tool.hex, emissiveIntensity:0.9,
          transparent:true, opacity:0.95, roughness:0.12, metalness:0.3
        })
      );
      mesh.position.copy(tool.nodePos); mesh.scale.setScalar(0);
      mesh.userData={isNode:true, toolId:i};
      nodeGroup.add(mesh); nodeObjects.push(mesh);

      /* node glow ring */
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.24,0.34,40),
        new THREE.MeshBasicMaterial({
          color:tool.hex, transparent:true, opacity:0.12,
          blending:THREE.AdditiveBlending, side:THREE.DoubleSide
        })
      );
      ring.position.copy(tool.nodePos); ring.userData={isNodeRing:true, toolId:i};
      nodeGroup.add(ring); nodeRings.push(ring);

      /* node outer halo (bigger glow on select) */
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.36,0.52,40),
        new THREE.MeshBasicMaterial({
          color:tool.hex, transparent:true, opacity:0,
          blending:THREE.AdditiveBlending, side:THREE.DoubleSide
        })
      );
      halo.position.copy(tool.nodePos); halo.userData={isNodeHalo:true, toolId:i};
      nodeGroup.add(halo);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     ICO SYSTEM — scene 2
  ══════════════════════════════════════════════════════════════ */
  function buildIcoSystem() {
    icoGroup = new THREE.Group(); icoGroup.visible=false; scene.add(icoGroup);
    const icoGeo = new THREE.IcosahedronGeometry(1.35,1);
    icoCore = new THREE.Mesh(icoGeo, new THREE.MeshStandardMaterial({
      color:0x7BB8D4, emissive:0x3A6A8A, emissiveIntensity:0.7,
      transparent:true, opacity:0.10, roughness:0.3, metalness:0.6
    }));
    icoCore.userData={isCore:true}; icoGroup.add(icoCore);

    icoWire = new THREE.Mesh(icoGeo.clone(), new THREE.MeshBasicMaterial({
      color:0xA8D8F0, wireframe:true, transparent:true, opacity:0.38,
      blending:THREE.AdditiveBlending
    }));
    icoWire.userData={isWire:true}; icoGroup.add(icoWire);

    const fd=[
      {col:0xA78BFA, axis:new THREE.Vector3( 1, 1, 0).normalize()},
      {col:0x34D399, axis:new THREE.Vector3(-1, 1, 0).normalize()},
      {col:0x60A5FA, axis:new THREE.Vector3( 0, 1, 1).normalize()},
      {col:0xFB923C, axis:new THREE.Vector3( 0,-1, 1).normalize()},
      {col:0xF87171, axis:new THREE.Vector3( 1,-1, 0).normalize()},
      {col:0xA8D8F0, axis:new THREE.Vector3(-1,-1, 0).normalize()},
    ];
    icoPieces=[];
    fd.forEach(({col,axis},i) => {
      const p = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.20,0),
        new THREE.MeshStandardMaterial({
          color:col, emissive:col, emissiveIntensity:1.0,
          transparent:true, opacity:0.9, roughness:0.2, metalness:0.4
        })
      );
      p.position.copy(axis.clone().multiplyScalar(0.1)); p.scale.setScalar(0);
      p.userData={
        axis, maxDist:2.0+Math.random()*0.4,
        rotSpeed:new THREE.Vector3((Math.random()-0.5)*2,(Math.random()-0.5)*2,(Math.random()-0.5)*2)
      };
      icoPieces.push(p); icoGroup.add(p);
    });
    icoGroup.add(new THREE.Mesh(
      new THREE.TorusGeometry(2.6,0.005,6,80),
      new THREE.MeshBasicMaterial({color:0x7BB8D4,transparent:true,opacity:0.05,blending:THREE.AdditiveBlending})
    ));
  }

  /* ══════════════════════════════════════════════════════════════
     DASH SYSTEM — scene 3
  ══════════════════════════════════════════════════════════════ */
  function buildDashSystem() {
    dashGroup = new THREE.Group(); dashGroup.visible=false; scene.add(dashGroup);
    [{r:0.55,pos:new THREE.Vector3(-2.2, 0.9, 0.2),spd:0.38},
     {r:0.40,pos:new THREE.Vector3(-0.7,-0.6, 0.5),spd:0.55},
     {r:0.65,pos:new THREE.Vector3( 1.0, 0.9,-0.4),spd:0.30},
     {r:0.42,pos:new THREE.Vector3( 2.4,-0.4, 0.1),spd:0.48}].forEach(({r,pos,spd}) => {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(r,18,18),
        new THREE.MeshStandardMaterial({color:0x7BB8D4,emissive:0x3A6A8A,emissiveIntensity:0.5,transparent:true,opacity:0.12,wireframe:true})
      );
      orb.position.copy(pos); orb.scale.setScalar(0); orb.userData={basePos:pos.clone(),spd}; dashGroup.add(orb);
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(r*0.28,12,12),
        new THREE.MeshStandardMaterial({color:0xA8D8F0,emissive:0xA8D8F0,emissiveIntensity:2.2,transparent:true,opacity:0.85})
      );
      core.position.copy(pos); core.scale.setScalar(0); core.userData={basePos:pos.clone(),spd,isCore:true}; dashGroup.add(core);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r*1.4,0.007,6,60),
        new THREE.MeshBasicMaterial({color:0x7BB8D4,transparent:true,opacity:0.20,blending:THREE.AdditiveBlending})
      );
      ring.position.copy(pos); ring.scale.setScalar(0);
      ring.rotation.x=Math.random()*Math.PI; ring.rotation.z=Math.random()*Math.PI;
      ring.userData={basePos:pos.clone(),spd,isRing:true,rotAx:Math.random()>0.5?'y':'z'};
      dashGroup.add(ring);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     PORTAL SYSTEM — scene 4
  ══════════════════════════════════════════════════════════════ */
  function buildPortalSystem() {
    portalGroup = new THREE.Group(); portalGroup.visible=false; scene.add(portalGroup);
    for(let i=0;i<7;i++){
      const r=0.8+i*0.38;
      const mat=new THREE.MeshBasicMaterial({
        color:i<3?0xA8D8F0:0x7BB8D4,transparent:true,
        opacity:Math.max(0.05,0.42-i*0.055),blending:THREE.AdditiveBlending
      });
      const ring=new THREE.Mesh(new THREE.TorusGeometry(r,0.012,8,90),mat);
      ring.rotation.x=Math.PI/2+(Math.random()-0.5)*0.6;
      ring.rotation.y=(Math.random()-0.5)*0.4; ring.scale.setScalar(0);
      ring.userData={rotSpeed:(i%2===0?1:-1)*(0.12+i*0.06),baseOpacity:mat.opacity};
      portalGroup.add(ring);
    }
    const disk=new THREE.Mesh(
      new THREE.CircleGeometry(0.9,64),
      new THREE.MeshBasicMaterial({color:0xA8D8F0,transparent:true,opacity:0.05,blending:THREE.AdditiveBlending,side:THREE.DoubleSide})
    );
    disk.scale.setScalar(0); disk.userData={isDisk:true}; portalGroup.add(disk);
  }

  /* ══════════════════════════════════════════════════════════════
     MORPH
  ══════════════════════════════════════════════════════════════ */
  function morphTo(target,dur) {
    dur=dur||2200;
    if(morphTween){morphTween.kill();morphTween=null;}
    const posAttr=mainParticles.geometry.attributes.position;
    morphFrom=posAttr.array.slice(); morphTarget=target;
    const proxy={t:0};
    morphTween=gsap.to(proxy,{t:1,duration:dur/1000,ease:'power3.inOut',onUpdate(){
      const e=proxy.t;
      for(let i=0;i<posAttr.array.length;i++) posAttr.array[i]=morphFrom[i]+(morphTarget[i]-morphFrom[i])*e;
      posAttr.needsUpdate=true;
    }});
  }

  /* ══════════════════════════════════════════════════════════════
     CAMERA
  ══════════════════════════════════════════════════════════════ */
  function moveCameraTo(idx,dur) {
    dur=dur||2.4; const wp=CAM[idx];
    gsap.to(camera.position,{x:wp.pos.x,y:wp.pos.y,z:wp.pos.z,duration:dur,ease:'power3.inOut'});
    gsap.to(camLook,{x:wp.look.x,y:wp.look.y,z:wp.look.z,duration:dur,ease:'power3.inOut'});
    gsap.to(camera,{fov:wp.fov,duration:dur,ease:'power2.inOut',onUpdate:()=>camera.updateProjectionMatrix()});
  }

  function zoomToNode(toolId) {
    const pos=TOOLS[toolId].nodePos;
    gsap.to(camera.position,{
      x:pos.x*0.55-1.0, y:pos.y*0.35, z:CAM[1].pos.z-0.8,
      duration:1.2, ease:'power3.inOut'
    });
    gsap.to(camLook,{x:pos.x*0.30,y:pos.y*0.20,z:0,duration:1.2,ease:'power3.inOut'});
  }

  /* ══════════════════════════════════════════════════════════════
     SCENE ACTIVATION
  ══════════════════════════════════════════════════════════════ */
  function activateScene(idx) {
    if(idx===activeScene) return;
    const prev=activeScene; activeScene=idx;
    document.getElementById('nav')?.classList.toggle('scrolled',idx>0);
    if(prev===4) onLeaveScene4();
    if(idx!==1) hideHUD();
    // Reset grab cursor when leaving scene 1
    if(prev===1 && idx!==1) {
      const canvas = document.getElementById('world-canvas');
      if(canvas) canvas.style.cursor = '';
      drag.active = false; drag.velX = 0; drag.velY = 0;
    }
    moveCameraTo(idx);
    if(idx===0) enterScene0();
    else if(idx===1) enterScene1();
    else if(idx===2) enterScene2();
    else if(idx===3) enterScene3();
    else if(idx===4) enterScene4();
  }

  /* ── Scene 0: HERO ──────────────────────────────────────────── */
  function enterScene0() {
    nodeGroup.visible=false; icoGroup.visible=false; dashGroup.visible=false; portalGroup.visible=false;
    mainParticles.visible=true;
    setFog(0x060810,0.022); morphTo(pos_logo,2800);
    // No HTML title — particles spell SPECTRA. Just animate the support text.
    gsap.fromTo('.hero-pre', {opacity:0,y:10},{opacity:1,y:0,duration:0.8,ease:'power2.out',delay:2.4});
    gsap.fromTo('.hero-sub', {opacity:0,y:18},{opacity:1,y:0,duration:0.9,ease:'power2.out',delay:2.7});
    gsap.fromTo('.hero-ctas',{opacity:0,y:14},{opacity:1,y:0,duration:0.85,ease:'power2.out',delay:3.0});
  }

  /* ── Scene 1: TOOL GRAPH ────────────────────────────────────── */
  function enterScene1() {
    nodeGroup.visible=true; icoGroup.visible=false; dashGroup.visible=false; portalGroup.visible=false;
    mainParticles.visible=true;
    setFog(0x060d1c,0.020); morphTo(pos_sphere,2200);

    /* staggered node pop-in */
    nodeObjects.forEach((mesh,i) => {
      gsap.to(mesh.scale,{x:1,y:1,z:1,duration:0.9,delay:i*0.09,ease:'back.out(1.7)'});
    });
    /* lines fade in with pulse */
    nodeLines.forEach((line,i) => {
      gsap.fromTo(line.material,{opacity:0},{opacity:0.22,duration:1.0,delay:0.4+i*0.06,ease:'power2.out'});
    });

    gsap.fromTo('#ui-tools .section-eyebrow,#ui-tools .section-title',
      {opacity:0,y:30},{opacity:1,y:0,stagger:0.1,duration:0.8,ease:'power2.out',delay:0.1});
    gsap.fromTo('.tool-node',
      {opacity:0,x:50},{opacity:1,x:0,stagger:0.1,duration:0.65,ease:'power3.out',delay:0.25});

    if(selectedTool>=0) highlightTool(selectedTool,false);

    // Enable grab cursor + preserve spin state on scene 1
    const canvas1 = document.getElementById('world-canvas');
    if(canvas1) canvas1.style.cursor = 'grab';
    // Reset velocity but keep accumulated spin so re-entering doesn't snap
    drag.velX = 0; drag.velY = 0;
  }

  /* ── Scene 2: ARCHITECTURE / ICO ───────────────────────────── */
  let _explodeTimer=null, icoExploded=false;

  function enterScene2() {
    icoGroup.visible=true; nodeGroup.visible=false; dashGroup.visible=false; portalGroup.visible=false;
    mainParticles.visible=true; icoExploded=false;
    setFog(0x080916,0.018); morphTo(pos_torus,2000);
    gsap.to(icoCore.scale,{x:1,y:1,z:1,duration:1.1,ease:'back.out(1.4)',delay:0.2});
    gsap.to(icoWire.scale,{x:1,y:1,z:1,duration:1.1,ease:'back.out(1.4)',delay:0.2});
    icoPieces.forEach((p,i) => {
      p.position.copy(p.userData.axis.clone().multiplyScalar(0.1));
      gsap.to(p.scale,{x:1,y:1,z:1,duration:0.65,delay:0.3+i*0.05,ease:'back.out(1.3)'});
    });
    gsap.fromTo('.frag',
      {opacity:0,scale:0.78,y:16},{opacity:1,scale:1,y:0,stagger:0.08,duration:0.65,ease:'back.out(1.4)',delay:0.3});
    gsap.fromTo('#ui-features .section-eyebrow,#ui-features .section-title',
      {opacity:0,y:30},{opacity:1,y:0,stagger:0.12,duration:0.8,ease:'power2.out',delay:0.1});
    scheduleExplode();
  }

  function scheduleExplode() {
    if(_explodeTimer) clearTimeout(_explodeTimer);
    _explodeTimer = setTimeout(()=>{ if(activeScene===2) explodeIco(); },2800);
  }

  function explodeIco() {
    icoExploded=true;
    icoPieces.forEach((p,i) => {
      const t=p.userData.axis.clone().multiplyScalar(p.userData.maxDist);
      gsap.to(p.position,{x:t.x,y:t.y,z:t.z,duration:1.3,delay:i*0.07,ease:'power4.out'});
      gsap.to(p.material,{emissiveIntensity:2.8,duration:0.5,delay:i*0.07});
    });
    gsap.to(icoCore.material,{opacity:0.03,duration:0.9,delay:0.2});
    gsap.to(icoWire.material,{opacity:0.06,duration:0.9,delay:0.2});
    _explodeTimer=setTimeout(()=>{ if(activeScene===2) reassembleIco(); },3200);
  }

  function reassembleIco() {
    icoExploded=false;
    icoPieces.forEach((p,i) => {
      const h=p.userData.axis.clone().multiplyScalar(0.1);
      gsap.to(p.position,{x:h.x,y:h.y,z:h.z,duration:1.5,delay:i*0.05,ease:'power3.inOut'});
      gsap.to(p.material,{emissiveIntensity:1.0,duration:0.4,delay:i*0.05});
    });
    gsap.to(icoCore.material,{opacity:0.10,duration:0.9,delay:0.3});
    gsap.to(icoWire.material,{opacity:0.38,duration:0.9,delay:0.3});
    _explodeTimer=setTimeout(()=>{ if(activeScene===2) explodeIco(); },2800);
  }

  /* ── Scene 3: METRICS ───────────────────────────────────────── */
  function enterScene3() {
    dashGroup.visible=true; nodeGroup.visible=false; icoGroup.visible=false; portalGroup.visible=false;
    mainParticles.visible=true;
    setFog(0x050a14,0.016); morphTo(pos_wave,2400);
    dashGroup.children.forEach((c,i) =>
      gsap.to(c.scale,{x:1,y:1,z:1,duration:1.0,delay:i*0.06,ease:'back.out(1.4)'}));
    document.querySelectorAll('.metric-val[data-count]').forEach(el => {
      const target=parseInt(el.dataset.count);
      gsap.fromTo({val:0},{val:target},{duration:2.2,ease:'power2.out',delay:0.5,
        onUpdate:function(){el.textContent=Math.round(this.targets()[0].val);}});
    });
    gsap.fromTo('.metric',{opacity:0,y:44},{opacity:1,y:0,stagger:0.14,duration:0.8,ease:'power2.out',delay:0.4});
    gsap.fromTo('#ui-about .section-eyebrow,#ui-about .section-title,#ui-about .section-body',
      {opacity:0,y:30},{opacity:1,y:0,stagger:0.1,duration:0.8,ease:'power2.out',delay:0.15});
  }

  /* ── Scene 4: PORTAL / CTA ──────────────────────────────────── */
  function enterScene4() {
    portalGroup.visible=true; dashGroup.visible=false; nodeGroup.visible=false; icoGroup.visible=false;
    mainParticles.visible=true;
    setFog(0x04060a,0.014); morphTo(pos_dna,2800);
    portalGroup.children.forEach((c,i) =>
      gsap.to(c.scale,{x:1,y:1,z:1,duration:1.3,delay:i*0.1,ease:'back.out(1.2)'}));
    gsap.to(mainParticles.scale,{z:0.55,duration:3.0,ease:'power2.inOut'});
    gsap.fromTo('.cta-title',{opacity:0,y:48},{opacity:1,y:0,duration:1.1,ease:'power3.out',delay:0.4});
    gsap.fromTo('.cta-body',{opacity:0,y:24},{opacity:1,y:0,duration:0.9,ease:'power2.out',delay:0.7});
    gsap.fromTo('.cta-actions',{opacity:0,y:18},{opacity:1,y:0,duration:0.85,ease:'power2.out',delay:0.95});
    gsap.fromTo('.cta-brand',{opacity:0},{opacity:1,duration:0.8,ease:'power2.out',delay:1.3});
  }

  function onLeaveScene4() {
    gsap.to(mainParticles.scale,{z:1.0,duration:1.5,ease:'power2.out'});
  }

  /* ── Fog helper ─────────────────────────────────────────────── */
  function setFog(hex,density) {
    if(!scene.fog) return;
    gsap.to(scene.fog.color,{
      r:((hex>>16)&255)/255, g:((hex>>8)&255)/255, b:(hex&255)/255,
      duration:2.2, ease:'power2.inOut'
    });
    gsap.to(scene.fog,{density,duration:2.2,ease:'power2.inOut'});
  }

  /* ══════════════════════════════════════════════════════════════
     TOOL INTERACTION — select / highlight / HUD
  ══════════════════════════════════════════════════════════════ */
  function selectTool(toolId) {
    if(selectedTool===toolId){
      /* deselect */
      selectedTool=-1;
      resetAllNodes();
      hideHUD();
      moveCameraTo(1,1.4);
      document.querySelectorAll('.tool-node').forEach(el=>el.classList.remove('selected','dimmed'));
      return;
    }
    selectedTool=toolId;
    highlightTool(toolId,true);
    showHUD(toolId);
    document.querySelectorAll('.tool-node').forEach(el => {
      const n=parseInt(el.dataset.node);
      el.classList.toggle('selected',n===toolId);
      el.classList.toggle('dimmed',n!==toolId);
    });
  }

  function highlightTool(toolId,withCamera) {
    const tool=TOOLS[toolId];

    /* node scales + emissive */
    nodeObjects.forEach((mesh,i) => {
      if(i===toolId){
        gsap.to(mesh.material,{emissiveIntensity:3.5,opacity:1.0,duration:0.5});
        gsap.to(mesh.scale,{x:1.62,y:1.62,z:1.62,duration:0.5,ease:'back.out(1.6)'});
      } else {
        gsap.to(mesh.material,{emissiveIntensity:0.28,opacity:0.36,duration:0.5});
        gsap.to(mesh.scale,{x:0.65,y:0.65,z:0.65,duration:0.4,ease:'power2.inOut'});
      }
    });

    /* node outer halos */
    nodeGroup.children.forEach(c => {
      if(c.userData.isNodeHalo) {
        gsap.to(c.material,{opacity:c.userData.toolId===toolId?0.28:0,duration:0.5});
      }
    });

    /* connection lines */
    nodeLines.forEach((line,i) => {
      gsap.to(line.material,{opacity:i===toolId?0.80:0.04,duration:0.5});
    });

    /* hub recolors to tool color */
    if(nodeHub) {
      const col=new THREE.Color(tool.hex);
      gsap.to(nodeHub.material.color,{r:col.r,g:col.g,b:col.b,duration:0.6});
      gsap.to(nodeHub.material.emissive,{r:col.r*0.8,g:col.g*0.8,b:col.b*0.8,duration:0.6});
      gsap.to(nodeHub.material,{emissiveIntensity:3.0,duration:0.5});
      /* hub pulses scale */
      gsap.to(nodeHub.scale,{x:1.28,y:1.28,z:1.28,duration:0.4,ease:'back.out(1.8)',
        onComplete:()=>gsap.to(nodeHub.scale,{x:1,y:1,z:1,duration:0.35,ease:'power2.inOut'})});
    }

    /* subtle fog tint toward tool color */
    if(scene.fog) {
      const fc=new THREE.Color(tool.hex);
      gsap.to(scene.fog.color,{r:fc.r*0.06,g:fc.g*0.06,b:fc.b*0.06+0.04,duration:1.0});
    }

    /* set CSS custom property for cursor color */
    document.documentElement.style.setProperty('--tc', tool.color);

    if(withCamera) zoomToNode(toolId);
  }

  function resetAllNodes() {
    nodeObjects.forEach(mesh => {
      gsap.to(mesh.material,{emissiveIntensity:0.9,opacity:0.95,duration:0.5});
      gsap.to(mesh.scale,{x:1,y:1,z:1,duration:0.5,ease:'back.out(1.3)'});
    });
    /* reset outer halos */
    nodeGroup.children.forEach(c => {
      if(c.userData.isNodeHalo) gsap.to(c.material,{opacity:0,duration:0.4});
    });
    nodeLines.forEach(line => gsap.to(line.material,{opacity:0.22,duration:0.5}));
    if(nodeHub) {
      gsap.to(nodeHub.material.color,{r:PAL.ICE.r,g:PAL.ICE.g,b:PAL.ICE.b,duration:0.6});
      gsap.to(nodeHub.material.emissive,{r:0.66,g:0.85,b:0.94,duration:0.6});
      gsap.to(nodeHub.material,{emissiveIntensity:1.8,duration:0.5});
    }
    document.documentElement.style.removeProperty('--tc');
    setFog(0x060d1c,0.020);
    document.querySelectorAll('.tool-node').forEach(el=>el.classList.remove('selected','dimmed'));
  }

  /* ══════════════════════════════════════════════════════════════
     HUD
  ══════════════════════════════════════════════════════════════ */
  function showHUD(toolId) {
    const tool=TOOLS[toolId], hud=document.getElementById('tool-hud');
    if(!hud) return;
    hud.querySelector('.hud-name').textContent=tool.name;
    hud.querySelector('.hud-desc').textContent=tool.short;
    const link=hud.querySelector('.hud-link');
    link.href=tool.url;
    hud.style.setProperty('--hud-color',tool.color);
    hud.classList.add('visible');
  }
  function hideHUD() { document.getElementById('tool-hud')?.classList.remove('visible'); }

  /* ══════════════════════════════════════════════════════════════
     TOOLTIP
  ══════════════════════════════════════════════════════════════ */
  function showTooltip(toolId,sx,sy) {
    const tip=document.getElementById('node-tooltip'); if(!tip) return;
    tip.textContent=TOOLS[toolId].name;
    tip.style.left=(sx+16)+'px'; tip.style.top=(sy-10)+'px';
    tip.style.setProperty('--tc',TOOLS[toolId].color);
    tip.classList.add('visible');
  }
  function hideTooltip() { document.getElementById('node-tooltip')?.classList.remove('visible'); }

  /* ══════════════════════════════════════════════════════════════
     RAYCASTING — node hover / click
  ══════════════════════════════════════════════════════════════ */
  function checkNodeHover(e) {
    if(activeScene!==1) return;
    raycaster.setFromCamera(mouseNDC,camera);
    const hits=raycaster.intersectObjects(nodeObjects);
    if(hits.length>0){
      const tId=hits[0].object.userData.toolId;
      if(tId!==hoveredNode){
        hoveredNode=tId;
        document.body.classList.add('cur-hover','cur-tool');
        document.documentElement.style.setProperty('--tc',TOOLS[tId].color);
        showTooltip(tId,e.clientX,e.clientY);
        if(tId!==selectedTool){
          gsap.to(hits[0].object.material,{emissiveIntensity:2.4,duration:0.22});
          gsap.to(hits[0].object.scale,{x:1.35,y:1.35,z:1.35,duration:0.22,ease:'back.out(1.5)'});
        }
      }
    } else {
      if(hoveredNode>=0){
        const prev=nodeObjects[hoveredNode];
        if(hoveredNode!==selectedTool){
          const ei=selectedTool>=0?0.28:0.9, sc=selectedTool>=0?0.65:1.0;
          gsap.to(prev.material,{emissiveIntensity:ei,duration:0.22});
          gsap.to(prev.scale,{x:sc,y:sc,z:sc,duration:0.22});
        }
        hoveredNode=-1;
        document.body.classList.remove('cur-hover','cur-tool');
        if(selectedTool<0) document.documentElement.style.removeProperty('--tc');
        hideTooltip();
      }
    }
  }

  function handleNodeClick(e) {
    if(activeScene!==1) return;
    raycaster.setFromCamera(mouseNDC,camera);
    const hits=raycaster.intersectObjects(nodeObjects);
    if(hits.length>0){
      /* click pulse on node */
      const mesh=hits[0].object;
      gsap.to(mesh.scale,{x:1.9,y:1.9,z:1.9,duration:0.18,ease:'power2.out',
        onComplete:()=>selectTool(mesh.userData.toolId)});
    }
  }

  /* ══════════════════════════════════════════════════════════════
     FRAGMENT INTERACTION (scene 2)
  ══════════════════════════════════════════════════════════════ */
  function handleFragClick(fragIdx) {
    const frags=document.querySelectorAll('.frag');
    if(hoveredFrag===fragIdx){
      hoveredFrag=-1;
      frags.forEach(f=>f.classList.remove('frag-active'));
      if(activeScene===2&&icoExploded) reassembleIco();
    } else {
      hoveredFrag=fragIdx;
      frags.forEach((f,i)=>f.classList.toggle('frag-active',i===fragIdx));
      if(activeScene===2){
        if(_explodeTimer) clearTimeout(_explodeTimer);
        explodeIco();
        const piece=icoPieces[Math.min(fragIdx,icoPieces.length-1)];
        if(piece) gsap.to(piece.material,{emissiveIntensity:4.2,duration:0.4});
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
     SCROLL TIMELINE
  ══════════════════════════════════════════════════════════════ */
  function buildScrollTimeline() {
    ['scene-hero','scene-tools','scene-features','scene-about','scene-cta'].forEach((id,idx) => {
      const el=document.getElementById(id); if(!el) return;
      ScrollTrigger.create({
        trigger:el, start:'top 62%', end:'bottom 38%',
        onEnter:()=>activateScene(idx), onEnterBack:()=>activateScene(idx),
        onLeave:()=>{ if(idx===4) onLeaveScene4(); },
        onLeaveBack:()=>{ if(idx===4) onLeaveScene4(); }
      });
    });
    ScrollTrigger.create({
      trigger:'#scroll-container', start:'top top', end:'bottom bottom', scrub:true,
      onUpdate(self){
        const f=document.querySelector('.nav-progress-fill');
        if(f) f.style.width=(self.progress*100)+'%';
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     RENDER LOOP
  ══════════════════════════════════════════════════════════════ */
  let _lastFrame=0; const FRAME_MS=1000/62;

  function RAF(now) {
    now=now||0; requestAnimationFrame(RAF);
    if(now-_lastFrame<FRAME_MS) return; _lastFrame=now;
    const t=clock.getElapsedTime();

    /* eased mouse parallax */
    mouseEased.x+=(mouse.x*0.20-mouseEased.x)*0.04;
    mouseEased.y+=(mouse.y*0.12-mouseEased.y)*0.04;

    /* spring look-at */
    camera.lookAt(camLook.x+mouseEased.x*0.10, camLook.y+mouseEased.y*0.07, camLook.z);

    /* particle rotation — drag overrides mouse-eased parallax on scene 1 */
    if(mainParticles&&activeScene!==4){
      if(activeScene===1){
        // Apply drag momentum decay
        if(!drag.active){
          drag.velX*=0.92; drag.velY*=0.92;
          drag.spinY+=drag.velX; drag.spinX+=drag.velY;
          // When momentum dies, gentle idle drift
          if(Math.abs(drag.velX)+Math.abs(drag.velY)<0.002){
            drag.spinY+=0.003;
          }
        }
        mainParticles.rotation.y=drag.spinY;
        mainParticles.rotation.x=drag.spinX;
        mainParticles.rotation.z=Math.sin(t*0.07)*0.025;
        // Keep nodeGroup locked to same rotation so tools spin with sphere
        if(nodeGroup){
          nodeGroup.rotation.y=drag.spinY;
          nodeGroup.rotation.x=drag.spinX;
        }
      } else {
        mainParticles.rotation.y+=(mouseEased.x*0.22-mainParticles.rotation.y)*0.03;
        mainParticles.rotation.x+=(mouseEased.y*0.14-mainParticles.rotation.x)*0.03;
        mainParticles.rotation.z=Math.sin(t*0.07)*0.025;
      }
    }
    if(ambParticles){
      ambParticles.rotation.y=t*0.005;
      ambParticles.rotation.x=Math.sin(t*0.035)*0.018;
    }
    if(mainParticles?.material.uniforms) mainParticles.material.uniforms.uTime.value=t;

    if(nodeGroup?.visible) tickNodes(t);
    if(icoGroup?.visible) tickIco(t);
    if(dashGroup?.visible) tickDash(t);
    if(portalGroup?.visible) tickPortal(t);

    renderer.render(scene,camera);
  }

  /* ── Tick helpers ───────────────────────────────────────────── */
  function tickNodes(t) {
    /* hub breathe */
    if(nodeHub&&nodeHub.scale.x>0.05) {
      const s=1+Math.sin(t*1.8)*0.055;
      nodeHub.scale.setScalar(s);
    }
    /* hub halo spin */
    if(nodeHubHalo) {
      nodeHubHalo.rotation.z=t*0.38;
      nodeHubHalo.material.opacity=0.11+Math.sin(t*1.4)*0.04;
    }
    /* corona counter-rotate */
    nodeGroup.children.forEach(c => {
      if(c.userData.isCorona) {
        c.rotation.z=-t*0.18;
        c.material.opacity=0.045+Math.sin(t*0.9)*0.018;
      }
    });

    /* node idle breathe (not selected) */
    nodeObjects.forEach((mesh,i) => {
      if(i===selectedTool||mesh.scale.x<0.08) return;
      const bs=selectedTool>=0?0.65:1.0;
      mesh.scale.setScalar(bs*(1+Math.sin(t*1.5+i*1.1)*0.048));
    });

    /* ring spins */
    nodeRings.forEach((ring,i) => { ring.rotation.z=t*0.42+i; });

    /* outer halos breathe for selected */
    nodeGroup.children.forEach(c => {
      if(c.userData.isNodeHalo&&c.userData.toolId===selectedTool&&c.material.opacity>0.01) {
        c.rotation.z=-t*0.28+c.userData.toolId;
        c.material.opacity=0.22+Math.sin(t*2.2)*0.08;
      }
    });

    /* line pulse */
    nodeLines.forEach((line,i) => {
      if(i!==selectedTool) {
        const base=selectedTool>=0?0.04:0.22;
        line.material.opacity=base+Math.sin(t*1.2+i*0.7)*0.04;
      } else {
        /* selected line shimmer */
        line.material.opacity=0.72+Math.sin(t*3.5)*0.18;
      }
    });

    // nodeGroup rotation is handled by drag system in RAF when scene===1
    // (no override here — drag.spinY/X already applied above)
  }

  function tickIco(t) {
    icoWire.rotation.y=t*0.22; icoWire.rotation.x=t*0.14;
    icoCore.rotation.y=-t*0.16; icoCore.rotation.z=t*0.09;
    if(icoExploded) {
      icoPieces.forEach(p => {
        p.rotation.x+=p.userData.rotSpeed.x*0.014;
        p.rotation.y+=p.userData.rotSpeed.y*0.014;
        p.rotation.z+=p.userData.rotSpeed.z*0.014;
      });
    }
    icoGroup.rotation.y=mouseEased.x*0.22+t*0.008;
    icoGroup.rotation.x=mouseEased.y*0.12;
  }

  function tickDash(t) {
    dashGroup.children.forEach(c => {
      if(c.userData.basePos){
        const sp=c.userData.spd||0.4, bp=c.userData.basePos;
        c.position.y=bp.y+Math.sin(t*sp+bp.x)*0.20;
        if(c.userData.isRing) c.rotation[c.userData.rotAx]=t*sp*0.8;
        else { c.rotation.y=t*sp*0.5; c.rotation.x=t*sp*0.3; }
      }
    });

    // dashGroup has its own simple auto-rotate (drag moved to scene 1)
    dashGroup.rotation.y = mouseEased.x * 0.18 + t * 0.008;
    dashGroup.rotation.x = mouseEased.y * 0.10;
  }

  function tickPortal(t) {
    portalGroup.children.forEach(c => {
      if(c.userData.rotSpeed){
        c.rotation.z+=c.userData.rotSpeed*0.012;
        if(c.userData.baseOpacity) {
          c.material.opacity=c.userData.baseOpacity*(0.85+Math.sin(t*1.1+c.userData.rotSpeed)*0.18);
        }
      }
    });
    portalGroup.rotation.y=mouseEased.x*0.10+Math.sin(t*0.15)*0.04;
    portalGroup.rotation.x=mouseEased.y*0.07;
  }

  /* ══════════════════════════════════════════════════════════════
     EVENTS
  ══════════════════════════════════════════════════════════════ */
  function bindEvents() {
    /* mouse move — cursor + raycasting */
    window.addEventListener('mousemove', e => {
      mouse.x=(e.clientX/innerWidth)*2-1;
      mouse.y=(e.clientY/innerHeight)*2-1;
      mouseNDC.set(mouse.x,-mouse.y);
      const dot=document.getElementById('cursor-dot');
      const ring=document.getElementById('cursor-ring');
      if(dot){ dot.style.left=e.clientX+'px'; dot.style.top=e.clientY+'px'; }
      if(ring){ ring.style.left=e.clientX+'px'; ring.style.top=e.clientY+'px'; }
      const tip=document.getElementById('node-tooltip');
      if(tip?.classList.contains('visible')){ tip.style.left=(e.clientX+16)+'px'; tip.style.top=(e.clientY-10)+'px'; }
      checkNodeHover(e);
    },{passive:true});

    /* 3D node click */
    window.addEventListener('click', handleNodeClick);

    /* touch parallax */
    window.addEventListener('touchmove', e => {
      if(!e.touches[0]) return;
      mouse.x=(e.touches[0].clientX/innerWidth)*2-1;
      mouse.y=(e.touches[0].clientY/innerHeight)*2-1;
      mouseNDC.set(mouse.x,-mouse.y);

      // drag-to-spin on scene 1 (touch)
      if(drag.active && drag.touch && nodeGroup?.visible) {
        const dx = e.touches[0].clientX - drag.lastX;
        const dy = e.touches[0].clientY - drag.lastY;
        drag.velX = dx * 0.012;
        drag.velY = dy * 0.012;
        drag.spinY += drag.velX;
        drag.spinX += drag.velY;
        drag.lastX = e.touches[0].clientX;
        drag.lastY = e.touches[0].clientY;
      }
    },{passive:true});

    /* drag-to-spin — mouse (scene 1: particle sphere) */
    const canvas = document.getElementById('world-canvas');

    window.addEventListener('mousedown', e => {
      if(!nodeGroup?.visible) return;
      drag.active = true;
      drag.touch  = false;
      drag.lastX  = e.clientX;
      drag.lastY  = e.clientY;
      drag.velX   = 0;
      drag.velY   = 0;
      if(canvas) canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', e => {
      if(!drag.active || !nodeGroup?.visible) return;
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.velX   = dx * 0.010;
      drag.velY   = dy * 0.010;
      drag.spinY += drag.velX;
      drag.spinX += drag.velY;
      drag.lastX  = e.clientX;
      drag.lastY  = e.clientY;
    }, {passive:true});

    window.addEventListener('mouseup', () => {
      if(!drag.active) return;
      drag.active = false;
      if(canvas && nodeGroup?.visible) canvas.style.cursor = 'grab';
    });

    window.addEventListener('mouseleave', () => {
      drag.active = false;
    });

    /* drag-to-spin — touch (scene 1: particle sphere) */
    window.addEventListener('touchstart', e => {
      if(!nodeGroup?.visible || !e.touches[0]) return;
      drag.active = true;
      drag.touch  = true;
      drag.lastX  = e.touches[0].clientX;
      drag.lastY  = e.touches[0].clientY;
      drag.velX   = 0;
      drag.velY   = 0;
    }, {passive:true});

    window.addEventListener('touchend', () => {
      drag.active = false;
      drag.touch  = false;
    }, {passive:true});

    /* resize */
    window.addEventListener('resize', () => {
      camera.aspect=innerWidth/innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth,innerHeight);
    },{passive:true});

    /* UI tool node buttons — single click selects, double-click launches with hyper thrust */
    document.querySelectorAll('.tool-node').forEach(el => {
      let clickTimer = null;

      el.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const tId = parseInt(el.dataset.node);

        // Ripple on every click
        spawnRipple(el, e);

        if (clickTimer) {
          // ── DOUBLE-CLICK → hyper-thrust navigate ──────────────
          clearTimeout(clickTimer); clickTimer = null;
          if (activeScene === 1) launchToTool(tId, el, e);
          return;
        }

        // ── SINGLE-CLICK → select / highlight ──────────────────
        clickTimer = setTimeout(() => {
          clickTimer = null;
          if (activeScene === 1) selectTool(tId);
          else {
            document.getElementById('scene-tools')?.scrollIntoView({behavior:'smooth'});
            setTimeout(() => selectTool(tId), 800);
          }
        }, 240);
      });

      el.addEventListener('mouseenter', () => document.body.classList.add('cur-hover'));
      el.addEventListener('mouseleave', () => document.body.classList.remove('cur-hover'));
    });

    /* Feature fragments */
    document.querySelectorAll('.frag').forEach((el,i) => {
      el.addEventListener('click', e=>{ e.stopPropagation(); spawnRipple(el,e); handleFragClick(i); });
      el.addEventListener('mouseenter',()=>document.body.classList.add('cur-hover'));
      el.addEventListener('mouseleave',()=>document.body.classList.remove('cur-hover'));
    });

    /* HUD link */
    document.querySelector('.hud-link')?.addEventListener('mouseenter',()=>document.body.classList.add('cur-hover'));
    document.querySelector('.hud-link')?.addEventListener('mouseleave',()=>document.body.classList.remove('cur-hover'));

    /* Generic interactive elements — ripple + cursor */
    document.querySelectorAll('a,button,.btn-primary,.btn-ghost,.metric,.cta-brand').forEach(el => {
      el.addEventListener('mouseenter',()=>document.body.classList.add('cur-hover'));
      el.addEventListener('mouseleave',()=>document.body.classList.remove('cur-hover'));
      el.addEventListener('click', e => spawnRipple(el, e));
    });

    /* Smooth scroll for anchor links */
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const t=document.querySelector(a.getAttribute('href')); if(!t) return;
        e.preventDefault();
        t.scrollIntoView({behavior:'smooth',block:'start'});
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     RIPPLE + HYPER-THRUST NAVIGATION
  ══════════════════════════════════════════════════════════════ */

  /* Spawn a ripple ring at the click point inside an element */
  function spawnRipple(el, e) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e?.clientX ?? rect.left + rect.width / 2) - rect.left;
    const y = (e?.clientY ?? rect.top + rect.height / 2) - rect.top;
    const ring = document.createElement('span');
    ring.className = 'ripple-ring';
    ring.style.left = x + 'px';
    ring.style.top  = y + 'px';
    el.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove(), { once: true });
  }

  /* Hyper-thrust: flash white from click origin, then navigate */
  function launchToTool(toolId, el, e) {
    const url = TOOLS[toolId]?.url;
    if (!url) return;

    const overlay = document.getElementById('hyper-overlay');
    if (!overlay) { window.location.href = url; return; }

    // Calc click origin as % of viewport
    const cx = e ? (e.clientX / innerWidth  * 100).toFixed(1) + '%' : '50%';
    const cy = e ? (e.clientY / innerHeight * 100).toFixed(1) + '%' : '50%';
    overlay.style.setProperty('--ox', cx);
    overlay.style.setProperty('--oy', cy);

    // Play launch animation on the node itself
    el?.classList.add('launching');

    // Camera: thrust forward (FOV squeeze + zoom in)
    gsap.to(camera, { fov: 30, duration: 0.45, ease: 'power4.in',
      onUpdate: () => camera.updateProjectionMatrix() });
    gsap.to(camera.position, { z: camera.position.z - 3.5, duration: 0.45, ease: 'power4.in' });

    // Flash the overlay
    overlay.classList.remove('settle');
    overlay.classList.add('fire');

    // Navigate after the flash peaks
    setTimeout(() => { window.location.href = url; }, 420);
  }

  /* ══════════════════════════════════════════════════════════════
     LOADER
  ══════════════════════════════════════════════════════════════ */
  function runLoader() {
    const loader=document.getElementById('loader');
    const bar=document.querySelector('.loader-bar-fill');
    const status=document.querySelector('.loader-status');
    if(!loader) return;
    const stages=['Initializing','Loading Engine','Building Particles','Syncing Systems','Ready'];
    let p=0, si=0;
    const iv=setInterval(()=>{
      p=Math.min(p+7+Math.random()*16,100);
      if(bar) bar.style.width=p+'%';
      const s=Math.min(Math.floor(p/25),stages.length-1);
      if(s!==si){ si=s; if(status) status.textContent=stages[si]; }
      if(p>=100){
        clearInterval(iv);
        if(status) status.textContent='Ready';
        setTimeout(()=>{
          loader.classList.add('out');
          setTimeout(()=>{ activateScene(0); buildScrollTimeline(); },700);
        },380);
      }
    },90);
  }

  /* ══════════════════════════════════════════════════════════════
     ENTRY
  ══════════════════════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', waitDeps);

})();
