/* ════════════════════════════════════════════════════════════════
   SPECTRA — VIDEO GENERATOR FRONTEND
   Complete rewrite for auth-gated, project-based AI filmmaking
   Auth → Projects → Generate → Poll → Shot Grid
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* ── STATE ───────────────────────────────────────────────────── */
const VG = {
  user:            null,   // { id, email, tier, credits }
  projects:        [],
  activeProjectId: null,
  shots:           {},     // { [projectId]: Shot[] }
  pollTimers:      {},     // { [shotId]: intervalId }
  authMode:        'login',
  selectedAspect:  '16:9',
  selectedDur:     5,
  generating:      false,
};

/* ── DOM REFS ────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

/* ── INIT ────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  checkSession();
});

/* ── SESSION CHECK ───────────────────────────────────────────── */
async function checkSession() {
  try {
    const res  = await api('GET', '/api/auth/me');
    const data = await res.json();
    if (res.ok && data.id) {
      // /api/auth/me returns { id, email, tier, credits, limits } directly
      VG.user = { id: data.id, email: data.email, tier: data.tier, credits: data.credits };
      enterApp();
    } else {
      showAuthGate();
    }
  } catch {
    showAuthGate();
  }
}

/* ── API HELPER ──────────────────────────────────────────────── */
function api(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(path, opts);
}

/* ── AUTH GATE ───────────────────────────────────────────────── */
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
      errEl.textContent     = data.error || 'Something went wrong';
      errEl.style.display   = 'block';
      btn.disabled          = false;
      btn.textContent       = VG.authMode === 'login' ? 'Sign In' : 'Create Account';
      return;
    }

    VG.user = data.user;
    enterApp();
  } catch (err) {
    errEl.textContent   = 'Network error — please try again';
    errEl.style.display = 'block';
    btn.disabled        = false;
    btn.textContent     = VG.authMode === 'login' ? 'Sign In' : 'Create Account';
  }
}

/* ── ENTER APP ───────────────────────────────────────────────── */
async function enterApp() {
  hideAuthGate();
  updateKeyDot();
  await Promise.all([
    loadProjects(),
    checkKeyStatus(),
    loadSettingsInfo(),
  ]);
}

