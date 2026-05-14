/* ════════════════════════════════════════════════════════════════
   SPECTRA — VIDEO GENERATOR FRONTEND  v2.0  (Studio Upgrade)
   Auth → Projects → Generate → Poll → Storyboard
   New: Model cards · Image upload · Style presets · Seed control
        Quality sliders · Enhance modes · Storyboard view toggle
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* ── STYLE PRESETS (mirrors backend STYLE_PRESETS) ───────────── */
const STYLE_PRESETS = [
  { id: 'neon_noir',         label: 'Neon Noir',          emoji: '🌃' },
  { id: 'golden_hour',       label: 'Golden Hour',         emoji: '🌅' },
  { id: 'studio_clean',      label: 'Studio Clean',        emoji: '💡' },
  { id: 'analog_grain',      label: 'Analog Film',         emoji: '📽' },
  { id: 'arctic_cold',       label: 'Arctic Cold',         emoji: '❄️' },
  { id: 'hyperreal',         label: 'Hyperreal',           emoji: '🔬' },
  { id: 'dreamlike',         label: 'Dreamlike',           emoji: '🌙' },
  { id: 'brutalist',         label: 'Brutalist',           emoji: '🏗' },
  { id: 'sunset_epic',       label: 'Sunset Epic',         emoji: '🔥' },
  { id: 'underwater',        label: 'Underwater',          emoji: '🌊' },
  { id: 'infrared',          label: 'Infrared',            emoji: '🔴' },
  { id: 'fashion_editorial', label: 'Fashion Editorial',   emoji: '✨' },
  { id: 'horror_dread',      label: 'Horror Dread',        emoji: '🕷' },
  { id: 'retro_wave',        label: 'Retrowave',           emoji: '🌐' },
  { id: 'nature_epic',       label: 'Nature Epic',         emoji: '🏔' },
  { id: 'minimalist',        label: 'Minimalist',          emoji: '⬜' },
  { id: 'smoke_haze',        label: 'Smoke & Haze',        emoji: '💨' },
  { id: 'raw_documentary',   label: 'Documentary',         emoji: '🎥' },
  { id: 'sci_fi_clinical',   label: 'Sci-Fi Clinical',     emoji: '🤖' },
  { id: 'western_dust',      label: 'Western Dust',        emoji: '🤠' },
];

/* ── MODEL DATA (mirrors backend HF_MODELS) ──────────────────── */
const HF_MODELS_DATA = [
  {
    id:             'higgsfield-ai/dop/lite',
    label:          'DoP Lite',
    desc:           'Fast image-to-video. Great for iterations.',
    speed:          'Fast',
    speedClass:     'fast',
    type:           'i2v',
    requires_image: true,
  },
  {
    id:             'higgsfield-ai/dop/standard',
    label:          'DoP Standard',
    desc:           'Balanced quality & speed. Best all-rounder.',
    speed:          'Balanced',
    speedClass:     'balanced',
    type:           'i2v',
    requires_image: true,
  },
  {
    id:             'higgsfield-ai/dop/turbo',
    label:          'DoP Turbo',
    desc:           'Maximum quality DoP generation.',
    speed:          'Quality',
    speedClass:     'quality',
    type:           'i2v',
    requires_image: true,
  },
  {
    id:             'kling-video/v2.1/pro/image-to-video',
    label:          'Kling 2.1 Pro',
    desc:           'Kling Pro — premium cinematic motion.',
    speed:          'Quality',
    speedClass:     'quality',
    type:           'i2v',
    requires_image: true,
  },
  {
    id:             'kling-video/v2.1/standard/image-to-video',
    label:          'Kling 2.1 Std',
    desc:           'Kling Standard — fast, reliable motion.',
    speed:          'Balanced',
    speedClass:     'balanced',
    type:           'i2v',
    requires_image: true,
  },
  {
    id:             'bytedance/seedance/v1/pro/image-to-video',
    label:          'Seedance Pro',
    desc:           'ByteDance Seedance Pro. High fidelity.',
    speed:          'Quality',
    speedClass:     'quality',
    type:           'i2v',
    requires_image: true,
  },
  {
    id:             'bytedance/seedance/v1/lite/image-to-video',
    label:          'Seedance Lite',
    desc:           'Seedance Lite — quick draft generations.',
    speed:          'Fast',
    speedClass:     'fast',
    type:           'i2v',
    requires_image: true,
  },
  {
    id:             'higgsfield-ai/soul/standard',
    label:          'Soul',
    desc:           'Text-to-image generation. No image needed.',
    speed:          'Balanced',
    speedClass:     'balanced',
    type:           't2v',
    requires_image: false,
  },
  {
    id:             'flux-pro/kontext/max/text-to-image',
    label:          'Flux Kontext',
    desc:           'Flux Pro — highest-detail image generation.',
    speed:          'Quality',
    speedClass:     'quality',
    type:           't2v',
    requires_image: false,
  },
];

/* ── MODELS REQUIRING IMAGE ──────────────────────────────────── */
const I2V_MODELS = new Set(
  HF_MODELS_DATA.filter(m => m.requires_image).map(m => m.id)
);

/* ── STATE ───────────────────────────────────────────────────── */
const VG = {
  user:            null,   // { id, email, tier, credits }
  projects:        [],
  activeProjectId: null,
  shots:           {},     // { [projectId]: Shot[] }
  pollTimers:      {},     // { [shotId]: intervalId }
  authMode:        'login',

  // Selection state
  selectedModel:   'higgsfield-ai/dop/standard',
  selectedAspect:  '16:9',
  selectedDur:     5,

  // New v2 state
  enhanceMode:     'cinematic',
  selectedPreset:  null,   // style preset id
  seedLocked:      false,
  uploadedImageKey: null,  // R2 key after upload
  uploadedImageUrl: null,  // /api/image/<key> or pasted URL

  // #3 — Character Continuity Lock
  lockedCharId:    null,
  lockedCharName:  null,
  lockedCharAvatar: null,

  // #5 — Style Memory (per-project localStorage)
  projectMemory:   {},  // { [projectId]: { model, aspect, duration, preset } }

  // Quality sliders
  quality: {
    motion: 5,
    style:  5,
    detail: 7,
  },

  // #8 — Campaign cache (H-6: loaded from D1, replaces localStorage)
  campaigns: [],

  // View
  storyboardView: 'grid', // 'grid' | 'strip'

  generating: false,

  // Transparent generation tracking
  shotStartTimes:  {},   // { [shotId]: Date.now() }
  shotElapsedTick: {},   // { [shotId]: intervalId }
  sessionCreditsUsed: 0, // credits burned this session
  lastGenerations: [],   // last 5 { model, duration, cost, label }
};

/* ── MODEL COST TABLE (credits per second of output) ─────────── */
const MODEL_COSTS = {
  'higgsfield-ai/dop/lite':                       { cps: 1.2, label: 'DoP Lite',     eta: 25  },
  'higgsfield-ai/dop/standard':                   { cps: 2.0, label: 'DoP Standard', eta: 45  },
  'higgsfield-ai/dop/turbo':                      { cps: 3.5, label: 'DoP Turbo',    eta: 60  },
  'kling-video/v2.1/pro/image-to-video':          { cps: 4.0, label: 'Kling 2.1 Pro',eta: 90  },
  'kling-video/v2.1/standard/image-to-video':     { cps: 2.2, label: 'Kling 2.1 Std',eta: 55  },
  'bytedance/seedance/v1/pro/image-to-video':     { cps: 3.8, label: 'Seedance Pro',  eta: 80  },
  'bytedance/seedance/v1/lite/image-to-video':    { cps: 1.8, label: 'Seedance Lite', eta: 35  },
  'higgsfield-ai/soul/standard':                  { cps: 1.0, label: 'Soul',          eta: 20  },
  'flux-pro/kontext/max/text-to-image':           { cps: 2.5, label: 'Flux Kontext',  eta: 30  },
};

function getShotCost(modelId, duration) {
  const m = MODEL_COSTS[modelId];
  if (!m) return null;
  return Math.round(m.cps * (duration || 5));
}
function getModelEta(modelId) {
  return MODEL_COSTS[modelId]?.eta ?? 60;
}

/* ── DOM REFS ────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

/* ── INIT ────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  renderModelCards();
  initModelPicker();
  renderStylePresets();
  initViewSwitcher();
  initAnalyticsControls();
  checkSession();
});

/* ═══════════════════════════════════════════════════════════════
   SESSION / AUTH
   ═══════════════════════════════════════════════════════════════ */

async function checkSession() {
  try {
    const res  = await api('GET', '/api/auth/me');
    const data = await res.json();
    if (res.ok && data.id) {
      VG.user = { id: data.id, email: data.email, tier: data.tier, credits: data.credits };
      enterApp();
    } else {
      showAuthGate();
    }
  } catch {
    showAuthGate();
  }
}

function showAuthGate() {
  $('vg-auth-gate').style.display = 'flex';
  $('vg-app').style.display       = 'none';
}

function hideAuthGate() {
  $('vg-auth-gate').style.display = 'none';
  $('vg-app').style.display       = 'flex';
}

function setAuthMode(mode) {
  VG.authMode = mode;
  $$('.vg-auth-tab').forEach(t => t.classList.toggle('active', t.dataset.authTab === mode));
  $('btn-auth-submit').textContent = mode === 'login' ? 'Sign In' : 'Create Account';
  const pwInput = $('auth-password');
  pwInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('auth-error').style.display = 'none';
}

async function handleAuth(e) {
  e.preventDefault();
  const email    = $('auth-email').value.trim();
  const password = $('auth-password').value;
  const errEl    = $('auth-error');
  const btn      = $('btn-auth-submit');

  errEl.style.display = 'none';
  btn.disabled        = true;
  btn.textContent     = VG.authMode === 'login' ? 'Signing in…' : 'Creating account…';

  try {
    const endpoint = VG.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const res      = await api('POST', endpoint, { email, password });
    const data     = await res.json();

    if (!res.ok) {
      errEl.textContent   = data.error || 'Something went wrong';
      errEl.style.display = 'block';
      btn.disabled        = false;
      btn.textContent     = VG.authMode === 'login' ? 'Sign In' : 'Create Account';
      return;
    }

    VG.user = data.user;
    enterApp();
  } catch {
    errEl.textContent   = 'Network error — please try again';
    errEl.style.display = 'block';
    btn.disabled        = false;
    btn.textContent     = VG.authMode === 'login' ? 'Sign In' : 'Create Account';
  }
}

async function enterApp() {
  hideAuthGate();
  updateKeyDot();
  await Promise.all([
    loadProjects(),
    fetchCampaigns(),
    checkKeyStatus(),
    loadSettingsInfo(),
  ]);
}

async function logout() {
  Object.values(VG.pollTimers).forEach(id => clearInterval(id));
  VG.pollTimers = {};

  await api('POST', '/api/auth/logout');
  VG.user            = null;
  VG.projects        = [];
  VG.activeProjectId = null;
  VG.shots           = {};
  VG.campaigns       = [];

  closeSettings();
  showAuthGate();
}

/* ═══════════════════════════════════════════════════════════════
   API HELPER
   ═══════════════════════════════════════════════════════════════ */

function api(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(path, opts);
}

/* ═══════════════════════════════════════════════════════════════
   KEY STATUS
   ═══════════════════════════════════════════════════════════════ */

async function checkKeyStatus() {
  try {
    const res  = await api('GET', '/api/keys/status');
    const data = await res.json();
    const has  = data?.higgsfield?.connected === true;

    const navDot = $('hf-key-dot');
    if (navDot) {
      navDot.classList.toggle('active',   has);
      navDot.classList.toggle('inactive', !has);
    }

    const statusEl = $('hf-key-status');
    const dotEl    = statusEl?.querySelector('.vg-key-dot');
    const textEl   = statusEl?.querySelector('.vg-key-status-text');
    if (dotEl)  dotEl.classList.toggle('active', has);
    if (textEl) textEl.textContent = has ? 'Connected' : 'Not set';
    return has;
  } catch {
    return false;
  }
}

function updateKeyDot() { checkKeyStatus(); }

async function saveKey(provider) {
  const input = $(`key-${provider}`);
  if (!input) return;

  const value = input.value.trim();
  if (!value) { showToast('Enter your API key first'); return; }

  const btn = document.querySelector(`[data-save-provider="${provider}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const res  = await api('POST', '/api/keys/save', { provider, key: value });
    const data = await res.json();
    if (res.ok) {
      input.value = '';
      input.type  = 'password';
      showToast('API key saved and encrypted ✓');
      await checkKeyStatus();
    } else {
      showToast(data.error || 'Failed to save key', true);
    }
  } catch {
    showToast('Network error', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS DRAWER
   ═══════════════════════════════════════════════════════════════ */

function openSettings() {
  $('settings-drawer').classList.add('open');
  $('settings-overlay').classList.add('open');
  loadSettingsInfo();
}

function closeSettings() {
  $('settings-drawer').classList.remove('open');
  $('settings-overlay').classList.remove('open');
}

async function loadSettingsInfo() {
  if (!VG.user) return;

  const infoEl = $('settings-account-info');
  if (infoEl) {
    infoEl.textContent = `${VG.user.email} · ${capitalize(VG.user.tier)} plan`;
  }

  const limitsEl = $('settings-limits');
  if (limitsEl) {
    const tierLimits = {
      free:    { projects: 1,   shots: 10,   label: 'Free' },
      creator: { projects: 5,   shots: 100,  label: 'Creator' },
      studio:  { projects: 25,  shots: 500,  label: 'Studio' },
      pro:     { projects: '∞', shots: '∞',  label: 'Pro' },
    };
    const lim = tierLimits[VG.user.tier] || tierLimits.free;
    limitsEl.innerHTML = `
      <div class="vg-limit-item">
        <div class="vg-limit-item-label">Plan</div>
        <div class="vg-limit-item-value">${lim.label}</div>
      </div>
      <div class="vg-limit-item">
        <div class="vg-limit-item-label">Projects</div>
        <div class="vg-limit-item-value">${lim.projects}</div>
      </div>
      <div class="vg-limit-item">
        <div class="vg-limit-item-label">Shots / mo</div>
        <div class="vg-limit-item-value">${lim.shots}</div>
      </div>
      <div class="vg-limit-item">
        <div class="vg-limit-item-label">Credits</div>
        <div class="vg-limit-item-value">${VG.user.credits ?? 0}</div>
      </div>`;
  }

  await checkKeyStatus();
}

/* ═══════════════════════════════════════════════════════════════
   MODEL CARDS
   ═══════════════════════════════════════════════════════════════ */

function renderModelCards() {
  const container = $('vg-model-cards');
  if (!container) return;

  // Group by type
  const i2v = HF_MODELS_DATA.filter(m => m.type === 'i2v');
  const t2v = HF_MODELS_DATA.filter(m => m.type === 't2v');

  function renderGroup(label, models) {
    return `
      <div class="vg-model-group-label">${label}</div>
      ${models.map(m => `
        <button class="vg-model-option ${m.id === VG.selectedModel ? 'active' : ''}"
                data-model-id="${escAttr(m.id)}" role="option"
                aria-selected="${m.id === VG.selectedModel}">
          <div class="vg-model-option-left">
            <span class="vg-model-option-name">${escHtml(m.label)}</span>
            <span class="vg-model-option-desc">${escHtml(m.desc)}</span>
          </div>
          <div class="vg-model-option-right">
            <span class="vg-model-speed-badge speed-${escAttr(m.speedClass)}">${escHtml(m.speed)}</span>
            <svg class="vg-model-option-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        </button>
      `).join('')}
    `;
  }

  container.innerHTML =
    renderGroup('Image → Video', i2v) +
    renderGroup('Text → Image', t2v);

  container.querySelectorAll('.vg-model-option').forEach(opt => {
    opt.addEventListener('click', () => {
      selectModel(opt.dataset.modelId);
      closeModelPicker();
    });
  });
}

function openModelPicker() {
  const trigger  = $('vg-model-trigger');
  const dropdown = $('vg-model-dropdown');
  const chevron  = $('vg-model-trigger-chevron');
  if (!dropdown || !trigger) return;

  // Position using fixed coords so sidebar overflow:auto can't clip it
  const rect = trigger.getBoundingClientRect();
  dropdown.style.top   = (rect.bottom + 4) + 'px';
  dropdown.style.left  = rect.left + 'px';
  dropdown.style.width = rect.width + 'px';

  dropdown.classList.add('open');
  dropdown.setAttribute('aria-hidden', 'false');
  trigger.setAttribute('aria-expanded', 'true');
  chevron?.classList.add('open');
}

function closeModelPicker() {
  const trigger  = $('vg-model-trigger');
  const dropdown = $('vg-model-dropdown');
  const chevron  = $('vg-model-trigger-chevron');
  if (!dropdown) return;
  dropdown.classList.remove('open');
  dropdown.setAttribute('aria-hidden', 'true');
  trigger?.setAttribute('aria-expanded', 'false');
  chevron?.classList.remove('open');
}

function initModelPicker() {
  const trigger = $('vg-model-trigger');
  if (!trigger) return;
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = $('vg-model-dropdown');
    if (dropdown?.classList.contains('open')) {
      closeModelPicker();
    } else {
      openModelPicker();
    }
  });
  // Close on outside click
  document.addEventListener('click', (e) => {
    const section = trigger.closest('.vg-model-picker-section');
    if (section && !section.contains(e.target)) {
      closeModelPicker();
    }
  });
}

function selectModel(modelId) {
  VG.selectedModel = modelId;

  // Update option active states
  $$('.vg-model-option').forEach(o => {
    const isActive = o.dataset.modelId === modelId;
    o.classList.toggle('active', isActive);
    o.setAttribute('aria-selected', isActive);
  });

  // Update trigger pill display
  const model = HF_MODELS_DATA.find(m => m.id === modelId);
  if (model) {
    const nameEl  = $('vg-model-trigger-name');
    const descEl  = $('vg-model-trigger-desc');
    const speedEl = $('vg-model-trigger-speed');
    if (nameEl)  nameEl.textContent  = model.label;
    if (descEl)  descEl.textContent  = model.desc;
    if (speedEl) {
      speedEl.textContent  = model.speed;
      speedEl.className    = `vg-model-trigger-speed speed-${model.speedClass}`;
    }
    // Update type badge
    const badge = $('vg-model-type-badge');
    if (badge) {
      badge.textContent = model.type.toUpperCase();
      badge.className   = `vg-model-type-badge ${model.type}`;
    }
  }

  // Update image block required/optional badges
  updateImageRequirement(modelId);

  // #5 — Save project memory when model changes
  saveProjectMemory(VG.activeProjectId);
}

function updateImageRequirement(modelId) {
  const isI2V   = I2V_MODELS.has(modelId);
  const reqBadge = $('vg-image-required-badge');
  const optBadge = $('vg-image-optional-badge');
  if (reqBadge) reqBadge.style.display = isI2V ? 'inline' : 'none';
  if (optBadge) optBadge.style.display = isI2V ? 'none'   : 'inline';
}

/* ═══════════════════════════════════════════════════════════════
   IMAGE UPLOAD SYSTEM
   ═══════════════════════════════════════════════════════════════ */

function initUploadZone() {
  const zone      = $('vg-upload-zone');
  const dropArea  = $('vg-upload-drop');
  const fileInput = $('vg-file-input');
  const browseBtn = $('btn-browse-image');
  const clearBtn  = $('btn-clear-image');
  const urlInput  = $('vg-image-url');

  if (!zone) return;

  // Browse button removed — label element handles file picker natively

  // File input change
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleFileUpload(file);
  });

  // Clear image
  clearBtn?.addEventListener('click', clearImage);

  // URL input → paste/blur to set image
  urlInput?.addEventListener('change', () => {
    const url = urlInput.value.trim();
    if (url) {
      VG.uploadedImageKey = null;
      VG.uploadedImageUrl = url;
      showUploadPreview(url);
    }
  });
  urlInput?.addEventListener('blur', () => {
    const url = urlInput.value.trim();
    if (url && !VG.uploadedImageUrl) {
      VG.uploadedImageKey = null;
      VG.uploadedImageUrl = url;
      showUploadPreview(url);
    }
  });

  // Drag and drop
  if (dropArea) {
    dropArea.addEventListener('dragover', e => {
      e.preventDefault();
      dropArea.classList.add('drag-over');
    });
    dropArea.addEventListener('dragleave', () => {
      dropArea.classList.remove('drag-over');
    });
    dropArea.addEventListener('drop', e => {
      e.preventDefault();
      dropArea.classList.remove('drag-over');
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith('image/')) {
        handleFileUpload(file);
      } else if (file) {
        showToast('Please drop an image file (JPEG, PNG, WebP, GIF)', true);
      }
    });
  }
}

async function handleFileUpload(file) {
  // Validate
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    showToast('Unsupported file type. Use JPEG, PNG, WebP, or GIF.', true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('File too large. Max 10MB.', true);
    return;
  }

  // Show local preview immediately
  const objectUrl = URL.createObjectURL(file);
  showUploadPreview(objectUrl, true); // isLoading=true

  // Upload to R2 via /api/upload
  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/upload', {
      method:      'POST',
      credentials: 'include',
      body:        formData,
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Upload failed', true);
      clearImage();
      return;
    }

    VG.uploadedImageKey = data.key;
    // Use absoluteUrl for Higgsfield (needs a public URL it can fetch)
    // Fall back to constructing one from relative url if absoluteUrl not returned
    VG.uploadedImageUrl = data.absoluteUrl || (window.location.origin + data.url);
    showUploadPreview(data.url);  // display uses relative path (fine for <img>)
    showToast('Image uploaded ✓');
  } catch {
    showToast('Upload failed — check connection', true);
    clearImage();
  }
}

function showUploadPreview(src, loading = false) {
  const preview = $('vg-upload-preview');
  const dropEl  = $('vg-upload-drop');
  const img     = $('vg-upload-img');

  if (preview) preview.style.display = 'flex';
  if (dropEl)  dropEl.style.display  = 'none';
  if (img) {
    img.src = src;
    img.style.opacity = loading ? '0.5' : '1';
  }
}

function clearImage() {
  VG.uploadedImageKey = null;
  VG.uploadedImageUrl = null;

  const preview   = $('vg-upload-preview');
  const dropEl    = $('vg-upload-drop');
  const img       = $('vg-upload-img');
  const urlInput  = $('vg-image-url');
  const fileInput = $('vg-file-input');

  if (preview) preview.style.display = 'none';
  if (dropEl)  dropEl.style.display  = 'flex';
  if (img)     img.src = '';
  if (urlInput) urlInput.value = '';
  if (fileInput) fileInput.value = '';
}

/* ═══════════════════════════════════════════════════════════════
   STYLE PRESETS
   ═══════════════════════════════════════════════════════════════ */

function renderStylePresets() {
  const container = $('vg-style-scroll');
  if (!container) return;

  container.innerHTML = STYLE_PRESETS.map(p => `
    <button class="vg-preset-chip ${p.id === VG.selectedPreset ? 'active' : ''}"
            data-preset-id="${p.id}" title="${escAttr(p.label)}">
      <span class="vg-preset-emoji">${p.emoji}</span>
      <span class="vg-preset-label">${escHtml(p.label)}</span>
    </button>
  `).join('');

  container.querySelectorAll('.vg-preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      togglePreset(chip.dataset.presetId);
      saveProjectMemory(VG.activeProjectId);
    });
  });

  // #6 — also render saved custom styles
  renderMyStyles();
}

function togglePreset(presetId) {
  // Toggle — clicking active preset deselects it
  VG.selectedPreset = VG.selectedPreset === presetId ? null : presetId;

  $$('.vg-preset-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.presetId === VG.selectedPreset);
  });
}

function clearPreset() {
  VG.selectedPreset = null;
  $$('.vg-preset-chip').forEach(c => c.classList.remove('active'));
}

/* ═══════════════════════════════════════════════════════════════
   ENHANCE MODES
   ═══════════════════════════════════════════════════════════════ */

const ENHANCE_MODE_LABELS = {
  cinematic:    'cinematic mode',
  realism:      'realism mode',
  motion:       'motion mode',
  storytelling: 'storytelling mode',
  camera:       'camera mode',
};

function setEnhanceMode(mode) {
  VG.enhanceMode = mode;
  $$('.vg-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const labelEl = $('enhance-mode-label');
  if (labelEl) labelEl.textContent = ENHANCE_MODE_LABELS[mode] || mode + ' mode';
}

/* ═══════════════════════════════════════════════════════════════
   SEED CONTROL
   ═══════════════════════════════════════════════════════════════ */

function randomizeSeed() {
  const seed     = Math.floor(Math.random() * 2147483647);
  const input    = $('vg-seed-input');
  if (input) input.value = seed;
  VG.seedLocked = false;
  updateLockIcon(false);
}

function toggleSeedLock() {
  VG.seedLocked = !VG.seedLocked;
  updateLockIcon(VG.seedLocked);

  if (VG.seedLocked) {
    // If no seed set, generate one on lock
    const input = $('vg-seed-input');
    if (input && !input.value) {
      input.value = Math.floor(Math.random() * 2147483647);
    }
    showToast('Seed locked — results will be reproducible');
  } else {
    showToast('Seed unlocked — randomized each generation');
  }
}

function updateLockIcon(locked) {
  const btn      = $('btn-lock-seed');
  const lockIcon = $('lock-icon');
  if (btn)      btn.classList.toggle('active', locked);
  if (lockIcon) lockIcon.setAttribute('stroke', locked ? 'var(--accent)' : 'currentColor');
}

function getCurrentSeed() {
  const input = $('vg-seed-input');
  const val   = input?.value?.trim();
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

/* ═══════════════════════════════════════════════════════════════
   QUALITY SLIDERS
   ═══════════════════════════════════════════════════════════════ */

function initQualitySliders() {
  const sliders = [
    { id: 'slider-motion', valId: 'val-motion', key: 'motion' },
    { id: 'slider-style',  valId: 'val-style',  key: 'style'  },
    { id: 'slider-detail', valId: 'val-detail', key: 'detail' },
  ];

  sliders.forEach(({ id, valId, key }) => {
    const slider = $(id);
    const valEl  = $(valId);
    if (!slider) return;

    // Set initial display
    slider.value = VG.quality[key];
    if (valEl) valEl.textContent = VG.quality[key];

    slider.addEventListener('input', () => {
      const v = parseInt(slider.value, 10);
      VG.quality[key] = v;
      if (valEl) valEl.textContent = v;
      // Update slider fill track CSS var
      updateSliderTrack(slider);
    });

    // Init track fill
    updateSliderTrack(slider);
  });
}

function updateSliderTrack(slider) {
  const min = parseInt(slider.min, 10) || 1;
  const max = parseInt(slider.max, 10) || 10;
  const val = parseInt(slider.value, 10);
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--fill', `${pct}%`);
}

function resetQuality() {
  VG.quality = { motion: 5, style: 5, detail: 7 };

  [
    { id: 'slider-motion', valId: 'val-motion', key: 'motion' },
    { id: 'slider-style',  valId: 'val-style',  key: 'style'  },
    { id: 'slider-detail', valId: 'val-detail', key: 'detail' },
  ].forEach(({ id, valId, key }) => {
    const slider = $(id);
    const valEl  = $(valId);
    if (slider) { slider.value = VG.quality[key]; updateSliderTrack(slider); }
    if (valEl)  valEl.textContent = VG.quality[key];
  });

  showToast('Quality reset to defaults');
}

function getQualityString() {
  const { motion, style, detail } = VG.quality;
  return `motion:${motion},style:${style},detail:${detail}`;
}

/* ═══════════════════════════════════════════════════════════════
   STORYBOARD VIEW TOGGLE
   ═══════════════════════════════════════════════════════════════ */

function toggleStoryboardView() {
  VG.storyboardView = VG.storyboardView === 'grid' ? 'strip' : 'grid';

  const grid     = $('vg-shot-grid');
  const iconEl   = $('view-toggle-icon');
  const btn      = $('btn-toggle-view');

  if (grid) {
    grid.classList.toggle('grid-view',  VG.storyboardView === 'grid');
    grid.classList.toggle('strip-view', VG.storyboardView === 'strip');
  }

  if (btn) btn.title = VG.storyboardView === 'grid' ? 'Switch to strip view' : 'Switch to grid view';

  // Swap icon between grid-squares and horizontal-strip
  if (iconEl) {
    if (VG.storyboardView === 'strip') {
      iconEl.innerHTML = `<line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>`;
    } else {
      iconEl.innerHTML = `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>`;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   PROJECTS
   ═══════════════════════════════════════════════════════════════ */

async function loadProjects() {
  const container = $('vg-project-selector');
  if (!container) return;

  container.innerHTML = '<div class="vg-project-loading">Loading…</div>';

  try {
    const res  = await api('GET', '/api/projects');
    const data = await res.json();
    if (!res.ok) {
      container.innerHTML = '<div class="vg-project-loading">Error loading projects</div>';
      return;
    }

    VG.projects = Array.isArray(data) ? data : (data.projects || []);
    renderProjectList();

    if (!VG.activeProjectId && VG.projects.length > 0) {
      selectProject(VG.projects[0].id);
    } else if (VG.projects.length === 0) {
      showEmptyState();
    }
  } catch {
    container.innerHTML = '<div class="vg-project-loading">Error loading projects</div>';
  }
}

function renderProjectList() {
  const container = $('vg-project-selector');
  if (!container) return;

  if (VG.projects.length === 0) {
    container.innerHTML = '<div class="vg-project-loading">No projects yet</div>';
    showEmptyState();
    return;
  }

  container.innerHTML = VG.projects.map(p => {
    const camp = p.campaign_id ? (VG.campaigns || []).find(c => c.id === p.campaign_id) : null;
    return `
    <div class="vg-project-row">
      <button class="vg-project-item ${p.id === VG.activeProjectId ? 'active' : ''}"
              data-project-id="${p.id}">
        <span class="vg-project-item-pip"></span>
        <span class="vg-project-item-name">${escHtml(p.name)}</span>
        <span class="vg-project-item-right">
          ${camp ? `<span class="vg-project-campaign-tag" title="Campaign: ${escAttr(camp.name)}"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></span>` : ''}
          <span class="vg-project-item-shots">${p.shot_count ?? 0}s</span>
        </span>
      </button>
      <button class="vg-project-delete-btn" data-delete-id="${p.id}" title="Delete project" aria-label="Delete project">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
  }).join('');

  container.querySelectorAll('.vg-project-item').forEach(btn => {
    btn.addEventListener('click', () => selectProject(btn.dataset.projectId));
  });

  container.querySelectorAll('.vg-project-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteProject(btn.dataset.deleteId);
    });
  });

  // #8 — refresh campaign list alongside project list
  renderCampaigns();
}

