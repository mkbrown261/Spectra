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

  // Quality sliders
  quality: {
    motion: 5,
    style:  5,
    detail: 7,
  },

  // View
  storyboardView: 'grid', // 'grid' | 'strip'

  generating: false,
};

/* ── DOM REFS ────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

/* ── INIT ────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  renderModelCards();
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

  container.innerHTML = HF_MODELS_DATA.map(m => `
    <button class="vg-model-card ${m.id === VG.selectedModel ? 'active' : ''}"
            data-model-id="${m.id}" title="${escAttr(m.desc)}">
      <div class="vg-model-card-header">
        <span class="vg-model-card-name">${escHtml(m.label)}</span>
        <span class="vg-model-speed-badge speed-${escAttr(m.speedClass)}">${escHtml(m.speed)}</span>
      </div>
      <div class="vg-model-card-desc">${escHtml(m.desc)}</div>
      <div class="vg-model-card-type">${m.type === 'i2v' ? 'Image → Video' : 'Text → Image'}</div>
    </button>
  `).join('');

  container.querySelectorAll('.vg-model-card').forEach(card => {
    card.addEventListener('click', () => selectModel(card.dataset.modelId));
  });
}

function selectModel(modelId) {
  VG.selectedModel = modelId;

  // Update card active states
  $$('.vg-model-card').forEach(c => {
    c.classList.toggle('active', c.dataset.modelId === modelId);
  });

  // Update type badge
  const model  = HF_MODELS_DATA.find(m => m.id === modelId);
  const badge  = $('vg-model-type-badge');
  if (badge && model) {
    badge.textContent = model.type.toUpperCase();
    badge.className   = `vg-model-type-badge ${model.type}`;
  }

  // Update image block required/optional badges
  updateImageRequirement(modelId);
}

function updateImageRequirement(modelId) {
  const isI2V     = I2V_MODELS.has(modelId);
  const reqBadge  = $('vg-image-required-badge');
  const optBadge  = $('vg-image-optional-badge');
  if (reqBadge) reqBadge.style.display = isI2V ? 'inline' : 'none';
  if (optBadge) optBadge.style.display = isI2V ? 'none' : 'inline';
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

  // Browse button → trigger file input
  browseBtn?.addEventListener('click', () => fileInput?.click());

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
    chip.addEventListener('click', () => togglePreset(chip.dataset.presetId));
  });
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

  container.innerHTML = VG.projects.map(p => `
    <button class="vg-project-item ${p.id === VG.activeProjectId ? 'active' : ''}"
            data-project-id="${p.id}">
      <span class="vg-project-item-pip"></span>
      <span class="vg-project-item-name">${escHtml(p.name)}</span>
      <span class="vg-project-item-shots">${p.shot_count ?? 0} shots</span>
    </button>
  `).join('');

  container.querySelectorAll('.vg-project-item').forEach(btn => {
    btn.addEventListener('click', () => selectProject(btn.dataset.projectId));
  });
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

  // Set default model for this project
  if (project.default_model) {
    selectModel(project.default_model);
  }

  // Hide empty, show grid
  $('vg-empty').style.display    = 'none';
  $('vg-shot-grid').style.display = 'grid';

  await loadShots(id);
}

function showEmptyState() {
  $('vg-empty').style.display    = 'flex';
  $('vg-shot-grid').style.display = 'none';
  const header = $('vg-board-header');
  if (header) header.style.display = 'none';
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

  const sorted = [...shots].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  grid.innerHTML = sorted.map(shot => renderShotCard(shot)).join('');

  // Bind shot actions
  grid.querySelectorAll('[data-shot-id]').forEach(el => {
    const shotId = el.dataset.shotId;
    const action = el.dataset.action;
    if (!action) return;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (action === 'delete')   deleteShot(shotId, projectId);
      if (action === 'copy')     copyPrompt(shotId, projectId);
      if (action === 'download') downloadShot(shotId, projectId);
      if (action === 'play')     playShot(shotId, projectId);
    });
  });
}

function renderShotCard(shot) {
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
    <article class="vg-shot-card" data-status="${shot.status}" data-shot-id="${shot.id}">
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
        await loadShots(projectId);
      }
    } catch (err) {
      console.error('Poll error for shot', shotId, err);
    }
  }, 4000);
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

    showToast('Shot submitted — generating now');

    // Clear prompt and unlock seed for next generation
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

function openProjectModal() {
  $('project-modal-overlay').classList.add('open');
  $('project-name-input').focus();
  $('project-modal-error').style.display = 'none';
}

function closeProjectModal() {
  $('project-modal-overlay').classList.remove('open');
  ['project-name-input','project-style-input','project-mood-input','project-palette-input'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
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

  const style   = $('project-style-input')?.value.trim()   || '';
  const mood    = $('project-mood-input')?.value.trim()    || '';
  const palette = $('project-palette-input')?.value.trim() || '';
  const model   = $('project-model-select')?.value          || 'higgsfield-ai/dop/standard';
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
    selectProject(data.id);
    showToast(`Project "${name}" created ✓`);
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

  // Aspect ratio
  $$('.vg-aspect-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.vg-aspect-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      VG.selectedAspect = btn.dataset.aspect;
    });
  });

  // Duration
  $$('.vg-dur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.vg-dur-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      VG.selectedDur = parseInt(btn.dataset.dur, 10);
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

  // Upgrade button (placeholder)
  $('btn-upgrade')?.addEventListener('click', () => {
    showToast('Upgrade coming soon — contact us to upgrade early');
  });

  // Escape key closes overlays
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeProjectModal();
      closeBibleModal();
      closeSettings();
      closePlayer();
    }
  });

  // Init upload zone
  initUploadZone();

  // Init quality sliders
  initQualitySliders();

  // Init enhance mode label
  setEnhanceMode(VG.enhanceMode);

  // Init model type badge
  updateImageRequirement(VG.selectedModel);
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
  const studioEl     = $('vg-app');
  const analyticsEl  = $('vg-analytics');

  if (!btnStudio || !btnAnalytics) return;

  btnStudio.addEventListener('click', () => {
    btnStudio.classList.add('active');
    btnAnalytics.classList.remove('active');
    studioEl.style.display    = 'flex';
    analyticsEl.style.display = 'none';
  });

  btnAnalytics.addEventListener('click', () => {
    if (!VG.user) { showToast('Sign in to view analytics', true); return; }
    btnAnalytics.classList.add('active');
    btnStudio.classList.remove('active');
    studioEl.style.display    = 'none';
    analyticsEl.style.display = 'block';
    if (!AN.data) loadAnalytics();
  });

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