/* ── LOGOUT ──────────────────────────────────────────────────── */
async function logout() {
  // Stop all polls
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

/* ── KEY STATUS ──────────────────────────────────────────────── */
async function checkKeyStatus() {
  try {
    const res  = await api('GET', '/api/keys/status');
    const data = await res.json();
    // /api/keys/status → { higgsfield: { connected: true, saved_at: ... } }
    const has  = data?.higgsfield?.connected === true;

    // Nav dot
    const navDot = $('hf-key-dot');
    if (navDot) {
      navDot.classList.toggle('active',   has);
      navDot.classList.toggle('inactive', !has);
    }

    // Drawer status
    const statusEl  = $('hf-key-status');
    const dotEl     = statusEl?.querySelector('.vg-key-dot');
    const textEl    = statusEl?.querySelector('.vg-key-status-text');
    if (dotEl)  dotEl.classList.toggle('active', has);
    if (textEl) textEl.textContent = has ? 'Connected' : 'Not set';
    return has;
  } catch {
    return false;
  }
}

function updateKeyDot() {
  checkKeyStatus();
}

async function saveKey(provider) {
  const inputId = `key-${provider}`;
  const input   = $(inputId);
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

/* ── SETTINGS DRAWER ─────────────────────────────────────────── */
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

  // Account info
  const infoEl = $('settings-account-info');
  if (infoEl) {
    infoEl.textContent = `${VG.user.email} · ${capitalize(VG.user.tier)} plan`;
  }

  // Tier limits
  const limitsEl = $('settings-limits');
  if (limitsEl) {
    const tierLimits = {
      free:    { projects: 1,    shots: 10,   label: 'Free' },
      creator: { projects: 5,    shots: 100,  label: 'Creator' },
      studio:  { projects: 25,   shots: 500,  label: 'Studio' },
      pro:     { projects: '∞',  shots: '∞',  label: 'Pro' },
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
      </div>
    `;
  }

  await checkKeyStatus();
}

/* ── PROJECTS ────────────────────────────────────────────────── */
async function loadProjects() {
  const container = $('vg-project-selector');
  if (!container) return;

  container.innerHTML = '<div class="vg-project-loading">Loading…</div>';

  try {
    const res  = await api('GET', '/api/projects');
    const data = await res.json();

    if (!res.ok) { container.innerHTML = '<div class="vg-project-loading">Error loading projects</div>'; return; }

    // /api/projects returns a bare array
    VG.projects = Array.isArray(data) ? data : (data.projects || []);
    renderProjectList();

    // Auto-select first project if none selected
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

  // Update project header
  const header = $('vg-project-header');
  if (header) {
    header.style.display = 'flex';
    $('vg-current-project-name').textContent = project.name;
  }

  // Set default model for this project
  if (project.default_model) {
    const sel = $('vg-model-select');
    if (sel) sel.value = project.default_model;
  }

  // Hide empty, show grid
  $('vg-empty').style.display    = 'none';
  $('vg-shot-grid').style.display = 'grid';

  await loadShots(id);
}

function showEmptyState() {
  $('vg-empty').style.display    = 'flex';
  $('vg-shot-grid').style.display = 'none';
  const header = $('vg-project-header');
  if (header) header.style.display = 'none';
}

async function loadShots(projectId) {
  try {
    const res  = await api('GET', `/api/projects/${projectId}`);
    const data = await res.json();
    if (!res.ok) return;

    // /api/projects/:id returns { ...project, shots: [...], characters: [...] }
    const shots = data.shots || [];
    VG.shots[projectId] = shots;

    // Update shot count
    const countEl = $('vg-project-shot-count');
    if (countEl) countEl.textContent = `${shots.length} shot${shots.length !== 1 ? 's' : ''}`;

    // Update project list count too
    const proj = VG.projects.find(p => p.id === projectId);
    if (proj) proj.shot_count = shots.length;

    renderShotGrid(projectId);

    // Resume polling for any active shots
    shots.forEach(shot => {
      if (shot.status === 'queued' || shot.status === 'in_progress') {
        startPolling(shot.id, projectId);
      }
    });
  } catch (err) {
    console.error('loadShots error:', err);
  }
}

/* ── SHOT GRID RENDER ────────────────────────────────────────── */
function renderShotGrid(projectId) {
  const grid = $('vg-shot-grid');
  if (!grid) return;

  const shots = VG.shots[projectId] || [];

  if (shots.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:3rem 1rem;color:var(--ice-dim);font-size:0.82rem">
        No shots yet — write a prompt and hit Generate Shot
      </div>`;
    return;
  }

  // Newest first
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
  const statusLabel = {
    queued:      'Queued',
    in_progress: 'Generating',
    completed:   'Done',
    failed:      'Failed',
    nsfw:        'Blocked',
  }[shot.status] || shot.status;

  const modelShort = (shot.model || '').split('/').pop() || '';

  const thumbContent = (() => {
    if (shot.status === 'completed' && shot.video_url) {
      return `
        <video src="${escAttr(shot.video_url)}" muted loop preload="metadata"
               onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"
               style="width:100%;height:100%;object-fit:cover;display:block"></video>
        <div class="vg-shot-play">
          <button class="vg-shot-play-btn" data-shot-id="${shot.id}" data-action="play" title="Play full screen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
        </div>`;
    }
    if (shot.status === 'completed' && shot.hf_video_url) {
      return `
        <video src="${escAttr(shot.hf_video_url)}" muted loop preload="metadata"
               onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"
               style="width:100%;height:100%;object-fit:cover;display:block"></video>
        <div class="vg-shot-play">
          <button class="vg-shot-play-btn" data-shot-id="${shot.id}" data-action="play" title="Play full screen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
        </div>`;
    }
    // Queued / in_progress / failed
    const icons = {
      queued: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
      in_progress: `<svg class="vg-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>`,
      failed: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      nsfw:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    };
    const icon = icons[shot.status] || icons.failed;
    return `
      <div class="vg-shot-status-overlay">
        <div class="vg-shot-status-icon">${icon}</div>
        <div class="vg-shot-status-label">${statusLabel}</div>
      </div>`;
  })();

  const videoUrl = shot.video_url || shot.hf_video_url || '';

  return `
    <article class="vg-shot-card" data-status="${shot.status}" data-shot-id="${shot.id}">
      <div class="vg-shot-thumb">
        ${thumbContent}
        <span class="vg-shot-aspect-badge">${shot.aspect_ratio || '16:9'}</span>
        <span class="vg-shot-model-badge">${escHtml(modelShort)}</span>
      </div>
      <div class="vg-shot-body">
        <p class="vg-shot-prompt">${escHtml(shot.prompt || '')}</p>
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
            <button class="vg-shot-action-btn delete" data-shot-id="${shot.id}" data-action="delete" title="Delete shot">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    </article>`;
}

/* ── SHOT POLLING ────────────────────────────────────────────── */
function startPolling(shotId, projectId) {
  if (VG.pollTimers[shotId]) return; // already polling

  VG.pollTimers[shotId] = setInterval(async () => {
    try {
      const res  = await api('GET', `/api/shots/${shotId}/status`);
      const data = await res.json();

      if (!res.ok) {
        clearInterval(VG.pollTimers[shotId]);
        delete VG.pollTimers[shotId];
        return;
      }

      const status = data.status;

      // Update shot in local state
      if (VG.shots[projectId]) {
        const idx = VG.shots[projectId].findIndex(s => s.id === shotId);
        if (idx !== -1) {
          VG.shots[projectId][idx] = { ...VG.shots[projectId][idx], ...data };
        }
      }

      // Update card in DOM
      updateShotCardInDOM(shotId, data);

      // Terminal states
      if (status === 'completed' || status === 'failed' || status === 'nsfw') {
        clearInterval(VG.pollTimers[shotId]);
        delete VG.pollTimers[shotId];

        // Refresh full project to get updated shot counts
        await loadShots(projectId);
      }
    } catch (err) {
      console.error('Poll error for shot', shotId, err);
    }
  }, 4000); // poll every 4 seconds
}

function updateShotCardInDOM(shotId, data) {
  const card = document.querySelector(`.vg-shot-card[data-shot-id="${shotId}"]`);
  if (!card) return;

  // Update status attribute (triggers CSS state changes)
  card.dataset.status = data.status;

  const thumb = card.querySelector('.vg-shot-thumb');
  if (!thumb) return;

  if (data.status === 'completed') {
    const videoUrl = data.video_url || data.hf_video_url || '';
    if (videoUrl) {
      // Remove overlay, add video
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

        // Add play button overlay
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

      // Update download button
      const body    = card.querySelector('.vg-shot-actions');
      const hasDl   = body?.querySelector('.vg-shot-dl-btn');
      if (body && !hasDl) {
        const dlBtn = document.createElement('button');
        dlBtn.className           = 'vg-shot-action-btn vg-shot-dl-btn';
        dlBtn.title               = 'Download';
        dlBtn.innerHTML           = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
        dlBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadShot(shotId, VG.activeProjectId); });
        // Insert before delete button
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

/* ── MODEL HINT ──────────────────────────────────────────────── */
// Models that require an image_url (image-to-video)
const I2V_MODELS = new Set([
  'higgsfield-ai/dop/lite',
  'higgsfield-ai/dop/standard',
  'higgsfield-ai/dop/turbo',
  'kling-video/v2.1/pro/image-to-video',
  'kling-video/v2.1/standard/image-to-video',
  'bytedance/seedance/v1/pro/image-to-video',
  'bytedance/seedance/v1/lite/image-to-video',
]);

function updateModelHint() {
  const model   = $('vg-model-select')?.value || '';
  const hintEl  = $('vg-model-hint');
  const labelEl = $('vg-image-label-note');
  const isI2V   = I2V_MODELS.has(model);

  if (hintEl) {
    hintEl.textContent = isI2V
      ? '⚠ This model requires a reference image URL'
      : '✓ Text-to-image — no reference image needed';
    hintEl.style.color = isI2V ? 'var(--yellow)' : 'var(--green)';
  }
  if (labelEl) {
    labelEl.textContent = isI2V ? '(required for this model)' : '(not required)';
    labelEl.style.color = isI2V ? 'var(--yellow)' : 'var(--ice-ghost)';
  }
}

/* ── GENERATE ────────────────────────────────────────────────── */
async function generate() {
  if (VG.generating) return;
  if (!VG.activeProjectId) { showToast('Select a project first', true); return; }

  const prompt    = $('vg-prompt').value.trim();
  const imageUrl  = $('vg-image-url').value.trim();
  const model     = $('vg-model-select').value;

  if (!prompt) { showToast('Enter a shot prompt', true); return; }

  // Validate image_url required for i2v models
  if (I2V_MODELS.has(model) && !imageUrl) {
    showToast('This model requires a reference image URL', true);
    $('vg-image-url').focus();
    return;
  }

  VG.generating = true;
  const btn = $('btn-generate');
  btn.disabled    = true;
  btn.classList.add('loading');
  btn.innerHTML   = `<span class="vg-spinner"></span> Submitting…`;

  try {
    const res  = await api('POST', '/api/generate', {
      project_id:   VG.activeProjectId,
      prompt,
      model,
      image_url:    imageUrl || undefined,
      duration:     VG.selectedDur,
      aspect_ratio: VG.selectedAspect,
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Generation failed', true);
      return;
    }

    // Add shot to local state immediately with queued status
    // /api/generate returns { ok, shot_id, request_id, status, prompt_enhanced }
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
      created_at:      new Date().toISOString(),
    };

    if (!VG.shots[VG.activeProjectId]) VG.shots[VG.activeProjectId] = [];
    VG.shots[VG.activeProjectId].unshift(newShot);

    // Show grid
    $('vg-empty').style.display    = 'none';
    $('vg-shot-grid').style.display = 'grid';

    renderShotGrid(VG.activeProjectId);

    // Start polling
    if (newShot.id) startPolling(newShot.id, VG.activeProjectId);

    showToast('Shot submitted — generating now');

    // Clear prompt
    $('vg-prompt').value = '';
    updateCharCount();

    // Update usage bar
    await updateUsageBar();
  } catch (err) {
    showToast('Network error — try again', true);
  } finally {
    VG.generating = false;
    btn.disabled  = false;
    btn.classList.remove('loading');
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Generate Shot`;
  }
}

/* ── ENHANCE PROMPT ──────────────────────────────────────────── */
async function enhancePrompt() {
  const textarea = $('vg-prompt');
  const prompt   = textarea.value.trim();
  if (!prompt) { showToast('Enter a prompt to enhance', true); return; }

  const btn = $('btn-enhance-prompt');
  btn.disabled    = true;
  btn.innerHTML   = `<span class="vg-spinner"></span> Enhancing…`;

  try {
    const res  = await api('POST', '/api/enhance-prompt', {
      prompt,
      model:       $('vg-model-select').value,
      aspect_ratio: VG.selectedAspect,
    });
    const data = await res.json();

    if (res.ok && data.enhanced) {
      textarea.value = data.enhanced;
      updateCharCount();
      showToast('Prompt enhanced ✓');
    } else {
      showToast(data.error || 'Enhancement failed', true);
    }
  } catch {
    showToast('Network error', true);
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Enhance with AI`;
  }
}

/* ── USAGE BAR ───────────────────────────────────────────────── */
async function updateUsageBar() {
  if (!VG.user) return;
  const tierShots = { free: 10, creator: 100, studio: 500, pro: 999999 };
  const limit     = tierShots[VG.user.tier] || 10;

  // Count shots this month from local state
  let thisMonth = 0;
  const now     = new Date();
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
    if (limit === 999999) {
      labelEl.textContent = `${thisMonth} shots this month (unlimited)`;
    } else {
      labelEl.textContent = `${thisMonth} / ${limit} shots this month`;
    }
  }
}

/* ── SHOT ACTIONS ────────────────────────────────────────────── */
async function deleteShot(shotId, projectId) {
  if (!confirm('Delete this shot?')) return;

  try {
    const res = await api('DELETE', `/api/shots/${shotId}`);
    if (res.ok) {
      // Stop polling
      if (VG.pollTimers[shotId]) {
        clearInterval(VG.pollTimers[shotId]);
        delete VG.pollTimers[shotId];
      }
      // Remove from local state
      if (VG.shots[projectId]) {
        VG.shots[projectId] = VG.shots[projectId].filter(s => s.id !== shotId);
      }
      // Update project count
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

  const a = document.createElement('a');
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

  // Build inline player overlay if not present
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

/* ── NEW PROJECT MODAL ───────────────────────────────────────── */
function openProjectModal() {
  $('project-modal-overlay').classList.add('open');
  $('project-name-input').focus();
  $('project-modal-error').style.display = 'none';
}

function closeProjectModal() {
  $('project-modal-overlay').classList.remove('open');
  // Clear inputs
  ['project-name-input','project-style-input','project-mood-input','project-palette-input'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
}

async function saveProject() {
  const name    = $('project-name-input').value.trim();
  const errEl   = $('project-modal-error');
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
  const model   = $('project-model-select')?.value          || 'higgsfield-ai/dop/preview';

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

    // /api/projects POST returns { ok, id, name } — build local project object
    const newProject = { id: data.id, name: data.name, shot_count: 0,
      default_model: model, style_bible: styleBible };
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

/* ── STYLE BIBLE MODAL ───────────────────────────────────────── */
function openBibleModal() {
  const project = VG.projects.find(p => p.id === VG.activeProjectId);
  if (!project) return;

  // Pre-fill from existing style bible
  const bible = project.style_bible || {};
  const parsed = typeof bible === 'string' ? tryParseJSON(bible) : bible;
  if (parsed) {
    $('bible-style-input').value  = parsed.style   || '';
    $('bible-mood-input').value   = parsed.mood    || '';
    $('bible-palette-input').value = parsed.palette || '';
    $('bible-camera-input').value = parsed.camera  || '';
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
      // Update local state
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

/* ── HELPERS ─────────────────────────────────────────────────── */
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

function escAttr(str) {
  return escHtml(str);
}

function tryParseJSON(str) {
  try { return typeof str === 'string' ? JSON.parse(str) : str; } catch { return null; }
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function updateCharCount() {
  const ta    = $('vg-prompt');
  const el    = $('vg-prompt-count');
  if (!ta || !el) return;
  el.textContent = `${ta.value.length}/500`;
}

function showToast(msg, isError = false) {
  const toast = $('vg-toast');
  if (!toast) return;
  toast.textContent  = msg;
  toast.style.color  = isError ? 'var(--red)' : 'var(--ice)';
  toast.style.borderColor = isError ? 'rgba(248,113,113,0.25)' : 'var(--border)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

/* ── BIND UI ─────────────────────────────────────────────────── */
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

  // Key toggle (show/hide)
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

  // Close modal on overlay click
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

  // Model select — update hint on change, and on init
  const modelSel = $('vg-model-select');
  if (modelSel) {
    modelSel.addEventListener('change', updateModelHint);
    updateModelHint(); // init hint on page load
  }

  // Prompt char count
  $('vg-prompt')?.addEventListener('input', updateCharCount);

  // Enhance prompt
  $('btn-enhance-prompt')?.addEventListener('click', enhancePrompt);

  // Generate
  $('btn-generate')?.addEventListener('click', generate);

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
}

/* ════════════════════════════════════════════════════════════════
   ANALYTICS MODULE
   - View switcher (Studio ↔ Analytics)
   - Data fetching from /api/analytics
   - SVG activity chart, model table, comparison bars,
     duration dist, aspect ratio chips, project velocity,
     status breakdown, per-model deep dive
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* ── ANALYTICS STATE ──────────────────────────────────────────── */
const AN = {
  data:          null,   // last fetched analytics response
  range:         '30d',
  modelFilter:   'all',  // 'all' | 'dop' | 'soul' | 'kling' | 'seedance' | 'flux'
  focusedModel:  null,   // model id currently drilled into
  loading:       false,
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
    // Only available if logged in
    if (!VG.user) { showToast('Sign in to view analytics', true); return; }
    btnAnalytics.classList.add('active');
    btnStudio.classList.remove('active');
    studioEl.style.display    = 'none';
    analyticsEl.style.display = 'block';
    // Load analytics if not yet loaded
    if (!AN.data) loadAnalytics();
  });

  // Default: studio active
  btnStudio.classList.add('active');
}

/* ── RANGE BUTTONS ────────────────────────────────────────────── */
function initAnalyticsControls() {
  // Range tabs
  document.querySelectorAll('.an-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.an-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AN.range = btn.dataset.range;
      loadAnalytics();
    });
  });

  // Model filter tabs
  document.querySelectorAll('.an-model-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.an-model-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AN.modelFilter  = btn.dataset.model;
      AN.focusedModel = null;
      if (AN.data) renderAnalytics(AN.data);
    });
  });

  // Refresh button
  const refreshBtn = $('btn-an-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('spinning');
      loadAnalytics().finally(() => {
        refreshBtn.classList.remove('spinning');
      });
    });
  }
}

/* ── LOAD ANALYTICS ───────────────────────────────────────────── */
async function loadAnalytics() {
  if (AN.loading) return;
  AN.loading = true;

  // Show skeleton loading states
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
  const loadingHtml = '<div class="an-loading-state">Loading…</div>';
  if (loading) {
    ['an-model-table-wrap','an-compare-bars','an-project-list',
     'an-status-row','an-dur-bars','an-aspect-wrap','an-deep-cards'].forEach(id => {
      const el = $(id);
      if (el) el.innerHTML = loadingHtml;
    });
  }
}

/* ── FILTER MODELS BY FAMILY ──────────────────────────────────── */
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

  // Update activity period badge
  const periodBadge = $('an-activity-period');
  if (periodBadge) {
    const rangeLabels = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', 'all': 'All time' };
    periodBadge.textContent = rangeLabels[AN.range] || AN.range;
  }
}