async function selectProject(id) {
  VG.activeProjectId = id;
  renderProjectList();

  const project = VG.projects.find(p => p.id === id);
  if (!project) return;

  // Update board header
  const header = $('vg-board-header');
  if (header) {
    header.style.display = 'flex';
    const nameEl = $('vg-current-project-name');
    if (nameEl) nameEl.textContent = project.name;
  }

  // #5 — Style Memory: restore saved settings for this project
  const memoryRestored = applyProjectMemory(id);
  if (!memoryRestored && project.default_model) {
    selectModel(project.default_model);
  }

  // #7 — Bible active indicator
  updateBibleIndicator(id);

  // #3 — Clear char lock when switching projects
  VG.lockedCharId     = null;
  VG.lockedCharName   = null;
  VG.lockedCharAvatar = null;
  renderCharLockBanner();

  // Hide empty, show grid
  $('vg-empty').style.display    = 'none';
  $('vg-shot-grid').style.display = 'grid';

  await loadShots(id);
  await renderCharacters(id);
}

function showEmptyState() {
  $('vg-empty').style.display    = 'flex';
  $('vg-shot-grid').style.display = 'none';
  const header = $('vg-board-header');
  if (header) header.style.display = 'none';
}

async function deleteProject(projectId) {
  const project = VG.projects.find(p => p.id === projectId);
  if (!project) return;

  const confirmed = confirm(`Delete "${project.name}"?\n\nThis will permanently remove the project and all its shots. This cannot be undone.`);
  if (!confirmed) return;

  try {
    const res = await api('DELETE', `/api/projects/${projectId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to delete project', 'error');
      return;
    }

    // Remove from local array
    VG.projects = VG.projects.filter(p => p.id !== projectId);

    // Clean up any cached shots
    delete VG.shots[projectId];

    // If the deleted project was active, switch to next available or show empty state
    if (VG.activeProjectId === projectId) {
      VG.activeProjectId = null;
      if (VG.projects.length > 0) {
        renderProjectList();
        await selectProject(VG.projects[0].id);
      } else {
        renderProjectList();
        showEmptyState();
      }
    } else {
      renderProjectList();
    }

    showToast(`Project "${project.name}" deleted`, 'info');
  } catch (err) {
    console.error('deleteProject error:', err);
    showToast('Failed to delete project', 'error');
  }
}

async function loadShots(projectId) {
  try {
    const res  = await api('GET', `/api/projects/${projectId}`);
    const data = await res.json();
    if (!res.ok) return;

    const shots = data.shots || [];
    VG.shots[projectId] = shots;

    const countEl = $('vg-project-shot-count');
    if (countEl) countEl.textContent = `${shots.length} shot${shots.length !== 1 ? 's' : ''}`;

    const proj = VG.projects.find(p => p.id === projectId);
    if (proj) proj.shot_count = shots.length;

    renderShotGrid(projectId);

    shots.forEach(shot => {
      if (shot.status === 'queued' || shot.status === 'in_progress') {
        startPolling(shot.id, projectId);
      }
    });
  } catch (err) {
    console.error('loadShots error:', err);
  }
}

/* ═══════════════════════════════════════════════════════════════
   SHOT GRID RENDER
   ═══════════════════════════════════════════════════════════════ */

function renderShotGrid(projectId) {
  const grid = $('vg-shot-grid');
  if (!grid) return;

  const shots = VG.shots[projectId] || [];

  if (shots.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:3rem 1rem;color:var(--text-muted);font-size:0.82rem">
        No shots yet — write a prompt and hit Generate Shot
      </div>`;
    return;
  }

  // Sort by sort_order (item 4), then creation date as fallback
  const sorted = [...shots].sort((a, b) => {
    if (a.sort_order != null && b.sort_order != null) return a.sort_order - b.sort_order;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  // Render cards with draggable attribute (Item 4)
  grid.innerHTML = sorted.map(shot => renderShotCard(shot, true)).join('');

  // Bind shot actions
  grid.querySelectorAll('[data-shot-id]').forEach(el => {
    const shotId = el.dataset.shotId;
    const action = el.dataset.action;
    if (!action) return;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (action === 'delete')     deleteShot(shotId, projectId);
      if (action === 'copy')       copyPrompt(shotId, projectId);
      if (action === 'download')   downloadShot(shotId, projectId);
      if (action === 'play')       playShot(shotId, projectId);
      if (action === 'continue')   continueFromShot(el);
      if (action === 'distribute') distributeShot(el);
      if (action === 'compare')    addShotToCompare(el);
    });
  });

  // Init drag-and-drop (Item 4)
  initDragAndDrop(grid);
}

function renderShotCard(shot, draggable = false) {
  const statusDotClass = {
    queued:      'dot-queued',
    in_progress: 'dot-progress',
    completed:   'dot-done',
    failed:      'dot-failed',
    nsfw:        'dot-failed',
  }[shot.status] || 'dot-failed';

  const statusLabel = {
    queued:      'Queued',
    in_progress: 'Rendering',
    completed:   'Done',
    failed:      'Failed',
    nsfw:        'Blocked',
  }[shot.status] || shot.status;

  const modelShort = (shot.model || '').split('/').pop() || '';

  const thumbContent = (() => {
    if (shot.status === 'completed' && (shot.video_url || shot.hf_video_url)) {
      const videoUrl = shot.video_url || shot.hf_video_url;
      return `
        <video src="${escAttr(videoUrl)}" muted loop preload="metadata"
               onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"
               style="width:100%;height:100%;object-fit:cover;display:block"></video>
        <div class="vg-shot-play">
          <button class="vg-shot-play-btn" data-shot-id="${shot.id}" data-action="play" title="Play full screen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
        </div>`;
    }
    const icons = {
      queued:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
      in_progress: `<svg class="vg-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>`,
      failed:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      nsfw:        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    };
    const icon = icons[shot.status] || icons.failed;

    // For queued/in_progress: show rich progress overlay
    if (shot.status === 'queued' || shot.status === 'in_progress') {
      const cost = getShotCost(shot.model, shot.duration);
      const eta  = getModelEta(shot.model);
      return `
        <div class="vg-shot-status-overlay vg-shot-generating">
          <div class="vg-shot-gen-top">
            <div class="vg-shot-gen-spinner">${icon}</div>
            <div class="vg-shot-gen-info">
              <span class="vg-shot-gen-status">${shot.status === 'queued' ? 'Queued' : 'Rendering'}</span>
              <span class="vg-shot-elapsed" data-shot-id="${shot.id}">0s</span>
            </div>
            ${cost ? `<span class="vg-shot-cost-badge">${cost} cr</span>` : ''}
          </div>
          <div class="vg-shot-progress-bar">
            <div class="vg-shot-progress-bar-fill" style="width:0%"></div>
          </div>
          <span class="vg-shot-eta">~${eta}s left</span>
        </div>`;
    }

    return `
      <div class="vg-shot-status-overlay">
        <div class="vg-shot-status-icon">${icon}</div>
        <div class="vg-shot-status-label">${statusLabel}</div>
      </div>`;
  })();

  const videoUrl = shot.video_url || shot.hf_video_url || '';

  // Build seed/style tags
  const tags = [];
  if (shot.seed != null) {
    tags.push(`<span class="vg-shot-tag tag-seed">seed:${shot.seed}</span>`);
  }
  if (shot.style_preset) {
    const preset = STYLE_PRESETS.find(p => p.id === shot.style_preset);
    const label  = preset ? preset.label : shot.style_preset;
    tags.push(`<span class="vg-shot-tag tag-style">${escHtml(label)}</span>`);
  }
  const tagsHtml = tags.length ? `<div class="vg-shot-tags">${tags.join('')}</div>` : '';

  return `
    <article class="vg-shot-card" data-status="${shot.status}" data-shot-id="${shot.id}"${draggable ? ' draggable="true"' : ''}>
      ${draggable ? `<div class="vg-shot-drag-handle" title="Drag to reorder">
        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" opacity="0.4"><circle cx="7" cy="4" r="1.5"/><circle cx="13" cy="4" r="1.5"/><circle cx="7" cy="10" r="1.5"/><circle cx="13" cy="10" r="1.5"/><circle cx="7" cy="16" r="1.5"/><circle cx="13" cy="16" r="1.5"/></svg>
      </div>` : ''}
      <div class="vg-shot-thumb">
        ${thumbContent}
        <span class="vg-shot-aspect-badge">${escHtml(shot.aspect_ratio || '16:9')}</span>
        <span class="vg-shot-model-badge">${escHtml(modelShort)}</span>
        <span class="vg-shot-status-dot ${statusDotClass}" title="${statusLabel}"></span>
      </div>
      <div class="vg-shot-body">
        <p class="vg-shot-prompt">${escHtml(shot.prompt || '')}</p>
        ${tagsHtml}
        <div class="vg-shot-meta">
          <span class="vg-shot-time">${timeAgo(shot.created_at)}</span>
          <div class="vg-shot-actions">
            ${videoUrl ? `
            <button class="vg-shot-action-btn vg-shot-continue-btn" data-shot-id="${shot.id}" data-action="continue" data-video-url="${escAttr(videoUrl)}" data-prompt="${escAttr(shot.prompt || '')}" title="Continue from last frame — use final frame as next reference">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="5 9 2 12 5 15"/><path d="M22 4v7a4 4 0 01-4 4H2"/></svg>
              Continue
            </button>` : ''}
            ${videoUrl ? `
            <button class="vg-shot-action-btn vg-shot-distribute-btn" data-shot-id="${shot.id}" data-action="distribute" data-video-url="${escAttr(videoUrl)}" data-project-id="${escAttr(VG.activeProjectId || '')}" data-project-name="${escAttr(VG.projects.find(p=>p.id===VG.activeProjectId)?.name || '')}" title="Distribute — publish to Instagram or YouTube">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
              Distribute
            </button>` : ''}
            <button class="vg-shot-action-btn vg-shot-compare-btn" data-shot-id="${shot.id}" data-action="compare" data-video-url="${escAttr(videoUrl)}" data-prompt="${escAttr(shot.prompt || '')}" title="Add to Compare — open A/B viewer with this shot">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="9" height="18" rx="1"/><rect x="13" y="3" width="9" height="18" rx="1"/></svg>
            </button>
            <button class="vg-shot-action-btn" data-shot-id="${shot.id}" data-action="copy" title="Copy prompt">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
            ${videoUrl ? `
            <button class="vg-shot-action-btn vg-shot-dl-btn" data-shot-id="${shot.id}" data-action="download" title="Download">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>` : ''}
            <button class="vg-shot-action-btn delete" data-shot-id="${shot.id}" data-action="delete" title="Delete">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    </article>`;
}

/* ═══════════════════════════════════════════════════════════════
   SHOT POLLING
   ═══════════════════════════════════════════════════════════════ */

function startPolling(shotId, projectId) {
  if (VG.pollTimers[shotId]) return;

  // Start elapsed timer for this shot
  if (!VG.shotStartTimes[shotId]) {
    VG.shotStartTimes[shotId] = Date.now();
  }
  // Tick every second to update elapsed display
  VG.shotElapsedTick[shotId] = setInterval(() => {
    updateShotElapsed(shotId);
  }, 1000);

  VG.pollTimers[shotId] = setInterval(async () => {
    try {
      const res  = await api('GET', `/api/shots/${shotId}/status`);
      const data = await res.json();

      if (!res.ok) {
        clearInterval(VG.pollTimers[shotId]);
        delete VG.pollTimers[shotId];
        return;
      }

      if (VG.shots[projectId]) {
        const idx = VG.shots[projectId].findIndex(s => s.id === shotId);
        if (idx !== -1) {
          VG.shots[projectId][idx] = { ...VG.shots[projectId][idx], ...data };
        }
      }

      updateShotCardInDOM(shotId, data);

      if (data.status === 'completed' || data.status === 'failed' || data.status === 'nsfw') {
        clearInterval(VG.pollTimers[shotId]);
        delete VG.pollTimers[shotId];
        // Stop elapsed timer
        clearInterval(VG.shotElapsedTick[shotId]);
        delete VG.shotElapsedTick[shotId];
        delete VG.shotStartTimes[shotId];
        await loadShots(projectId);
      }
    } catch (err) {
      console.error('Poll error for shot', shotId, err);
    }
  }, 4000);
}

function updateShotElapsed(shotId) {
  const card = document.querySelector(`.vg-shot-card[data-shot-id="${shotId}"]`);
  if (!card) return;
  const timerEl = card.querySelector('.vg-shot-elapsed');
  const etaEl   = card.querySelector('.vg-shot-eta');
  const barEl   = card.querySelector('.vg-shot-progress-bar-fill');
  if (!timerEl) return;

  const start   = VG.shotStartTimes[shotId];
  if (!start) return;
  const elapsed = Math.floor((Date.now() - start) / 1000);
  const mins    = Math.floor(elapsed / 60);
  const secs    = elapsed % 60;
  timerEl.textContent = mins > 0
    ? `${mins}m ${String(secs).padStart(2,'0')}s`
    : `${secs}s`;

  // ETA
  const shot = Object.values(VG.shots).flat().find(s => s.id === shotId);
  const eta  = getModelEta(shot?.model || '');
  const remaining = Math.max(0, eta - elapsed);
  if (etaEl) {
    etaEl.textContent = remaining > 0 ? `~${remaining}s left` : 'finishing…';
  }
  // Progress bar
  if (barEl) {
    const pct = Math.min(95, Math.round((elapsed / eta) * 100));
    barEl.style.width = pct + '%';
  }
}

function updateShotCardInDOM(shotId, data) {
  const card = document.querySelector(`.vg-shot-card[data-shot-id="${shotId}"]`);
  if (!card) return;

  card.dataset.status = data.status;

  // Update status dot
  const dot = card.querySelector('.vg-shot-status-dot');
  if (dot) {
    dot.className = `vg-shot-status-dot ${({
      queued:      'dot-queued',
      in_progress: 'dot-progress',
      completed:   'dot-done',
      failed:      'dot-failed',
      nsfw:        'dot-failed',
    }[data.status] || 'dot-failed')}`;
  }

  const thumb = card.querySelector('.vg-shot-thumb');
  if (!thumb) return;

  if (data.status === 'completed') {
    const videoUrl = data.video_url || data.hf_video_url || '';
    if (videoUrl) {
      thumb.querySelector('.vg-shot-status-overlay')?.remove();
      if (!thumb.querySelector('video')) {
        const vid = document.createElement('video');
        vid.src          = videoUrl;
        vid.muted        = true;
        vid.loop         = true;
        vid.preload      = 'metadata';
        vid.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        vid.addEventListener('mouseenter', () => vid.play());
        vid.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });
        thumb.insertBefore(vid, thumb.firstChild);

        const playDiv = document.createElement('div');
        playDiv.className = 'vg-shot-play';
        playDiv.innerHTML = `<button class="vg-shot-play-btn" title="Play full screen">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>`;
        playDiv.querySelector('.vg-shot-play-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          playShot(shotId, VG.activeProjectId);
        });
        thumb.appendChild(playDiv);
      }

      const body  = card.querySelector('.vg-shot-actions');
      const hasDl = body?.querySelector('.vg-shot-dl-btn');
      if (body && !hasDl) {
        const dlBtn = document.createElement('button');
        dlBtn.className = 'vg-shot-action-btn vg-shot-dl-btn';
        dlBtn.title     = 'Download';
        dlBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
        dlBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadShot(shotId, VG.activeProjectId); });
        const delBtn = body.querySelector('.delete');
        if (delBtn) body.insertBefore(dlBtn, delBtn);
      }
    }
  } else if (data.status === 'failed' || data.status === 'nsfw') {
    const overlay = thumb.querySelector('.vg-shot-status-overlay');
    if (overlay) {
      const icon  = overlay.querySelector('.vg-shot-status-icon');
      const label = overlay.querySelector('.vg-shot-status-label');
      if (icon)  icon.innerHTML  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
      if (label) label.textContent = data.status === 'nsfw' ? 'Blocked' : 'Failed';
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   GENERATE
   ═══════════════════════════════════════════════════════════════ */

async function generate() {
  if (VG.generating) return;
  if (!VG.activeProjectId) { showToast('Select a project first', true); return; }

  const prompt   = $('vg-prompt').value.trim();
  const model    = VG.selectedModel;

  if (!prompt) { showToast('Enter a shot prompt', true); return; }

  // Get image URL: prefer uploaded R2 key URL, fall back to pasted URL input
  const urlInput  = $('vg-image-url');
  const imageUrl  = VG.uploadedImageUrl || urlInput?.value?.trim() || '';

  // Validate image required for i2v
  if (I2V_MODELS.has(model) && !imageUrl) {
    showToast('This model requires a reference image', true);
    $('vg-upload-zone')?.classList.add('shake');
    setTimeout(() => $('vg-upload-zone')?.classList.remove('shake'), 500);
    return;
  }

  VG.generating = true;
  const btn = $('btn-generate');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = `<span class="vg-spinner"></span> Submitting…`;

  // Get seed
  const seed = getCurrentSeed();
  if (!VG.seedLocked && $('vg-seed-input')) {
    // Generate and display a new random seed for non-locked state
    if (!$('vg-seed-input').value) {
      const newSeed = Math.floor(Math.random() * 2147483647);
      $('vg-seed-input').value = newSeed;
    }
  }

  try {
    const payload = {
      project_id:   VG.activeProjectId,
      prompt,
      model,
      aspect_ratio: VG.selectedAspect,
      duration:     VG.selectedDur,
      enhance_mode: VG.enhanceMode,
    };

    if (imageUrl)          payload.image_url    = imageUrl;
    if (seed != null)      payload.seed         = seed;
    if (VG.selectedPreset) payload.style_preset = VG.selectedPreset;
    if (VG.quality)        payload.quality      = getQualityString();

    const res  = await api('POST', '/api/generate', payload);
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Generation failed', true);
      return;
    }

    const newShot = {
      id:              data.shot_id,
      project_id:      VG.activeProjectId,
      prompt,
      prompt_raw:      prompt,
      prompt_enhanced: data.prompt_enhanced || prompt,
      model,
      aspect_ratio:    VG.selectedAspect,
      duration:        VG.selectedDur,
      status:          data.status || 'queued',
      hf_request_id:   data.request_id,
      video_url:       null,
      hf_video_url:    null,
      seed:            data.seed ?? seed,
      style_preset:    data.style_preset || VG.selectedPreset || null,
      quality:         payload.quality || null,
      created_at:      new Date().toISOString(),
    };

    if (!VG.shots[VG.activeProjectId]) VG.shots[VG.activeProjectId] = [];
    VG.shots[VG.activeProjectId].unshift(newShot);

    $('vg-empty').style.display    = 'none';
    $('vg-shot-grid').style.display = 'grid';
    renderShotGrid(VG.activeProjectId);

    if (newShot.id) startPolling(newShot.id, VG.activeProjectId);

    // Track cost + session history
    const cost = getShotCost(model, VG.selectedDur);
    if (cost) {
      VG.sessionCreditsUsed += cost;
      VG.lastGenerations.unshift({ model, duration: VG.selectedDur, cost, label: MODEL_COSTS[model]?.label || model });
      if (VG.lastGenerations.length > 5) VG.lastGenerations.pop();
      updateCreditWidget();
    }

    showToast('Shot queued — keep composing while it renders');

    // Clear prompt and unlock seed for next shot — don't block the user
    $('vg-prompt').value = '';
    updateCharCount();
    if (!VG.seedLocked) {
      const seedInput = $('vg-seed-input');
      if (seedInput) seedInput.value = '';
    }

    await updateUsageBar();
  } catch {
    showToast('Network error — try again', true);
  } finally {
    // Re-enable immediately — user can queue another shot right away
    VG.generating = false;
    btn.disabled  = false;
    btn.classList.remove('loading');
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Generate Shot`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   ENHANCE PROMPT
   ═══════════════════════════════════════════════════════════════ */

async function enhancePrompt() {
  const textarea = $('vg-prompt');
  const prompt   = textarea?.value.trim();
  if (!prompt) { showToast('Enter a prompt to enhance', true); return; }

  const btn = $('btn-enhance-prompt');
  btn.disabled  = true;
  btn.innerHTML = `<span class="vg-spinner"></span> Enhancing…`;

  try {
    const payload = {
      prompt,
      model:        VG.selectedModel,
      aspect_ratio: VG.selectedAspect,
      mode:         VG.enhanceMode,
    };
    if (VG.selectedPreset) payload.style_preset = VG.selectedPreset;

    // #7 — inject style bible from active project
    const activeProject = VG.projects.find(p => p.id === VG.activeProjectId);
    if (activeProject?.style_bible) {
      const bible = typeof activeProject.style_bible === 'string'
        ? tryParseJSON(activeProject.style_bible)
        : activeProject.style_bible;
      if (bible && Object.values(bible).some(v => v)) {
        payload.style_bible = bible;
      }
    }

    const res  = await api('POST', '/api/enhance-prompt', payload);
    const data = await res.json();

    if (res.ok && data.enhanced) {
      textarea.value = data.enhanced;
      updateCharCount();
      showToast(`Prompt enhanced · ${VG.enhanceMode} mode ✓`);
    } else {
      showToast(data.error || 'Enhancement failed', true);
    }
  } catch {
    showToast('Network error', true);
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Enhance`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   CREDIT INTELLIGENCE WIDGET
   ═══════════════════════════════════════════════════════════════ */

function updateCreditWidget() {
  const widget  = $('vg-credit-widget');
  const totalEl = $('vg-cw-total');
  const histEl  = $('vg-cw-history');
  const tipEl   = $('vg-cw-tip');
  if (!widget) return;

  if (VG.lastGenerations.length === 0) { widget.style.display = 'none'; return; }
  widget.style.display = 'block';

  if (totalEl) totalEl.textContent = `${VG.sessionCreditsUsed} cr used`;

  if (histEl) {
    histEl.innerHTML = VG.lastGenerations.map(g => `
      <div class="vg-cw-row">
        <span class="vg-cw-model">${g.label}</span>
        <span class="vg-cw-dur">${g.duration}s</span>
        <span class="vg-cw-cost">${g.cost} cr</span>
      </div>`).join('');
  }

  // Smart tip — suggest cheaper model if user picked an expensive one
  if (tipEl) {
    const last = VG.lastGenerations[0];
    const cheaperModels = Object.entries(MODEL_COSTS)
      .filter(([id, m]) => m.cps < (MODEL_COSTS[last?.model]?.cps || 0))
      .sort((a,b) => a[1].cps - b[1].cps);
    if (cheaperModels.length && last) {
      const [cheapId, cheapInfo] = cheaperModels[0];
      const saving = last.cost - getShotCost(cheapId, last.duration);
      tipEl.style.display = 'flex';
      tipEl.innerHTML = `
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        <span><strong>${cheapInfo.label}</strong> saves ~${saving} cr per shot for similar results</span>`;
    } else {
      tipEl.style.display = 'none';
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   USAGE BAR
   ═══════════════════════════════════════════════════════════════ */

async function updateUsageBar() {
  if (!VG.user) return;
  const tierShots = { free: 10, creator: 100, studio: 500, pro: 999999 };
  const limit     = tierShots[VG.user.tier] || 10;

  let thisMonth    = 0;
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  Object.values(VG.shots).forEach(shots => {
    shots.forEach(s => {
      if (new Date(s.created_at) >= monthStart) thisMonth++;
    });
  });

  const pct     = limit === 999999 ? 0 : Math.min((thisMonth / limit) * 100, 100);
  const fillEl  = $('vg-usage-fill');
  const labelEl = $('vg-usage-label');
  if (fillEl)  fillEl.style.width = `${pct}%`;
  if (labelEl) {
    labelEl.textContent = limit === 999999
      ? `${thisMonth} shots this month (unlimited)`
      : `${thisMonth} / ${limit} shots this month`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   SHOT ACTIONS
   ═══════════════════════════════════════════════════════════════ */

async function deleteShot(shotId, projectId) {
  if (!confirm('Delete this shot?')) return;

  try {
    const res = await api('DELETE', `/api/shots/${shotId}`);
    if (res.ok) {
      if (VG.pollTimers[shotId]) {
        clearInterval(VG.pollTimers[shotId]);
        delete VG.pollTimers[shotId];
      }
      if (VG.shots[projectId]) {
        VG.shots[projectId] = VG.shots[projectId].filter(s => s.id !== shotId);
      }
      const proj = VG.projects.find(p => p.id === projectId);
      if (proj && proj.shot_count > 0) proj.shot_count--;

      renderShotGrid(projectId);
      const countEl = $('vg-project-shot-count');
      if (countEl) {
        const cnt = (VG.shots[projectId] || []).length;
        countEl.textContent = `${cnt} shot${cnt !== 1 ? 's' : ''}`;
      }
      showToast('Shot deleted');
    } else {
      showToast('Failed to delete shot', true);
    }
  } catch {
    showToast('Network error', true);
  }
}

function copyPrompt(shotId, projectId) {
  const shot = (VG.shots[projectId] || []).find(s => s.id === shotId);
  if (!shot?.prompt) return;
  navigator.clipboard.writeText(shot.prompt).then(() => showToast('Prompt copied'));
}

function downloadShot(shotId, projectId) {
  const shot = (VG.shots[projectId] || []).find(s => s.id === shotId);
  const url  = shot?.video_url || shot?.hf_video_url;
  if (!url) { showToast('No video available yet', true); return; }

  const a    = document.createElement('a');
  a.href     = url;
  a.download = `spectra-shot-${shotId.slice(0, 8)}.mp4`;
  a.target   = '_blank';
  a.rel      = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function playShot(shotId, projectId) {
  const shot = (VG.shots[projectId] || []).find(s => s.id === shotId);
  const url  = shot?.video_url || shot?.hf_video_url;
  if (!url) return;

  let overlay = $('vg-player-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'vg-player-overlay';
    overlay.innerHTML = `
      <video id="vg-player-video" controls autoplay></video>
      <button id="vg-player-close" title="Close">✕</button>`;
    document.body.appendChild(overlay);
    $('vg-player-close').addEventListener('click', closePlayer);
    overlay.addEventListener('click', e => { if (e.target === overlay) closePlayer(); });
  }

  const vid = $('vg-player-video');
  vid.src   = url;
  overlay.classList.add('open');
  vid.play().catch(() => {});
}

function closePlayer() {
  const overlay = $('vg-player-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  const vid = $('vg-player-video');
  if (vid) { vid.pause(); vid.src = ''; }
}

/* ═══════════════════════════════════════════════════════════════
   NEW PROJECT MODAL
   ═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   NEW PROJECT MODAL — GUIDED USE-CASE FLOW
   ═══════════════════════════════════════════════════════════════ */

const USE_CASE_CONFIGS = {
  commercial: {
    label:       '📺 Commercial',
    model:       'kling-video/v2.1/pro/image-to-video',
    aspect:      '16:9',
    duration:    8,
    style:       'Clean, polished, professional',
    mood:        'Confident, aspirational',
    palette:     'Brand-focused, high contrast',
    promptHint:  'Product hero shot, brand reveal, call to action',
  },
  music_video: {
    label:       '🎵 Music Video',
    model:       'higgsfield-ai/dop/turbo',
    aspect:      '16:9',
    duration:    8,
    style:       'Stylized, visually expressive',
    mood:        'Emotional, dynamic, immersive',
    palette:     'Vivid, saturated, mood-driven',
    promptHint:  'Artist performance, abstract visuals, rhythm-driven cuts',
  },
  fashion: {
    label:       '👗 Fashion Ad',
    model:       'higgsfield-ai/dop/standard',
    aspect:      '9:16',
    duration:    5,
    style:       'Editorial, high-fashion, minimalist',
    mood:        'Sophisticated, aspirational, sleek',
    palette:     'Neutral tones, luxury accents',
    promptHint:  'Model walking, garment detail close-up, runway atmosphere',
  },
  character: {
    label:       '🎭 Character Scene',
    model:       'kling-video/v2.1/pro/image-to-video',
    aspect:      '16:9',
    duration:    8,
    style:       'Cinematic, character-driven',
    mood:        'Narrative, emotionally resonant',
    palette:     'Dramatic lighting, motivated color',
    promptHint:  'Character reaction shot, emotional moment, scene dialogue',
  },
  product: {
    label:       '📦 Product Showcase',
    model:       'higgsfield-ai/dop/standard',
    aspect:      '1:1',
    duration:    5,
    style:       'Clean, studio, product-focused',
    mood:        'Premium, trustworthy, clear',
    palette:     'White/neutral backgrounds, accent color',
    promptHint:  'Product rotation, feature highlight, texture close-up',
  },
  trailer: {
    label:       '🎬 Cinematic Trailer',
    model:       'higgsfield-ai/dop/turbo',
    aspect:      '16:9',
    duration:    10,
    style:       'Epic, cinematic, blockbuster',
    mood:        'Intense, dramatic, awe-inspiring',
    palette:     'Desaturated, teal-orange, high contrast',
    promptHint:  'Wide establishing shot, action sequence, dramatic reveal',
  },
  social: {
    label:       '📱 Social Content',
    model:       'higgsfield-ai/dop/lite',
    aspect:      '9:16',
    duration:    5,
    style:       'Trendy, authentic, snappy',
    mood:        'Energetic, fun, relatable',
    palette:     'Bold, vibrant, eye-catching',
    promptHint:  'Hook moment, relatable action, strong visual cut',
  },
  custom: {
    label:       '✏️ Custom',
    model:       'higgsfield-ai/dop/standard',
    aspect:      '16:9',
    duration:    5,
    style:       '',
    mood:        '',
    palette:     '',
    promptHint:  '',
  },
};

let _selectedUseCase = null;

function openProjectModal() {
  _selectedUseCase = null;
  // Reset to step 1
  $('project-step-1').style.display = 'block';
  $('project-step-2').style.display = 'none';
  $('btn-save-project').style.display  = 'none';
  $('btn-back-project').style.display  = 'none';
  // Deselect all use-case cards
  $$('.vg-usecase-card').forEach(c => c.classList.remove('active'));
  $('project-modal-overlay').classList.add('open');
}

function closeProjectModal() {
  $('project-modal-overlay').classList.remove('open');
  _selectedUseCase = null;
  ['project-name-input','project-style-input','project-mood-input','project-palette-input'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
}

function selectUseCase(key) {
  _selectedUseCase = key;
  const cfg = USE_CASE_CONFIGS[key];
  if (!cfg) return;

  // Move to step 2
  $('project-step-1').style.display = 'none';
  $('project-step-2').style.display = 'block';
  $('btn-save-project').style.display = 'inline-flex';
  $('btn-back-project').style.display = 'inline-flex';

  // Banner
  const banner = $('vg-usecase-banner');
  if (banner) {
    banner.innerHTML = `<span class="vg-usecase-badge">${cfg.label}</span>
      ${cfg.promptHint ? `<span class="vg-usecase-hint-text">Prompt ideas: <em>${cfg.promptHint}</em></span>` : ''}`;
  }

  // Pre-fill advanced fields
  const styleEl   = $('project-style-input');
  const moodEl    = $('project-mood-input');
  const paletteEl = $('project-palette-input');
  const modelEl   = $('project-model-select');
  if (styleEl)   styleEl.value   = cfg.style;
  if (moodEl)    moodEl.value    = cfg.mood;
  if (paletteEl) paletteEl.value = cfg.palette;
  if (modelEl)   modelEl.value   = cfg.model;

  // Config summary
  const summary = $('vg-usecase-summary');
  if (summary) {
    const modelLabel = MODEL_COSTS[cfg.model]?.label || cfg.model.split('/').pop();
    summary.innerHTML = `
      <div class="vg-ucs-row">
        <span class="vg-ucs-item"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>${modelLabel}</span>
        <span class="vg-ucs-item"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>${cfg.aspect}</span>
        <span class="vg-ucs-item"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${cfg.duration}s</span>
      </div>`;
  }

  $('project-name-input').focus();
}

async function saveProject() {
  const name  = $('project-name-input').value.trim();
  const errEl = $('project-modal-error');
  errEl.style.display = 'none';

  if (!name) {
    errEl.textContent   = 'Project name is required';
    errEl.style.display = 'block';
    return;
  }

  const btn = $('btn-save-project');
  btn.disabled    = true;
  btn.textContent = 'Creating…';

  const cfg     = _selectedUseCase ? USE_CASE_CONFIGS[_selectedUseCase] : null;
  const style   = $('project-style-input')?.value.trim()   || cfg?.style   || '';
  const mood    = $('project-mood-input')?.value.trim()    || cfg?.mood    || '';
  const palette = $('project-palette-input')?.value.trim() || cfg?.palette || '';
  const model   = $('project-model-select')?.value          || cfg?.model  || 'higgsfield-ai/dop/standard';
  const styleBible = buildStyleBible({ style, mood, palette });

  try {
    const res  = await api('POST', '/api/projects', {
      name,
      style_bible:   styleBible,
      default_model: model,
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent   = data.error || 'Failed to create project';
      errEl.style.display = 'block';
      return;
    }

    const newProject = {
      id: data.id, name: data.name, shot_count: 0,
      default_model: model, style_bible: styleBible,
    };
    VG.projects.unshift(newProject);
    renderProjectList();
    closeProjectModal();
    await selectProject(data.id);

    // Apply use-case defaults to the compose panel
    if (cfg) {
      // Aspect ratio
      $$('.vg-aspect-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.aspect === cfg.aspect);
      });
      VG.selectedAspect = cfg.aspect;

      // Duration
      $$('.vg-dur-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.dur) === cfg.duration);
      });
      VG.selectedDur = cfg.duration;

      // Model
      selectModel(model);
    }

    showToast(`"${name}" created — ready to generate`);
  } catch {
    errEl.textContent   = 'Network error — please try again';
    errEl.style.display = 'block';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Create Project';
  }
}

/* ═══════════════════════════════════════════════════════════════
   STYLE BIBLE MODAL
   ═══════════════════════════════════════════════════════════════ */

function openBibleModal() {
  const project = VG.projects.find(p => p.id === VG.activeProjectId);
  if (!project) return;

  const bible  = project.style_bible || {};
  const parsed = typeof bible === 'string' ? tryParseJSON(bible) : bible;
  if (parsed) {
    $('bible-style-input').value   = parsed.style   || '';
    $('bible-mood-input').value    = parsed.mood    || '';
    $('bible-palette-input').value = parsed.palette || '';
    $('bible-camera-input').value  = parsed.camera  || '';
  }

  $('bible-modal-overlay').classList.add('open');
}

function closeBibleModal() {
  $('bible-modal-overlay').classList.remove('open');
}

/* ── #7 BIBLE ACTIVE INDICATOR ────────────────────────────────── */
function updateBibleIndicator(projectId) {  const dot = $('vg-bible-dot');
  const tip = $('vg-bible-tip');
  if (!dot) return;

  const project = VG.projects.find(p => p.id === projectId);
  const bible   = project?.style_bible;
  const parsed  = bible
    ? (typeof bible === 'string' ? tryParseJSON(bible) : bible)
    : null;
  const hasContent = parsed && Object.values(parsed).some(v => v && v.trim());

  dot.style.display = hasContent ? 'inline-block' : 'none';
  if (tip) tip.style.display = hasContent ? 'inline' : 'none';
}

async function saveBible() {
  if (!VG.activeProjectId) return;

  const bible = {
    style:   $('bible-style-input').value.trim(),
    mood:    $('bible-mood-input').value.trim(),
    palette: $('bible-palette-input').value.trim(),
    camera:  $('bible-camera-input').value.trim(),
  };

  const btn = $('btn-save-bible');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    const res  = await api('PATCH', `/api/projects/${VG.activeProjectId}`, { style_bible: bible });
    const data = await res.json();

    if (res.ok) {
      const proj = VG.projects.find(p => p.id === VG.activeProjectId);
      if (proj) proj.style_bible = bible;
      closeBibleModal();
      updateBibleIndicator(VG.activeProjectId);
      showToast('Style bible updated ✓');
    } else {
      showToast(data.error || 'Failed to save', true);
    }
  } catch {
    showToast('Network error', true);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Save Style Bible';
  }
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function buildStyleBible({ style, mood, palette }) {
  const parts = {};
  if (style)   parts.style   = style;
  if (mood)    parts.mood    = mood;
  if (palette) parts.palette = palette;
  return Object.keys(parts).length ? parts : null;
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) { return escHtml(str); }

function tryParseJSON(str) {
  try { return typeof str === 'string' ? JSON.parse(str) : str; } catch { return null; }
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function updateCharCount() {
  const ta = $('vg-prompt');
  const el = $('vg-prompt-count');
  if (!ta || !el) return;
  el.textContent = `${ta.value.length}/600`;
}

function showToast(msg, isError = false) {
  const toast = $('vg-toast');
  if (!toast) return;
  toast.textContent       = msg;
  toast.style.color       = isError ? 'var(--red)' : 'var(--text-primary)';
  toast.style.borderColor = isError ? 'rgba(248,113,113,0.3)' : 'var(--border-subtle)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

/* ═══════════════════════════════════════════════════════════════
   BIND UI
   ═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   ITEM 2 — STRIPE UPGRADE FLOW
   ═══════════════════════════════════════════════════════════════ */

function openUpgradeModal() {
  const overlay = $('upgrade-modal-overlay');
  if (overlay) {
    overlay.classList.add('open');
    $('upgrade-modal-error') && ($('upgrade-modal-error').style.display = 'none');
  }
}

function closeUpgradeModal() {
  const overlay = $('upgrade-modal-overlay');
  if (overlay) overlay.classList.remove('open');
}

async function startCheckout(tier) {
  try {
    const errEl = $('upgrade-modal-error');
    if (errEl) errEl.style.display = 'none';
    const btns = document.querySelectorAll('[data-upgrade-tier]');
    btns.forEach(b => { b.disabled = true; b.textContent = 'Processing…'; });

    const res  = await api('POST', '/api/billing/checkout', { tier });
    const data = await res.json();

    btns.forEach(b => { b.disabled = false; b.textContent = `Select ${capitalize(b.dataset.upgradeTier)}`; });

    if (!res.ok || !data.url) {
      const msg = data.error || 'Failed to create checkout session';
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      showToast(msg, true);
      return;
    }
    // Redirect to Stripe Checkout
    window.location.href = data.url;
  } catch (err) {
    showToast('Checkout error: ' + err.message, true);
  }
}

/* ═══════════════════════════════════════════════════════════════
   ITEM 4 — SHOT REORDER (drag-and-drop)
   ═══════════════════════════════════════════════════════════════ */

let _dragShotId  = null;
let _dragOverId  = null;

function initDragAndDrop(grid) {
  if (!grid) return;

  grid.addEventListener('dragstart', e => {
    const card = e.target.closest('.vg-shot-card');
    if (!card) return;
    _dragShotId = card.dataset.shotId;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  grid.addEventListener('dragend', e => {
    const card = e.target.closest('.vg-shot-card');
    if (card) card.classList.remove('dragging');
    grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    _dragShotId = null;
    _dragOverId = null;
  });

  grid.addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('.vg-shot-card');
    if (!card || card.dataset.shotId === _dragShotId) return;
    grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    card.classList.add('drag-over');
    _dragOverId = card.dataset.shotId;
  });

  grid.addEventListener('drop', async e => {
    e.preventDefault();
    grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (!_dragShotId || !_dragOverId || _dragShotId === _dragOverId) return;

    const projectId = VG.activeProjectId;
    if (!projectId) return;

    const shots = VG.shots[projectId] || [];

    // Build new order: remove dragged, insert before drop target
    const newOrder = shots.filter(s => s.id !== _dragShotId);
    const dropIdx  = newOrder.findIndex(s => s.id === _dragOverId);
    const dragged  = shots.find(s => s.id === _dragShotId);
    if (!dragged) return;
    newOrder.splice(dropIdx, 0, dragged);

    // Optimistic update
    VG.shots[projectId] = newOrder;
    renderShotGrid(projectId);

    // Persist to server
    try {
      await api('PATCH', `/api/projects/${projectId}/reorder`, {
        shot_ids: newOrder.map(s => s.id),
      });
    } catch {
      showToast('Reorder save failed', true);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   ITEM 5 — CHARACTER SOUL
   ═══════════════════════════════════════════════════════════════ */

let _charUploadedKey = null;
let _charUploadedUrl = null;

function openCharModal() {
  $('char-modal-overlay')?.classList.add('open');
  $('char-name-input') && ($('char-name-input').value = '');
  $('char-desc-input') && ($('char-desc-input').value = '');
  $('char-upload-name') && ($('char-upload-name').textContent = '');
  $('char-upload-preview') && ($('char-upload-preview').style.display = 'none');
  $('char-modal-error') && ($('char-modal-error').style.display = 'none');
  $('char-file-input') && ($('char-file-input').value = '');
  _charUploadedKey = null;
  _charUploadedUrl = null;
}

function closeCharModal() {
  $('char-modal-overlay')?.classList.remove('open');
}

async function handleCharFileSelect(file) {
  const nameEl    = $('char-upload-name');
  const previewEl = $('char-upload-preview');
  const imgEl     = $('char-upload-img');

  if (nameEl) nameEl.textContent = 'Uploading…';
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res  = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    _charUploadedKey = data.key;
    _charUploadedUrl = data.absoluteUrl || (window.location.origin + data.url);
    if (nameEl) nameEl.textContent = file.name;
    if (imgEl)  { imgEl.src = data.url; }
    if (previewEl) previewEl.style.display = 'block';
  } catch (err) {
    if (nameEl) nameEl.textContent = '';
    showToast('Upload failed: ' + err.message, true);
  }
}

async function saveCharacter() {
  const name   = $('char-name-input')?.value?.trim();
  const desc   = $('char-desc-input')?.value?.trim();
  const errEl  = $('char-modal-error');
  const saveBtn = $('btn-save-char');

  if (!name) {
    if (errEl) { errEl.textContent = 'Character name required'; errEl.style.display = 'block'; }
    return;
  }
  if (!VG.activeProjectId) {
    if (errEl) { errEl.textContent = 'Select a project first'; errEl.style.display = 'block'; }
    return;
  }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  if (errEl) errEl.style.display = 'none';

  try {
    const res  = await api('POST', `/api/projects/${VG.activeProjectId}/characters`, {
      name,
      description:   desc || null,
      ref_image_url: _charUploadedUrl || null,
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to save character');

    closeCharModal();
    showToast(`Character "${name}" added`);
    // Reload project to get updated characters list
    await loadShots(VG.activeProjectId);
    await renderCharacters(VG.activeProjectId);
  } catch (err) {
    if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
    showToast(err.message, true);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Add Character'; }
  }
}

async function renderCharacters(projectId) {
  const panel = $('vg-character-section');
  const list  = $('vg-character-list');
  if (!panel || !list || !projectId) return;

  panel.style.display = 'block';

  try {
    const res  = await api('GET', `/api/projects/${projectId}`);
    const data = await res.json();
    const chars = data.characters || [];

    if (chars.length === 0) {
      list.innerHTML = `<div class="vg-char-empty">No characters yet. Add one to maintain visual consistency across shots.</div>`;
      return;
    }

    list.innerHTML = chars.map(ch => {
      const soulPending = ch.soul_id === 'pending';
      const soulReady   = ch.soul_id && ch.soul_id !== 'pending';
      return `
      <div class="vg-char-card" data-char-id="${ch.id}">
        <div class="vg-char-avatar">
          ${ch.ref_image_url
            ? `<img src="${escAttr(ch.ref_image_url)}" alt="${escAttr(ch.name)}" loading="lazy"/>`
            : `<div class="vg-char-initials">${escHtml(ch.name.slice(0,2).toUpperCase())}</div>`
          }
        </div>
        <div class="vg-char-info">
          <div class="vg-char-name">${escHtml(ch.name)}</div>
          ${ch.description ? `<div class="vg-char-desc">${escHtml(ch.description)}</div>` : ''}
          ${soulReady   ? `<div class="vg-char-soul-badge ready">✓ Soul ready</div>` : ''}
          ${soulPending ? `<div class="vg-char-soul-badge pending"><span class="vg-spinner-xs"></span> Training soul…</div>` : ''}
        </div>
        <div class="vg-char-actions">
          <button class="vg-btn-chip vg-char-use-btn"  data-char-id="${ch.id}" data-ref-url="${escAttr(ch.ref_image_url || '')}" title="Lock as reference image">Use</button>
          <button class="vg-btn-chip vg-char-edit-btn" data-char-id="${ch.id}" data-name="${escAttr(ch.name)}" data-desc="${escAttr(ch.description || '')}" title="Edit name / description">Edit</button>
          ${ch.ref_image_url && !ch.soul_id
            ? `<button class="vg-btn-chip vg-char-train-btn" data-char-id="${ch.id}" title="Train Soul for visual consistency">Train Soul</button>`
            : ''
          }
          ${soulPending
            ? `<button class="vg-btn-chip vg-char-poll-btn" data-char-id="${ch.id}" title="Check training status">Check</button>`
            : ''
          }
          <button class="vg-btn-chip danger vg-char-del-btn" data-char-id="${ch.id}" title="Delete character">×</button>
        </div>
      </div>`;
    }).join('');

    // Bind character actions
    list.querySelectorAll('.vg-char-use-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card   = btn.closest('.vg-char-card');
        const name   = card?.querySelector('.vg-char-name')?.textContent || '';
        const avatar = card?.querySelector('img')?.src || null;
        useCharacter(btn.dataset.charId, btn.dataset.refUrl, name, avatar);
      });
    });
    list.querySelectorAll('.vg-char-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openCharEditInline(btn.dataset.charId, btn.dataset.name, btn.dataset.desc, projectId));
    });
    list.querySelectorAll('.vg-char-train-btn').forEach(btn => {
      btn.addEventListener('click', () => trainCharacterSoul(btn.dataset.charId));
    });
    list.querySelectorAll('.vg-char-poll-btn').forEach(btn => {
      btn.addEventListener('click', () => pollSoulStatus(btn.dataset.charId, projectId));
    });
    list.querySelectorAll('.vg-char-del-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteCharacter(btn.dataset.charId, projectId));
    });

    // Auto-start background polling for any in-flight soul trainings
    chars.filter(ch => ch.soul_id === 'pending').forEach(ch => {
      startSoulPoll(ch.id, projectId);
    });
  } catch (err) {
    list.innerHTML = `<div class="vg-char-empty" style="color:var(--color-error)">Failed to load characters</div>`;
  }
}

async function useCharacter(charId, refUrl, charName, charAvatar) {
  if (!refUrl) {
    showToast('This character has no reference image', true);
    return;
  }

  // #3 — Character Continuity Lock
  VG.lockedCharId     = charId;
  VG.lockedCharName   = charName || 'Character';
  VG.lockedCharAvatar = charAvatar || null;
  VG.uploadedImageUrl = refUrl.startsWith('/')
    ? window.location.origin + refUrl
    : refUrl;
  VG.uploadedImageKey = null;

  // Show preview
  const imgEl = $('vg-upload-img');
  if (imgEl) imgEl.src = VG.uploadedImageUrl;
  showUploadPreview(VG.uploadedImageUrl);

  // Show lock banner in compose panel
  renderCharLockBanner();

  showToast(`🔒 ${VG.lockedCharName} locked — all shots will use this character`);
}

/* ── #3 CHARACTER CONTINUITY LOCK ───────────────────────────── */

function renderCharLockBanner() {
  const banner  = $('vg-char-lock-banner');
  const nameEl  = $('vg-char-lock-name');
  const avatarWrap = $('vg-char-lock-avatar-wrap');
  if (!banner) return;

  if (VG.lockedCharId) {
    banner.style.display = 'flex';
    if (nameEl) nameEl.textContent = VG.lockedCharName || 'Character';
    if (avatarWrap && VG.lockedCharAvatar) {
      avatarWrap.innerHTML = `<img class="vg-char-lock-avatar" src="${escAttr(VG.lockedCharAvatar)}" alt="${escAttr(VG.lockedCharName || '')}"/>`;
    }
  } else {
    banner.style.display = 'none';
  }
}

function clearCharLock() {
  VG.lockedCharId     = null;
  VG.lockedCharName   = null;
  VG.lockedCharAvatar = null;
  renderCharLockBanner();
  // Also clear the image if it was set by the lock
  clearImage();
  showToast('Character lock removed');
}

/* ── #5 STYLE MEMORY PER PROJECT ────────────────────────────── */

const MEMORY_KEY = 'spectra_project_memory';

function saveProjectMemory(projectId) {
  if (!projectId) return;
  try {
    const all = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}');
    all[projectId] = {
      model:    VG.selectedModel,
      aspect:   VG.selectedAspect,
      duration: VG.selectedDur,
      preset:   VG.selectedPreset,
      savedAt:  Date.now(),
    };
    localStorage.setItem(MEMORY_KEY, JSON.stringify(all));
  } catch {}
}

function loadProjectMemory(projectId) {
  if (!projectId) return null;
  try {
    const all = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}');
    return all[projectId] || null;
  } catch { return null; }
}

function applyProjectMemory(projectId) {
  const mem = loadProjectMemory(projectId);
  if (!mem) return false;

  // Model
  if (mem.model) selectModel(mem.model);

  // Aspect
  if (mem.aspect) {
    $$('.vg-aspect-btn').forEach(b => b.classList.toggle('active', b.dataset.aspect === mem.aspect));
    VG.selectedAspect = mem.aspect;
  }

  // Duration
  if (mem.duration) {
    $$('.vg-dur-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.dur) === mem.duration));
    VG.selectedDur = mem.duration;
  }

  // Preset
  if (mem.preset) {
    VG.selectedPreset = mem.preset;
    $$('.vg-preset-chip').forEach(b => b.classList.toggle('active', b.dataset.presetId === mem.preset));
  }

  return true;
}

/* ── #6 CUSTOM STYLE SYSTEMS ─────────────────────────────────── */

const CUSTOM_STYLES_KEY = 'spectra_custom_styles';

function loadCustomStyles() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_STYLES_KEY) || '[]');
  } catch { return []; }
}

function saveCustomStyles(styles) {
  try {
    localStorage.setItem(CUSTOM_STYLES_KEY, JSON.stringify(styles));
  } catch {}
}

function renderMyStyles() {
  const section = $('vg-my-styles-section');
  const scroll  = $('vg-my-styles-scroll');
  if (!section || !scroll) return;

  const styles = loadCustomStyles();
  if (styles.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  scroll.innerHTML = styles.map((s, idx) => `
    <span class="vg-preset-chip vg-custom-style-chip ${s.presetId === VG.selectedPreset ? 'active' : ''}"
          data-style-idx="${idx}" data-preset-id="${escAttr(s.presetId || '')}" title="${escAttr(s.name)}">
      <span class="vg-preset-emoji">${s.emoji || '⭐'}</span>
      <span class="vg-preset-label">${escHtml(s.name)}</span>
      <button class="vg-custom-style-del" data-style-idx="${idx}" title="Delete style">×</button>
    </span>
  `).join('');

  // Apply click — select preset
  scroll.querySelectorAll('.vg-custom-style-chip').forEach(chip => {
    chip.addEventListener('click', e => {
      if (e.target.classList.contains('vg-custom-style-del')) return;
      togglePreset(chip.dataset.presetId);
      saveProjectMemory(VG.activeProjectId);
    });
  });

  // Delete buttons
  scroll.querySelectorAll('.vg-custom-style-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteCustomStyle(parseInt(btn.dataset.styleIdx, 10));
    });
  });
}

function saveCustomStyle() {
  if (!VG.selectedPreset) {
    showToast('Select a built-in preset first, then save it as a named style', true);
    return;
  }

  const preset = STYLE_PRESETS.find(p => p.id === VG.selectedPreset);
  if (!preset) { showToast('Unknown preset', true); return; }

  const styles  = loadCustomStyles();
  const already = styles.find(s => s.presetId === VG.selectedPreset);
  if (already) { showToast(`"${already.name}" already saved`, true); return; }

  // Prompt for a custom name (prefill with preset label)
  const name = window.prompt('Name this style:', preset.label);
  if (!name || !name.trim()) return;

  styles.push({
    name:     name.trim(),
    presetId: preset.id,
    emoji:    preset.emoji,
    savedAt:  Date.now(),
  });
  saveCustomStyles(styles);
  renderMyStyles();
  showToast(`Style "${name.trim()}" saved ✓`);
}

function deleteCustomStyle(idx) {
  const styles = loadCustomStyles();
  const name   = styles[idx]?.name || 'style';
  if (!confirm(`Delete "${name}"?`)) return;
  styles.splice(idx, 1);
  saveCustomStyles(styles);
  renderMyStyles();
  showToast(`"${name}" deleted`);
}

/* ── #8 CAMPAIGN WORKFLOW (H-6: D1-backed, localStorage removed) ── */

async function fetchCampaigns() {
  try {
    const res = await api('GET', '/api/campaigns');
    if (!res.ok) return;
    VG.campaigns = await res.json();
  } catch { /* non-fatal */ }
}

function renderCampaigns() {
  const list = $('vg-campaign-list');
  if (!list) return;

  const campaigns = VG.campaigns || [];
  if (campaigns.length === 0) {
    list.innerHTML = '<div class="vg-campaign-empty">No campaigns yet</div>';
    return;
  }

  list.innerHTML = campaigns.map((c, idx) => {
    // Count projects assigned to this campaign
    const assignedProjects = VG.projects.filter(p => p.campaign_id === c.id);
    const shotCount = assignedProjects.reduce((sum, p) => sum + (p.shot_count || 0), 0);
    return `
    <div class="vg-campaign-item" data-campaign-idx="${idx}" data-campaign-id="${escAttr(c.id)}">
      <div class="vg-campaign-item-left">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        <span class="vg-campaign-name">${escHtml(c.name)}</span>
      </div>
      <div class="vg-campaign-item-right">
        <span class="vg-campaign-meta">${assignedProjects.length}p · ${shotCount}s</span>
        <button class="vg-campaign-export-btn" data-campaign-idx="${idx}" title="Export manifest">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button class="vg-campaign-del-btn" data-campaign-idx="${idx}" title="Delete campaign">×</button>
      </div>
    </div>`;
  }).join('');

  // Click campaign to assign active project
  list.querySelectorAll('.vg-campaign-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.vg-campaign-export-btn') || e.target.closest('.vg-campaign-del-btn')) return;
      assignProjectToCampaign(item.dataset.campaignId);
    });
  });

  // Export buttons
  list.querySelectorAll('.vg-campaign-export-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      exportCampaign(parseInt(btn.dataset.campaignIdx, 10));
    });
  });

  // Delete buttons
  list.querySelectorAll('.vg-campaign-del-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteCampaign(parseInt(btn.dataset.campaignIdx, 10));
    });
  });
}

