/* ════════════════════════════════════════════════════════════════
   SPECTRA — PERSONA ENGINE  v1.0
   /tools/persona-engine/
   Auth → Persona list → Editor (voice fields) → Apply Voice → History
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
  const el = $('pe-toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = `pe-toast show ${isError ? 'error' : ''}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'pe-toast'; }, 3200);
}

function timeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── STATE ────────────────────────────────────────────────────── */
const PE = {
  user:           null,
  personas:       [],
  activePersona:  null,   // full persona object incl. tone_traits[], example_lines[], recent_applications[]
  archetypes:     [],     // reference catalog from /api/persona/archetypes
  traits:         [],     // working tone_traits array for the active editor
  examples:       [],     // working example_lines array for the active editor
};

/* ════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  try {
    const res = await api('GET', '/api/auth/me');
    if (!res.ok) { showAuthGate(); return; }
    PE.user = await res.json();
    $('pe-user-email').textContent = PE.user.email || '';
  } catch { showAuthGate(); return; }

  $('pe-auth-gate').style.display = 'none';
  $('pe-app').style.display = 'flex';

  bindUI();
  await loadArchetypes();
  await loadPersonas();
}

/* ── AUTH GATE ────────────────────────────────────────────────── */
function showAuthGate() {
  $('pe-auth-gate').style.display = 'flex';
  $('pe-app').style.display = 'none';
  $('pe-auth-form')?.addEventListener('submit', handleAuthSubmit);
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email    = $('pe-auth-email')?.value?.trim() || '';
  const password = $('pe-auth-pass')?.value || '';
  const errEl    = $('pe-auth-err');
  const btn      = $('pe-auth-submit');
  if (!email || !password) { if (errEl) errEl.textContent = 'Email and password required'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  if (errEl) errEl.textContent = '';
  try {
    const res  = await api('POST', '/api/auth/login', { email, password });
    const data = await res.json();
    if (!res.ok) { if (errEl) errEl.textContent = data.error || 'Sign in failed'; return; }
    PE.user = data.user || { email };
    $('pe-auth-gate').style.display = 'none';
    $('pe-app').style.display = 'flex';
    $('pe-user-email').textContent = PE.user.email || '';
    bindUI();
    await loadArchetypes();
    await loadPersonas();
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
  $('btn-new-persona')?.addEventListener('click', createPersonaPrompt);
  $('btn-empty-new-persona')?.addEventListener('click', createPersonaPrompt);

  $('btn-save-persona')?.addEventListener('click', savePersona);
  $('btn-delete-persona')?.addEventListener('click', deleteActivePersona);
  $('btn-set-default')?.addEventListener('click', setDefaultPersona);

  $('pe-traits-input')?.addEventListener('keydown', handleTraitInput);
  $('btn-add-example')?.addEventListener('click', () => addExampleRow(''));

  $('btn-apply-voice')?.addEventListener('click', applyVoice);
  $('btn-copy-output')?.addEventListener('click', copyOutput);
}

/* ════════════════════════════════════════════════════════════════
   ARCHETYPE REFERENCE CATALOG
   ════════════════════════════════════════════════════════════════ */
async function loadArchetypes() {
  try {
    const res  = await api('GET', '/api/persona/archetypes');
    const data = await res.json();
    PE.archetypes = data.archetypes || [];
    renderArchetypePalette();
  } catch (err) {
    console.error('loadArchetypes error:', err);
  }
}

function renderArchetypePalette() {
  const el = $('pe-archetype-palette');
  if (!el) return;
  el.innerHTML = PE.archetypes.map(a => `
    <div class="pe-archetype-chip" data-archetype-label="${escHtml(a.label)}" title="Click to use this archetype">
      <span class="pe-archetype-chip-label">${escHtml(a.label)}</span>
      <span class="pe-archetype-chip-traits">${escHtml((a.traits || []).join(', '))}</span>
    </div>
  `).join('');
  $$('.pe-archetype-chip').forEach(chip => chip.addEventListener('click', () => {
    if (!PE.activePersona) { showToast('Select or create a persona first', true); return; }
    const label = chip.dataset.archetypeLabel;
    $('pe-archetype').value = label;
    const archetype = PE.archetypes.find(a => a.label === label);
    if (archetype) {
      archetype.traits.forEach(t => { if (!PE.traits.includes(t)) PE.traits.push(t); });
      renderTraits();
    }
  }));
}

/* ════════════════════════════════════════════════════════════════
   PERSONAS
   ════════════════════════════════════════════════════════════════ */
async function loadPersonas() {
  try {
    const res  = await api('GET', '/api/personas');
    const data = await res.json();
    PE.personas = data.personas || [];
    renderPersonaList();
    if (!PE.personas.length) showEmptyState();
  } catch (err) {
    console.error('loadPersonas error:', err);
    showToast('Failed to load personas', true);
  }
}

function renderPersonaList() {
  const listEl = $('pe-persona-list');
  if (!listEl) return;
  if (!PE.personas.length) {
    listEl.innerHTML = '<div class="pe-persona-empty">No personas yet</div>';
    return;
  }
  listEl.innerHTML = PE.personas.map(p => `
    <button class="pe-persona-item ${PE.activePersona?.id === p.id ? 'active' : ''}" data-persona-id="${escHtml(p.id)}">
      <span class="pe-persona-item-name">${escHtml(p.name)}${p.is_default ? '<span class="pe-default-badge">Default</span>' : ''}</span>
      <span class="pe-persona-item-meta">${p.project_count || 0} project${p.project_count === 1 ? '' : 's'} · ${p.application_count || 0} applied</span>
    </button>
  `).join('');
  $$('.pe-persona-item').forEach(btn => btn.addEventListener('click', () => openPersona(btn.dataset.personaId)));
}

async function createPersonaPrompt() {
  const name = prompt('Persona name:', 'New Persona');
  if (!name?.trim()) return;
  try {
    const res  = await api('POST', '/api/personas', { name: name.trim() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create persona');
    await loadPersonas();
    await openPersona(data.id);
    showToast('Persona created ✓');
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openPersona(personaId) {
  try {
    const res  = await api('GET', `/api/personas/${personaId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load persona');
    PE.activePersona = data;
    PE.traits   = Array.isArray(data.tone_traits)   ? [...data.tone_traits]   : [];
    PE.examples = Array.isArray(data.example_lines) ? [...data.example_lines] : [];
    renderPersonaList();
    renderEditor();
  } catch (err) {
    showToast(err.message, true);
  }
}

function showEmptyState() {
  $('pe-empty-state').style.display = 'flex';
  $('pe-editor').style.display      = 'none';
}

function renderEditor() {
  const persona = PE.activePersona;
  if (!persona) { showEmptyState(); return; }

  $('pe-empty-state').style.display = 'none';
  $('pe-editor').style.display      = 'flex';

  $('pe-name').value      = persona.name || '';
  $('pe-archetype').value = persona.archetype || '';
  $('pe-audience').value  = persona.audience_summary || '';
  $('pe-vocab').value     = persona.vocabulary_notes || '';

  $('btn-set-default').classList.toggle('active', !!persona.is_default);

  renderTraits();
  renderExamples();
  renderApplyOutput(null);
  renderHistory();
}

async function savePersona() {
  const persona = PE.activePersona;
  if (!persona) return;
  const btn = $('btn-save-persona');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const body = {
      name:              $('pe-name').value.trim(),
      archetype:         $('pe-archetype').value.trim(),
      tone_traits:       PE.traits,
      audience_summary:  $('pe-audience').value.trim(),
      vocabulary_notes:  $('pe-vocab').value.trim(),
      example_lines:     PE.examples.filter(l => l && l.trim()),
    };
    const res = await api('PATCH', `/api/personas/${persona.id}`, body);
    if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Save failed'); }
    Object.assign(persona, body);
    renderPersonaList();
    showToast('Persona saved ✓');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Persona'; }
  }
}

async function deleteActivePersona() {
  const persona = PE.activePersona;
  if (!persona) return;
  if (!confirm(`Delete persona "${persona.name}"? This cannot be undone.`)) return;
  try {
    await api('DELETE', `/api/personas/${persona.id}`);
    PE.activePersona = null;
    await loadPersonas();
    showEmptyState();
    showToast('Persona deleted');
  } catch (err) {
    showToast('Failed to delete persona', true);
  }
}

async function setDefaultPersona() {
  const persona = PE.activePersona;
  if (!persona) return;
  try {
    const res = await api('POST', `/api/personas/${persona.id}/set-default`);
    if (!res.ok) throw new Error('Failed to set default');
    await loadPersonas();
    await openPersona(persona.id);
    showToast('Default persona updated ✓');
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ════════════════════════════════════════════════════════════════
   TONE TRAITS (tag input)
   ════════════════════════════════════════════════════════════════ */
function renderTraits() {
  const wrap = $('pe-traits-wrap');
  const input = $('pe-traits-input');
  if (!wrap || !input) return;
  $$('.pe-tag', wrap).forEach(el => el.remove());
  PE.traits.forEach((t, idx) => {
    const tag = document.createElement('span');
    tag.className = 'pe-tag';
    tag.innerHTML = `${escHtml(t)} <span class="pe-tag-remove" data-idx="${idx}">×</span>`;
    wrap.insertBefore(tag, input);
  });
  $$('.pe-tag-remove', wrap).forEach(x => x.addEventListener('click', e => {
    PE.traits.splice(Number(e.target.dataset.idx), 1);
    renderTraits();
  }));
}

function handleTraitInput(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = e.target.value.trim().replace(/,$/, '');
    if (val && !PE.traits.includes(val)) {
      PE.traits.push(val);
      renderTraits();
    }
    e.target.value = '';
  } else if (e.key === 'Backspace' && !e.target.value && PE.traits.length) {
    PE.traits.pop();
    renderTraits();
  }
}

/* ════════════════════════════════════════════════════════════════
   EXAMPLE LINES
   ════════════════════════════════════════════════════════════════ */
function renderExamples() {
  const listEl = $('pe-example-list');
  if (!listEl) return;
  if (!PE.examples.length) {
    listEl.innerHTML = '';
    return;
  }
  listEl.innerHTML = PE.examples.map((line, idx) => `
    <div class="pe-example-row" data-idx="${idx}">
      <input type="text" class="pe-text-input pe-example-input" value="${escHtml(line)}" placeholder="A sample line in this voice…"/>
      <button class="pe-example-remove" data-idx="${idx}" title="Remove">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');
  $$('.pe-example-input', listEl).forEach((inp, idx) => inp.addEventListener('change', e => { PE.examples[idx] = e.target.value; }));
  $$('.pe-example-remove', listEl).forEach(btn => btn.addEventListener('click', e => {
    const idx = Number(e.currentTarget.dataset.idx);
    PE.examples.splice(idx, 1);
    renderExamples();
  }));
}

function addExampleRow(text) {
  PE.examples.push(text || '');
  renderExamples();
  const inputs = $$('.pe-example-input');
  inputs[inputs.length - 1]?.focus();
}

/* ════════════════════════════════════════════════════════════════
   VOICE APPLY
   ════════════════════════════════════════════════════════════════ */
let _lastAppliedOutput = '';

async function applyVoice() {
  const persona = PE.activePersona;
  if (!persona) { showToast('Select or create a persona first', true); return; }

  const sourceText = $('pe-apply-input').value.trim();
  if (!sourceText) { showToast('Enter some text to rewrite first', true); return; }

  const context = $('pe-apply-context').value;
  const btn = $('btn-apply-voice');
  if (btn) { btn.disabled = true; btn.innerHTML = 'Applying…'; }

  try {
    const res  = await api('POST', `/api/personas/${persona.id}/apply`, { source_text: sourceText, context });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Apply failed');
    _lastAppliedOutput = data.output_text;
    renderApplyOutput(data.output_text, data.unchanged);
    await openPersona(persona.id); // refresh history + application_count
    if (!data.unchanged) showToast('Voice applied ✓');
    else showToast('AI unavailable right now — showing original text unchanged', true);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/></svg> Apply Voice'; }
  }
}

function renderApplyOutput(text, unchanged) {
  const el = $('pe-apply-output');
  if (!el) return;
  if (!text) {
    el.textContent = 'Output will appear here.';
    el.classList.add('pe-apply-output-empty');
    return;
  }
  el.textContent = text;
  el.classList.remove('pe-apply-output-empty');
}

function copyOutput() {
  if (!_lastAppliedOutput) { showToast('Nothing to copy yet', true); return; }
  navigator.clipboard.writeText(_lastAppliedOutput).then(() => showToast('Copied ✓')).catch(() => showToast('Copy failed', true));
}

/* ════════════════════════════════════════════════════════════════
   HISTORY
   ════════════════════════════════════════════════════════════════ */
function renderHistory() {
  const listEl = $('pe-history-list');
  const persona = PE.activePersona;
  if (!listEl) return;
  const applications = persona?.recent_applications || [];
  if (!applications.length) {
    listEl.innerHTML = '<div class="pe-history-empty">No applications yet — try Apply Voice above.</div>';
    return;
  }
  listEl.innerHTML = applications.map(a => `
    <div class="pe-history-row">
      <div class="pe-history-row-head">
        <span class="pe-history-context">${escHtml(a.context || 'general')}</span>
        <span class="pe-history-time">${timeAgo(a.created_at)}</span>
      </div>
      <div class="pe-history-source">"${escHtml(a.source_text)}"</div>
      <div class="pe-history-output">→ ${escHtml(a.output_text)}</div>
    </div>
  `).join('');
}
