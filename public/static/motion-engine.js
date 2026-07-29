/* ════════════════════════════════════════════════════════════════
   SPECTRA — MOTION COMPOSITION ENGINE  v1.0
   /tools/motion-engine/
   Auth → Project select → Sequences → Beats (AI-composed or manual)
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* ── HELPERS ──────────────────────────────────────────────────── */
const $  = id  => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function api(method, path, body) {
  const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(path, opts);
}

function showToast(msg, isError = false) {
  const el = $('mo-toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = `mo-toast show ${isError ? 'error' : ''}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'mo-toast'; }, 3200);
}

/* ── STATE ────────────────────────────────────────────────────── */
const MO = {
  user:            null,
  projects:        [],
  activeProjectId: null,
  sequences:       [],
  activeSequence:  null,   // full sequence object incl. beats, once loaded
  catalog:         [],     // camera move catalog from /api/motion/catalog
};

/* ════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  try {
    const res = await api('GET', '/api/auth/me');
    if (!res.ok) { showAuthGate(); return; }
    MO.user = await res.json();
    $('mo-user-email').textContent = MO.user.email || '';
  } catch { showAuthGate(); return; }

  $('mo-auth-gate').style.display = 'none';
  $('mo-app').style.display = 'flex';

  bindUI();
  await loadCatalog();
  await loadProjects();
}

/* ── AUTH GATE ────────────────────────────────────────────────── */
function showAuthGate() {
  $('mo-auth-gate').style.display = 'flex';
  $('mo-app').style.display = 'none';
  $('mo-auth-form')?.addEventListener('submit', handleAuthSubmit);
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email    = $('mo-auth-email')?.value?.trim() || '';
  const password = $('mo-auth-pass')?.value || '';
  const errEl    = $('mo-auth-err');
  const btn      = $('mo-auth-submit');
  if (!email || !password) { if (errEl) errEl.textContent = 'Email and password required'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  if (errEl) errEl.textContent = '';
  try {
    const res  = await api('POST', '/api/auth/login', { email, password });
    const data = await res.json();
    if (!res.ok) { if (errEl) errEl.textContent = data.error || 'Sign in failed'; return; }
    MO.user = data.user || { email };
    $('mo-auth-gate').style.display = 'none';
    $('mo-app').style.display = 'flex';
    $('mo-user-email').textContent = MO.user.email || '';
    bindUI();
    await loadCatalog();
    await loadProjects();
  } catch (err) {
    if (errEl) errEl.textContent = err.message || 'Network error';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
  }
}

/* ════════════════════════════════════════════════════════════════
   BIND UI
   ════════════════════════════════════════════════════════════════ */
function bindUI() {
  $('mo-project-select')?.addEventListener('change', e => selectProject(e.target.value));

  $('btn-new-sequence')?.addEventListener('click', createSequencePrompt);
  $('btn-empty-new-sequence')?.addEventListener('click', createSequencePrompt);

  $('mo-seq-name')?.addEventListener('change', saveSequenceMeta);
  $('mo-seq-mood')?.addEventListener('change', saveSequenceMeta);

  $('btn-delete-sequence')?.addEventListener('click', deleteActiveSequence);
  $('btn-add-beat')?.addEventListener('click', () => addBeat());
  $('btn-ai-compose')?.addEventListener('click', runAiCompose);

  $('btn-export-plan')?.addEventListener('click', openExportModal);
  $('btn-close-export')?.addEventListener('click', () => $('mo-export-overlay').style.display = 'none');
  $('mo-export-overlay')?.addEventListener('click', e => { if (e.target.id === 'mo-export-overlay') $('mo-export-overlay').style.display = 'none'; });
  $('btn-copy-export')?.addEventListener('click', copyExportJson);
}

/* ════════════════════════════════════════════════════════════════
   CAMERA MOVE CATALOG / PALETTE
   ════════════════════════════════════════════════════════════════ */
async function loadCatalog() {
  try {
    const res  = await api('GET', '/api/motion/catalog');
    const data = await res.json();
    MO.catalog = data.moves || [];
    renderPalette();
  } catch (err) {
    console.error('loadCatalog error:', err);
  }
}

function renderPalette() {
  const el = $('mo-palette');
  if (!el) return;
  el.innerHTML = MO.catalog.map(m => `
    <div class="mo-palette-chip" data-move-id="${escHtml(m.id)}" title="${escHtml(m.prompt_fragment)}">
      <span class="mo-palette-chip-label">${escHtml(m.label)}</span>
      <span class="mo-palette-chip-cat">${escHtml(m.category)}</span>
    </div>
  `).join('');
}

function moveLabel(id) {
  const m = MO.catalog.find(m => m.id === id);
  return m ? m.label : id;
}

/* ════════════════════════════════════════════════════════════════
   PROJECTS
   ════════════════════════════════════════════════════════════════ */
async function loadProjects() {
  const sel = $('mo-project-select');
  try {
    const res  = await api('GET', '/api/projects');
    const data = await res.json();
    MO.projects = Array.isArray(data) ? data : (data.projects || []);

    if (!MO.projects.length) {
      if (sel) sel.innerHTML = '<option value="">No projects — create one in Video Generator</option>';
      showEmptyState();
      return;
    }

    if (sel) {
      sel.innerHTML = MO.projects.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('');
    }

    MO.activeProjectId = MO.projects[0].id;
    if (sel) sel.value = MO.activeProjectId;
    await loadSequences();
  } catch (err) {
    console.error('loadProjects error:', err);
    showToast('Failed to load projects', true);
  }
}

async function selectProject(projectId) {
  MO.activeProjectId = projectId;
  MO.activeSequence   = null;
  showEmptyState();
  await loadSequences();
}

/* ════════════════════════════════════════════════════════════════
   SEQUENCES
   ════════════════════════════════════════════════════════════════ */
async function loadSequences() {
  const listEl = $('mo-seq-list');
  if (!MO.activeProjectId) return;
  try {
    const res  = await api('GET', `/api/motion/sequences?project_id=${encodeURIComponent(MO.activeProjectId)}`);
    const data = await res.json();
    MO.sequences = data.sequences || [];
    renderSequenceList();
  } catch (err) {
    console.error('loadSequences error:', err);
    if (listEl) listEl.innerHTML = '<div class="mo-seq-empty">Failed to load sequences</div>';
  }
}

function renderSequenceList() {
  const listEl = $('mo-seq-list');
  if (!listEl) return;
  if (!MO.sequences.length) {
    listEl.innerHTML = '<div class="mo-seq-empty">No sequences yet</div>';
    return;
  }
  listEl.innerHTML = MO.sequences.map(s => `
    <button class="mo-seq-item ${MO.activeSequence?.id === s.id ? 'active' : ''}" data-seq-id="${escHtml(s.id)}">
      <span class="mo-seq-item-name">${escHtml(s.name)}</span>
      <span class="mo-seq-item-meta">${s.beat_count || 0} beats · ${s.total_duration_sec || 0}s</span>
    </button>
  `).join('');
  $$('.mo-seq-item').forEach(btn => btn.addEventListener('click', () => openSequence(btn.dataset.seqId)));
}

async function createSequencePrompt() {
  if (!MO.activeProjectId) { showToast('Select or create a project first', true); return; }
  const name = prompt('Sequence name:', 'New Sequence');
  if (!name?.trim()) return;
  try {
    const res  = await api('POST', '/api/motion/sequences', { project_id: MO.activeProjectId, name: name.trim() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create sequence');
    await loadSequences();
    await openSequence(data.id);
    showToast('Sequence created ✓');
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openSequence(seqId) {
  try {
    const res  = await api('GET', `/api/motion/sequences/${seqId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load sequence');
    MO.activeSequence = data;
    renderSequenceList();
    renderEditor();
  } catch (err) {
    showToast(err.message, true);
  }
}

function showEmptyState() {
  $('mo-empty-state').style.display = 'flex';
  $('mo-editor').style.display      = 'none';
}

function renderEditor() {
  const seq = MO.activeSequence;
  if (!seq) { showEmptyState(); return; }

  $('mo-empty-state').style.display = 'none';
  $('mo-editor').style.display      = 'flex';

  $('mo-seq-name').value = seq.name || '';
  $('mo-seq-mood').value = seq.mood || '';

  renderBeats();
}

async function saveSequenceMeta() {
  const seq = MO.activeSequence;
  if (!seq) return;
  const name = $('mo-seq-name').value.trim();
  const mood = $('mo-seq-mood').value.trim();
  try {
    const res  = await api('PATCH', `/api/motion/sequences/${seq.id}`, { name, mood });
    if (!res.ok) throw new Error('Save failed');
    seq.name = name;
    seq.mood = mood;
    renderSequenceList();
    showToast('Saved ✓');
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteActiveSequence() {
  const seq = MO.activeSequence;
  if (!seq) return;
  if (!confirm(`Delete sequence "${seq.name}"? This cannot be undone.`)) return;
  try {
    await api('DELETE', `/api/motion/sequences/${seq.id}`);
    MO.activeSequence = null;
    await loadSequences();
    showEmptyState();
    showToast('Sequence deleted');
  } catch (err) {
    showToast('Failed to delete sequence', true);
  }
}

/* ════════════════════════════════════════════════════════════════
   BEATS
   ════════════════════════════════════════════════════════════════ */
function renderBeats() {
  const listEl = $('mo-beats-list');
  const seq    = MO.activeSequence;
  if (!listEl || !seq) return;

  const beats = seq.beats || [];
  const totalDuration = beats.reduce((a, b) => a + (b.duration_sec || 0), 0);
  $('mo-editor-duration').textContent = `${totalDuration}s total · ${beats.length} beat${beats.length !== 1 ? 's' : ''}`;

  if (!beats.length) {
    listEl.innerHTML = '<div class="mo-beats-empty">No beats yet — use AI Compose or add a beat manually.</div>';
    return;
  }

  listEl.innerHTML = beats.map((b, idx) => `
    <div class="mo-beat-card" draggable="true" data-beat-id="${escHtml(b.id)}">
      <div class="mo-beat-drag-handle" title="Drag to reorder">
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2" cy="2" r="1.3"/><circle cx="8" cy="2" r="1.3"/><circle cx="2" cy="7" r="1.3"/><circle cx="8" cy="7" r="1.3"/><circle cx="2" cy="12" r="1.3"/><circle cx="8" cy="12" r="1.3"/></svg>
      </div>
      <div class="mo-beat-index">${idx + 1}</div>
      <div class="mo-beat-body">
        <select class="mo-beat-move-select" data-field="camera_move" data-beat-id="${escHtml(b.id)}">
          ${MO.catalog.map(m => `<option value="${escHtml(m.id)}" ${m.id === b.camera_move ? 'selected' : ''}>${escHtml(m.label)}</option>`).join('')}
        </select>
        <textarea class="mo-beat-notes" data-field="notes" data-beat-id="${escHtml(b.id)}" placeholder="Notes / reasoning" rows="1">${escHtml(b.notes || '')}</textarea>
      </div>
      <div class="mo-beat-controls">
        <label class="mo-beat-slider-label">Intensity
          <input type="range" min="1" max="10" value="${b.intensity}" class="mo-beat-slider" data-field="intensity" data-beat-id="${escHtml(b.id)}"/>
          <span class="mo-beat-slider-val">${b.intensity}</span>
        </label>
        <label class="mo-beat-dur-label">Dur
          <input type="number" min="2" max="10" value="${b.duration_sec}" class="mo-beat-dur-input" data-field="duration_sec" data-beat-id="${escHtml(b.id)}"/>s
        </label>
      </div>
      <button class="mo-beat-delete" data-beat-id="${escHtml(b.id)}" title="Delete beat">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  bindBeatCardEvents();
  initBeatDragAndDrop();
}

function bindBeatCardEvents() {
  $$('.mo-beat-move-select').forEach(sel => sel.addEventListener('change', e => updateBeatField(e.target.dataset.beatId, 'camera_move', e.target.value)));
  $$('.mo-beat-notes').forEach(ta => ta.addEventListener('change', e => updateBeatField(e.target.dataset.beatId, 'notes', e.target.value)));
  $$('.mo-beat-slider').forEach(sl => {
    sl.addEventListener('input', e => {
      const valEl = e.target.parentElement.querySelector('.mo-beat-slider-val');
      if (valEl) valEl.textContent = e.target.value;
    });
    sl.addEventListener('change', e => updateBeatField(e.target.dataset.beatId, 'intensity', Number(e.target.value)));
  });
  $$('.mo-beat-dur-input').forEach(inp => inp.addEventListener('change', e => updateBeatField(e.target.dataset.beatId, 'duration_sec', Number(e.target.value))));
  $$('.mo-beat-delete').forEach(btn => btn.addEventListener('click', () => deleteBeat(btn.dataset.beatId)));
}

async function addBeat() {
  const seq = MO.activeSequence;
  if (!seq) return;
  const defaultMove = MO.catalog[0]?.id || 'static';
  try {
    const res  = await api('POST', `/api/motion/sequences/${seq.id}/beats`, {
      camera_move: defaultMove, intensity: 5, duration_sec: 5,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add beat');
    await openSequence(seq.id);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function updateBeatField(beatId, field, value) {
  const seq = MO.activeSequence;
  if (!seq) return;
  try {
    const res = await api('PATCH', `/api/motion/beats/${beatId}`, { [field]: value });
    if (!res.ok) throw new Error('Update failed');
    // Keep local state in sync without a full re-fetch, except for
    // fields whose display depends on the catalog lookup.
    const beat = seq.beats.find(b => b.id === beatId);
    if (beat) beat[field] = value;
    if (field === 'duration_sec' || field === 'intensity') {
      const totalDuration = seq.beats.reduce((a, b) => a + (b.duration_sec || 0), 0);
      $('mo-editor-duration').textContent = `${totalDuration}s total · ${seq.beats.length} beat${seq.beats.length !== 1 ? 's' : ''}`;
    }
  } catch (err) {
    showToast('Failed to save beat — reverting', true);
    await openSequence(seq.id);
  }
}

async function deleteBeat(beatId) {
  const seq = MO.activeSequence;
  if (!seq) return;
  try {
    await api('DELETE', `/api/motion/beats/${beatId}`);
    await openSequence(seq.id);
    showToast('Beat removed');
  } catch (err) {
    showToast('Failed to delete beat', true);
  }
}

/* ── Drag-and-drop beat reorder (mirrors Video Generator's pattern,
      including rollback-to-server-truth on save failure) ────────── */
let _dragBeatId = null;
let _dragOverBeatId = null;

function initBeatDragAndDrop() {
  const list = $('mo-beats-list');
  if (!list) return;

  list.addEventListener('dragstart', e => {
    const card = e.target.closest('.mo-beat-card');
    if (!card) return;
    _dragBeatId = card.dataset.beatId;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  list.addEventListener('dragend', e => {
    const card = e.target.closest('.mo-beat-card');
    if (card) card.classList.remove('dragging');
    $$('.drag-over').forEach(el => el.classList.remove('drag-over'));
    _dragBeatId = null;
    _dragOverBeatId = null;
  });

  list.addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('.mo-beat-card');
    if (!card || card.dataset.beatId === _dragBeatId) return;
    $$('.drag-over').forEach(el => el.classList.remove('drag-over'));
    card.classList.add('drag-over');
    _dragOverBeatId = card.dataset.beatId;
  });

  list.addEventListener('drop', async e => {
    e.preventDefault();
    $$('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (!_dragBeatId || !_dragOverBeatId || _dragBeatId === _dragOverBeatId) return;

    const seq = MO.activeSequence;
    if (!seq) return;

    const beats   = seq.beats;
    const newOrder = beats.filter(b => b.id !== _dragBeatId);
    const dropIdx  = newOrder.findIndex(b => b.id === _dragOverBeatId);
    const dragged  = beats.find(b => b.id === _dragBeatId);
    if (!dragged) return;
    newOrder.splice(dropIdx, 0, dragged);

    seq.beats = newOrder;
    renderBeats();

    try {
      const res = await api('PATCH', `/api/motion/sequences/${seq.id}/reorder`, {
        beat_ids: newOrder.map(b => b.id),
      });
      if (!res.ok) {
        showToast('Reorder save failed — reverting', true);
        await openSequence(seq.id);
      }
    } catch {
      showToast('Reorder save failed — reverting', true);
      await openSequence(seq.id);
    }
  });
}

/* ════════════════════════════════════════════════════════════════
   AI COMPOSER
   ════════════════════════════════════════════════════════════════ */
async function runAiCompose() {
  const seq = MO.activeSequence;
  if (!seq) { showToast('Create or select a sequence first', true); return; }

  const description = $('mo-composer-desc').value.trim();
  if (!description) { showToast('Describe the scene first', true); return; }

  const beatCount = Number($('mo-composer-count').value) || 4;
  const replace   = $('mo-composer-replace').checked;
  const btn       = $('btn-ai-compose');

  if (btn) { btn.disabled = true; btn.innerHTML = 'Composing…'; }
  try {
    const res  = await api('POST', `/api/motion/sequences/${seq.id}/compose`, {
      description, beat_count: beatCount, mood: $('mo-seq-mood').value.trim(), replace,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI compose failed');
    await openSequence(seq.id);
    showToast(`${data.beats_added} beat${data.beats_added !== 1 ? 's' : ''} composed ✓`);
    $('mo-composer-desc').value = '';
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/></svg> AI Compose'; }
  }
}

/* ════════════════════════════════════════════════════════════════
   EXPORT PLAN
   ════════════════════════════════════════════════════════════════ */
let _lastExportPlan = null;

async function openExportModal() {
  const seq = MO.activeSequence;
  if (!seq) return;
  try {
    const res  = await api('GET', `/api/motion/sequences/${seq.id}/export`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Export failed');
    _lastExportPlan = data;
    renderExportBody(data);
    $('mo-export-overlay').style.display = 'flex';
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderExportBody(data) {
  const el = $('mo-export-body');
  if (!el) return;
  if (!data.plan.length) {
    el.innerHTML = '<div class="mo-beats-empty">No beats to export yet.</div>';
    return;
  }
  el.innerHTML = data.plan.map(p => `
    <div class="mo-export-row">
      <div class="mo-export-row-head">
        <span class="mo-export-row-idx">${p.index}</span>
        <span class="mo-export-row-move">${escHtml(p.camera_label)}</span>
        <span class="mo-export-row-dur">${p.duration_sec}s</span>
      </div>
      <div class="mo-export-row-frag">${escHtml(p.prompt_fragment)}</div>
      <div class="mo-export-row-meta">quality: <code>${escHtml(p.quality_string)}</code>${p.notes ? ` · ${escHtml(p.notes)}` : ''}</div>
    </div>
  `).join('');
}

function copyExportJson() {
  if (!_lastExportPlan) return;
  const text = JSON.stringify(_lastExportPlan, null, 2);
  navigator.clipboard.writeText(text).then(() => showToast('Plan JSON copied ✓')).catch(() => showToast('Copy failed', true));
}