async function createCampaign(name) {
  if (!name || !name.trim()) return;
  try {
    const res  = await api('POST', '/api/campaigns', { name: name.trim() });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed to create campaign', 'error'); return; }
    VG.campaigns.push(data);
    renderCampaigns();
    showToast(`Campaign "${data.name}" created`);
    return data;
  } catch { showToast('Failed to create campaign', 'error'); }
}

async function deleteCampaign(idx) {
  const camp = (VG.campaigns || [])[idx];
  if (!camp) return;
  if (!confirm(`Delete campaign "${camp.name}"? Projects will not be deleted.`)) return;
  try {
    const res = await api('DELETE', `/api/campaigns/${camp.id}`);
    if (!res.ok) { showToast('Failed to delete campaign', 'error'); return; }
    // Unassign projects in local cache
    VG.projects.forEach(p => { if (p.campaign_id === camp.id) p.campaign_id = null; });
    VG.campaigns.splice(idx, 1);
    renderCampaigns();
    renderProjectList();
    showToast(`Campaign "${camp.name}" deleted`);
  } catch { showToast('Failed to delete campaign', 'error'); }
}

async function assignProjectToCampaign(campaignId) {
  if (!VG.activeProjectId) {
    showToast('Select a project first, then click a campaign to assign it', 'info');
    return;
  }
  const project = VG.projects.find(p => p.id === VG.activeProjectId);
  const camp    = (VG.campaigns || []).find(c => c.id === campaignId);
  if (!project || !camp) return;

  // Toggle — clicking the already-assigned campaign unassigns
  const newCampaignId = project.campaign_id === campaignId ? null : campaignId;
  try {
    const res  = await api('PUT', `/api/projects/${project.id}/campaign`, { campaign_id: newCampaignId });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed to update campaign', 'error'); return; }
    project.campaign_id = newCampaignId;
    renderCampaigns();
    renderProjectList();
    if (newCampaignId === null) {
      showToast(`Removed "${project.name}" from campaign`);
    } else {
      showToast(`"${project.name}" → "${camp.name}" ✓`);
    }
  } catch { showToast('Failed to update campaign assignment', 'error'); }
}