/* ── SUMMARY CARDS ────────────────────────────────────────────── */
function renderSummaryCards(data, filteredMods) {
  const ov = data.overview || {};

  // Aggregate filtered model stats if filter is active
  let totalReqs   = ov.total_shots  || 0;
  let successRate = ov.success_rate || 0;
  let totalSecs   = ov.total_seconds || 0;
  let totalCost   = parseFloat(ov.total_cost_usd || 0);

  if (AN.modelFilter !== 'all' && filteredMods.length > 0) {
    totalReqs   = filteredMods.reduce((a, m) => a + (m.total || 0), 0);
    const totalCompleted = filteredMods.reduce((a, m) => a + (m.completed || 0), 0);
    successRate = totalReqs > 0 ? Math.round((totalCompleted / totalReqs) * 100) : 0;
    totalSecs   = filteredMods.reduce((a, m) => a + (m.total_seconds_gen || 0), 0);
    totalCost   = filteredMods.reduce((a, m) => a + parseFloat(m.est_cost_usd || 0), 0);
  }

  // P50 / P90 — weighted average across filtered models
  let p50 = null, p90 = null;
  const modelsWithSpeed = filteredMods.filter(m => m.p50_gen_sec != null && m.total > 0);
  if (modelsWithSpeed.length > 0) {
    const totalWeight = modelsWithSpeed.reduce((a, m) => a + m.total, 0);
    p50 = Math.round(modelsWithSpeed.reduce((a, m) => a + (m.p50_gen_sec * m.total), 0) / totalWeight);
    p90 = Math.round(modelsWithSpeed.reduce((a, m) => a + (m.p90_gen_sec * m.total), 0) / totalWeight);
  } else if (AN.modelFilter === 'all') {
    // Fallback to overview avg
    p50 = ov.avg_gen_time_sec ? Math.round(ov.avg_gen_time_sec) : null;
    p90 = ov.avg_gen_time_sec ? Math.round(ov.avg_gen_time_sec * 1.3) : null;
  }

  setText('an-total-requests', totalReqs.toLocaleString());
  setText('an-total-sub', `${filteredMods.length || data.models?.length || 0} model${(filteredMods.length || 1) !== 1 ? 's' : ''} active`);
  setText('an-success-rate', `${successRate}%`);
  setText('an-speed-p50',   p50 != null ? `${p50}s` : '—');
  setText('an-speed-p90',   p90 != null ? `${p90}s` : '—');
  setText('an-total-cost',  `$${totalCost.toFixed(2)}`);
  setText('an-total-seconds', `${totalSecs}s`);

  // Animate success bar
  const bar = $('an-success-bar');
  if (bar) {
    // Colour based on rate
    bar.style.background = successRate >= 80 ? 'var(--green)' : successRate >= 50 ? 'var(--yellow)' : 'var(--red)';
    // Defer to allow CSS transition
    requestAnimationFrame(() => { bar.style.width = `${successRate}%`; });
  }
}

