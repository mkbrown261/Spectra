/**
 * SPECTRA — Video Generator v1
 * Full frontend: input state, streaming, tab rendering
 */
(function () {
  'use strict';

  /* ── State ──────────────────────────────────────────────────────── */
  let state = {
    platform:    'tiktok',
    style:       'cinematic',
    aspect:      '9:16',
    tone:        'engaging',
    duration:    30,
    concept:     '',
    script:      '',
    audience:    '',
    mood:        '',
    music_style: '',
    result:      null,
    hooks:       null,
    loading:     false,
    hooksLoading: false,
  };

  /* ── DOM refs ───────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const $$ = sel => document.querySelectorAll(sel);

  /* ── Init ───────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    bindPlatformBtns();
    bindStyleChips();
    bindAspectBtns();
    bindGenerateBtn();
    bindHooksBtn();
    bindOutputTabs();
    bindCopyActions();
    bindExportBtn();
    bindRerunBtn();
    syncCharCounts();
  });

  /* ── Platform buttons ───────────────────────────────────────────── */
  function bindPlatformBtns() {
    $$('.vg-platform-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.vg-platform-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.platform = btn.dataset.platform;
        // Auto-set aspect ratio for platform
        const aspectMap = { tiktok:'9:16', instagram:'9:16', youtube:'16:9', twitter:'16:9', facebook:'16:9', ads:'1:1' };
        const asp = aspectMap[state.platform];
        if (asp) selectAspect(asp);
      });
    });
  }

  /* ── Style chips ────────────────────────────────────────────────── */
  function bindStyleChips() {
    $$('.vg-style-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.vg-style-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.style = chip.dataset.style;
      });
    });
  }

  /* ── Aspect ratio ───────────────────────────────────────────────── */
  function bindAspectBtns() {
    $$('.vg-aspect-btn').forEach(btn => {
      btn.addEventListener('click', () => selectAspect(btn.dataset.aspect));
    });
  }
  function selectAspect(asp) {
    $$('.vg-aspect-btn').forEach(b => b.classList.toggle('active', b.dataset.aspect === asp));
    state.aspect = asp;
  }

  /* ── Char counts ────────────────────────────────────────────────── */
  function syncCharCounts() {
    const pairs = [
      ['vg-concept', 'vg-concept-count', 500],
      ['vg-script',  'vg-script-count',  2000],
    ];
    pairs.forEach(([inputId, countId, max]) => {
      const el = $(inputId), counter = $(countId);
      if (!el || !counter) return;
      const update = () => {
        const len = el.value.length;
        counter.textContent = `${len}/${max}`;
        counter.style.color = len > max * 0.9 ? 'var(--orange)' : 'rgba(168,216,240,0.35)';
      };
      el.addEventListener('input', update);
      update();
    });
  }

  /* ── Generate button ────────────────────────────────────────────── */
  function bindGenerateBtn() {
    const btn = $('btn-generate');
    if (!btn) return;
    btn.addEventListener('click', runGenerate);
  }

  async function runGenerate() {
    const concept = $('vg-concept')?.value?.trim();
    if (!concept) {
      flashField('vg-concept', 'Describe your video concept first');
      return;
    }

    state.concept    = concept;
    state.script     = $('vg-script')?.value?.trim()    || '';
    state.audience   = $('vg-audience')?.value?.trim()  || '';
    state.mood       = $('vg-mood')?.value?.trim()      || '';
    state.music_style= $('vg-music')?.value?.trim()     || '';
    state.tone       = $('vg-tone')?.value               || 'engaging';
    state.duration   = parseInt($('vg-duration')?.value) || 30;
    state.loading    = true;
    state.result     = null;
    state.hooks      = null;

    showLoading('Generating your video production brief...');

    try {
      const body = {
        platform:     state.platform,
        style:        state.style,
        aspect_ratio: state.aspect,
        tone:         state.tone,
        duration_sec: state.duration,
        concept:      state.concept,
        script:       state.script,
        audience:     state.audience,
        mood:         state.mood,
        music_style:  state.music_style,
      };

      const res = await fetch('/api/video/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'token') {
              fullText += evt.text;
              updateStreamPreview(fullText);
            } else if (evt.type === 'done') {
              try {
                // Strip markdown code fences if present
                let raw = evt.full || fullText;
                raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/,'').trim();
                state.result = JSON.parse(raw);
                showResults();
              } catch (parseErr) {
                showError('Failed to parse response. Try again.');
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      showError(err.message || 'Generation failed. Check your connection and try again.');
    } finally {
      state.loading = false;
    }
  }

  /* ── Hooks button ───────────────────────────────────────────────── */
  function bindHooksBtn() {
    const btn = $('btn-hooks');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (state.hooksLoading) return;
      const concept = $('vg-concept')?.value?.trim();
      if (!concept) { flashField('vg-concept', 'Enter your concept first'); return; }

      state.hooksLoading = true;

      // Switch to hooks tab and show spinner
      switchOutputTab('hooks');
      renderHooksLoading();

      try {
        const res = await fetch('/api/video/hooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: state.platform,
            concept,
            style: state.style,
            audience: $('vg-audience')?.value?.trim() || '',
            tone: $('vg-tone')?.value || 'engaging',
          }),
        });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buffer = '', fullText = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'token') fullText += evt.text;
              else if (evt.type === 'done') {
                let raw = evt.full || fullText;
                raw = raw.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();
                state.hooks = JSON.parse(raw);
                renderHooks();
              }
            } catch {}
          }
        }
      } catch (err) {
        const hookTab = $('out-hooks');
        if (hookTab) hookTab.innerHTML = `<p style="color:var(--red);padding:2rem;text-align:center">${err.message}</p>`;
      } finally {
        state.hooksLoading = false;
      }
    });
  }

  /* ── Output tab switching ───────────────────────────────────────── */
  function bindOutputTabs() {
    $$('.vg-output-tab').forEach(tab => {
      tab.addEventListener('click', () => switchOutputTab(tab.dataset.outputTab));
    });
  }
  function switchOutputTab(name) {
    $$('.vg-output-tab').forEach(t => t.classList.toggle('active', t.dataset.outputTab === name));
    $$('.vg-output-content').forEach(c => c.classList.toggle('active', c.id === `out-${name}`));
  }

  /* ── Copy / export ──────────────────────────────────────────────── */
  function bindCopyActions() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-copy]');
      if (!btn) return;
      const text = btn.dataset.copy || btn.closest('[data-copy-text]')?.dataset?.copyText;
      if (text) copyToClipboard(text);
    });
  }

  function bindExportBtn() {
    $('btn-export')?.addEventListener('click', exportMarkdown);
  }
  function bindRerunBtn() {
    $('btn-rerun')?.addEventListener('click', () => {
      hideResults();
      runGenerate();
    });
  }

  /* ── UI helpers ─────────────────────────────────────────────────── */
  function showLoading(label) {
    $('vg-empty')   && ($('vg-empty').style.display   = 'none');
    $('vg-results') && ($('vg-results').style.display = 'none');
    $('vg-error')   && ($('vg-error').style.display   = 'none');
    $('vg-loading') && ($('vg-loading').style.display = 'flex');
    const lbl = $('loading-label');
    if (lbl) lbl.textContent = label;
    $('loading-stream') && ($('loading-stream').textContent = '');
    $('btn-generate') && ($('btn-generate').disabled = true);
  }

  function updateStreamPreview(text) {
    const el = $('loading-stream');
    if (!el) return;
    // Show last 200 chars of stream as a preview
    const preview = text.slice(-200).replace(/[{}\[\]"]/g, '').trim();
    el.textContent = preview;
    const lbl = $('loading-label');
    if (lbl) lbl.textContent = 'Writing production brief...';
  }

  function showResults() {
    $('vg-loading') && ($('vg-loading').style.display = 'none');
    $('vg-empty')   && ($('vg-empty').style.display   = 'none');
    $('vg-error')   && ($('vg-error').style.display   = 'none');
    const res = $('vg-results');
    if (res) res.style.display = 'block';
    $('btn-generate') && ($('btn-generate').disabled = false);

    // Set platform badge
    const badge = $('results-platform-badge');
    if (badge) badge.textContent = state.platform.toUpperCase();

    renderBrief();
    renderScript();
    renderShots();
    renderProduction();
    renderCaptions();

    switchOutputTab('brief');
  }

  function hideResults() {
    $('vg-results') && ($('vg-results').style.display = 'none');
  }

  function showError(msg) {
    $('vg-loading') && ($('vg-loading').style.display = 'none');
    $('btn-generate') && ($('btn-generate').disabled = false);
    let el = $('vg-error');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vg-error';
      el.style.cssText = 'padding:3rem;text-align:center;color:var(--red);font-size:0.88rem;';
      $('vg-output-panel')?.appendChild(el);
    }
    el.style.display = 'block';
    el.innerHTML = `<div style="font-size:1.5rem;margin-bottom:0.8rem">⚠</div>${msg}`;
  }

  function flashField(id, msg) {
    const el = $(id);
    if (!el) return;
    el.style.borderColor = 'var(--red)';
    el.placeholder = msg;
    el.focus();
    setTimeout(() => { el.style.borderColor = ''; }, 2000);
  }

  /* ── Render: Brief tab ───────────────────────────────────────────── */
  function renderBrief() {
    const d = state.result;
    if (!d) return;

    // Concept card
    const concept = $('out-concept');
    if (concept && d.concept) {
      concept.innerHTML = `
        <div class="vg-concept-block">
          <div class="vg-concept-label">Video Concept</div>
          <div class="vg-concept-text">${esc(d.concept)}</div>
        </div>`;
    }

    // Brief grid cards
    const grid = $('out-brief-grid');
    if (grid && d.brief) {
      const b = d.brief;
      grid.innerHTML = [
        { label: 'Format',        value: b.format        || state.style },
        { label: 'Platform',      value: b.platform      || state.platform.toUpperCase() },
        { label: 'Aspect Ratio',  value: b.aspect_ratio  || state.aspect },
        { label: 'Duration',      value: b.duration      || `${state.duration}s` },
        { label: 'Target Audience', value: b.audience    || state.audience || 'General' },
        { label: 'Mood',          value: b.mood          || state.mood || '—' },
        { label: 'Visual Style',  value: b.visual_style  || state.style },
        { label: 'Pacing',        value: b.pacing        || '—' },
      ].map(({ label, value }) => `
        <div class="vg-brief-card">
          <div class="vg-brief-card-label">${label}</div>
          <div class="vg-brief-card-value">${esc(value)}</div>
        </div>`).join('');
    }

    // Director's note
    const directors = $('out-directors-note');
    if (directors && d.directors_note) {
      directors.innerHTML = `
        <div class="vg-concept-block" style="border-color:rgba(167,139,250,0.22);background:linear-gradient(135deg,rgba(167,139,250,0.06),rgba(167,139,250,0.02))">
          <div class="vg-concept-label" style="color:var(--purple)">Director's Note</div>
          <div class="vg-concept-text">${esc(d.directors_note)}</div>
        </div>`;
    }
  }

  /* ── Render: Script tab ─────────────────────────────────────────── */
  function renderScript() {
    const d = state.result;
    const container = $('out-script-container');
    if (!container || !d?.scripts?.length) return;

    container.innerHTML = d.scripts.map((s, i) => `
      <div class="vg-script-block">
        <div class="vg-script-version-label">
          <span>${i + 1}</span>
          ${esc(s.title || `Version ${i + 1}`)}
        </div>
        <div class="vg-script-meta">
          ${s.structure ? `<span class="vg-script-meta-tag">${esc(s.structure)}</span>` : ''}
          ${s.tone      ? `<span class="vg-script-meta-tag">${esc(s.tone)}</span>` : ''}
          ${s.duration  ? `<span class="vg-script-meta-tag">${esc(s.duration)}</span>` : ''}
        </div>
        <div class="vg-script-body">${esc(s.script || s.body || '')}</div>
        <button class="vg-script-copy-btn" onclick="navigator.clipboard.writeText(${JSON.stringify(s.script||s.body||'')})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copy Script
        </button>
      </div>`).join('');
  }

  /* ── Render: Shots tab ──────────────────────────────────────────── */
  function renderShots() {
    const d = state.result;
    const container = $('out-shot-list');
    if (!container || !d?.shot_list?.length) return;

    container.innerHTML = d.shot_list.map((shot, i) => `
      <div class="vg-shot">
        <div class="vg-shot-num">${String(i + 1).padStart(2, '0')}</div>
        <div class="vg-shot-body">
          <div class="vg-shot-type">${esc(shot.type || shot.shot_type || 'SHOT')}</div>
          <div class="vg-shot-desc">${esc(shot.description || shot.desc || '')}</div>
          ${shot.note || shot.direction ? `<div class="vg-shot-note">${esc(shot.note || shot.direction)}</div>` : ''}
        </div>
        <div class="vg-shot-dur">${esc(shot.duration || shot.dur || '')}</div>
      </div>`).join('');
  }

  /* ── Render: Hooks tab ──────────────────────────────────────────── */
  function renderHooksLoading() {
    const container = $('out-hooks');
    if (!container) return;
    container.innerHTML = `
      <div class="vg-hooks-loading">
        <div class="vg-loading-ring"></div>
        <div class="vg-loading-label">Writing hook variations...</div>
      </div>`;
  }

  function renderHooks() {
    const container = $('out-hooks');
    if (!container || !state.hooks) return;
    const hooks = state.hooks.hooks || state.hooks;
    if (!Array.isArray(hooks) || !hooks.length) {
      container.innerHTML = '<p style="color:var(--ice-dim);padding:2rem;text-align:center">No hooks returned. Try again.</p>';
      return;
    }
    container.innerHTML = `<div class="vg-hook-list">${hooks.map((h, i) => `
      <div class="vg-hook-card">
        <div class="vg-hook-meta">
          <span class="vg-hook-num">Hook ${i + 1}</span>
          <span class="vg-hook-strategy">${esc(h.strategy || '')}</span>
        </div>
        <div class="vg-hook-text">${esc(h.text || h.hook || '')}</div>
        <div class="vg-hook-why">${esc(h.why_it_works || h.why || '')}</div>
        <button class="vg-hook-copy" onclick="navigator.clipboard.writeText(${JSON.stringify(h.text||h.hook||'')});this.textContent='Copied!'">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copy Hook
        </button>
      </div>`).join('')}</div>`;
  }

  /* ── Render: Production tab ─────────────────────────────────────── */
  function renderProduction() {
    const d = state.result;
    if (!d) return;

    const music = $('out-music');
    if (music && d.music_brief) {
      const m = d.music_brief;
      music.innerHTML = `
        <div class="vg-music-block">
          <div class="vg-music-title">${esc(m.genre || m.style || 'Music Direction')}</div>
          <div class="vg-music-desc">${esc(m.description || m.notes || '')}</div>
        </div>
        ${m.reference_tracks ? `
          <div style="font-family:'Space Mono',monospace;font-size:0.58rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent);margin-bottom:0.5rem">Reference Tracks</div>
          <ul class="vg-prod-list">${(m.reference_tracks||[]).map(t=>`<li>${esc(t)}</li>`).join('')}</ul>
        ` : ''}`;
    }

    const broll = $('out-broll');
    if (broll && d.broll_suggestions?.length) {
      broll.innerHTML = `
        <div class="vg-prod-card-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>
          B-Roll Suggestions
        </div>
        <ul class="vg-prod-list">${d.broll_suggestions.map(b=>`<li>${esc(b)}</li>`).join('')}</ul>`;
    }

    const vo = $('out-voiceover');
    if (vo && d.voiceover) {
      const v = d.voiceover;
      vo.innerHTML = `
        <div class="vg-prod-card-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a3 3 0 013 3v7a3 3 0 01-6 0V5a3 3 0 013-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          Voiceover Direction
        </div>
        <ul class="vg-prod-list">
          ${v.style  ? `<li><strong>Style:</strong> ${esc(v.style)}</li>`  : ''}
          ${v.tone   ? `<li><strong>Tone:</strong> ${esc(v.tone)}</li>`   : ''}
          ${v.pacing ? `<li><strong>Pacing:</strong> ${esc(v.pacing)}</li>` : ''}
          ${v.notes  ? `<li>${esc(v.notes)}</li>`  : ''}
        </ul>`;
    }

    const tech = $('out-technical');
    if (tech && d.technical) {
      const t = d.technical;
      tech.innerHTML = Object.entries(t).map(([k, v]) => `
        <div class="vg-tech-row">
          <span class="vg-tech-label">${k.replace(/_/g,' ')}</span>
          <span class="vg-tech-value">${esc(String(v))}</span>
        </div>`).join('');
    }
  }

  /* ── Render: Captions tab ───────────────────────────────────────── */
  function renderCaptions() {
    const d = state.result;
    const container = $('out-captions-container');
    if (!container || !d?.captions) return;

    const caps = d.captions;
    container.innerHTML = Object.entries(caps).map(([platform, cap]) => {
      if (!cap) return '';
      const text = typeof cap === 'string' ? cap : cap.text || cap.caption || '';
      const tags = typeof cap === 'object' ? (cap.hashtags || cap.tags || []) : [];
      return `
        <div class="vg-caption-card">
          <div class="vg-caption-platform">${platform.toUpperCase()}</div>
          <div class="vg-caption-text">${esc(text)}</div>
          ${tags.length ? `<div class="vg-hashtags">${tags.map(t=>`<span class="vg-hashtag">${esc(t)}</span>`).join('')}</div>` : ''}
          <button class="vg-script-copy-btn" onclick="navigator.clipboard.writeText(${JSON.stringify(text + (tags.length ? '\n\n' + tags.join(' ') : ''))})">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            Copy Caption
          </button>
        </div>`;
    }).join('');
  }

  /* ── Export as Markdown ─────────────────────────────────────────── */
  function exportMarkdown() {
    const d = state.result;
    if (!d) return;
    const lines = [
      `# Spectra Video Brief — ${state.platform.toUpperCase()}`,
      `**Style:** ${state.style} | **Aspect:** ${state.aspect} | **Duration:** ${state.duration}s`,
      `\n## Concept\n${d.concept || ''}`,
      `\n## Director's Note\n${d.directors_note || ''}`,
      ...(d.scripts||[]).map((s,i) => `\n## Script Version ${i+1}: ${s.title||''}\n${s.script||s.body||''}`),
      `\n## Shot List`,
      ...(d.shot_list||[]).map((s,i)=>`${i+1}. **${s.type||''}** — ${s.description||''} (${s.duration||''})`),
      `\n## Hooks`,
      ...(state.hooks?.hooks||[]).map((h,i)=>`${i+1}. **${h.strategy}** — ${h.text||h.hook}`),
      `\n## Music Brief\n${d.music_brief?.description||''}`,
      `\n---\n*Generated by Spectra Video Generator*`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `spectra-video-brief-${Date.now()}.md`;
    a.click();
  }

  /* ── Utilities ──────────────────────────────────────────────────── */
  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      const toast = document.querySelector('.vg-copied-toast');
      if (!toast) return;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    });
  }

})();