function exportCampaign(idx) {
  const campaigns = VG.campaigns || [];
  const camp      = campaigns[idx];
  if (!camp) return;

  const assignedProjects = VG.projects.filter(p => p.campaign_id === camp.id);
  if (assignedProjects.length === 0) {
    showToast('No projects assigned to this campaign', true);
    return;
  }

  const lines = [
    `SPECTRA CAMPAIGN MANIFEST`,
    `Campaign: ${camp.name}`,
    `Exported: ${new Date().toISOString()}`,
    `Projects: ${assignedProjects.length}`,
    `═`.repeat(60),
    '',
  ];

  assignedProjects.forEach(project => {
    lines.push(`PROJECT: ${project.name}`);
    lines.push(`  Model: ${project.default_model || '—'}`);
    lines.push(`  Style Bible: ${project.style_bible ? JSON.stringify(project.style_bible) : '—'}`);

    const shots = VG.shots[project.id] || [];
    if (shots.length === 0) {
      lines.push(`  Shots: (none loaded — select this project to load)`);
    } else {
      shots.forEach((shot, i) => {
        lines.push(`  Shot ${i + 1}:`);
        lines.push(`    Status:  ${shot.status}`);
        lines.push(`    Model:   ${shot.model || '—'}`);
        lines.push(`    Prompt:  ${(shot.prompt || '').replace(/\n/g, ' ')}`);
        if (shot.video_url || shot.hf_video_url) {
          lines.push(`    URL:     ${shot.video_url || shot.hf_video_url}`);
        }
      });
    }
    lines.push('');
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `spectra_campaign_${camp.name.replace(/\s+/g, '_')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Manifest exported for "${camp.name}"`);
}

/* ── CHARACTER SOUL TRAINING + STATUS POLLING ───────────────── */

const _soulPolls = {};   // charId → intervalId

async function trainCharacterSoul(charId) {
  if (!VG.activeProjectId) return;
  const btn = document.querySelector(`[data-char-id="${charId}"].vg-char-train-btn`);
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  try {
    const res  = await api('POST', `/api/projects/${VG.activeProjectId}/characters/train`, { character_id: charId });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Training failed');
    showToast(data.message || 'Soul training submitted — will check status automatically');
    // Re-render: pending badge appears, auto-poll kicks off from renderCharacters()
    await renderCharacters(VG.activeProjectId);
  } catch (err) {
    showToast(err.message, true);
    if (btn) { btn.disabled = false; btn.textContent = 'Train Soul'; }
  }
}

// Manual "Check" button — single status check with button feedback
async function pollSoulStatus(charId, projectId) {
  const btn = document.querySelector(`[data-char-id="${charId}"].vg-char-poll-btn`);
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  const done = await checkSoulStatus(charId, projectId);
  if (!done && btn) { btn.disabled = false; btn.textContent = 'Check'; }
}

// Core status check — returns true when training is complete (poll stops)
async function checkSoulStatus(charId, projectId) {
  try {
    const res  = await api('GET', `/api/projects/${projectId}/characters/${charId}/soul-status`);
    const data = await res.json();
    if (!res.ok) return false;

    if (data.status === 'ready') {
      stopSoulPoll(charId);
      showToast('✨ Soul training complete — character is ready!');
      await renderCharacters(projectId);
      return true;
    }
    // Non-transient status → stop polling to avoid infinite loop
    if (data.status !== 'pending' && data.status !== 'submitted' && data.status !== 'in_progress') {
      stopSoulPoll(charId);
      await renderCharacters(projectId);
      return true;
    }
    return false;
  } catch { return false; }
}

function startSoulPoll(charId, projectId) {
  if (_soulPolls[charId]) return;   // already running
  _soulPolls[charId] = setInterval(async () => {
    await checkSoulStatus(charId, projectId);
  }, 8000);   // poll every 8 s
}

function stopSoulPoll(charId) {
  if (_soulPolls[charId]) {
    clearInterval(_soulPolls[charId]);
    delete _soulPolls[charId];
  }
}

/* ── CHARACTER INLINE EDIT ───────────────────────────────────── */

function openCharEditInline(charId, currentName, currentDesc, projectId) {
  const card = document.querySelector(`.vg-char-card[data-char-id="${charId}"]`);
  if (!card || card.classList.contains('editing')) return;
  card.classList.add('editing');

  const infoEl   = card.querySelector('.vg-char-info');
  if (!infoEl) return;
  const origHTML = infoEl.innerHTML;

  infoEl.innerHTML = `
    <input class="vg-input vg-char-edit-name" value="${escAttr(currentName)}" placeholder="Name" maxlength="60"/>
    <input class="vg-input vg-char-edit-desc" value="${escAttr(currentDesc)}" placeholder="Description (optional)" maxlength="200" style="margin-top:4px"/>
    <div class="vg-char-edit-actions">
      <button class="vg-btn-primary vg-char-edit-save" style="font-size:11px;padding:3px 10px">Save</button>
      <button class="vg-btn-ghost vg-char-edit-cancel" style="font-size:11px;padding:3px 8px">Cancel</button>
    </div>
  `;
  infoEl.querySelector('.vg-char-edit-name')?.focus();

  const doCancel = () => {
    infoEl.innerHTML = origHTML;
    card.classList.remove('editing');
  };

  const doSave = async () => {
    const newName = infoEl.querySelector('.vg-char-edit-name')?.value?.trim();
    const newDesc = infoEl.querySelector('.vg-char-edit-desc')?.value?.trim();
    if (!newName) { showToast('Name cannot be empty', true); return; }

    const saveBtn   = infoEl.querySelector('.vg-char-edit-save');
    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';

    try {
      const res = await api('PATCH', `/api/projects/${projectId}/characters/${charId}`, {
        name:        newName,
        description: newDesc || null,
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Save failed'); }
      showToast('Character updated');
      await renderCharacters(projectId);
    } catch (err) {
      showToast(err.message, true);
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Save';
    }
  };

  infoEl.querySelector('.vg-char-edit-cancel').addEventListener('click', doCancel);
  infoEl.querySelector('.vg-char-edit-save').addEventListener('click', doSave);
  infoEl.querySelectorAll('.vg-char-edit-name, .vg-char-edit-desc').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  doSave();
      if (e.key === 'Escape') doCancel();
    });
  });
}