/* ── ACTIVITY CHART (SVG bar chart) ──────────────────────────── */
function renderActivityChart(dailyData) {
  const svg      = $('an-activity-svg');
  const emptyEl  = $('an-activity-empty');
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

  const maxVal = Math.max(...dailyData.map(d => (d.total || 0)), 1);
  const n      = dailyData.length;
  const bw     = Math.max(2, (chartW / n) - 2);
  const gap    = (chartW - bw * n) / Math.max(n - 1, 1);

  let svgContent = '';

  // Axis line
  svgContent += `<line class="bar-axis" x1="${padL}" y1="${H - LABEL_H}" x2="${W - padR}" y2="${H - LABEL_H}"/>`;

  dailyData.forEach((d, i) => {
    const x        = padL + i * (bw + gap);
    const total    = d.total    || 0;
    const completed = d.completed || 0;
    const failed   = d.failed   || 0;
    const active   = total - completed - failed;

    const hTotal    = total    > 0 ? Math.max((total    / maxVal) * chartH, 2) : 0;
    const hCompleted= completed> 0 ? Math.max((completed/ maxVal) * chartH, 2) : 0;
    const hFailed   = failed   > 0 ? Math.max((failed   / maxVal) * chartH, 2) : 0;

    // Stacked: completed (bottom) + failed (top) — proportional
    if (hTotal > 0) {
      svgContent += `<rect class="bar-completed" x="${x}" y="${(H - LABEL_H) - hCompleted}" width="${bw}" height="${hCompleted}" rx="1"/>`;
      if (hFailed > 0) {
        svgContent += `<rect class="bar-failed" x="${x}" y="${(H - LABEL_H) - hCompleted - hFailed}" width="${bw}" height="${hFailed}" rx="1"/>`;
      }
    }

    // Label every Nth bar depending on density
    const step = n <= 10 ? 1 : n <= 20 ? 2 : n <= 31 ? 3 : 7;
    if (i % step === 0) {
      const dayLabel = d.day ? d.day.slice(5) : '';   // MM-DD
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
        <td style="text-align:right;font-family:'Space Mono',monospace;color:var(--ice);font-weight:700">${m.total}</td>
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

  // Click row → deep dive
  wrap.querySelectorAll('tr[data-model-id]').forEach(row => {
    row.addEventListener('click', () => {
      const mid = row.dataset.modelId;
      AN.focusedModel = AN.focusedModel === mid ? null : mid;
      // Re-render table highlighting + deep dive
      renderModelTable(models);
      renderDeepDive(AN.focusedModel, models);
    });
  });
}

/* ── COMPARE BARS ─────────────────────────────────────────────── */
function renderCompareBars(models) {
  const wrap = $('an-compare-bars');
  if (!wrap) return;

  if (!models.length) {
    wrap.innerHTML = '<div class="an-empty-state">No data yet.</div>';
    return;
  }

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

  if (!durationData.length) {
    wrap.innerHTML = '<div class="an-empty-state">No data yet.</div>';
    return;
  }

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

  if (!aspectData.length) {
    wrap.innerHTML = '<div class="an-empty-state">No data yet.</div>';
    return;
  }

  const total = aspectData.reduce((a, d) => a + (d.count || 0), 0) || 1;

  // Visual dimensions for aspect ratio icons
  const dims = {
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

  // Header row
  let html = `
    <div class="an-proj-row" style="opacity:0.5;font-size:0.62rem;text-transform:uppercase;letter-spacing:0.06em">
      <div style="color:var(--ice-ghost)">Project</div>
      <div style="color:var(--ice-ghost);text-align:right">Shots</div>
      <div style="color:var(--ice-ghost);text-align:right">Done</div>
    </div>`;

  html += active.map(p => {
    const pct = p.total_shots > 0
      ? Math.round(((p.completed_shots || 0) / p.total_shots) * 100)
      : 0;
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

  // Aggregate from filtered models if filter is active
  if (AN.modelFilter !== 'all' && models.length > 0) {
    completed = models.reduce((a, m) => a + (m.completed || 0), 0);
    failed    = models.reduce((a, m) => a + (m.failed    || 0), 0);
    nsfw      = models.reduce((a, m) => a + (m.nsfw      || 0), 0);
    active    = models.reduce((a, m) => a + (m.active    || 0), 0);
  }

  const total = completed + failed + nsfw + active || 1;

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
    wrap.innerHTML = '<div class="an-loading-state" style="color:var(--ice-ghost)">Click a model row above to drill into its metrics</div>';
    // Reset deep-dive header hint
    const hint = panel.querySelector('.an-panel-hint');
    if (hint) hint.textContent = 'click a model in the table above to focus';
    return;
  }

  const m = models.find(mo => mo.model === modelId);
  if (!m) {
    wrap.innerHTML = '<div class="an-loading-state">Model not found in current filter</div>';
    return;
  }

  // Update panel hint to show focused model name
  const hint = panel.querySelector('.an-panel-hint');
  if (hint) hint.textContent = m.label;

  const colour = MODEL_COLOURS[m.family] || MODEL_COLOURS.other;

  // Estimated cost per generation
  const costPerGen = m.total > 0
    ? (parseFloat(m.est_cost_usd || 0) / m.total).toFixed(3)
    : '0.000';

  // Output video minutes
  const outputMins = m.total_seconds_gen
    ? (m.total_seconds_gen / 60).toFixed(1)
    : '0.0';

  // Error rate
  const errRate = m.total > 0
    ? Math.round(((( m.failed || 0) + (m.nsfw || 0)) / m.total) * 100)
    : 0;

  const cards = [
    { label: 'Total Requests',    value: m.total,            sub: `${m.total} generations` },
    { label: 'Completed',         value: m.completed || 0,   sub: `${m.success_rate}% success rate` },
    { label: 'Failed / Blocked',  value: `${(m.failed||0) + (m.nsfw||0)}`, sub: `${errRate}% error rate` },
    { label: 'Speed P50',         value: m.p50_gen_sec != null ? `${m.p50_gen_sec}s` : '—', sub: 'median gen time' },
    { label: 'Speed P90',         value: m.p90_gen_sec != null ? `${m.p90_gen_sec}s` : '—', sub: '90th percentile' },
    { label: 'Min Gen Time',      value: m.min_gen_sec  != null ? `${Math.round(m.min_gen_sec)}s`  : '—', sub: 'fastest job' },
    { label: 'Max Gen Time',      value: m.max_gen_sec  != null ? `${Math.round(m.max_gen_sec)}s`  : '—', sub: 'slowest job' },
    { label: 'Est. Total Cost',   value: `$${m.est_cost_usd}`, sub: `$${costPerGen} per gen` },
    { label: 'Output Video',      value: `${m.total_seconds_gen || 0}s`, sub: `${outputMins} mins generated` },
    { label: 'Active Jobs',       value: m.active || 0,      sub: 'currently running' },
  ];

  wrap.innerHTML = cards.map(card => `
    <div class="an-deep-card" style="border-color:${colour}22">
      <div class="an-deep-card-label">${escHtml(card.label)}</div>
      <div class="an-deep-card-value" style="color:${colour}">${escHtml(String(card.value))}</div>
      <div class="an-deep-card-sub">${escHtml(card.sub)}</div>
    </div>`).join('');
}

/* ── HELPER: setText ──────────────────────────────────────────── */
function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

/* ── INIT ANALYTICS ON DOM READY ─────────────────────────────── */
// We hook into the existing DOMContentLoaded flow by patching bindUI
const _origBindUI = typeof bindUI === 'function' ? bindUI : null;

// Patch: run analytics init after the main bindUI
document.addEventListener('DOMContentLoaded', () => {
  initViewSwitcher();
  initAnalyticsControls();
});

// Also hook into enterApp so analytics reloads when user logs in
const _origEnterApp = enterApp;
// Override enterApp to also set up analytics when auth gate clears
// (We use a flag to avoid double-init)
let _analyticsInited = false;