async function deleteCharacter(charId, projectId) {
  if (!confirm('Delete this character?')) return;
  try {
    const res = await api('DELETE', `/api/projects/${projectId}/characters/${charId}`);
    if (!res.ok) throw new Error('Delete failed');
    showToast('Character deleted');
    await renderCharacters(projectId);
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ═══════════════════════════════════════════════════════════════
   #9 MULTI-SHOT CONTINUITY
   "Continue from last frame" — captures final video frame via
   canvas, uploads to R2, pre-fills compose as next reference
   ═══════════════════════════════════════════════════════════════ */

async function continueFromShot(btn) {
  const videoUrl = btn.dataset.videoUrl;
  const prompt   = btn.dataset.prompt || '';

  if (!videoUrl) { showToast('No video URL on this shot', true); return; }

  btn.disabled  = true;
  btn.innerHTML = `<span class="vg-spinner"></span>`;

  try {
    // Extract last frame using a hidden video + canvas
    const frameBlob = await extractLastFrame(videoUrl);
    if (!frameBlob) throw new Error('Frame capture failed');

    // Upload to R2 via /api/upload
    const formData = new FormData();
    formData.append('file', frameBlob, 'last_frame.jpg');

    const res  = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Upload failed');

    // Pre-fill compose panel
    VG.uploadedImageKey = data.key;
    VG.uploadedImageUrl = data.absoluteUrl || (window.location.origin + data.url);
    showUploadPreview(data.url);

    // Clear char lock (frame replaces it)
    VG.lockedCharId     = null;
    VG.lockedCharName   = null;
    VG.lockedCharAvatar = null;
    renderCharLockBanner();

    // Scroll compose into view
    const compose = $('vg-compose');
    if (compose) compose.scrollIntoView({ behavior: 'smooth', block: 'start' });

    showToast('Last frame loaded as reference — write your next shot prompt ✓');
  } catch (err) {
    showToast(err.message || 'Continue failed', true);
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="5 9 2 12 5 15"/><path d="M22 4v7a4 4 0 01-4 4H2"/></svg> Continue`;
  }
}

/* ── Distribute shot → open Distribution Engine ──────────────── */
function distributeShot(btn) {
  const videoUrl   = btn.dataset.videoUrl    || '';
  const projectId  = btn.dataset.projectId   || '';
  const projectName= btn.dataset.projectName || '';

  if (!videoUrl) { showToast('No video URL on this shot', true); return; }

  const params = new URLSearchParams({
    video_url:    videoUrl,
    project_id:   projectId,
    project_name: projectName,
  });

  window.open(`/tools/distribution/?${params.toString()}`, '_blank');
}

function extractLastFrame(videoUrl) {
  return new Promise((resolve) => {
    const video  = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');

    video.crossOrigin = 'anonymous';
    video.muted       = true;
    video.preload     = 'metadata';
    video.src         = videoUrl;

    video.addEventListener('loadedmetadata', () => {
      // Seek to near the end (last 0.1s)
      video.currentTime = Math.max(0, video.duration - 0.1);
    });

    video.addEventListener('seeked', () => {
      canvas.width  = video.videoWidth  || 1280;
      canvas.height = video.videoHeight || 720;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.92);
    });

    video.addEventListener('error', () => resolve(null));

    // Timeout safety
    setTimeout(() => resolve(null), 10000);

    video.load();
  });
}

/* ═══════════════════════════════════════════════════════════════
   #10 AI CREATIVE DIRECTOR
   Scene concept → structured shot list via GPT-4o
   One-click queue any suggested shot
   ═══════════════════════════════════════════════════════════════ */

// Director state
const DIRECTOR = {
  shots:   [],
  concept: '',
  loading: false,
};

function openDirectorPanel() {
  const compose  = $('vg-compose');
  const director = $('vg-director-panel');
  if (!compose || !director) return;

  compose.style.display  = 'none';
  director.style.display = 'flex';
  $('vg-director-concept')?.focus();
}

function closeDirectorPanel() {
  const compose  = $('vg-compose');
  const director = $('vg-director-panel');
  if (!compose || !director) return;

  director.style.display = 'none';
  compose.style.display  = 'flex';
}

async function runDirector() {
  if (DIRECTOR.loading) return;
  if (!VG.activeProjectId) {
    showToast('Select a project first', true);
    return;
  }

  const concept = $('vg-director-concept')?.value.trim();
  if (!concept) { showToast('Describe a scene concept first', true); return; }

  const shotCount = parseInt($('vg-director-shot-count')?.value || '4', 10);

  // Get style bible from active project
  const activeProject = VG.projects.find(p => p.id === VG.activeProjectId);
  const bible = activeProject?.style_bible
    ? (typeof activeProject.style_bible === 'string'
        ? tryParseJSON(activeProject.style_bible)
        : activeProject.style_bible)
    : null;

  DIRECTOR.loading = true;
  const btn = $('btn-director-run');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="vg-spinner"></span> Directing…`; }

  $('vg-director-results').style.display  = 'none';
  $('vg-director-loading').style.display  = 'flex';
  $('vg-director-error').style.display    = 'none';

  try {
    const payload = { concept, shot_count: shotCount };
    if (bible && Object.values(bible).some(v => v)) payload.style_bible = bible;

    const res  = await api('POST', '/api/director', payload);
    const data = await res.json();

    if (!res.ok || !data.shots?.length) {
      throw new Error(data.error || 'Director returned no shots');
    }

    DIRECTOR.shots   = data.shots;
    DIRECTOR.concept = concept;
    renderDirectorShots();

  } catch (err) {
    const errEl = $('vg-director-error');
    if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
  } finally {
    DIRECTOR.loading = false;
    $('vg-director-loading').style.display = 'none';
    if (btn) {
      btn.disabled  = false;
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg> Generate Shot List`;
    }
  }
}

function renderDirectorShots() {
  const container = $('vg-director-shots');
  const results   = $('vg-director-results');
  const label     = $('vg-director-concept-label');

  if (!container || !results) return;

  if (label) label.textContent = `"${DIRECTOR.concept.slice(0, 60)}${DIRECTOR.concept.length > 60 ? '…' : ''}"`;

  const MODEL_SHORT = {
    'higgsfield-ai/dop/standard':                  'DoP Std',
    'higgsfield-ai/dop/turbo':                     'DoP Turbo',
    'higgsfield-ai/dop/lite':                      'DoP Lite',
    'kling-video/v2.1/pro/image-to-video':         'Kling Pro',
    'kling-video/v2.1/standard/image-to-video':    'Kling Std',
    'bytedance/seedance/v1/pro/image-to-video':    'Seedance',
    'bytedance/seedance/v1/lite/image-to-video':   'Seedance Lite',
    'higgsfield-ai/soul/standard':                 'Soul',
    'flux-pro/kontext/max/text-to-image':          'Flux Kontext',
  };

  container.innerHTML = DIRECTOR.shots.map((s, idx) => `
    <div class="vg-director-shot-card" data-idx="${idx}">
      <div class="vg-dsc-top">
        <span class="vg-dsc-num">Shot ${s.shot}</span>
        <span class="vg-dsc-label">${escHtml(s.label)}</span>
        <div class="vg-dsc-badges">
          <span class="vg-dsc-badge">${escHtml(MODEL_SHORT[s.model] || s.model.split('/').pop())}</span>
          <span class="vg-dsc-badge">${escHtml(s.aspect_ratio)}</span>
          <span class="vg-dsc-badge">${s.duration}s</span>
          ${s.requires_image ? `<span class="vg-dsc-badge vg-dsc-badge-img">needs ref</span>` : `<span class="vg-dsc-badge vg-dsc-badge-t2v">text→video</span>`}
        </div>
      </div>
      <p class="vg-dsc-prompt">${escHtml(s.prompt)}</p>
      ${s.director_note ? `<p class="vg-dsc-note">🎬 ${escHtml(s.director_note)}</p>` : ''}
      <div class="vg-dsc-actions">
        <button class="vg-btn-chip vg-dsc-load-btn" data-idx="${idx}">
          Load into Compose
        </button>
        <button class="vg-btn-primary vg-dsc-queue-btn" data-idx="${idx}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Queue Shot
        </button>
      </div>
    </div>
  `).join('');

  // Bind buttons
  container.querySelectorAll('.vg-dsc-load-btn').forEach(btn => {
    btn.addEventListener('click', () => loadDirectorShotToCompose(parseInt(btn.dataset.idx, 10)));
  });
  container.querySelectorAll('.vg-dsc-queue-btn').forEach(btn => {
    btn.addEventListener('click', () => queueDirectorShot(parseInt(btn.dataset.idx, 10), btn));
  });

  results.style.display = 'block';
}

function loadDirectorShotToCompose(idx) {
  const shot = DIRECTOR.shots[idx];
  if (!shot) return;

  // Pre-fill prompt
  const textarea = $('vg-prompt');
  if (textarea) { textarea.value = shot.prompt; updateCharCount(); }

  // Set model
  selectModel(shot.model);

  // Set aspect ratio
  $$('.vg-aspect-btn').forEach(b => b.classList.toggle('active', b.dataset.aspect === shot.aspect_ratio));
  VG.selectedAspect = shot.aspect_ratio;

  // Set duration
  $$('.vg-dur-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.dur) === shot.duration));
  VG.selectedDur = shot.duration;

  // Switch to compose panel
  closeDirectorPanel();
  showToast(`Shot ${shot.shot}: "${shot.label}" loaded — add a reference image and generate`);
}

async function queueDirectorShot(idx, btn) {
  const shot = DIRECTOR.shots[idx];
  if (!shot) return;
  if (!VG.activeProjectId) { showToast('Select a project first', true); return; }

  // For i2v models, we need a reference image — load to compose instead
  if (shot.requires_image && !VG.uploadedImageUrl) {
    loadDirectorShotToCompose(idx);
    showToast('Reference image required — upload one then click Generate Shot', true);
    return;
  }

  btn.disabled  = true;
  btn.innerHTML = `<span class="vg-spinner"></span> Queuing…`;

  try {
    const payload = {
      project_id:   VG.activeProjectId,
      prompt:       shot.prompt,
      model:        shot.model,
      aspect_ratio: shot.aspect_ratio,
      duration:     shot.duration,
      enhance_mode: 'cinematic',
    };

    if (VG.uploadedImageUrl && shot.requires_image) payload.image_url = VG.uploadedImageUrl;

    const res  = await api('POST', '/api/generate', payload);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Generation failed');

    // Add to local shots
    const newShot = {
      id:           data.shot_id,
      project_id:   VG.activeProjectId,
      prompt:       shot.prompt,
      model:        shot.model,
      aspect_ratio: shot.aspect_ratio,
      duration:     shot.duration,
      status:       data.status || 'queued',
      created_at:   new Date().toISOString(),
    };
    if (!VG.shots[VG.activeProjectId]) VG.shots[VG.activeProjectId] = [];
    VG.shots[VG.activeProjectId].unshift(newShot);

    // Show storyboard
    $('vg-empty').style.display    = 'none';
    $('vg-shot-grid').style.display = 'grid';
    renderShotGrid(VG.activeProjectId);
    if (newShot.id) startPolling(newShot.id, VG.activeProjectId);

    btn.innerHTML = `✓ Queued`;
    btn.classList.add('vg-dsc-btn-done');
    showToast(`Shot ${shot.shot} queued ✓`);
  } catch (err) {
    showToast(err.message, true);
    btn.disabled  = false;
    btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Queue Shot`;
  }
}

async function queueAllDirectorShots() {
  if (!DIRECTOR.shots.length) return;
  if (!VG.activeProjectId) { showToast('Select a project first', true); return; }

  const btn = $('btn-director-queue-all');
  if (btn) { btn.disabled = true; btn.textContent = 'Queuing…'; }

  let queued = 0;
  for (let i = 0; i < DIRECTOR.shots.length; i++) {
    const shot = DIRECTOR.shots[i];
    // Skip i2v shots without a reference image
    if (shot.requires_image && !VG.uploadedImageUrl) continue;

    try {
      const payload = {
        project_id:   VG.activeProjectId,
        prompt:       shot.prompt,
        model:        shot.model,
        aspect_ratio: shot.aspect_ratio,
        duration:     shot.duration,
        enhance_mode: 'cinematic',
      };
      if (VG.uploadedImageUrl && shot.requires_image) payload.image_url = VG.uploadedImageUrl;

      const res  = await api('POST', '/api/generate', payload);
      const data = await res.json();
      if (!res.ok) continue;

      const newShot = {
        id:           data.shot_id,
        project_id:   VG.activeProjectId,
        prompt:       shot.prompt,
        model:        shot.model,
        aspect_ratio: shot.aspect_ratio,
        duration:     shot.duration,
        status:       data.status || 'queued',
        created_at:   new Date().toISOString(),
      };
      if (!VG.shots[VG.activeProjectId]) VG.shots[VG.activeProjectId] = [];
      VG.shots[VG.activeProjectId].unshift(newShot);
      if (newShot.id) startPolling(newShot.id, VG.activeProjectId);

      // Mark button done
      const shotBtn = document.querySelector(`.vg-dsc-queue-btn[data-idx="${i}"]`);
      if (shotBtn) { shotBtn.innerHTML = '✓ Queued'; shotBtn.classList.add('vg-dsc-btn-done'); shotBtn.disabled = true; }

      queued++;
    } catch {}

    // Small delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 300));
  }

  $('vg-empty').style.display    = 'none';
  $('vg-shot-grid').style.display = 'grid';
  renderShotGrid(VG.activeProjectId);

  if (btn) { btn.disabled = false; btn.textContent = `${queued} queued ✓`; }
  showToast(`${queued} shot${queued !== 1 ? 's' : ''} queued from Director ✓`);
}

function bindUI() {
  // Auth tabs
  $$('.vg-auth-tab').forEach(tab => {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.authTab));
  });

  // Auth form
  $('vg-auth-form')?.addEventListener('submit', handleAuth);

  // Settings drawer
  $('btn-open-settings')?.addEventListener('click', openSettings);
  $('btn-close-settings')?.addEventListener('click', closeSettings);
  $('settings-overlay')?.addEventListener('click', closeSettings);
  $('btn-logout')?.addEventListener('click', logout);

  // Key save buttons
  document.querySelectorAll('[data-save-provider]').forEach(btn => {
    btn.addEventListener('click', () => saveKey(btn.dataset.saveProvider));
  });

  // Key toggle show/hide
  document.querySelectorAll('.vg-key-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  // Project modal
  $('btn-new-project')?.addEventListener('click', openProjectModal);
  $('btn-new-project-empty')?.addEventListener('click', openProjectModal);
  $('btn-close-project-modal')?.addEventListener('click', closeProjectModal);
  $('btn-cancel-project-modal')?.addEventListener('click', closeProjectModal);
  $('btn-save-project')?.addEventListener('click', saveProject);
  $('btn-back-project')?.addEventListener('click', () => {
    $('project-step-1').style.display = 'block';
    $('project-step-2').style.display = 'none';
    $('btn-save-project').style.display = 'none';
    $('btn-back-project').style.display = 'none';
  });
  // Use-case card clicks
  $$('.vg-usecase-card').forEach(card => {
    card.addEventListener('click', () => {
      $$('.vg-usecase-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectUseCase(card.dataset.usecase);
    });
  });
  $('project-modal-overlay')?.addEventListener('click', e => {
    if (e.target === $('project-modal-overlay')) closeProjectModal();
  });

  // Style bible modal
  $('btn-edit-project')?.addEventListener('click', openBibleModal);
  $('btn-close-bible-modal')?.addEventListener('click', closeBibleModal);
  $('btn-cancel-bible-modal')?.addEventListener('click', closeBibleModal);
  $('btn-save-bible')?.addEventListener('click', saveBible);
  $('bible-modal-overlay')?.addEventListener('click', e => {
    if (e.target === $('bible-modal-overlay')) closeBibleModal();
  });

  // #3 — Character lock clear button
  $('btn-char-lock-clear')?.addEventListener('click', clearCharLock);

  // #6 — Save custom style
  $('btn-save-custom-style')?.addEventListener('click', saveCustomStyle);

  // #8 — Campaign workflow
  $('btn-new-campaign')?.addEventListener('click', () => {
    const row = $('vg-campaign-new-row');
    if (row) {
      row.style.display = 'flex';
      $('vg-campaign-name-input')?.focus();
    }
  });
  $('btn-campaign-cancel')?.addEventListener('click', () => {
    const row = $('vg-campaign-new-row');
    if (row) row.style.display = 'none';
    const inp = $('vg-campaign-name-input');
    if (inp) inp.value = '';
  });
  $('btn-campaign-save')?.addEventListener('click', () => {
    const inp = $('vg-campaign-name-input');
    if (!inp) return;
    const name = inp.value.trim();
    if (!name) { inp.focus(); return; }
    createCampaign(name);
    inp.value = '';
    const row = $('vg-campaign-new-row');
    if (row) row.style.display = 'none';
  });
  $('vg-campaign-name-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-campaign-save')?.click();
    if (e.key === 'Escape') $('btn-campaign-cancel')?.click();
  });

  // #5 — Save memory on aspect/duration/model change
  $$('.vg-aspect-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setTimeout(() => saveProjectMemory(VG.activeProjectId), 100);
    });
  });
  $$('.vg-dur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setTimeout(() => saveProjectMemory(VG.activeProjectId), 100);
    });
  });

  // Aspect ratio
  $$('.vg-aspect-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.vg-aspect-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      VG.selectedAspect = btn.dataset.aspect;
      saveProjectMemory(VG.activeProjectId);
    });
  });

  // Duration
  $$('.vg-dur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.vg-dur-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      VG.selectedDur = parseInt(btn.dataset.dur, 10);
      saveProjectMemory(VG.activeProjectId);
    });
  });

  // Enhance mode buttons
  $$('.vg-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setEnhanceMode(btn.dataset.mode));
  });

  // Prompt char count
  $('vg-prompt')?.addEventListener('input', updateCharCount);

  // Enhance prompt
  $('btn-enhance-prompt')?.addEventListener('click', enhancePrompt);

  // Generate
  $('btn-generate')?.addEventListener('click', generate);

  // Style preset clear
  $('btn-clear-preset')?.addEventListener('click', clearPreset);

  // Seed controls
  $('btn-randomize-seed')?.addEventListener('click', randomizeSeed);
  $('btn-lock-seed')?.addEventListener('click', toggleSeedLock);

  // Quality reset
  $('btn-reset-quality')?.addEventListener('click', resetQuality);

  // Storyboard view toggle
  $('btn-toggle-view')?.addEventListener('click', toggleStoryboardView);

  // Upgrade button — open upgrade modal (Item 2)
  $('btn-upgrade')?.addEventListener('click', openUpgradeModal);

  // Upgrade modal
  $('btn-close-upgrade-modal')?.addEventListener('click', closeUpgradeModal);
  $('upgrade-modal-overlay')?.addEventListener('click', e => {
    if (e.target === $('upgrade-modal-overlay')) closeUpgradeModal();
  });
  document.querySelectorAll('[data-upgrade-tier]').forEach(btn => {
    btn.addEventListener('click', () => startCheckout(btn.dataset.upgradeTier));
  });

  // Character modal (Item 5)
  $('btn-add-character')?.addEventListener('click', openCharModal);
  $('btn-close-char-modal')?.addEventListener('click', closeCharModal);
  $('btn-cancel-char-modal')?.addEventListener('click', closeCharModal);
  $('char-modal-overlay')?.addEventListener('click', e => {
    if (e.target === $('char-modal-overlay')) closeCharModal();
  });
  $('btn-save-char')?.addEventListener('click', saveCharacter);
  $('btn-char-browse')?.addEventListener('click', () => $('char-file-input')?.click());
  $('char-file-input')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) handleCharFileSelect(file);
  });

  // Escape key closes overlays
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeProjectModal();
      closeBibleModal();
      closeSettings();
      closePlayer();
      closeCharModal();
      closeUpgradeModal();
      closeDirectorPanel();
    }
  });

  // #10 — AI Creative Director
  $('btn-open-director')?.addEventListener('click', openDirectorPanel);
  $('btn-close-director')?.addEventListener('click', closeDirectorPanel);
  $('btn-director-run')?.addEventListener('click', runDirector);
  $('btn-director-queue-all')?.addEventListener('click', queueAllDirectorShots);
  $('vg-director-concept')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runDirector();
  });

  // Init upload zone
  initUploadZone();

  // Init quality sliders
  initQualitySliders();

  // Init enhance mode label
  setEnhanceMode(VG.enhanceMode);

  // Init model type badge
  updateImageRequirement(VG.selectedModel);

  // Init pre-publish script scorer
  initPrescore();
}

/* ════════════════════════════════════════════════════════════════
   ANALYTICS MODULE
   View switcher · /api/analytics fetch · SVG chart · tables
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* ── ANALYTICS STATE ──────────────────────────────────────────── */
const AN = {
  data:         null,
  range:        '30d',
  modelFilter:  'all',
  focusedModel: null,
  loading:      false,
};

/* ── MODEL FAMILY COLOURS ─────────────────────────────────────── */
const MODEL_COLOURS = {
  dop:      '#7C6AF7',
  soul:     '#34D399',
  kling:    '#60A5FA',
  seedance: '#FB923C',
  flux:     '#F472B6',
  other:    '#6B7280',
};

/* ── VIEW SWITCHER ────────────────────────────────────────────── */
function initViewSwitcher() {
  const btnStudio    = $('btn-show-studio');
  const btnAnalytics = $('btn-show-analytics');
  const btnCompare   = $('btn-show-compare');
  const btnTimeline  = $('btn-show-timeline');
  const studioEl     = $('vg-app');
  const analyticsEl  = $('vg-analytics');
  const compareEl    = $('vg-compare');
  const timelineEl   = $('vg-timeline');

  if (!btnStudio || !btnAnalytics) return;

  const allBtns  = [btnStudio, btnAnalytics, btnCompare, btnTimeline].filter(Boolean);
  const allViews = [
    { el: studioEl,   display: 'flex'  },
    { el: analyticsEl,display: 'block' },
    { el: compareEl,  display: 'flex'  },
    { el: timelineEl, display: 'flex'  },
  ];

  function showView(activeBtn, activeEl, display, onSwitch) {
    allBtns.forEach(b  => b.classList.remove('active'));
    allViews.forEach(v => { if (v.el) v.el.style.display = 'none'; });
    activeBtn.classList.add('active');
    if (activeEl) activeEl.style.display = display;
    if (onSwitch) onSwitch();
  }

  btnStudio.addEventListener('click', () => {
    showView(btnStudio, studioEl, 'flex');
  });

  btnAnalytics.addEventListener('click', () => {
    if (!VG.user) { showToast('Sign in to view analytics', true); return; }
    showView(btnAnalytics, analyticsEl, 'block', () => {
      if (!AN.data) loadAnalytics();
    });
  });

  if (btnCompare) {
    btnCompare.addEventListener('click', () => {
      if (!VG.user) { showToast('Sign in to use Compare', true); return; }
      showView(btnCompare, compareEl, 'flex', () => initCompareView());
    });
  }

  if (btnTimeline) {
    btnTimeline.addEventListener('click', () => {
      if (!VG.user) { showToast('Sign in to use Timeline', true); return; }
      showView(btnTimeline, timelineEl, 'flex', () => initTimelineView());
    });
  }

  btnStudio.classList.add('active');
}

/* ── RANGE + MODEL FILTER CONTROLS ───────────────────────────── */
function initAnalyticsControls() {
  document.querySelectorAll('.an-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.an-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AN.range = btn.dataset.range;
      loadAnalytics();
    });
  });

  document.querySelectorAll('.an-model-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.an-model-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AN.modelFilter  = btn.dataset.model;
      AN.focusedModel = null;
      if (AN.data) renderAnalytics(AN.data);
    });
  });

  const refreshBtn = $('btn-an-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('spinning');
      loadAnalytics().finally(() => refreshBtn.classList.remove('spinning'));
    });
  }
}

/* ── LOAD ANALYTICS ───────────────────────────────────────────── */
async function loadAnalytics() {
  if (AN.loading) return;
  AN.loading = true;
  setAnalyticsLoading(true);

  try {
    const res  = await api('GET', `/api/analytics?range=${AN.range}`);
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to load analytics', true);
      setAnalyticsLoading(false);
      return;
    }

    AN.data = data;
    renderAnalytics(data);
  } catch (err) {
    console.error('Analytics load error:', err);
    showToast('Failed to load analytics', true);
    setAnalyticsLoading(false);
  } finally {
    AN.loading = false;
  }
}

function setAnalyticsLoading(loading) {
  if (!loading) return;
  const html = '<div class="an-loading-state">Loading…</div>';
  ['an-model-table-wrap','an-compare-bars','an-project-list',
   'an-status-row','an-dur-bars','an-aspect-wrap','an-deep-cards'].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = html;
  });
}

function filteredModels(allModels) {
  if (AN.modelFilter === 'all') return allModels;
  return allModels.filter(m => m.family === AN.modelFilter);
}

/* ── RENDER ALL ANALYTICS ─────────────────────────────────────── */
function renderAnalytics(data) {
  const models = filteredModels(data.models || []);
  renderSummaryCards(data, models);
  renderActivityChart(data.daily || []);
  renderModelTable(models);
  renderCompareBars(models);
  renderDurationBars(data.duration || []);
  renderAspectRatio(data.aspect_ratio || []);
  renderProjectVelocity(data.projects || []);
  renderStatusBreakdown(data.overview || {}, models);
  renderDeepDive(AN.focusedModel, models);

  const periodBadge = $('an-activity-period');
  if (periodBadge) {
    const labels = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', all: 'All time' };
    periodBadge.textContent = labels[AN.range] || AN.range;
  }
}

/* ── SUMMARY CARDS ────────────────────────────────────────────── */
function renderSummaryCards(data, filteredMods) {
  const ov = data.overview || {};

  let totalReqs   = ov.total_shots  || 0;
  let successRate = ov.success_rate || 0;
  let totalSecs   = ov.total_seconds || 0;
  let totalCost   = parseFloat(ov.total_cost_usd || 0);

  if (AN.modelFilter !== 'all' && filteredMods.length > 0) {
    totalReqs   = filteredMods.reduce((a, m) => a + (m.total || 0), 0);
    const completed = filteredMods.reduce((a, m) => a + (m.completed || 0), 0);
    successRate = totalReqs > 0 ? Math.round((completed / totalReqs) * 100) : 0;
    totalSecs   = filteredMods.reduce((a, m) => a + (m.total_seconds_gen || 0), 0);
    totalCost   = filteredMods.reduce((a, m) => a + parseFloat(m.est_cost_usd || 0), 0);
  }

  let p50 = null, p90 = null;
  const modelsWithSpeed = filteredMods.filter(m => m.p50_gen_sec != null && m.total > 0);
  if (modelsWithSpeed.length > 0) {
    const tw = modelsWithSpeed.reduce((a, m) => a + m.total, 0);
    p50 = Math.round(modelsWithSpeed.reduce((a, m) => a + (m.p50_gen_sec * m.total), 0) / tw);
    p90 = Math.round(modelsWithSpeed.reduce((a, m) => a + (m.p90_gen_sec * m.total), 0) / tw);
  } else if (AN.modelFilter === 'all') {
    p50 = ov.avg_gen_time_sec ? Math.round(ov.avg_gen_time_sec) : null;
    p90 = ov.avg_gen_time_sec ? Math.round(ov.avg_gen_time_sec * 1.3) : null;
  }

  setText('an-total-requests', totalReqs.toLocaleString());
  setText('an-total-sub',     `${filteredMods.length || data.models?.length || 0} model${(filteredMods.length || 1) !== 1 ? 's' : ''} active`);
  setText('an-success-rate',  `${successRate}%`);
  setText('an-speed-p50',     p50 != null ? `${p50}s` : '—');
  setText('an-speed-p90',     p90 != null ? `${p90}s` : '—');
  setText('an-total-cost',    `$${totalCost.toFixed(2)}`);
  setText('an-total-seconds', `${totalSecs}s`);

  const bar = $('an-success-bar');
  if (bar) {
    bar.style.background = successRate >= 80 ? 'var(--green)' : successRate >= 50 ? 'var(--yellow)' : 'var(--red)';
    requestAnimationFrame(() => { bar.style.width = `${successRate}%`; });
  }
}

/* ── ACTIVITY CHART (SVG) ─────────────────────────────────────── */
function renderActivityChart(dailyData) {
  const svg     = $('an-activity-svg');
  const emptyEl = $('an-activity-empty');
  if (!svg) return;

  if (!dailyData.length) {
    svg.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const W = 700, H = 100, LABEL_H = 18;
  const padL = 4, padR = 4;
  const chartW = W - padL - padR;
  const chartH = H - LABEL_H;

  const maxVal = Math.max(...dailyData.map(d => d.total || 0), 1);
  const n      = dailyData.length;
  const bw     = Math.max(2, (chartW / n) - 2);
  const gap    = (chartW - bw * n) / Math.max(n - 1, 1);

  let svgContent = `<line class="bar-axis" x1="${padL}" y1="${H - LABEL_H}" x2="${W - padR}" y2="${H - LABEL_H}"/>`;

  dailyData.forEach((d, i) => {
    const x         = padL + i * (bw + gap);
    const total     = d.total     || 0;
    const completed = d.completed || 0;
    const failed    = d.failed    || 0;

    const hTotal     = total     > 0 ? Math.max((total     / maxVal) * chartH, 2) : 0;
    const hCompleted = completed > 0 ? Math.max((completed / maxVal) * chartH, 2) : 0;
    const hFailed    = failed    > 0 ? Math.max((failed    / maxVal) * chartH, 2) : 0;

    if (hTotal > 0) {
      svgContent += `<rect class="bar-completed" x="${x}" y="${(H - LABEL_H) - hCompleted}" width="${bw}" height="${hCompleted}" rx="1"/>`;
      if (hFailed > 0) {
        svgContent += `<rect class="bar-failed" x="${x}" y="${(H - LABEL_H) - hCompleted - hFailed}" width="${bw}" height="${hFailed}" rx="1"/>`;
      }
    }

    const step = n <= 10 ? 1 : n <= 20 ? 2 : n <= 31 ? 3 : 7;
    if (i % step === 0) {
      const dayLabel = d.day ? d.day.slice(5) : '';
      svgContent += `<text class="bar-label" x="${x + bw / 2}" y="${H}">${escHtml(dayLabel)}</text>`;
    }
  });

  svg.innerHTML = svgContent;
}

/* ── MODEL TABLE ──────────────────────────────────────────────── */
function renderModelTable(models) {
  const wrap = $('an-model-table-wrap');
  if (!wrap) return;

  if (!models.length) {
    wrap.innerHTML = '<div class="an-empty-state">No generation data yet.<br>Generate some shots to see model analytics here.</div>';
    return;
  }

  const rows = models.map(m => {
    const rateClass = m.success_rate >= 80 ? 'an-rate-high' : m.success_rate >= 50 ? 'an-rate-mid' : 'an-rate-low';
    const p50       = m.p50_gen_sec != null ? `${m.p50_gen_sec}s` : '—';
    const p90       = m.p90_gen_sec != null ? `${m.p90_gen_sec}s` : '—';
    const focused   = AN.focusedModel === m.model ? ' class="focused"' : '';
    return `
      <tr data-model-id="${escAttr(m.model)}"${focused}>
        <td>
          <div class="an-model-name">
            <span class="an-model-family-pip an-family-${escAttr(m.family)}"></span>
            ${escHtml(m.label)}
          </div>
        </td>
        <td style="text-align:right;font-family:'Space Mono',monospace;color:var(--text-primary);font-weight:700">${m.total}</td>
        <td><span class="an-rate-pill ${rateClass}">${m.success_rate}%</span></td>
        <td><span class="an-speed-val">${p50}</span></td>
        <td><span class="an-speed-val">${p90}</span></td>
        <td><span class="an-cost-val">$${m.est_cost_usd}</span></td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="an-model-table">
      <thead>
        <tr>
          <th>Model</th>
          <th style="text-align:right">Reqs</th>
          <th>Success</th>
          <th>P50</th>
          <th>P90</th>
          <th>Est. Cost</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  wrap.querySelectorAll('tr[data-model-id]').forEach(row => {
    row.addEventListener('click', () => {
      const mid = row.dataset.modelId;
      AN.focusedModel = AN.focusedModel === mid ? null : mid;
      renderModelTable(models);
      renderDeepDive(AN.focusedModel, models);
    });
  });
}

/* ── COMPARE BARS ─────────────────────────────────────────────── */
function renderCompareBars(models) {
  const wrap = $('an-compare-bars');
  if (!wrap) return;

  if (!models.length) { wrap.innerHTML = '<div class="an-empty-state">No data yet.</div>'; return; }

  const sorted = [...models].sort((a, b) => b.success_rate - a.success_rate);
  wrap.innerHTML = sorted.map(m => {
    const colour = MODEL_COLOURS[m.family] || MODEL_COLOURS.other;
    return `
      <div class="an-cmp-row">
        <div class="an-cmp-label" title="${escAttr(m.label)}">${escHtml(m.label)}</div>
        <div class="an-cmp-track">
          <div class="an-cmp-fill" style="width:${m.success_rate}%;background:${colour}"></div>
        </div>
        <div class="an-cmp-pct">${m.success_rate}%</div>
      </div>`;
  }).join('');
}

/* ── DURATION DISTRIBUTION ────────────────────────────────────── */
function renderDurationBars(durationData) {
  const wrap = $('an-dur-bars');
  if (!wrap) return;

  if (!durationData.length) { wrap.innerHTML = '<div class="an-empty-state">No data yet.</div>'; return; }

  const maxCount = Math.max(...durationData.map(d => d.count || 0), 1);
  wrap.innerHTML = durationData.map(d => {
    const pct = Math.round(((d.count || 0) / maxCount) * 100);
    return `
      <div class="an-dur-row">
        <div class="an-dur-label">${d.duration || '?'}s</div>
        <div class="an-dur-bar-track">
          <div class="an-dur-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="an-dur-count">${d.count}</div>
      </div>`;
  }).join('');
}

/* ── ASPECT RATIO CHIPS ───────────────────────────────────────── */
function renderAspectRatio(aspectData) {
  const wrap = $('an-aspect-wrap');
  if (!wrap) return;

  if (!aspectData.length) { wrap.innerHTML = '<div class="an-empty-state">No data yet.</div>'; return; }

  const total = aspectData.reduce((a, d) => a + (d.count || 0), 0) || 1;
  const dims  = {
    '16:9': { w: 32, h: 18 }, '9:16': { w: 16, h: 28 },
    '1:1':  { w: 24, h: 24 }, '4:5':  { w: 20, h: 25 },
    '4:3':  { w: 28, h: 21 }, '3:4':  { w: 21, h: 28 },
  };

  wrap.innerHTML = aspectData.map(d => {
    const pct = Math.round(((d.count || 0) / total) * 100);
    const dim = dims[d.aspect_ratio] || { w: 24, h: 24 };
    return `
      <div class="an-aspect-chip">
        <div class="an-aspect-ratio-vis" style="width:${dim.w}px;height:${dim.h}px"></div>
        <div class="an-aspect-chip-label">${escHtml(d.aspect_ratio || '?')}</div>
        <div class="an-aspect-chip-count">${d.count}</div>
        <div class="an-aspect-chip-pct">${pct}%</div>
      </div>`;
  }).join('');
}

/* ── PROJECT VELOCITY ─────────────────────────────────────────── */
function renderProjectVelocity(projects) {
  const wrap = $('an-project-list');
  if (!wrap) return;

  const active = projects.filter(p => (p.total_shots || 0) > 0);
  if (!active.length) {
    wrap.innerHTML = '<div class="an-proj-empty">No projects with shots yet.</div>';
    return;
  }

  let html = `
    <div class="an-proj-row" style="opacity:0.5;font-size:0.62rem;text-transform:uppercase;letter-spacing:0.06em">
      <div style="color:var(--text-muted)">Project</div>
      <div style="color:var(--text-muted);text-align:right">Shots</div>
      <div style="color:var(--text-muted);text-align:right">Done</div>
    </div>`;

  html += active.map(p => {
    const pct      = p.total_shots > 0 ? Math.round(((p.completed_shots || 0) / p.total_shots) * 100) : 0;
    const rateStyle = pct >= 80 ? 'color:var(--green)' : pct >= 50 ? 'color:var(--yellow)' : 'color:var(--red)';
    return `
      <div class="an-proj-row">
        <div class="an-proj-name" title="${escAttr(p.name)}">${escHtml(p.name)}</div>
        <div class="an-proj-shots">${p.total_shots}</div>
        <div class="an-proj-rate" style="${rateStyle}">${pct}%</div>
      </div>`;
  }).join('');

  wrap.innerHTML = html;
}

/* ── STATUS BREAKDOWN ─────────────────────────────────────────── */
function renderStatusBreakdown(overview, models) {
  const wrap = $('an-status-row');
  if (!wrap) return;

  let completed = overview.completed || 0;
  let failed    = overview.failed    || 0;
  let nsfw      = overview.nsfw      || 0;
  let active    = overview.active    || 0;

  if (AN.modelFilter !== 'all' && models.length > 0) {
    completed = models.reduce((a, m) => a + (m.completed || 0), 0);
    failed    = models.reduce((a, m) => a + (m.failed    || 0), 0);
    nsfw      = models.reduce((a, m) => a + (m.nsfw      || 0), 0);
    active    = models.reduce((a, m) => a + (m.active    || 0), 0);
  }

  wrap.innerHTML = `
    <div class="an-status-seg completed" title="${completed} completed">
      <div class="an-seg-val">${completed}</div>
      <div class="an-seg-label">Done</div>
    </div>
    <div class="an-status-seg active" title="${active} in progress">
      <div class="an-seg-val">${active}</div>
      <div class="an-seg-label">Active</div>
    </div>
    <div class="an-status-seg failed" title="${failed} failed">
      <div class="an-seg-val">${failed}</div>
      <div class="an-seg-label">Failed</div>
    </div>
    <div class="an-status-seg nsfw" title="${nsfw} blocked">
      <div class="an-seg-val">${nsfw}</div>
      <div class="an-seg-label">NSFW</div>
    </div>`;
}

/* ── PER-MODEL DEEP DIVE ──────────────────────────────────────── */
function renderDeepDive(modelId, models) {
  const wrap  = $('an-deep-cards');
  const panel = $('an-model-deep');
  if (!wrap || !panel) return;

  if (!modelId) {
    wrap.innerHTML = '<div class="an-loading-state" style="color:var(--text-muted)">Click a model row above to drill into its metrics</div>';
    const hint = panel.querySelector('.an-panel-hint');
    if (hint) hint.textContent = 'click a model in the table above to focus';
    return;
  }

  const m = models.find(mo => mo.model === modelId);
  if (!m) {
    wrap.innerHTML = '<div class="an-loading-state">Model not found in current filter</div>';
    return;
  }

  const hint = panel.querySelector('.an-panel-hint');
  if (hint) hint.textContent = m.label;

  const colour     = MODEL_COLOURS[m.family] || MODEL_COLOURS.other;
  const costPerGen = m.total > 0 ? (parseFloat(m.est_cost_usd || 0) / m.total).toFixed(3) : '0.000';
  const outputMins = m.total_seconds_gen ? (m.total_seconds_gen / 60).toFixed(1) : '0.0';
  const errRate    = m.total > 0 ? Math.round((((m.failed || 0) + (m.nsfw || 0)) / m.total) * 100) : 0;

  const cards = [
    { label: 'Total Requests',   value: m.total,                                         sub: `${m.total} generations` },
    { label: 'Completed',        value: m.completed || 0,                                sub: `${m.success_rate}% success rate` },
    { label: 'Failed / Blocked', value: `${(m.failed || 0) + (m.nsfw || 0)}`,            sub: `${errRate}% error rate` },
    { label: 'Speed P50',        value: m.p50_gen_sec != null ? `${m.p50_gen_sec}s` : '—', sub: 'median gen time' },
    { label: 'Speed P90',        value: m.p90_gen_sec != null ? `${m.p90_gen_sec}s` : '—', sub: '90th percentile' },
    { label: 'Min Gen Time',     value: m.min_gen_sec != null ? `${Math.round(m.min_gen_sec)}s` : '—', sub: 'fastest job' },
    { label: 'Max Gen Time',     value: m.max_gen_sec != null ? `${Math.round(m.max_gen_sec)}s` : '—', sub: 'slowest job' },
    { label: 'Est. Total Cost',  value: `$${m.est_cost_usd}`,                            sub: `$${costPerGen} per gen` },
    { label: 'Output Video',     value: `${m.total_seconds_gen || 0}s`,                  sub: `${outputMins} mins generated` },
    { label: 'Active Jobs',      value: m.active || 0,                                   sub: 'currently running' },
  ];

  wrap.innerHTML = cards.map(card => `
    <div class="an-deep-card" style="border-color:${colour}22">
      <div class="an-deep-card-label">${escHtml(card.label)}</div>
      <div class="an-deep-card-value" style="color:${colour}">${escHtml(String(card.value))}</div>
      <div class="an-deep-card-sub">${escHtml(card.sub)}</div>
    </div>`).join('');
}

/* ── setText HELPER ───────────────────────────────────────────── */
function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

/* ════════════════════════════════════════════════════════════════
   PRE-PUBLISH SCRIPT SCORER
   Lite panel embedded in Video Generator — scores prompts before
   the user spends a generation credit.
   ════════════════════════════════════════════════════════════════ */

/* ── State ───────────────────────────────────────────────────── */
const PRESCORE = {
  open:           false,
  loading:        false,
  lastPrompt:     '',
  debounceTimer:  null,
  DEBOUNCE_MS:    1400,          // ms idle before auto-rescore
  MIN_AUTO_LEN:   30,            // minimum prompt length for auto-score
};

/* ── Init — called from bindUI() ─────────────────────────────── */
function initPrescore() {
  // Open / close toggle on Score Script button
  $('btn-prescore')?.addEventListener('click', togglePrescorePanel);

  // Close button inside panel
  $('btn-prescore-close')?.addEventListener('click', closePrescorePanel);

  // Apply improved prompt
  $('btn-prescore-apply')?.addEventListener('click', applyImprovedPrompt);

  // Auto-rescore: debounced on prompt input
  $('vg-prompt')?.addEventListener('input', onPromptInputForPrescore);
}

/* ── Open / Close ────────────────────────────────────────────── */
function togglePrescorePanel() {
  if (PRESCORE.open) {
    closePrescorePanel();
  } else {
    openPrescorePanel();
  }
}

function openPrescorePanel() {
  const panel = $('vg-prescore-panel');
  if (!panel) return;
  PRESCORE.open = true;
  panel.style.display = 'flex';
  // Show empty state if no results yet, else keep existing results
  const results  = $('vg-prescore-results');
  const loading  = $('vg-prescore-loading');
  const empty    = $('vg-prescore-empty');
  if (!results || results.style.display === 'none') {
    showPrescoreState('empty');
  }
  // Auto-run if there is already a prompt
  const prompt = ($('vg-prompt')?.value || '').trim();
  if (prompt.length >= PRESCORE.MIN_AUTO_LEN && (!PRESCORE.lastPrompt || PRESCORE.lastPrompt !== prompt)) {
    runPrescore();
  }
}

function closePrescorePanel() {
  const panel = $('vg-prescore-panel');
  if (!panel) return;
  PRESCORE.open = false;
  panel.style.display = 'none';
}

/* ── State helpers ───────────────────────────────────────────── */
function showPrescoreState(state) {
  // state: 'loading' | 'results' | 'empty'
  const loading = $('vg-prescore-loading');
  const results = $('vg-prescore-results');
  const empty   = $('vg-prescore-empty');
  if (loading) loading.style.display = state === 'loading' ? 'flex' : 'none';
  if (results) results.style.display = state === 'results' ? 'block' : 'none';
  if (empty)   empty.style.display   = state === 'empty'   ? 'flex'  : 'none';
}

/* ── Core scoring function ───────────────────────────────────── */
async function runPrescore() {
  if (PRESCORE.loading) return;

  const prompt       = ($('vg-prompt')?.value || '').trim();
  const platform     = VG.platform || 'instagram';
  const model        = VG.selectedModel || '';
  const style_preset = VG.selectedPreset || '';

  if (!prompt) {
    if (PRESCORE.open) showPrescoreState('empty');
    return;
  }

  PRESCORE.loading    = true;
  PRESCORE.lastPrompt = prompt;

  // Open panel automatically if not already open
  if (!PRESCORE.open) openPrescorePanel();
  showPrescoreState('loading');

  try {
    const res  = await api('POST', '/api/attention/prescore', { prompt, platform, model, style_preset });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Scoring failed');

    renderPrescoreResults(data);
    showPrescoreState('results');
  } catch (err) {
    showToast('Script scoring failed: ' + err.message, true);
    showPrescoreState('empty');
  } finally {
    PRESCORE.loading = false;
  }
}

/* ── Render results ──────────────────────────────────────────── */
function renderPrescoreResults(data) {
  const score   = Math.max(0, Math.min(100, Math.round(data.hook_score || 0)));
  const verdict = data.verdict        || '';
  const issue   = data.biggest_issue  || '';
  const fix     = data.fix            || '';
  const improved= data.improved_prompt|| '';
  const flags   = Array.isArray(data.flags) ? data.flags : [];

  /* ── Score ring ── */
  const ring = $('vg-prescore-ring-fill');
  if (ring) {
    const radius      = parseFloat(ring.getAttribute('r') || '28');
    const circumf     = 2 * Math.PI * radius;
    const dashOffset  = circumf - (circumf * score / 100);
    ring.style.strokeDasharray  = `${circumf}`;
    ring.style.strokeDashoffset = `${dashOffset}`;
    // Remove old colour classes
    ring.classList.remove('vg-prescore-ring-great','vg-prescore-ring-good','vg-prescore-ring-ok','vg-prescore-ring-weak','vg-prescore-ring-dead');
    if      (score >= 85) ring.classList.add('vg-prescore-ring-great');
    else if (score >= 70) ring.classList.add('vg-prescore-ring-good');
    else if (score >= 50) ring.classList.add('vg-prescore-ring-ok');
    else if (score >= 30) ring.classList.add('vg-prescore-ring-weak');
    else                  ring.classList.add('vg-prescore-ring-dead');
  }

  const numEl = $('vg-prescore-num');
  if (numEl) numEl.textContent = score;

  /* ── Verdict ── */
  const verdictEl = $('vg-prescore-verdict');
  if (verdictEl) verdictEl.textContent = verdict;

  /* ── Flags ── */
  const flagsEl = $('vg-prescore-flags');
  if (flagsEl) {
    if (flags.length > 0) {
      flagsEl.style.display = 'flex';
      flagsEl.innerHTML = flags.map(f =>
        `<span class="vg-prescore-flag">${escHtml(f)}</span>`
      ).join('');
    } else {
      flagsEl.style.display = 'none';
      flagsEl.innerHTML = '';
    }
  }

  /* ── Biggest issue ── */
  const issueEl = $('vg-prescore-issue');
  if (issueEl) issueEl.textContent = issue || '—';

  /* ── Fix ── */
  const fixEl = $('vg-prescore-fix');
  if (fixEl) fixEl.textContent = fix || '—';

  /* ── Improved prompt ── */
  const improvedEl = $('vg-prescore-improved');
  if (improvedEl) {
    improvedEl.textContent = improved;
    improvedEl.dataset.improved = improved;
  }

  /* ── Improved wrap — hide if no suggestion ── */
  const improvedWrap = $('vg-prescore-improved-wrap');
  if (improvedWrap) improvedWrap.style.display = improved ? 'block' : 'none';
}

/* ── Apply improved prompt to textarea ──────────────────────── */
function applyImprovedPrompt() {
  const improvedEl = $('vg-prescore-improved');
  const textarea   = $('vg-prompt');
  if (!improvedEl || !textarea) return;

  const improved = improvedEl.dataset.improved || improvedEl.textContent || '';
  if (!improved) return;

  textarea.value = improved;
  updateCharCount();
  PRESCORE.lastPrompt = improved;
  showToast('Improved prompt applied ✓');
}

/* ── Debounced auto-rescore on prompt input ──────────────────── */
function onPromptInputForPrescore() {
  if (!PRESCORE.open) return;               // only auto-score if panel is open
  clearTimeout(PRESCORE.debounceTimer);
  PRESCORE.debounceTimer = setTimeout(() => {
    const prompt = ($('vg-prompt')?.value || '').trim();
    if (prompt.length >= PRESCORE.MIN_AUTO_LEN && prompt !== PRESCORE.lastPrompt) {
      runPrescore();
    }
  }, PRESCORE.DEBOUNCE_MS);
}

/* ═══════════════════════════════════════════════════════════════
   SHOT COMPARISON  —  A/B Viewer
   ═══════════════════════════════════════════════════════════════ */

const COMPARE = {
  selected: [],      // array of shot IDs selected for comparison
  MAX: 4,
  syncEnabled: true,
  winner: null,
};

/* ── Toggle compare-selection on a shot card ─────────────────── */
function toggleCompareSelect(shotId, projectId) {
  const idx = COMPARE.selected.indexOf(shotId);
  if (idx !== -1) {
    COMPARE.selected.splice(idx, 1);
  } else {
    if (COMPARE.selected.length >= COMPARE.MAX) {
      showToast(`Max ${COMPARE.MAX} shots for comparison`);
      return;
    }
    COMPARE.selected.push(shotId);
  }
  refreshCompareUI(projectId);
}

function refreshCompareUI(projectId) {
  const n   = COMPARE.selected.length;
  const btn = $('btn-open-compare');
  const badge = $('compare-badge');
  if (btn)   { btn.disabled = n < 2; }
  if (badge) { badge.textContent = n; }

  // Highlight selected shot cards
  document.querySelectorAll('.vg-shot-card').forEach(card => {
    const id = card.dataset.shotId;
    if (COMPARE.selected.includes(id)) {
      card.classList.add('compare-selected');
    } else {
      card.classList.remove('compare-selected');
    }
  });
}

/* ── Open compare modal ──────────────────────────────────────── */
function openCompareModal(projectId) {
  if (COMPARE.selected.length < 2) {
    showToast('Select at least 2 shots to compare');
    return;
  }
  const shots = (VG.shots[projectId] || []).filter(s => COMPARE.selected.includes(s.id));
  if (shots.length < 2) {
    showToast('Could not find selected shots');
    return;
  }
  COMPARE.winner = null;
  renderCompareModal(shots);
  $('compare-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCompareModal() {
  $('compare-overlay').classList.remove('open');
  document.body.style.overflow = '';
  // Pause all videos
  document.querySelectorAll('#compare-grid video').forEach(v => v.pause());
}

/* ── Render compare modal contents ──────────────────────────── */
function renderCompareModal(shots) {
  const n   = shots.length;
  const grid = $('compare-grid');
  const badge = $('compare-mode-badge');
  if (badge) badge.textContent = `${n}-UP`;
  grid.dataset.count = n;
  grid.style.setProperty('--compare-cols', n);

  const LABELS = ['A', 'B', 'C', 'D'];

  grid.innerHTML = shots.map((shot, i) => {
    const videoUrl = shot.video_url || shot.hf_video_url || '';
    const model    = (shot.model || '').split('/').pop() || '—';
    const dur      = shot.duration ? `${shot.duration}s` : '—';
    const ar       = shot.aspect_ratio || '16:9';

    const videoHtml = videoUrl
      ? `<video src="${escAttr(videoUrl)}" muted loop preload="auto"
           style="width:100%;height:100%;object-fit:contain;display:block;flex:1;min-height:0"></video>
         <div class="vg-compare-panel-overlay">
           <button class="vg-compare-panel-play" data-compare-panel="${i}" title="Play / Pause">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
           </button>
         </div>`
      : `<div class="vg-compare-no-video">
           <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 12h20"/></svg>
           No video
         </div>`;

    return `
      <div class="vg-compare-panel" data-compare-idx="${i}" data-shot-id="${shot.id}">
        <div class="vg-compare-panel-label">${LABELS[i]}</div>
        <div class="vg-compare-winner-badge">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          Winner
        </div>
        <div class="vg-tl-clip-thumb" style="flex:1;min-height:0;position:relative">
          ${videoHtml}
        </div>
        <div class="vg-compare-panel-meta">
          <div class="vg-compare-panel-prompt">${escHtml(shot.prompt || '')}</div>
          <div class="vg-compare-panel-stats">
            <span>${escHtml(model)}</span>
            <span>${escHtml(ar)} · ${dur}</span>
          </div>
        </div>
      </div>`;
  }).join('');

  // Render metadata diff table
  renderCompareMetaTable(shots);

  // Render winner buttons
  const winRow = $('compare-winner-row');
  winRow.innerHTML = shots.map((shot, i) => `
    <button class="vg-compare-winner-btn" data-winner-idx="${i}" data-shot-id="${shot.id}">
      ${LABELS[i]} — ${escHtml((shot.model || '').split('/').pop() || 'Shot ' + (i+1))}
    </button>`).join('');

  // Wire play/pause buttons
  grid.querySelectorAll('[data-compare-panel]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = +btn.dataset.comparePanel;
      toggleCompareVideo(idx);
    });
  });

  // Wire winner buttons
  winRow.querySelectorAll('.vg-compare-winner-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const shotId = btn.dataset.shotId;
      COMPARE.winner = shotId;
      winRow.querySelectorAll('.vg-compare-winner-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      // Highlight winner panel
      grid.querySelectorAll('.vg-compare-panel').forEach(p => {
        p.classList.toggle('winner', p.dataset.shotId === shotId);
      });
      showToast(`Shot ${btn.dataset.winnerIdx === '0' ? 'A' : ['B','C','D'][+btn.dataset.winnerIdx - 1]} selected as winner`);
    });
  });
}

function toggleCompareVideo(idx) {
  const panels = document.querySelectorAll('#compare-grid .vg-compare-panel');
  const panel  = panels[idx];
  if (!panel) return;
  const video = panel.querySelector('video');
  if (!video) return;

  if (COMPARE.syncEnabled) {
    // Sync all videos
    const allVideos = document.querySelectorAll('#compare-grid video');
    const playing   = !video.paused;
    allVideos.forEach(v => {
      if (playing) v.pause();
      else { v.currentTime = video.currentTime; v.play().catch(() => {}); }
    });
  } else {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }
}

/* ── Play All button ─────────────────────────────────────────── */
function comparePlayAll() {
  const allVideos = document.querySelectorAll('#compare-grid video');
  const anyPlaying = [...allVideos].some(v => !v.paused);
  allVideos.forEach(v => {
    if (anyPlaying) v.pause();
    else { v.currentTime = 0; v.play().catch(() => {}); }
  });
  const playAllBtn = $('compare-play-all');
  if (playAllBtn) {
    playAllBtn.innerHTML = anyPlaying
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play All`
      : `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause All`;
  }
}

/* ── Render metadata diff ────────────────────────────────────── */
function renderCompareMetaTable(shots) {
  const table = $('compare-meta-table');
  if (!table) return;
  table.style.setProperty('--compare-cols', shots.length);

  const FIELDS = [
    { key: 'model',        label: 'Model',    fmt: v => (v||'').split('/').pop() || '—' },
    { key: 'aspect_ratio', label: 'Ratio',    fmt: v => v || '—' },
    { key: 'duration',     label: 'Duration', fmt: v => v != null ? `${v}s` : '—' },
    { key: 'seed',         label: 'Seed',     fmt: v => v != null ? String(v) : '—' },
    { key: 'style_preset', label: 'Style',    fmt: v => v || '—' },
    { key: 'status',       label: 'Status',   fmt: v => v || '—' },
  ];

  table.innerHTML = FIELDS.map(field => {
    const vals = shots.map(s => field.fmt(s[field.key]));
    const allSame = vals.every(v => v === vals[0]);
    return `
      <div class="vg-compare-meta-row">
        <div class="vg-compare-meta-key">${field.label}</div>
        ${vals.map(v => `<div class="vg-compare-meta-val${!allSame ? ' diff' : ''}">${escHtml(v)}</div>`).join('')}
      </div>`;
  }).join('');
}

/* ── Export diff JSON ────────────────────────────────────────── */
function exportCompareDiff(projectId) {
  const shots = (VG.shots[projectId] || []).filter(s => COMPARE.selected.includes(s.id));
  const payload = {
    exported_at:  new Date().toISOString(),
    project_id:   projectId,
    winner_shot_id: COMPARE.winner || null,
    shots: shots.map((s, i) => ({
      label:        ['A','B','C','D'][i],
      id:           s.id,
      model:        s.model,
      aspect_ratio: s.aspect_ratio,
      duration:     s.duration,
      seed:         s.seed,
      style_preset: s.style_preset,
      prompt:       s.prompt,
      video_url:    s.video_url || s.hf_video_url || null,
      status:       s.status,
      created_at:   s.created_at,
      is_winner:    s.id === COMPARE.winner,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `spectra-compare-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
  showToast('Diff JSON exported');
}

/* ═══════════════════════════════════════════════════════════════
   SEQUENCE TIMELINE EDITOR
   ═══════════════════════════════════════════════════════════════ */

const TIMELINE = {
  projectId:    null,
  clips:        [],   // ordered array of shot objects
  dragSrcIdx:   null,
  seqPlaying:   false,
  seqQueue:     [],
  seqIndex:     0,
};

/* ── Open timeline panel ─────────────────────────────────────── */
function openTimeline(projectId) {
  const project = VG.projects.find(p => p.id === projectId);
  const shots   = (VG.shots[projectId] || [])
    .filter(s => s.status === 'completed' && (s.video_url || s.hf_video_url))
    .sort((a, b) => {
      if (a.sort_order != null && b.sort_order != null) return a.sort_order - b.sort_order;
      return new Date(a.created_at) - new Date(b.created_at);
    });

  TIMELINE.projectId = projectId;
  TIMELINE.clips     = [...shots];

  const nameEl = $('timeline-project-name');
  if (nameEl) nameEl.textContent = project ? project.name : '';

  renderTimeline();
  $('timeline-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeTimeline() {
  stopSeqPlayback();
  $('timeline-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* ── Render film-strip track ─────────────────────────────────── */
function renderTimeline() {
  const track     = $('timeline-track');
  const durEl     = $('timeline-total-duration');
  const statsEl   = $('timeline-stats');
  if (!track) return;

  const clips = TIMELINE.clips;

  if (clips.length === 0) {
    track.innerHTML = `
      <div class="vg-tl-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="2" y="7" width="4" height="10" rx="1"/><rect x="8" y="4" width="4" height="13" rx="1"/><rect x="14" y="9" width="4" height="8" rx="1"/></svg>
        No completed shots yet
      </div>`;
    if (durEl) durEl.textContent = '0:00 total';
    if (statsEl) statsEl.textContent = '0 shots';
    return;
  }

  const totalSec = clips.reduce((acc, s) => acc + (s.duration || 4), 0);
  if (durEl) durEl.textContent = `${formatTimecodeClient(totalSec)} total`;
  if (statsEl) statsEl.textContent = `${clips.length} shot${clips.length !== 1 ? 's' : ''}`;

  track.innerHTML = clips.map((shot, i) => {
    const videoUrl = shot.video_url || shot.hf_video_url || '';
    const dur      = shot.duration || 4;
    const model    = (shot.model || '').split('/').pop() || '';
    const prompt   = (shot.prompt || '').slice(0, 42) + ((shot.prompt || '').length > 42 ? '…' : '');
    const statusDot = shot.status === 'completed' ? 'done' : shot.status === 'failed' ? 'failed' : 'pending';

    return `
      <div class="vg-tl-clip" draggable="true" data-tl-idx="${i}" data-shot-id="${shot.id}">
        <div class="vg-tl-clip-thumb">
          ${videoUrl
            ? `<video src="${escAttr(videoUrl)}" muted preload="metadata" style="width:100%;height:100%;object-fit:cover"
                 onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>`
            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:rgba(232,244,253,0.2)">
                 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
               </div>`}
          <div class="vg-tl-clip-index">${i + 1}</div>
          <div class="vg-tl-clip-status-dot ${statusDot}"></div>
        </div>
        <div class="vg-tl-clip-footer">
          <div class="vg-tl-clip-label" title="${escAttr(shot.prompt || '')}">${escHtml(prompt)}</div>
          <div class="vg-tl-clip-dur">${escHtml(model)} · ${dur}s</div>
        </div>
        <div class="vg-tl-drag-handle" title="Drag to reorder">
          <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" opacity="0.5">
            <circle cx="7" cy="4" r="1.5"/><circle cx="13" cy="4" r="1.5"/>
            <circle cx="7" cy="10" r="1.5"/><circle cx="13" cy="10" r="1.5"/>
            <circle cx="7" cy="16" r="1.5"/><circle cx="13" cy="16" r="1.5"/>
          </svg>
        </div>
      </div>`;
  }).join('');

  // Render ruler
  renderTimelineRuler(totalSec);

  // Wire drag-and-drop
  initTimelineDragDrop();
}

/* ── Ruler ticks ─────────────────────────────────────────────── */
function renderTimelineRuler(totalSec) {
  const ruler = $('timeline-ruler');
  if (!ruler) return;
  ruler.innerHTML = '';
  if (totalSec <= 0) return;

  const clips   = TIMELINE.clips;
  const clipW   = 146; // 140px + 6px gap
  const padL    = 24;  // matches 1.5rem padding
  let cumSec    = 0;
  clips.forEach((shot, i) => {
    const x = padL + i * clipW;
    const tick = document.createElement('div');
    tick.className = 'vg-timeline-ruler-tick';
    tick.style.cssText = `left:${x}px;height:8px`;
    ruler.appendChild(tick);

    const label = document.createElement('div');
    label.className = 'vg-timeline-ruler-label';
    label.style.left = `${x}px`;
    label.textContent = formatTimecodeClient(cumSec);
    ruler.appendChild(label);

    cumSec += shot.duration || 4;
  });
}

/* ── Timeline drag-and-drop (horizontal reorder) ─────────────── */
function initTimelineDragDrop() {
  const track = $('timeline-track');
  if (!track) return;

  track.querySelectorAll('.vg-tl-clip').forEach(clip => {
    clip.addEventListener('dragstart', e => {
      TIMELINE.dragSrcIdx = +clip.dataset.tlIdx;
      clip.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    clip.addEventListener('dragend', () => {
      clip.classList.remove('dragging');
      track.querySelectorAll('.vg-tl-clip').forEach(c => c.classList.remove('drag-over'));
    });
    clip.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      track.querySelectorAll('.vg-tl-clip').forEach(c => c.classList.remove('drag-over'));
      clip.classList.add('drag-over');
    });
    clip.addEventListener('dragleave', () => clip.classList.remove('drag-over'));
    clip.addEventListener('drop', e => {
      e.preventDefault();
      const targetIdx = +clip.dataset.tlIdx;
      if (TIMELINE.dragSrcIdx === null || TIMELINE.dragSrcIdx === targetIdx) return;
      // Reorder
      const moved = TIMELINE.clips.splice(TIMELINE.dragSrcIdx, 1)[0];
      TIMELINE.clips.splice(targetIdx, 0, moved);
      TIMELINE.dragSrcIdx = null;
      renderTimeline();
      // Persist new order to storyboard via sort_order save
      saveTimelineOrder();
    });
  });
}

/* ── Save reordered sort_order to DB (mirrors storyboard reorder) */
async function saveTimelineOrder() {
  const projectId = TIMELINE.projectId;
  if (!projectId) return;
  try {
    const order = TIMELINE.clips.map((s, i) => ({ id: s.id, sort_order: i }));
    await api('PATCH', `/api/projects/${projectId}/shots/reorder`, { order });
    // Sync VG.shots order
    if (VG.shots[projectId]) {
      order.forEach(({ id, sort_order }) => {
        const s = VG.shots[projectId].find(x => x.id === id);
        if (s) s.sort_order = sort_order;
      });
      renderShotGrid(projectId);
    }
    showToast('Timeline order saved');
  } catch (err) {
    console.warn('Timeline reorder save failed:', err);
  }
}

/* ── Sort by creation date ───────────────────────────────────── */
function sortTimelineByDate() {
  TIMELINE.clips.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  renderTimeline();
  showToast('Sorted by creation date');
}

/* ── Export manifest JSON ────────────────────────────────────── */
async function exportTimelineManifest(projectId) {
  try {
    const res  = await api('POST', `/api/projects/${projectId}/timeline/export`, {
      clip_ids: TIMELINE.clips.map(s => s.id),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Export failed', true); return; }

    // Also build local manifest for immediate download
    const manifest = {
      exported_at:   new Date().toISOString(),
      project_id:    projectId,
      project_name:  (VG.projects.find(p => p.id === projectId) || {}).name || '',
      total_duration: TIMELINE.clips.reduce((a, s) => a + (s.duration || 4), 0),
      clip_count:    TIMELINE.clips.length,
      clips: TIMELINE.clips.map((shot, i) => ({
        index:        i + 1,
        shot_id:      shot.id,
        timecode_in:  formatTimecodeClient(TIMELINE.clips.slice(0, i).reduce((a, s) => a + (s.duration || 4), 0)),
        timecode_out: formatTimecodeClient(TIMELINE.clips.slice(0, i + 1).reduce((a, s) => a + (s.duration || 4), 0)),
        duration_sec: shot.duration || 4,
        model:        shot.model,
        aspect_ratio: shot.aspect_ratio,
        prompt:       shot.prompt,
        video_url:    shot.video_url || shot.hf_video_url || null,
        seed:         shot.seed,
        style_preset: shot.style_preset,
      })),
      server_manifest: data,
    };

    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `spectra-timeline-${projectId}-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast(`Manifest exported — ${manifest.clip_count} clips, ${manifest.total_duration}s total`);
  } catch (err) {
    showToast('Export error: ' + err.message, true);
  }
}

/* ── Sequence preview (play clips in order) ──────────────────── */
function startSeqPlayback() {
  const clips = TIMELINE.clips.filter(s => s.video_url || s.hf_video_url);
  if (clips.length === 0) { showToast('No playable clips in timeline'); return; }

  TIMELINE.seqPlaying = true;
  TIMELINE.seqQueue   = clips;
  TIMELINE.seqIndex   = 0;

  const preview = $('timeline-preview');
  if (preview) preview.style.display = 'flex';

  playNextSeqClip();
}

function playNextSeqClip() {
  if (!TIMELINE.seqPlaying) return;
  const clips = TIMELINE.seqQueue;
  if (TIMELINE.seqIndex >= clips.length) {
    stopSeqPlayback();
    showToast('Sequence complete');
    return;
  }
  const shot   = clips[TIMELINE.seqIndex];
  const video  = $('tl-preview-video');
  const label  = $('tl-preview-label');
  if (!video) return;

  if (label) label.textContent = `Shot ${TIMELINE.seqIndex + 1} / ${clips.length} — ${escHtml((shot.model || '').split('/').pop())}`;

  video.src = shot.video_url || shot.hf_video_url;
  video.onended = () => {
    TIMELINE.seqIndex++;
    playNextSeqClip();
  };
  video.play().catch(() => {});
}

function stopSeqPlayback() {
  TIMELINE.seqPlaying = false;
  const video = $('tl-preview-video');
  if (video) { video.pause(); video.src = ''; }
  const preview = $('timeline-preview');
  if (preview) preview.style.display = 'none';
}

/* ── Client-side timecode formatter ─────────────────────────── */
function formatTimecodeClient(totalSeconds) {
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/* ═══════════════════════════════════════════════════════════════
   EVENT WIRING  —  Compare + Timeline + board header buttons
   ═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Compare button in board header ───────────────────────── */
  const btnOpenCompare = $('btn-open-compare');
  if (btnOpenCompare) {
    btnOpenCompare.addEventListener('click', () => {
      openCompareModal(VG.activeProjectId);
    });
  }

  /* ── Compare modal close ───────────────────────────────────── */
  const compareClose = $('compare-close');
  if (compareClose) compareClose.addEventListener('click', closeCompareModal);

  const compareOverlay = $('compare-overlay');
  if (compareOverlay) {
    compareOverlay.addEventListener('click', e => {
      if (e.target === compareOverlay) closeCompareModal();
    });
  }

  /* ── Compare sync toggle ───────────────────────────────────── */
  const compareSyncBtn = $('compare-sync-btn');
  if (compareSyncBtn) {
    compareSyncBtn.addEventListener('click', () => {
      COMPARE.syncEnabled = !COMPARE.syncEnabled;
      compareSyncBtn.classList.toggle('active', COMPARE.syncEnabled);
    });
    compareSyncBtn.classList.add('active');
  }

  /* ── Compare play all ──────────────────────────────────────── */
  const comparePlayAll = $('compare-play-all');
  if (comparePlayAll) comparePlayAll.addEventListener('click', comparePlayAll_handler);
  function comparePlayAll_handler() { comparePlayAll(); }
  // Override — correct reference
  if (comparePlayAll) {
    comparePlayAll.replaceWith(comparePlayAll.cloneNode(true));
    $('compare-play-all').addEventListener('click', comparePlayAll);
  }

  /* ── Compare export JSON ───────────────────────────────────── */
  const compareExportBtn = $('compare-export-json');
  if (compareExportBtn) {
    compareExportBtn.addEventListener('click', () => {
      exportCompareDiff(VG.activeProjectId);
    });
  }

  /* ── Timeline open button ──────────────────────────────────── */
  const btnOpenTimeline = $('btn-open-timeline');
  if (btnOpenTimeline) {
    btnOpenTimeline.addEventListener('click', () => {
      openTimeline(VG.activeProjectId);
    });
  }

  /* ── Timeline close button ─────────────────────────────────── */
  const timelineClose = $('timeline-close');
  if (timelineClose) timelineClose.addEventListener('click', closeTimeline);

  const timelineOverlay = $('timeline-overlay');
  if (timelineOverlay) {
    timelineOverlay.addEventListener('click', e => {
      if (e.target === timelineOverlay) closeTimeline();
    });
  }

  /* ── Timeline shuffle / sort ───────────────────────────────── */
  const timelineShuffle = $('timeline-shuffle');
  if (timelineShuffle) timelineShuffle.addEventListener('click', sortTimelineByDate);

  /* ── Timeline export manifest ──────────────────────────────── */
  const timelineExport = $('timeline-export');
  if (timelineExport) {
    timelineExport.addEventListener('click', () => {
      exportTimelineManifest(TIMELINE.projectId);
    });
  }

  /* ── Timeline sequence preview ─────────────────────────────── */
  const tlPlaySeq = $('tl-play-seq');
  if (tlPlaySeq) tlPlaySeq.addEventListener('click', () => {
    if (TIMELINE.seqPlaying) stopSeqPlayback();
    else startSeqPlayback();
  });

  const tlStopSeq = $('tl-stop-seq');
  if (tlStopSeq) tlStopSeq.addEventListener('click', stopSeqPlayback);

  /* ── Keyboard shortcuts ────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('compare-overlay')?.classList.contains('open')) { closeCompareModal(); return; }
      if ($('timeline-overlay')?.classList.contains('open')) { closeTimeline(); return; }
    }
  });
});

/* ── Patch renderShotGrid to show Compare + Timeline buttons
      and wire compare-checkbox on each shot card ──────────────── */
const _origRenderShotGrid = renderShotGrid;
function renderShotGrid(projectId) {
  _origRenderShotGrid(projectId);

  // Show board header action buttons when a project is loaded
  const compareBtn  = $('btn-open-compare');
  const timelineBtn = $('btn-open-timeline');
  if (compareBtn)  compareBtn.style.display = '';
  if (timelineBtn) timelineBtn.style.display = '';

  // Reset compare selection when switching projects
  if (VG.activeProjectId !== projectId) {
    COMPARE.selected = [];
  }
  refreshCompareUI(projectId);

  // Wire compare checkbox on each shot card
  const grid = $('vg-shot-grid');
  if (!grid) return;

  grid.querySelectorAll('.vg-shot-card').forEach(card => {
    const shotId = card.dataset.shotId;
    if (!shotId) return;

    // Inject compare check button if not already present
    if (!card.querySelector('.vg-shot-compare-check')) {
      const shot = (VG.shots[projectId] || []).find(s => s.id === shotId);
      // Only add compare checkbox for completed shots with video
      if (shot && shot.status === 'completed' && (shot.video_url || shot.hf_video_url)) {
        const checkBtn = document.createElement('button');
        checkBtn.className = 'vg-shot-compare-check';
        checkBtn.title = 'Select for comparison';
        checkBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#7BB8D4" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
        checkBtn.addEventListener('click', e => {
          e.stopPropagation();
          toggleCompareSelect(shotId, projectId);
        });
        card.style.position = 'relative';
        card.appendChild(checkBtn);
      }
    }

    // Sync compare-selected class
    if (COMPARE.selected.includes(shotId)) {
      card.classList.add('compare-selected');
    }
  });
}

/* ════════════════════════════════════════════════════════════════
   COMPARE NAV-TAB VIEW — bridges to COMPARE overlay system
   The #vg-compare section acts as a full-page wrapper that hosts
   the same compare grid; clicking nav tab just switches the view
   and opens the compare flow inline rather than as a floating overlay.
   ════════════════════════════════════════════════════════════════ */

/* Called by initViewSwitcher when Compare tab is clicked */
function initCompareView() {
  const pid = VG.activeProjectId;

  // Populate the picker scroll with completed shots for this project
  const scroll = document.getElementById('vg-cmp-picker-scroll');
  const hint   = document.getElementById('vg-cmp-picker-hint');
  if (!scroll) return;

  const shots = (VG.shots[pid] || []).filter(s =>
    s.status === 'completed' && (s.video_url || s.hf_video_url)
  );

  if (!shots.length) {
    scroll.innerHTML = `<span class="vg-cmp-picker-empty">No completed shots in this project yet</span>`;
    if (hint) hint.textContent = '0 / 4 selected';
    renderCmpGrid([]);
    return;
  }

  // Sync COMPARE.selected state into picker UI
  scroll.innerHTML = shots.map((s, i) => {
    const vUrl = escAttr(s.video_url || s.hf_video_url);
    const sel  = COMPARE.selected.includes(s.id) ? 'selected' : '';
    return `
      <div class="vg-cmp-thumb ${sel}" data-shot-id="${s.id}" title="${escAttr(s.prompt || '')}">
        <video src="${vUrl}" muted preload="metadata" onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>
        <span class="vg-cmp-thumb-num">${i + 1}</span>
      </div>`;
  }).join('');

  scroll.querySelectorAll('.vg-cmp-thumb').forEach(el => {
    el.addEventListener('click', () => {
      const id  = el.dataset.shotId;
      const idx = COMPARE.selected.indexOf(id);
      if (idx >= 0) {
        COMPARE.selected.splice(idx, 1);
      } else {
        if (COMPARE.selected.length >= COMPARE.MAX) {
          showToast(`Max ${COMPARE.MAX} shots for comparison`);
          return;
        }
        COMPARE.selected.push(id);
      }
      // Sync selection UI
      scroll.querySelectorAll('.vg-cmp-thumb').forEach(t =>
        t.classList.toggle('selected', COMPARE.selected.includes(t.dataset.shotId))
      );
      if (hint) hint.textContent = `${COMPARE.selected.length} / 4 selected`;
      // Re-render inline grid
      const selectedShots = shots.filter(s => COMPARE.selected.includes(s.id));
      renderCmpGrid(selectedShots);
    });
  });

  if (hint) hint.textContent = `${COMPARE.selected.length} / 4 selected`;

  // Initial render with any already-selected shots
  const selectedShots = shots.filter(s => COMPARE.selected.includes(s.id));
  renderCmpGrid(selectedShots);
}

/* Render the inline compare grid inside #vg-compare section */
function renderCmpGrid(shots) {
  const grid    = document.getElementById('vg-cmp-grid');
  const winBar  = document.getElementById('vg-cmp-winner-bar');
  const winBtns = document.getElementById('vg-cmp-winner-btns');
  const winNote = document.getElementById('vg-cmp-winner-note');
  const syncBtn = document.getElementById('btn-cmp-sync-toggle');
  const clearBtn = document.getElementById('btn-cmp-clear');
  if (!grid) return;

  const LABELS = ['A', 'B', 'C', 'D'];

  if (!shots.length) {
    grid.removeAttribute('data-count');
    grid.innerHTML = `
      <div class="vg-cmp-empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><rect x="2" y="3" width="9" height="18" rx="1"/><rect x="13" y="3" width="9" height="18" rx="1"/></svg>
        <p>Select 2–4 shots from the picker above to compare them side-by-side</p>
      </div>`;
    if (winBar) winBar.style.display = 'none';
    return;
  }

  grid.setAttribute('data-count', String(shots.length));

  grid.innerHTML = shots.map((shot, i) => {
    const vUrl   = escAttr(shot.video_url || shot.hf_video_url || '');
    const model  = (shot.model || '').split('/').pop() || '—';
    const dur    = shot.duration ? `${shot.duration}s` : '';
    const aspect = shot.aspect_ratio || '16:9';
    const isWin  = COMPARE.winner === shot.id;

    return `
      <div class="vg-cmp-cell${isWin ? ' winner' : ''}" data-cell-id="${shot.id}">
        <div class="vg-cmp-cell-header">
          <span class="vg-cmp-cell-label">Shot ${LABELS[i]}</span>
          <button class="vg-cmp-cell-remove" data-remove-id="${shot.id}" title="Remove from compare">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        ${vUrl ? `<video class="vg-cmp-cell-video" src="${vUrl}" muted loop preload="auto"
                   data-cell-vid="${shot.id}" style="width:100%;flex:1;object-fit:contain;min-height:0;display:block"></video>` : ''}
        <div class="vg-cmp-play-overlay">
          <button class="vg-cmp-play-btn" data-play-id="${shot.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
        </div>
        <div class="vg-cmp-cell-footer">
          <p class="vg-cmp-cell-prompt">${escHtml(shot.prompt || '')}</p>
          <div class="vg-cmp-cell-meta">
            <span class="vg-cmp-cell-tag">${escHtml(model)}</span>
            ${dur ? `<span class="vg-cmp-cell-tag">${escHtml(dur)}</span>` : ''}
            <span class="vg-cmp-cell-tag">${escHtml(aspect)}</span>
          </div>
        </div>
        <div class="vg-cmp-cell-winner-ring"></div>
      </div>`;
  }).join('');

  // Remove buttons
  grid.querySelectorAll('[data-remove-id]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id  = btn.dataset.removeId;
      const idx = COMPARE.selected.indexOf(id);
      if (idx >= 0) COMPARE.selected.splice(idx, 1);
      if (COMPARE.winner === id) COMPARE.winner = null;
      // Re-run initCompareView to refresh everything
      initCompareView();
    });
  });

  // Play/pause buttons
  const cmpSyncEnabled = { on: true };

  grid.querySelectorAll('[data-play-id]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleCmpPlayback(btn.dataset.playId, cmpSyncEnabled);
    });
  });
  grid.querySelectorAll('.vg-cmp-cell').forEach(cell => {
    cell.addEventListener('click', () => toggleCmpPlayback(cell.dataset.cellId, cmpSyncEnabled));
  });

  // Winner bar
  if (winBar) {
    winBar.style.display = shots.length >= 2 ? 'flex' : 'none';
    if (winBtns) {
      winBtns.innerHTML = shots.map((s, i) => `
        <button class="vg-cmp-winner-btn${COMPARE.winner === s.id ? ' active' : ''}" data-win-id="${s.id}">
          Shot ${LABELS[i]}
        </button>`).join('');
      winBtns.querySelectorAll('.vg-cmp-winner-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.winId;
          COMPARE.winner = COMPARE.winner === id ? null : id;
          grid.querySelectorAll('.vg-cmp-cell').forEach(c =>
            c.classList.toggle('winner', c.dataset.cellId === COMPARE.winner)
          );
          winBtns.querySelectorAll('.vg-cmp-winner-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.winId === COMPARE.winner)
          );
          if (winNote) {
            winNote.textContent = COMPARE.winner
              ? `Shot ${LABELS[shots.findIndex(s => s.id === COMPARE.winner)]} marked as winner`
              : '';
          }
        });
      });
    }
  }

  // Sync toggle (one-time bind)
  if (syncBtn && !syncBtn._cmpBound) {
    syncBtn._cmpBound = true;
    syncBtn.addEventListener('click', () => {
      cmpSyncEnabled.on = !cmpSyncEnabled.on;
      syncBtn.textContent   = cmpSyncEnabled.on ? 'Sync ON' : 'Sync OFF';
      syncBtn.classList.toggle('active', cmpSyncEnabled.on);
    });
  }

  // Clear button
  if (clearBtn && !clearBtn._cmpBound) {
    clearBtn._cmpBound = true;
    clearBtn.addEventListener('click', () => {
      COMPARE.selected = [];
      COMPARE.winner   = null;
      document.querySelectorAll('.vg-cmp-cell-video').forEach(v => v.pause());
      initCompareView();
    });
  }
}

function toggleCmpPlayback(shotId, syncState) {
  const vid = document.querySelector(`[data-cell-vid="${shotId}"]`);
  if (!vid) return;

  if (syncState.on) {
    const all      = document.querySelectorAll('.vg-cmp-cell-video');
    const anyPlay  = [...all].some(v => !v.paused);
    all.forEach(v => anyPlay ? v.pause() : v.play().catch(() => {}));
  } else {
    vid.paused ? vid.play().catch(() => {}) : vid.pause();
  }
}

/* Called from renderShotGrid compare action button */
function addShotToCompare(btn) {
  const shotId   = btn.dataset.shotId;
  const videoUrl = btn.dataset.videoUrl;
  if (!shotId || !videoUrl) return;

  if (COMPARE.selected.includes(shotId)) {
    showToast('Shot already in Compare', true);
    return;
  }
  if (COMPARE.selected.length >= COMPARE.MAX) {
    showToast(`Max ${COMPARE.MAX} shots — open Compare tab to remove one first`, true);
    return;
  }
  COMPARE.selected.push(shotId);
  showToast('Added to Compare — click the Compare tab to view');

  // Also refresh compare-badge on board header if visible
  const badge = document.getElementById('compare-badge');
  if (badge) badge.textContent = COMPARE.selected.length;
  const openBtn = document.getElementById('btn-open-compare');
  if (openBtn) openBtn.disabled = COMPARE.selected.length < 2;

  // If compare view is already visible, refresh it
  const cmpEl = document.getElementById('vg-compare');
  if (cmpEl && cmpEl.style.display !== 'none') initCompareView();
}

/* ════════════════════════════════════════════════════════════════
   TIMELINE NAV-TAB VIEW — bridges to TIMELINE overlay system
   ════════════════════════════════════════════════════════════════ */

/* Called by initViewSwitcher when Timeline tab is clicked */
function initTimelineView() {
  const pid = VG.activeProjectId;
  if (!pid) {
    renderTlBank([]);
    return;
  }

  // Load completed shots via the timeline API endpoint
  api('GET', `/api/projects/${pid}/timeline`)
    .then(r => r.json())
    .then(data => {
      const shots = data.shots || [];
      shots.forEach(s => { TIMELINE._shotsMap = TIMELINE._shotsMap || {}; TIMELINE._shotsMap[s.id] = s; });

      // Use existing TIMELINE.clips if already loaded for this project, else populate
      if (TIMELINE.projectId !== pid || !TIMELINE.clips.length) {
        TIMELINE.projectId = pid;
        TIMELINE.clips     = [...shots];
      }

      renderTlStrip();
      renderTlBank(shots);
      renderTlRuler();
      updateTlDuration();
      enableTlButtons();
    })
    .catch(err => {
      console.error('[TL] init', err);
      renderTlBank([]);
    });

  bindTlControls();
}

function enableTlButtons() {
  const has = TIMELINE.clips.length > 0;
  const pl  = document.getElementById('btn-tl-play-all');
  const ex  = document.getElementById('btn-tl-export');
  if (pl) pl.disabled = !has;
  if (ex) ex.disabled = !has;
}

/* ── Ruler ───────────────────────────────────────────────────── */
function renderTlRuler() {
  const inner = document.getElementById('vg-tl-ruler-inner');
  if (!inner) return;
  const PPS     = 40; // pixels per second
  const total   = TIMELINE.clips.reduce((a, s) => a + (s.duration || 5), 0);
  const maxSecs = Math.max(total, 30);
  let   html    = '';
  for (let t = 0; t <= maxSecs; t++) {
    const maj = t % 5 === 0;
    const m   = Math.floor(t / 60);
    const s   = t % 60;
    const tc  = `${m}:${String(s).padStart(2,'0')}`;
    html += `<div style="width:${PPS}px;position:relative;flex-shrink:0">
      <div style="width:1px;height:${maj ? 12 : 6}px;background:${maj ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)'}"></div>
      ${maj ? `<span style="position:absolute;bottom:3px;left:3px;font-size:0.55rem;color:var(--text-muted);font-family:var(--font-mono)">${tc}</span>` : ''}
    </div>`;
  }
  inner.innerHTML = html;
}

/* ── Strip ───────────────────────────────────────────────────── */
function renderTlStrip() {
  const strip = document.getElementById('vg-tl-strip');
  if (!strip) return;
  const PPS = 40;

  if (!TIMELINE.clips.length) {
    strip.innerHTML = `
      <div class="vg-tl-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><rect x="2" y="7" width="20" height="10" rx="1"/></svg>
        <p>Drag shots from the Shot Bank below to add them to the sequence</p>
      </div>`;
    enableTlButtons();
    return;
  }

  let cur = 0;
  strip.innerHTML = TIMELINE.clips.map((shot, i) => {
    const dur   = shot.duration || 5;
    const start = cur; cur += dur;
    const vUrl  = escAttr(shot.video_url || shot.hf_video_url || '');
    const model = (shot.model || '').split('/').pop() || '—';
    const clipW = Math.max(80, dur * PPS);
    const tcIn  = tlFmt(start);
    const tcOut = tlFmt(start + dur);
    return `
      <div class="vg-tl-clip" data-tl-idx="${i}" data-shot-id="${shot.id}" draggable="true"
           style="width:${clipW}px" title="${escAttr(shot.prompt || '')}">
        ${vUrl ? `<video src="${vUrl}" muted preload="metadata"></video>` : ''}
        <div class="vg-tl-clip-overlay"></div>
        <div class="vg-tl-clip-info">
          <div class="vg-tl-clip-timecode">${tcIn} → ${tcOut}</div>
          <div class="vg-tl-clip-model">${escHtml(model)} · ${dur}s</div>
        </div>
        <div class="vg-tl-clip-handle">
          <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" opacity="0.5">
            <circle cx="7" cy="4" r="1.5"/><circle cx="13" cy="4" r="1.5"/>
            <circle cx="7" cy="10" r="1.5"/><circle cx="13" cy="10" r="1.5"/>
            <circle cx="7" cy="16" r="1.5"/><circle cx="13" cy="16" r="1.5"/>
          </svg>
        </div>
        <button class="vg-tl-clip-remove" data-tl-remove="${i}" title="Remove from timeline">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
  }).join('');

  // Bind drag-reorder within strip
  strip.querySelectorAll('.vg-tl-clip').forEach(clip => {
    const idx = +clip.dataset.tlIdx;

    clip.addEventListener('click', e => {
      if (e.target.closest('[data-tl-remove]')) return;
      showTlClipDetails(TIMELINE.clips[idx]);
    });
    clip.addEventListener('dragstart', e => {
      TIMELINE.dragSrcIdx = idx;
      e.dataTransfer.effectAllowed = 'move';
      clip.classList.add('dragging');
    });
    clip.addEventListener('dragend', () => {
      clip.classList.remove('dragging');
      strip.querySelectorAll('.vg-tl-clip').forEach(c => c.classList.remove('drag-over'));
    });
    clip.addEventListener('dragover', e => {
      e.preventDefault();
      strip.querySelectorAll('.vg-tl-clip').forEach(c => c.classList.remove('drag-over'));
      clip.classList.add('drag-over');
    });
    clip.addEventListener('drop', e => {
      e.preventDefault();
      const from = TIMELINE.dragSrcIdx;
      const to   = +clip.dataset.tlIdx;
      if (from === null || from === to) return;
      const [moved] = TIMELINE.clips.splice(from, 1);
      TIMELINE.clips.splice(to, 0, moved);
      TIMELINE.dragSrcIdx = null;
      renderTlStrip(); renderTlRuler(); updateTlDuration();
    });
  });

  // Remove buttons
  strip.querySelectorAll('[data-tl-remove]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      TIMELINE.clips.splice(+btn.dataset.tlRemove, 1);
      renderTlStrip(); renderTlRuler(); updateTlDuration();
      // Un-dim bank card
      const id = btn.closest('.vg-tl-clip')?.dataset.shotId;
      if (id) {
        const bc = document.querySelector(`.vg-tl-bank-clip[data-bank-id="${id}"]`);
        if (bc) bc.classList.remove('in-timeline');
      }
    });
  });

  // Strip accepts drops from bank
  strip.addEventListener('dragover', e => e.preventDefault());
  strip.addEventListener('drop', e => {
    e.preventDefault();
    const bankId = e.dataTransfer.getData('tl-bank-id');
    if (!bankId) return;
    addTlClip(bankId);
  });

  enableTlButtons();
}

function addTlClip(shotId) {
  const map    = TIMELINE._shotsMap || {};
  const shot   = map[shotId];
  if (!shot) return;
  if (TIMELINE.clips.find(s => s.id === shotId)) return;
  TIMELINE.clips.push(shot);
  renderTlStrip(); renderTlRuler(); updateTlDuration();
  const bc = document.querySelector(`.vg-tl-bank-clip[data-bank-id="${shotId}"]`);
  if (bc) bc.classList.add('in-timeline');
}

function showTlClipDetails(shot) {
  const det  = document.getElementById('vg-tl-details');
  const body = document.getElementById('vg-tl-details-body');
  if (!det || !body || !shot) return;
  det.style.display = 'flex';
  const idx   = TIMELINE.clips.indexOf(shot);
  const start = TIMELINE.clips.slice(0, idx).reduce((a, s) => a + (s.duration || 5), 0);
  const vUrl  = shot.video_url || shot.hf_video_url || '';
  const model = (shot.model || '').split('/').pop() || '—';
  body.innerHTML = `
    ${vUrl ? `<video class="vg-tl-details-video" src="${escAttr(vUrl)}" controls muted></video>` : ''}
    <div class="vg-tl-details-row">
      <span class="vg-tl-details-key">Timecode</span>
      <span class="vg-tl-details-val mono">${tlFmt(start)} → ${tlFmt(start + (shot.duration || 5))}</span>
    </div>
    <div class="vg-tl-details-row">
      <span class="vg-tl-details-key">Model</span>
      <span class="vg-tl-details-val mono">${escHtml(model)}</span>
    </div>
    <div class="vg-tl-details-row">
      <span class="vg-tl-details-key">Duration</span>
      <span class="vg-tl-details-val mono">${shot.duration || 5}s</span>
    </div>
    <div class="vg-tl-details-row">
      <span class="vg-tl-details-key">Aspect</span>
      <span class="vg-tl-details-val mono">${escHtml(shot.aspect_ratio || '16:9')}</span>
    </div>
    <div class="vg-tl-details-row">
      <span class="vg-tl-details-key">Prompt</span>
      <span class="vg-tl-details-val">${escHtml(shot.prompt || '—')}</span>
    </div>`;
}

/* ── Shot Bank ───────────────────────────────────────────────── */
function renderTlBank(shots) {
  const grid = document.getElementById('vg-tl-bank-grid');
  const hint = document.getElementById('vg-tl-bank-hint');
  if (!grid) return;

  if (!shots.length) {
    grid.innerHTML = `<span class="vg-tl-bank-empty">No completed shots yet — generate some shots first</span>`;
    return;
  }

  grid.innerHTML = shots.map(shot => {
    const vUrl  = escAttr(shot.video_url || shot.hf_video_url || '');
    const inTl  = TIMELINE.clips.find(s => s.id === shot.id) ? 'in-timeline' : '';
    const model = (shot.model || '').split('/').pop() || '—';
    return `
      <div class="vg-tl-bank-clip ${inTl}" data-bank-id="${shot.id}"
           draggable="true" title="${escAttr(shot.prompt || '')}">
        ${vUrl ? `<video src="${vUrl}" muted preload="metadata" onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>` : ''}
        <div class="vg-tl-bank-clip-label">${escHtml(model)} · ${shot.duration || 5}s</div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.vg-tl-bank-clip').forEach(clip => {
    const id = clip.dataset.bankId;
    clip.addEventListener('dblclick', () => addTlClip(id));
    clip.addEventListener('dragstart', e => {
      e.dataTransfer.setData('tl-bank-id', id);
      e.dataTransfer.effectAllowed = 'copy';
    });
  });

  if (hint) hint.textContent = `drag or double-click to add · ${shots.length} shot${shots.length !== 1 ? 's' : ''} available`;
}

function updateTlDuration() {
  const badge = document.getElementById('vg-tl-total-duration');
  if (!badge) return;
  const total = TIMELINE.clips.reduce((a, s) => a + (s.duration || 5), 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  badge.textContent = `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function tlFmt(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ── Preview sequence ────────────────────────────────────────── */
function startTlPreview() {
  if (!TIMELINE.clips.length) return;
  const preview = document.getElementById('vg-tl-preview');
  const vidEl   = document.getElementById('vg-tl-preview-video');
  const counter = document.getElementById('vg-tl-preview-counter');
  if (!preview || !vidEl) return;

  preview.style.display = 'flex';
  let idx = 0;

  function playNext() {
    if (idx >= TIMELINE.clips.length) { preview.style.display = 'none'; return; }
    const shot = TIMELINE.clips[idx];
    const url  = shot.video_url || shot.hf_video_url;
    if (!url) { idx++; playNext(); return; }
    if (counter) counter.textContent = `Shot ${idx + 1} / ${TIMELINE.clips.length}`;
    vidEl.src    = url;
    vidEl.onended = () => { idx++; playNext(); };
    vidEl.play().catch(() => {});
  }
  playNext();
}

/* ── Export manifest ─────────────────────────────────────────── */
async function exportTlManifest() {
  const pid = VG.activeProjectId;
  if (!pid || !TIMELINE.clips.length) return;

  const btn = document.getElementById('btn-tl-export');
  if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }

  try {
    const res  = await api('POST', `/api/projects/${pid}/timeline/export`, {
      shot_ids: TIMELINE.clips.map(s => s.id),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Export failed');

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `spectra-sequence-${pid.slice(0,8)}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const clips = data.manifest?.clips?.length || 0;
    const dur   = data.manifest?.total_duration || '0:00:00';
    showTlExportToast(`Manifest exported — ${clips} clips · ${dur} total`);
  } catch (err) {
    showToast(`Export failed: ${err.message}`, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export Manifest`;
    }
  }
}

function showTlExportToast(msg) {
  document.querySelector('.vg-tl-export-toast')?.remove();
  const el = document.createElement('div');
  el.className   = 'vg-tl-export-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

/* ── Bind timeline controls (idempotent) ─────────────────────── */
function bindTlControls() {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el && !el._tlBound) { el._tlBound = true; el.addEventListener('click', fn); }
  };
  bind('btn-tl-play-all',       startTlPreview);
  bind('btn-tl-export',         exportTlManifest);
  bind('btn-tl-preview-close', () => {
    const v = document.getElementById('vg-tl-preview-video');
    if (v) { v.pause(); v.src = ''; }
    document.getElementById('vg-tl-preview').style.display = 'none';
  });
  bind('btn-tl-details-close', () => {
    document.querySelectorAll('.vg-tl-clip').forEach(c => c.classList.remove('selected'));
    document.getElementById('vg-tl-details').style.display = 'none';
  });
}

