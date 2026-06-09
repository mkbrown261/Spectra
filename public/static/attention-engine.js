/* ═══════════════════════════════════════════════════════════════════
   SPECTRA — Attention Engine JavaScript
   Full client-side logic: form handling, SSE streaming, UI rendering
═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── STATE ─────────────────────────────────────────────────────── */
  const state = {
    platform: 'tiktok',
    activeTab: 'url',
    outputTab: 'scores',
    analysisData: null,
    rewriteData: null,
    isAnalyzing: false,
    isRewriting: false,
    hasRealData: false,   // true once URL fetch succeeds OR user enters views>0
    fetchedPlatform: null, // platform from last successful URL fetch
  };

  // Current logged-in user (set after checkSession)
  let aeUser = null;

  /* ── DOM REFS ───────────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  /* ── INIT ───────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    injectToast();
    checkSession();
  });

  // ── AUTH GATE ────────────────────────────────────────────────────
  async function checkSession() {
    try {
      const res  = await fetch('/api/auth/me');
      const data = await res.json();
      if (res.ok && data.id) {
        aeUser = { id: data.id, email: data.email, tier: data.tier, credits: data.credits };
        enterApp();
      } else {
        showAuthGate();
      }
    } catch {
      showAuthGate();
    }
  }

  function showAuthGate() {
    const gate = $('ae-auth-gate');
    const app  = $('ae-app');
    if (gate) gate.classList.add('visible');
    if (app)  app.style.display = 'none';
    initAuthForm();
  }

  function enterApp() {
    const gate = $('ae-auth-gate');
    const app  = $('ae-app');
    if (gate) gate.classList.remove('visible');
    if (app)  app.style.display = '';
    // Boot all app functionality now that we're authenticated
    bindPlatform();
    bindInputTabs();
    bindOutputTabs();
    bindActions();
    bindResultsButtons();
    initConnectionsDrawer();
    initURLFetch();
    loadConnectionStatus();
  }

  function initAuthForm() {
    let currentMode = 'login';

    // Tab switching
    $$('.ae-auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        currentMode = tab.dataset.aeAuthTab;
        $$('.ae-auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const submitBtn = $('btn-ae-auth-submit');
        if (submitBtn) submitBtn.textContent = currentMode === 'login' ? 'Sign In' : 'Create Account';
        clearAuthError();
      });
    });

    // Form submit
    $('ae-auth-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email    = $('ae-auth-email')?.value.trim();
      const password = $('ae-auth-password')?.value.trim();
      if (!email || !password) { showAuthError('Email and password are required.'); return; }

      const submitBtn = $('btn-ae-auth-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Signing in...'; }
      clearAuthError();

      try {
        const endpoint = currentMode === 'login' ? '/api/auth/login' : '/api/auth/register';
        const res  = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Authentication failed');
        aeUser = { id: data.id || data.userId, email: data.email, tier: data.tier, credits: data.credits };
        enterApp();
      } catch (err) {
        showAuthError(err.message);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = currentMode === 'login' ? 'Sign In' : 'Create Account';
        }
      }
    });
  }

  function showAuthError(msg) {
    const el = $('ae-auth-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
  function clearAuthError() {
    const el = $('ae-auth-error');
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  }

  /* ══════════════════════════════════════════════════════════════════
     PLATFORM SELECTOR
  ══════════════════════════════════════════════════════════════════ */
  function bindPlatform() {
    $$('.ae-platform-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const platform = btn.dataset.platform;

        $$('.ae-platform-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.platform = platform;

        // Update URL placeholder
        const urlInput = $('content-url');
        if (urlInput) {
          const placeholders = {
            tiktok:    'https://www.tiktok.com/@user/video/...',
            instagram: 'https://www.instagram.com/reel/...',
            youtube:   'https://www.youtube.com/watch?v=...',
            twitter:   'https://twitter.com/user/status/...',
            facebook:  'https://www.facebook.com/watch/?v=...',
            bluesky:   'https://bsky.app/profile/yourhandle/post/...',
            ads:       'Paste ad URL or leave blank...',
          };
          urlInput.placeholder = placeholders[platform] || 'Paste your content URL...';
        }

        // YouTube: open drawer and kick off OAuth if not connected
        if (platform === 'youtube') {
          if (!connState.youtube) {
            openConnectionsDrawer();
            // Small delay so drawer opens first, then auto-start OAuth
            setTimeout(() => {
              if (!connState.youtube) {
                $('btn-connect-youtube')?.click();
              }
            }, 350);
          }
        }

        // Bluesky: open drawer and scroll to Bluesky form if not connected
        if (platform === 'bluesky') {
          if (!connState.bluesky) {
            openConnectionsDrawer();
            setTimeout(() => {
              $('bsky-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              $('bsky-handle')?.focus();
            }, 350);
          }
        }
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     INPUT TABS (URL / Manual)
  ══════════════════════════════════════════════════════════════════ */
  function bindInputTabs() {
    $$('.ae-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.ae-tab').forEach(t => t.classList.remove('active'));
        $$('.ae-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        state.activeTab = tab.dataset.tab;
        const content = $(`tab-${tab.dataset.tab}`);
        if (content) content.classList.add('active');
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     OUTPUT TABS
  ══════════════════════════════════════════════════════════════════ */
  function bindOutputTabs() {
    $$('.ae-output-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.ae-output-tab').forEach(t => t.classList.remove('active'));
        $$('.ae-output-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        state.outputTab = tab.dataset.outputTab;
        const content = $(`out-${tab.dataset.outputTab}`);
        if (content) content.classList.add('active');
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     COLLECT FORM DATA
  ══════════════════════════════════════════════════════════════════ */
  function collectFormData() {
    const isURL = state.activeTab === 'url';
    const hookText = isURL
      ? ($('hook-text')?.value || '')
      : ($('hook-text-2')?.value || '');

    const dropoffRaw = $('dropoff-points')?.value || '';
    const dropoffPoints = dropoffRaw
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n >= 0);

    return {
      platform: state.platform,
      content_url: $('content-url')?.value || '',
      content_description: $('content-desc')?.value || '',
      hook_text: hookText,
      script_excerpt: $('script-text')?.value || '',
      duration_sec: parseInt($('duration')?.value || '60', 10),
      dropoff_points: dropoffPoints,
      target_audience: $('target-audience')?.value || '',
      tone: $('tone-select')?.value || 'engaging',
      metrics: {
        views: parseFloat($('m-views')?.value || '0'),
        likes: parseFloat($('m-likes')?.value || '0'),
        comments: parseFloat($('m-comments')?.value || '0'),
        shares: parseFloat($('m-shares')?.value || '0'),
        saves: parseFloat($('m-saves')?.value || '0'),
        watch_time_pct: parseFloat($('m-watchtime')?.value || '0'),
      },
    };
  }

  /* ══════════════════════════════════════════════════════════════════
     ACTIONS — Analyze + Score Only
  ══════════════════════════════════════════════════════════════════ */
  function bindActions() {
    $('btn-analyze')?.addEventListener('click', runAnalysis);
    $('btn-score')?.addEventListener('click', runScoreOnly);
  }

  function validateHasRealData() {
    // Accept if URL was successfully fetched (real platform data)
    if (state.hasRealData) return true;
    // Accept if user manually entered views > 0 AND at least one engagement metric
    const m = collectFormData().metrics;
    const hasViews = m.views > 0;
    const hasEngagement = m.likes > 0 || m.comments > 0 || m.shares > 0 || m.saves > 0 || m.watch_time_pct > 0;
    return hasViews && hasEngagement;
  }

  function showNoDataMessage(platform) {
    // Inject a warning before the analyze buttons
    const existing = $('ae-no-data-banner');
    if (existing) existing.remove();
    const actions = document.querySelector('.ae-actions');
    if (!actions) return;
    const banner = document.createElement('div');
    banner.id = 'ae-no-data-banner';
    banner.className = 'ae-no-data-msg';
    const connectable = platform === 'youtube' || platform === 'bluesky';
    let tip = '';
    if (platform === 'youtube' && !connState.youtube) {
      tip = ' <a href="#" id="no-data-connect-yt" style="color:var(--ae);text-decoration:underline;cursor:pointer">Connect YouTube →</a>';
    } else if (platform === 'bluesky' && !connState.bluesky) {
      tip = ' <a href="#" id="no-data-connect-bsky" style="color:var(--ae);text-decoration:underline;cursor:pointer">Connect Bluesky →</a>';
    }
    banner.innerHTML = `<strong>No real data to analyze</strong>Paste a ${platform.charAt(0).toUpperCase()+platform.slice(1)} URL to auto-fill metrics, or enter Views + at least one engagement metric manually.${tip}`;
    actions.before(banner);
    // Wire connect links
    $('no-data-connect-yt')?.addEventListener('click', (e) => { e.preventDefault(); openConnectionsDrawer(); $('btn-connect-youtube')?.click(); });
    $('no-data-connect-bsky')?.addEventListener('click', (e) => { e.preventDefault(); openConnectionsDrawer(); $('bsky-handle')?.focus(); });
    // Auto-dismiss after 6s
    setTimeout(() => { const b = $('ae-no-data-banner'); if (b) b.remove(); }, 6000);
  }

  async function runScoreOnly() {
    if (state.isAnalyzing) return;
    const data = collectFormData();

    if (!validateHasRealData()) {
      showNoDataMessage(state.platform);
      return;
    }

    showLoading('Calculating scores...');

    try {
      const res = await fetch('/api/attention/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      // Build minimal analysis data from score response
      state.analysisData = {
        meta: {
          scores: {
            composite: json.scores.composite,
            hook: json.scores.hook,
            retention: json.scores.retention,
            engagement: json.scores.engagement,
            viral: json.scores.viral,
            watch_time: json.scores.watch_time,
            shareability: json.scores.shareability,
          },
          segments: json.segments,
          platform: json.platform,
          weights: json.weights,
          signal_breakdown: json.signal_breakdown,
        },
        ai: null,
        form: data,
      };

      showResults();
      switchOutputTab('scores');
      renderScores(state.analysisData.meta);
      renderTimeline(state.analysisData.meta.segments);
      showToast('Scores calculated', 'success');
    } catch (err) {
      showToast('Score failed: ' + err.message, 'error');
      showEmpty();
    }
  }

  async function runAnalysis() {
    if (state.isAnalyzing) return;

    if (!validateHasRealData()) {
      showNoDataMessage(state.platform);
      return;
    }

    state.isAnalyzing = true;

    const data = collectFormData();
    const btnAnalyze = $('btn-analyze');
    if (btnAnalyze) {
      btnAnalyze.classList.add('loading');
      btnAnalyze.textContent = 'Analyzing...';
    }

    showLoading('Connecting to Attention Engine...');
    setLoadingLabel('Connecting to Attention Engine...');

    const loadingMessages = [
      'Processing engagement signals...',
      'Applying platform weight model...',
      'Calculating retention curve...',
      'Running drop-off detection...',
      'Diagnosing content performance...',
      'Generating optimization plan...',
      'Finalizing analysis...',
    ];
    let msgIdx = 0;
    const msgInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % loadingMessages.length;
      setLoadingLabel(loadingMessages[msgIdx]);
    }, 2200);

    try {
      const response = await fetch('/api/attention/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let metaData = null;
      let fullAIText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(line.slice(6));

            if (parsed.type === 'meta') {
              metaData = parsed;
              setLoadingLabel('AI diagnosis running...');

            } else if (parsed.type === 'token') {
              fullAIText += parsed.text;
              // Show streaming preview
              const streamEl = $('loading-stream');
              if (streamEl) {
                // Show last 180 chars of the AI output streaming
                const preview = fullAIText.replace(/[{}\[\]"]/g, '').slice(-180).trim();
                streamEl.textContent = preview;
              }

            } else if (parsed.type === 'done') {
              fullAIText = parsed.full;
            }
          } catch (e) { /* skip malformed */ }
        }
      }

      clearInterval(msgInterval);

      // Parse AI response
      let aiData = null;
      try {
        // Extract JSON from the AI response (it might have markdown fences)
        const jsonMatch = fullAIText.match(/\{[\s\S]*\}/);
        if (jsonMatch) aiData = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.warn('AI JSON parse error:', e);
      }

      // Build compound scores from meta + AI diagnosis
      let compositeScores = metaData ? { ...metaData.scores } : {};
      if (aiData?.diagnosis) {
        const d = aiData.diagnosis;
        compositeScores.hook        = d.hook_effectiveness?.score ?? compositeScores.hook ?? 0;
        compositeScores.engagement  = d.emotional_impact?.score ?? compositeScores.engagement ?? 0;
      }

      state.analysisData = {
        meta: metaData,
        ai: aiData,
        form: data,
        scores: compositeScores,
      };

      showResults();
      switchOutputTab('scores');
      renderScores(metaData, aiData, compositeScores);
      renderTimeline(metaData?.segments || [], aiData);
      renderDiagnosis(aiData);
      renderOptimize(aiData);

    } catch (err) {
      clearInterval(msgInterval);
      showToast('Analysis failed: ' + err.message, 'error');
      showEmpty();
      console.error(err);
    } finally {
      state.isAnalyzing = false;
      if (btnAnalyze) {
        btnAnalyze.classList.remove('loading');
        btnAnalyze.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>Run Analysis`;
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     REWRITE ENGINE
  ══════════════════════════════════════════════════════════════════ */
  function bindResultsButtons() {
    $('btn-run-rewrite')?.addEventListener('click', runRewrite);
    $('btn-export')?.addEventListener('click', exportReport);
    $('btn-copy')?.addEventListener('click', copyResults);
    $('btn-rerun')?.addEventListener('click', () => {
      showEmpty();
      setTimeout(() => {
        $('btn-analyze')?.click();
      }, 100);
    });
  }

  async function runRewrite() {
    if (state.isRewriting) return;
    state.isRewriting = true;

    const btn = $('btn-run-rewrite');
    if (btn) { btn.classList.add('loading'); btn.textContent = 'Generating...'; }

    const output = $('rewrite-output');
    if (output) {
      output.innerHTML = `<div class="ae-rw-loading"><div class="ae-rw-loading-ring"></div>AI is generating your hooks and script rewrites...</div>`;
    }

    const formData = collectFormData();
    const issues = state.analysisData?.ai?.top_issues || [];

    try {
      const response = await fetch('/api/attention/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: state.platform,
          hook_text: formData.hook_text,
          script_excerpt: formData.script_excerpt,
          issues,
          target_audience: formData.target_audience,
          tone: formData.tone,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const p = JSON.parse(line.slice(6));
            if (p.type === 'token') fullText += p.text;
            if (p.type === 'done') fullText = p.full;
          } catch {}
        }
      }

      let rwData = null;
      try {
        const m = fullText.match(/\{[\s\S]*\}/);
        if (m) rwData = JSON.parse(m[0]);
      } catch (e) { console.warn('Rewrite parse error', e); }

      state.rewriteData = rwData;
      renderRewrites(rwData);

    } catch (err) {
      if (output) output.innerHTML = `<div class="ae-empty-output">Rewrite failed: ${err.message}</div>`;
      showToast('Rewrite failed', 'error');
    } finally {
      state.isRewriting = false;
      if (btn) {
        btn.classList.remove('loading');
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>Regenerate`;
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     UI STATE: show/hide panels
  ══════════════════════════════════════════════════════════════════ */
  function showLoading(msg) {
    $('ae-empty').style.display = 'none';
    $('ae-results').style.display = 'none';
    $('ae-loading').style.display = 'flex';
    setLoadingLabel(msg);
    const streamEl = $('loading-stream');
    if (streamEl) streamEl.textContent = '';
  }

  function showResults() {
    $('ae-empty').style.display = 'none';
    $('ae-loading').style.display = 'none';
    $('ae-results').style.display = 'flex';
  }

  function showEmpty() {
    const emptyEl = $('ae-empty');
    if (emptyEl) {
      emptyEl.style.display = 'flex';
      // If YouTube is connected and the grid hasn't loaded yet, load it
      if (connState.youtube && !$('ae-vg-grid')) {
        loadVideoGrid();
      }
    }
    $('ae-loading').style.display = 'none';
    $('ae-results').style.display = 'none';
  }

  function setLoadingLabel(msg) {
    const el = $('loading-label');
    if (el) el.textContent = msg;
  }

  function switchOutputTab(tabId) {
    $$('.ae-output-tab').forEach(t => t.classList.remove('active'));
    $$('.ae-output-content').forEach(c => c.classList.remove('active'));
    const tab = document.querySelector(`.ae-output-tab[data-output-tab="${tabId}"]`);
    const content = $(`out-${tabId}`);
    if (tab) tab.classList.add('active');
    if (content) content.classList.add('active');
    state.outputTab = tabId;
  }

  /* ══════════════════════════════════════════════════════════════════
     RENDER: SCORES
  ══════════════════════════════════════════════════════════════════ */
  function gradeFromScore(s) {
    if (s >= 90) return 'S';
    if (s >= 80) return 'A';
    if (s >= 65) return 'B';
    if (s >= 50) return 'C';
    if (s >= 35) return 'D';
    return 'F';
  }

  function colorFromScore(s) {
    if (s >= 80) return 'var(--c-green)';
    if (s >= 60) return 'var(--c-blue)';
    if (s >= 40) return 'var(--c-yellow)';
    if (s >= 25) return 'var(--c-orange)';
    return 'var(--c-red)';
  }

  function renderScores(meta, aiData, overrideScores) {
    // Platform badge — only show if real data was fetched from that platform
    const badge = $('results-platform-badge');
    if (badge) {
      if (state.fetchedPlatform) {
        badge.textContent = state.fetchedPlatform.toUpperCase();
        badge.style.display = '';
      } else {
        // Manual entry — no platform badge (no fake "from platform" labeling)
        badge.textContent = '';
        badge.style.display = 'none';
      }
    }

    const scores = overrideScores || (meta ? meta.scores : {});

    const scoreCards = [
      { key: 'composite',   label: 'Composite',    color: 'var(--ae)' },
      { key: 'hook',        label: 'Hook Strength', color: 'var(--c-blue)' },
      { key: 'retention',   label: 'Retention',     color: 'var(--c-green)' },
      { key: 'engagement',  label: 'Engagement',    color: 'var(--c-orange)' },
      { key: 'viral',       label: 'Viral Potential', color: 'var(--c-red)' },
      { key: 'watch_time',  label: 'Watch Time',    color: 'var(--c-yellow)' },
    ];

    const row = $('score-cards-row');
    if (row) {
      row.innerHTML = scoreCards.map(sc => {
        const val = Math.round(scores[sc.key] || 0);
        const grade = gradeFromScore(val);
        const circ = 2 * Math.PI * 28; // r=28
        const offset = circ - (val / 100) * circ;
        return `
          <div class="ae-score-card" style="--card-color:${sc.color}">
            <div class="ae-gauge-wrap">
              <svg class="ae-gauge-svg" viewBox="0 0 72 72">
                <circle class="ae-gauge-track" cx="36" cy="36" r="28"/>
                <circle class="ae-gauge-fill"
                  cx="36" cy="36" r="28"
                  stroke-dasharray="${circ}"
                  stroke-dashoffset="${circ}"
                  data-offset="${offset}"
                  style="stroke:${sc.color}"
                />
              </svg>
              <div class="ae-gauge-value">${val}</div>
            </div>
            <div class="ae-score-label">${sc.label}</div>
            <div class="ae-score-grade grade-${grade}">${grade}</div>
          </div>`;
      }).join('');

      // Animate gauges after paint
      requestAnimationFrame(() => {
        setTimeout(() => {
          $$('.ae-gauge-fill', row).forEach(circle => {
            const offset = parseFloat(circle.dataset.offset);
            circle.style.strokeDashoffset = offset;
          });
        }, 80);
      });
    }

    // Signal bars
    const signalLabel = $('signal-platform-label');
    if (signalLabel) signalLabel.textContent = state.fetchedPlatform ? state.fetchedPlatform.toUpperCase() : '';

    const barsContainer = $('signal-bars');
    if (barsContainer && meta?.signal_breakdown) {
      const signals = meta.signal_breakdown;
      const signalColors = {
        likes: 'var(--c-red)',
        comments: 'var(--c-blue)',
        shares: 'var(--c-green)',
        saves: 'var(--ae)',
        watch_time: 'var(--c-yellow)',
        views: 'var(--ice-dim)',
      };

      barsContainer.innerHTML = Object.entries(signals).map(([key, data]) => {
        const score = Math.round(data.score || 0);
        const raw = data.raw;
        const weight = Math.round((data.weight || 0) * 100);
        const color = signalColors[key] || 'var(--ae)';
        const displayName = key.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
        const rawDisplay = key === 'watch_time' ? `${raw}%` : raw.toLocaleString();
        return `
          <div class="ae-signal-row">
            <div class="ae-signal-name">${displayName}</div>
            <div class="ae-signal-bar-track">
              <div class="ae-signal-bar-fill" data-score="${score}" style="width:0%;background:${color}"></div>
            </div>
            <div class="ae-signal-score">${score}</div>
            <div class="ae-signal-weight">${weight}%</div>
          </div>`;
      }).join('');

      // Animate bars
      requestAnimationFrame(() => {
        setTimeout(() => {
          $$('.ae-signal-bar-fill', barsContainer).forEach(bar => {
            bar.style.width = bar.dataset.score + '%';
          });
        }, 120);
      });
    }

    // Verdict
    if (aiData?.overall_verdict) {
      const card = $('verdict-card');
      const text = $('verdict-text');
      if (card && text) {
        text.textContent = aiData.overall_verdict;
        card.style.display = 'block';
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     RENDER: TIMELINE
  ══════════════════════════════════════════════════════════════════ */
  function renderTimeline(segments, aiData) {
    const chart      = $('timeline-chart');
    const dropoffList = $('dropoff-list');
    if (!chart) return;

    // Only render actual timeline if we have real drop-off data
    // Segments generated from no drop-off points are generic and misleading
    const formData = collectFormData();
    const hasRealDropoffs = formData.dropoff_points && formData.dropoff_points.length > 0;

    if (!segments?.length || !hasRealDropoffs) {
      chart.innerHTML = `<div class="ae-timeline-empty">
        <div>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4;display:block;margin:0 auto 0.75rem"><path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 4-6"/></svg>
          No drop-off data entered.<br>
          <span style="opacity:0.6">Add timestamps to the <strong>Drop-off Points</strong> field above to see the retention curve.</span>
        </div>
      </div>`;
      if (dropoffList) dropoffList.innerHTML = '';
      return;
    }

    const maxRet = Math.max(...segments.map(s => s.retention), 1);

    chart.innerHTML = segments.map(seg => {
      const heightPct = (seg.retention / maxRet) * 100;
      const barClass = seg.severity || 'normal';
      return `
        <div class="ae-tl-bar-wrap">
          <div class="ae-tl-bar ${barClass}"
               style="height:0%"
               data-height="${heightPct}">
          </div>
          <div class="ae-tl-bar-tooltip">${seg.label}<br>${seg.retention}% retention</div>
        </div>`;
    }).join('');

    // Animate bars
    requestAnimationFrame(() => {
      setTimeout(() => {
        $$('.ae-tl-bar', chart).forEach(bar => {
          bar.style.height = bar.dataset.height + '%';
        });
      }, 100);
    });

    // Drop-off list
    if (!dropoffList) return;

    const dropoffs = segments.filter(s => s.is_dropoff);
    const aiDropoffs = aiData?.dropoff_analysis || [];

    if (!dropoffs.length) {
      dropoffList.innerHTML = `<div class="ae-empty-output">No significant drop-off points detected in the specified timeline.</div>`;
      return;
    }

    dropoffList.innerHTML = dropoffs.map((seg, i) => {
      const aiDrop = aiDropoffs[i] || {};
      const cause = aiDrop.cause || `Audience engagement declined at ${seg.label}`;
      const fix = aiDrop.fix || 'Review this segment for pacing and visual engagement.';
      const sev = seg.severity || 'warning';
      return `
        <div class="ae-dropoff-item ${sev}">
          <div>
            <div class="ae-dropoff-time">${seg.start}s</div>
            <div class="ae-dropoff-badge ${sev}">${sev}</div>
          </div>
          <div class="ae-dropoff-body">
            <div class="ae-dropoff-cause">${cause}</div>
            <div class="ae-dropoff-fix">→ ${fix}</div>
          </div>
        </div>`;
    }).join('');
  }

  /* ══════════════════════════════════════════════════════════════════
     RENDER: DIAGNOSIS
  ══════════════════════════════════════════════════════════════════ */
  function renderDiagnosis(aiData) {
    const grid = $('diagnosis-grid');
    if (!grid) return;

    if (!aiData?.diagnosis) {
      grid.innerHTML = `<div class="ae-empty-output">Run the full analysis to see the AI diagnosis breakdown.</div>`;
      return;
    }

    const diagItems = [
      { key: 'hook_effectiveness', label: 'Hook Effectiveness',  icon: '⚡' },
      { key: 'pacing',             label: 'Content Pacing',       icon: '⏱' },
      { key: 'visual_engagement',  label: 'Visual Engagement',    icon: '👁' },
      { key: 'messaging_clarity',  label: 'Messaging Clarity',    icon: '💬' },
      { key: 'emotional_impact',   label: 'Emotional Impact',     icon: '❤' },
      { key: 'cta_strength',       label: 'CTA Strength',         icon: '🎯' },
    ];

    const d = aiData.diagnosis;

    grid.innerHTML = diagItems.map(item => {
      const data = d[item.key];
      if (!data) return '';
      const score = data.score || 0;
      const color = colorFromScore(score);
      const grade = gradeFromScore(score);
      return `
        <div class="ae-diag-card">
          <div class="ae-diag-bar-track">
            <div class="ae-diag-bar-fill" data-width="${score}" style="width:0%;background:${color}"></div>
          </div>
          <div class="ae-diag-card-top">
            <div class="ae-diag-name">${item.label}</div>
            <div class="ae-diag-score-badge" style="color:${color}">${score}<span style="font-size:0.65rem;opacity:0.6">/100</span></div>
          </div>
          <div class="ae-diag-verdict">
            <div class="ae-diag-verdict-dot" style="background:${color}"></div>
            ${data.verdict || grade}
          </div>
          <div class="ae-diag-reasoning">${data.reasoning || ''}</div>
          ${data.fix ? `<div class="ae-diag-fix"><span class="ae-diag-fix-icon">→</span> ${data.fix}</div>` : ''}
        </div>`;
    }).join('');

    // Animate bars
    requestAnimationFrame(() => {
      setTimeout(() => {
        $$('.ae-diag-bar-fill', grid).forEach(bar => {
          bar.style.width = bar.dataset.width + '%';
        });
      }, 100);
    });

    // Issues + Strengths
    const issuesSection = $('issues-section');
    const issuesList = $('top-issues-list');
    const strengthsList = $('strengths-list');

    if (issuesSection && aiData.top_issues?.length) {
      issuesSection.style.display = 'grid';
      if (issuesList) {
        issuesList.innerHTML = aiData.top_issues.map(i => `<li>${i}</li>`).join('');
      }
      if (strengthsList && aiData.top_strengths?.length) {
        strengthsList.innerHTML = aiData.top_strengths.map(s => `<li>${s}</li>`).join('');
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     RENDER: OPTIMIZE
  ══════════════════════════════════════════════════════════════════ */
  function renderOptimize(aiData) {
    const list = $('optimize-list');
    if (!list) return;

    if (!aiData?.optimization_plan?.length) {
      list.innerHTML = `<div class="ae-empty-output">Run the full analysis to see the optimization plan.</div>`;
      return;
    }

    const sorted = [...aiData.optimization_plan].sort((a, b) => (a.priority || 5) - (b.priority || 5));

    list.innerHTML = sorted.map(item => {
      const p = item.priority || 5;
      return `
        <div class="ae-optimize-item">
          <div class="ae-opt-priority p${p}">${p}</div>
          <div class="ae-opt-body">
            <div class="ae-opt-action">${item.action || ''}</div>
            <div class="ae-opt-detail">${item.detail || ''}</div>
            <div class="ae-opt-meta">
              <span class="ae-opt-tag impact-${item.impact || 'Medium'}">Impact: ${item.impact || 'Medium'}</span>
              <span class="ae-opt-tag effort-${item.effort || 'Medium'}">Effort: ${item.effort || 'Medium'}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    // Platform insight
    if (aiData.platform_insights) {
      const card = $('platform-insight-card');
      const grid = $('platform-insight-grid');
      if (card && grid) {
        const pi = aiData.platform_insights;
        grid.innerHTML = [
          { label: 'Algorithm Note',      text: pi.algorithm_note },
          { label: 'Trend Alignment',     text: pi.trend_alignment },
          { label: 'Posting Recommendation', text: pi.posting_recommendation },
        ].filter(i => i.text).map(i => `
          <div class="ae-pi-item">
            <div class="ae-pi-item-label">${i.label}</div>
            <div class="ae-pi-item-text">${i.text}</div>
          </div>
        `).join('');
        card.style.display = 'block';
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     RENDER: REWRITES
  ══════════════════════════════════════════════════════════════════ */
  function renderRewrites(rwData) {
    const output = $('rewrite-output');
    if (!output) return;

    if (!rwData) {
      output.innerHTML = `<div class="ae-empty-output">No rewrite data received. Try again.</div>`;
      return;
    }

    let html = '';

    // Hooks
    if (rwData.hooks?.length) {
      html += `<div class="ae-rw-section-title">Hook Variations</div>`;
      html += `<div class="ae-hooks-grid">`;
      html += rwData.hooks.map(h => `
        <div class="ae-hook-card">
          <div class="ae-hook-version">VERSION ${h.version || '?'} — ${(h.strategy || '').toUpperCase()}</div>
          <div class="ae-hook-text">"${h.text || ''}"</div>
          <div class="ae-hook-strategy">${h.strategy || ''}</div>
          <div class="ae-hook-why">${h.why_it_works || ''}</div>
          <button class="ae-hook-copy" onclick="copyText(\`${escapeTick(h.text)}\`)" title="Copy hook">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
        </div>`).join('');
      html += `</div>`;
    }

    // Script rewrites
    if (rwData.script_rewrites?.length) {
      html += `<div class="ae-rw-section-title" style="margin-top:1.5rem">Script Rewrites</div>`;
      html += `<div class="ae-script-cards">`;
      html += rwData.script_rewrites.map(sr => `
        <div class="ae-script-card">
          <div class="ae-script-card-header">
            <div class="ae-script-title">${sr.title || 'Version ' + sr.version}</div>
            <div class="ae-script-meta">
              <span class="ae-script-tag">${sr.tone || 'engaging'}</span>
              <span class="ae-script-tag">${sr.structure || 'narrative'}</span>
            </div>
          </div>
          <div class="ae-script-body">${sr.script || ''}</div>
          <div class="ae-script-expand" onclick="toggleScriptExpand(this)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            Expand
          </div>
        </div>`).join('');
      html += `</div>`;
    }

    // Pattern interrupts
    if (rwData.pattern_interrupts?.length) {
      html += `<div class="ae-rw-section-title" style="margin-top:1.5rem">Pattern Interrupts</div>`;
      html += `<div class="ae-chips-grid">`;
      html += rwData.pattern_interrupts.map(pi => `
        <button class="ae-rw-chip" onclick="copyText(\`${escapeTick(pi)}\`)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          ${pi}
        </button>`).join('');
      html += `</div>`;
    }

    // CTAs
    if (rwData.cta_options?.length) {
      html += `<div class="ae-rw-section-title" style="margin-top:1.5rem">CTA Options</div>`;
      html += `<div class="ae-chips-grid">`;
      html += rwData.cta_options.map(cta => `
        <button class="ae-rw-chip" onclick="copyText(\`${escapeTick(cta)}\`)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
          ${cta}
        </button>`).join('');
      html += `</div>`;
    }

    // Storytelling framework
    if (rwData.storytelling_framework) {
      const fw = rwData.storytelling_framework;
      html += `<div class="ae-rw-section-title" style="margin-top:1.5rem">Storytelling Framework</div>`;
      html += `
        <div class="ae-framework-card">
          <div class="ae-fw-name">${fw.name || 'Framework'}</div>
          <div class="ae-fw-steps">
            ${(fw.structure || []).map((step, i) => `
              <div class="ae-fw-step">
                <div class="ae-fw-step-num">${i + 1}</div>
                <div>${step}</div>
              </div>`).join('')}
          </div>
          ${fw.example_applied ? `<div class="ae-fw-example">"${fw.example_applied}"</div>` : ''}
        </div>`;
    }

    // Platform notes
    if (rwData.platform_notes) {
      html += `
        <div style="margin-top:1.25rem;padding:1rem 1.25rem;background:var(--surface);border:1px solid var(--border);border-radius:10px;font-size:0.82rem;color:var(--ice-dim);line-height:1.65">
          <div style="font-family:var(--font-mono);font-size:0.58rem;letter-spacing:0.22em;color:var(--ae);margin-bottom:0.5rem;text-transform:uppercase">Platform Notes</div>
          ${rwData.platform_notes}
        </div>`;
    }

    output.innerHTML = html;
    showToast('Rewrites generated', 'success');
  }

  /* ══════════════════════════════════════════════════════════════════
     EXPORT
  ══════════════════════════════════════════════════════════════════ */
  function exportReport() {
    if (!state.analysisData) { showToast('Nothing to export yet', 'error'); return; }

    const d = state.analysisData;
    const meta = d.meta || {};
    const ai = d.ai || {};
    const form = d.form || {};
    const platform = (meta.platform || state.platform || 'unknown').toUpperCase();
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const scores = meta.scores || d.scores || {};
    const scoreLines = Object.entries(scores)
      .map(([k, v]) => `  ${k.replace(/_/g, ' ').toUpperCase()}: ${Math.round(v || 0)}/100`)
      .join('\n');

    let report = `SPECTRA ATTENTION ENGINE — ANALYSIS REPORT
Generated: ${now}
Platform: ${platform}
${form.content_url ? 'URL: ' + form.content_url : ''}
${form.content_description ? 'Description: ' + form.content_description : ''}

═══════════════════════════════════
PERFORMANCE SCORES
═══════════════════════════════════
${scoreLines}

═══════════════════════════════════
METRICS ENTERED
═══════════════════════════════════
  Views:       ${form.metrics?.views?.toLocaleString() || 'N/A'}
  Likes:       ${form.metrics?.likes?.toLocaleString() || 'N/A'}
  Comments:    ${form.metrics?.comments?.toLocaleString() || 'N/A'}
  Shares:      ${form.metrics?.shares?.toLocaleString() || 'N/A'}
  Saves:       ${form.metrics?.saves?.toLocaleString() || 'N/A'}
  Watch Time:  ${form.metrics?.watch_time_pct || 0}%
`;

    if (ai.overall_verdict) {
      report += `\n═══════════════════════════════════\nAI VERDICT\n═══════════════════════════════════\n${ai.overall_verdict}\n`;
    }

    if (ai.top_issues?.length) {
      report += `\n═══════════════════════════════════\nTOP ISSUES\n═══════════════════════════════════\n`;
      ai.top_issues.forEach((issue, i) => { report += `${i + 1}. ${issue}\n`; });
    }

    if (ai.top_strengths?.length) {
      report += `\nSTRENGTHS\n`;
      ai.top_strengths.forEach((s, i) => { report += `${i + 1}. ${s}\n`; });
    }

    if (ai.diagnosis) {
      report += `\n═══════════════════════════════════\nDIAGNOSIS BREAKDOWN\n═══════════════════════════════════\n`;
      Object.entries(ai.diagnosis).forEach(([key, data]) => {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        report += `\n${label} — Score: ${data.score || 0}/100\n`;
        report += `Verdict: ${data.verdict || ''}\n`;
        report += `Reasoning: ${data.reasoning || ''}\n`;
        report += `Fix: ${data.fix || ''}\n`;
      });
    }

    if (ai.optimization_plan?.length) {
      report += `\n═══════════════════════════════════\nOPTIMIZATION PLAN\n═══════════════════════════════════\n`;
      ai.optimization_plan.forEach(item => {
        report += `\nPriority ${item.priority}: ${item.action}\n`;
        report += `Impact: ${item.impact} | Effort: ${item.effort}\n`;
        report += `${item.detail}\n`;
      });
    }

    if (state.rewriteData?.hooks?.length) {
      report += `\n═══════════════════════════════════\nHOOK REWRITES\n═══════════════════════════════════\n`;
      state.rewriteData.hooks.forEach(h => {
        report += `\nVersion ${h.version}: "${h.text}"\nStrategy: ${h.strategy}\n`;
      });
    }

    report += `\n═══════════════════════════════════\nGenerated by Spectra Attention Engine\n`;

    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spectra-attention-report-${platform.toLowerCase()}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Report exported', 'success');
  }

  function copyResults() {
    if (!state.analysisData) { showToast('Nothing to copy yet', 'error'); return; }
    const scores = state.analysisData.meta?.scores || {};
    const lines = ['SPECTRA ATTENTION ENGINE — QUICK SCORES', ''];
    Object.entries(scores).forEach(([k, v]) => {
      lines.push(`${k.replace(/_/g, ' ').toUpperCase()}: ${Math.round(v || 0)}/100`);
    });
    if (state.analysisData.ai?.overall_verdict) {
      lines.push('', 'VERDICT:', state.analysisData.ai.overall_verdict);
    }
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => showToast('Copied to clipboard', 'success'))
      .catch(() => showToast('Copy failed', 'error'));
  }

  /* ══════════════════════════════════════════════════════════════════
     TOAST
  ══════════════════════════════════════════════════════════════════ */
  function injectToast() {
    const el = document.createElement('div');
    el.className = 'ae-toast';
    el.id = 'ae-toast';
    el.innerHTML = `<div class="ae-toast-dot"></div><span id="ae-toast-msg"></span>`;
    document.body.appendChild(el);
  }

  let toastTimer = null;
  function showToast(msg, type = 'info') {
    const el = $('ae-toast');
    const msgEl = $('ae-toast-msg');
    if (!el || !msgEl) return;
    clearTimeout(toastTimer);
    el.className = `ae-toast ${type}`;
    msgEl.textContent = msg;
    requestAnimationFrame(() => el.classList.add('show'));
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  /* ══════════════════════════════════════════════════════════════════
     HELPERS (exposed to window for inline event handlers)
  ══════════════════════════════════════════════════════════════════ */
  window.copyText = function (text) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('Copied', 'success'))
      .catch(() => showToast('Copy failed', 'error'));
  };

  window.toggleScriptExpand = function (btn) {
    const body = btn.previousElementSibling;
    if (!body) return;
    const expanded = body.style.maxHeight !== '240px' && body.style.maxHeight !== '';
    if (expanded || body.style.maxHeight === '') {
      body.style.maxHeight = '240px';
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg> Expand`;
    } else {
      body.style.maxHeight = body.scrollHeight + 'px';
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg> Collapse`;
    }
  };

  function escapeTick(str) {
    return (str || '').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  }

  /* ══════════════════════════════════════════════════════════════════
     VIDEO GRID — shows YouTube uploads in the output panel
  ══════════════════════════════════════════════════════════════════ */

  let videoGridData = []; // cached video list

  async function loadVideoGrid() {
    const empty = $('ae-empty');
    if (!empty) return;

    // Show loading state
    empty.innerHTML = `
      <div class="ae-vg-loading">
        <div class="ae-loading-ring" style="width:32px;height:32px;border-width:2px;margin:0 auto"></div>
        <p style="color:var(--ice-dim);font-size:0.85rem;margin-top:0.75rem">Loading your videos...</p>
      </div>`;

    try {
      const res  = await fetch('/api/auth/youtube/videos?limit=20');
      const data = await res.json();

      if (data.error || !data.videos?.length) {
        resetEmptyState(`No videos found. ${data.error || ''}`);
        return;
      }

      videoGridData = data.videos;
      renderVideoGrid(data.videos, data.channel || 'Your Channel');
    } catch {
      resetEmptyState('Could not load videos — check your YouTube connection.');
    }
  }

  function resetEmptyState(msg) {
    const empty = $('ae-empty');
    if (!empty) return;
    empty.innerHTML = `
      <div class="ae-empty-icon"><svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.3"/><circle cx="32" cy="32" r="16" stroke="currentColor" stroke-width="1.5" opacity="0.5"/><circle cx="32" cy="32" r="5" fill="currentColor" opacity="0.7"/><circle cx="32" cy="12" r="2.5" fill="currentColor" opacity="0.4"/><circle cx="50" cy="42" r="2.5" fill="currentColor" opacity="0.4"/><circle cx="14" cy="42" r="2.5" fill="currentColor" opacity="0.4"/><line x1="32" y1="32" x2="32" y2="14.5" stroke="currentColor" stroke-width="1" opacity="0.3"/><line x1="32" y1="32" x2="48" y2="40.5" stroke="currentColor" stroke-width="1" opacity="0.3"/><line x1="32" y1="32" x2="16" y2="40.5" stroke="currentColor" stroke-width="1" opacity="0.3"/></svg></div>
      <h2 class="ae-empty-title">Attention Engine Ready</h2>
      <p class="ae-empty-sub">${msg || 'Connect YouTube or Bluesky via the Connections button to load your content.'}</p>
      <div class="ae-empty-chips"><span class="ae-chip">Drop-off Detection</span><span class="ae-chip">Engagement Scoring</span><span class="ae-chip">Hook Analysis</span><span class="ae-chip">Script Rewrite</span></div>`;
  }

  function renderVideoGrid(videos, channelName) {
    const empty = $('ae-empty');
    if (!empty) return;

    empty.innerHTML = `
      <div class="ae-vg-header">
        <div class="ae-vg-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color:#F87171;flex-shrink:0"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg>
          ${channelName}
        </div>
        <div class="ae-vg-sub">Click any video to load its metrics, then run analysis</div>
      </div>
      <div class="ae-vg-grid" id="ae-vg-grid">
        ${videos.map((v, i) => videoCard(v, i)).join('')}
      </div>`;

    // Wire click handlers
    $$('.ae-vg-card', empty).forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.idx, 10);
        if (!isNaN(idx) && videos[idx]) {
          selectVideo(videos[idx]);
          $$('.ae-vg-card', empty).forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
        }
      });
    });
  }

  function videoCard(v, idx) {
    const views = formatCount(v.metrics.views);
    const likes = formatCount(v.metrics.likes);
    const dur   = v.duration_sec ? formatDuration(v.duration_sec) : '';
    const date  = v.published ? new Date(v.published).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '';
    return `
      <div class="ae-vg-card" data-idx="${idx}" title="${v.title.replace(/"/g,'&quot;')}">
        <div class="ae-vg-thumb">
          <img src="${v.thumbnail}" alt="" loading="lazy" onerror="this.style.opacity='0'"/>
          ${dur ? `<span class="ae-vg-dur">${dur}</span>` : ''}
          <div class="ae-vg-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
        </div>
        <div class="ae-vg-info">
          <div class="ae-vg-name">${v.title}</div>
          <div class="ae-vg-meta">
            <span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ${views}</span>
            ${v.metrics.likes ? `<span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg> ${likes}</span>` : ''}
            ${date ? `<span class="ae-vg-date">${date}</span>` : ''}
          </div>
        </div>
      </div>`;
  }

  function selectVideo(v) {
    // Switch to URL tab
    const urlTab = document.querySelector('.ae-tab[data-tab="url"]');
    if (urlTab && !urlTab.classList.contains('active')) urlTab.click();

    // Fill URL input
    const urlInput = $('content-url');
    if (urlInput) {
      urlInput.value = v.url;
      autoSelectPlatform(v.url);
      clearURLNote();
      hideURLPreview();
    }

    // Fill all metric inputs
    const setVal = (id, val) => { const el = $(id); if (el && val > 0) el.value = val; };
    setVal('m-views',    v.metrics.views);
    setVal('m-likes',    v.metrics.likes);
    setVal('m-comments', v.metrics.comments);
    setVal('m-shares',   v.metrics.shares);
    setVal('m-saves',    v.metrics.saves);
    if ($('duration') && v.duration_sec > 0) $('duration').value = v.duration_sec;

    // Mark as real data — unlocks Run Analysis
    state.hasRealData     = true;
    state.fetchedPlatform = 'youtube';

    // Flash filled inputs green
    ['m-views','m-likes','m-comments','m-shares','m-saves','duration'].forEach(id => {
      const el = $(id);
      if (el && parseFloat(el.value) > 0) {
        el.style.borderColor = 'rgba(52,211,153,0.5)';
        setTimeout(() => { el.style.borderColor = ''; }, 2000);
      }
    });

    // Show URL preview strip
    showURLPreview(v.thumbnail, v.title, { channel: v.channel, duration_sec: v.duration_sec, platform: 'youtube' });

    // Remove any stale no-data warning
    $('ae-no-data-banner')?.remove();

    showToast(`"${v.title.slice(0,42)}${v.title.length>42?'…':''}" loaded — hit Run Analysis`, 'success');
  }

  function formatCount(n) {
    if (!n || n === 0) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toLocaleString();
  }

  /* ══════════════════════════════════════════════════════════════════
     CONNECTIONS DRAWER — YouTube OAuth + Bluesky App Password
  ══════════════════════════════════════════════════════════════════ */

  // Track connection state in memory (loaded from server on open)
  const connState = { youtube: false, bluesky: false };

  // Exposed so platform buttons and no-data banner can open drawer
  function openConnectionsDrawer() {
    const drawer  = $('keys-drawer');
    const overlay = $('keys-overlay');
    if (drawer)  drawer.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    loadConnectionStatus();
  }

  function closeConnectionsDrawer() {
    const drawer  = $('keys-drawer');
    const overlay = $('keys-overlay');
    if (drawer)  drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  function initConnectionsDrawer() {
    $('btn-open-keys')?.addEventListener('click',  openConnectionsDrawer);
    $('btn-close-keys')?.addEventListener('click', closeConnectionsDrawer);
    $('keys-overlay')?.addEventListener('click',   closeConnectionsDrawer);

    // Toggle show/hide password inputs
    $$('.ae-key-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $(btn.dataset.target);
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    });

    // YouTube OAuth connect
    $('btn-connect-youtube')?.addEventListener('click', () => {
      const btn = $('btn-connect-youtube');
      btn.classList.add('loading');
      btn.textContent = 'Opening Google sign-in...';
      // Open OAuth popup
      const popup = window.open('/api/auth/youtube/start', 'yt-oauth', 'width=500,height=650,left=200,top=100');
      // Listen for result message from callback page
      const handler = (e) => {
        if (e.data?.type !== 'yt-auth') return;
        window.removeEventListener('message', handler);
        btn.classList.remove('loading');
        if (e.data.success) {
          setYouTubeConnected(e.data.channelName);
          showToast(`YouTube connected: ${e.data.channelName}`, 'success');
        } else {
          btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Connect YouTube Account`;
          showToast('YouTube connection failed: ' + (e.data.error || 'cancelled'), 'error');
        }
      };
      window.addEventListener('message', handler);
      // Cleanup if popup closed without message
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handler);
          if (!connState.youtube) {
            btn.classList.remove('loading');
            btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Connect YouTube Account`;
          }
        }
      }, 800);
    });

    // YouTube disconnect
    $('btn-disconnect-youtube')?.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/youtube/disconnect', { method: 'DELETE' });
        setYouTubeDisconnected();
        showToast('YouTube disconnected', 'success');
      } catch { showToast('Disconnect failed', 'error'); }
    });

    // Bluesky connect
    $('btn-connect-bluesky')?.addEventListener('click', async () => {
      const handle   = $('bsky-handle')?.value.trim();
      const password = $('bsky-password')?.value.trim();
      if (!handle || !password) { showToast('Enter your handle and app password', 'error'); return; }
      const btn = $('btn-connect-bluesky');
      btn.textContent = 'Connecting...';
      btn.disabled = true;
      try {
        const res = await fetch('/api/attention/bluesky/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle, app_password: password }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setBlueskyConnected(data.handle);
        // Clear inputs for security
        if ($('bsky-handle'))   $('bsky-handle').value   = '';
        if ($('bsky-password')) $('bsky-password').value = '';
        showToast(`Bluesky connected: @${data.handle}`, 'success');
      } catch (err) {
        showToast('Bluesky error: ' + err.message, 'error');
        btn.textContent = 'Connect';
        btn.disabled = false;
      }
    });

    // Bluesky disconnect
    $('btn-disconnect-bluesky')?.addEventListener('click', async () => {
      try {
        await fetch('/api/attention/bluesky/disconnect', { method: 'DELETE' });
        setBlueskyDisconnected();
        showToast('Bluesky disconnected', 'success');
      } catch { showToast('Disconnect failed', 'error'); }
    });
  }

  async function loadConnectionStatus() {
    // Check YouTube status
    try {
      const ytRes = await fetch('/api/auth/youtube/status');
      const ytData = await ytRes.json();
      if (ytData.connected) setYouTubeConnected(ytData.channelName);
      else setYouTubeDisconnected();
    } catch {}

    // Check Bluesky status
    try {
      const bskyRes = await fetch('/api/attention/bluesky/status');
      const bskyData = await bskyRes.json();
      if (bskyData.connected) setBlueskyConnected(bskyData.handle);
      else setBlueskyDisconnected();
    } catch {}
  }

  function setYouTubeConnected(channelName) {
    connState.youtube = true;
    $('yt-connect-area') && ($('yt-connect-area').style.display = 'none');
    $('yt-connected-area') && ($('yt-connected-area').style.display = 'block');
    if ($('yt-channel-name')) $('yt-channel-name').textContent = channelName || 'YouTube Connected';
    setBlockStatus('yt-status', 'active', '● Connected');
    const sumYt = $('sum-youtube');
    if (sumYt) { sumYt.textContent = `✓ ${channelName || 'Connected'}`; sumYt.className = 'ae-sum-val connected'; }
    // Green badge on platform button
    $('plat-btn-youtube')?.classList.add('conn-active');
    updateNavDot();
    // Load video grid into the empty output panel
    // Only load if results aren't already showing
    if ($('ae-empty')?.style.display !== 'none' && $('ae-results')?.style.display === 'none') {
      loadVideoGrid();
    }
  }

  function setYouTubeDisconnected() {
    connState.youtube = false;
    $('yt-connect-area') && ($('yt-connect-area').style.display = 'block');
    $('yt-connected-area') && ($('yt-connected-area').style.display = 'none');
    const btn = $('btn-connect-youtube');
    if (btn) btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Connect YouTube Account`;
    setBlockStatus('yt-status', 'inactive', 'Not connected');
    const sumYt = $('sum-youtube');
    if (sumYt) { sumYt.textContent = '— Not connected'; sumYt.className = 'ae-sum-val missing'; }
    $('plat-btn-youtube')?.classList.remove('conn-active');
    updateNavDot();
  }

  function setBlueskyConnected(handle) {
    connState.bluesky = true;
    $('bsky-connect-area') && ($('bsky-connect-area').style.display = 'none');
    $('bsky-connected-area') && ($('bsky-connected-area').style.display = 'block');
    if ($('bsky-handle-display')) $('bsky-handle-display').textContent = `@${handle}`;
    setBlockStatus('bsky-status', 'active', '● Connected');
    const sumBsky = $('sum-bluesky');
    if (sumBsky) { sumBsky.textContent = `✓ @${handle}`; sumBsky.className = 'ae-sum-val connected'; }
    // Green badge on platform button
    $('plat-btn-bluesky')?.classList.add('conn-active');
    updateNavDot();
  }

  function setBlueskyDisconnected() {
    connState.bluesky = false;
    $('bsky-connect-area') && ($('bsky-connect-area').style.display = 'block');
    $('bsky-connected-area') && ($('bsky-connected-area').style.display = 'none');
    setBlockStatus('bsky-status', 'inactive', 'Not connected');
    const sumBsky = $('sum-bluesky');
    if (sumBsky) { sumBsky.textContent = '— Not connected'; sumBsky.className = 'ae-sum-val missing'; }
    $('plat-btn-bluesky')?.classList.remove('conn-active');
    updateNavDot();
  }

  function setBlockStatus(statusId, state, text) {
    const dot   = document.querySelector(`#${statusId} .ae-key-dot`);
    const label = document.querySelector(`#${statusId} .ae-key-status-text`);
    if (dot)   dot.className = `ae-key-dot ${state}`;
    if (label) { label.className = `ae-key-status-text ${state}`; label.textContent = text; }
  }

  function updateNavDot() {
    const dot = $('keys-status-dot');
    if (!dot) return;
    const count = (connState.youtube ? 1 : 0) + (connState.bluesky ? 1 : 0);
    if (count >= 2)     dot.className = 'ae-keys-status-dot has-keys';
    else if (count >= 1) dot.className = 'ae-keys-status-dot partial';
    else                 dot.className = 'ae-keys-status-dot';
  }

  /* ══════════════════════════════════════════════════════════════════
     URL AUTO-FETCH — detects platform, hits /api/fetch-url, populates form
  ══════════════════════════════════════════════════════════════════ */
  function initURLFetch() {
    const urlInput = $('content-url');
    if (!urlInput) return;

    let fetchTimer = null;

    urlInput.addEventListener('input', () => {
      clearTimeout(fetchTimer);
      const val = urlInput.value.trim();

      // Reset preview
      hideURLPreview();
      clearURLNote();

      // If user cleared the URL, reset hasRealData so they can't run on stale data
      if (!val) {
        state.hasRealData = false;
        state.fetchedPlatform = null;
        $('ae-no-data-banner')?.remove();
      }

      if (!val || val.length < 20) return;

      // Auto-select platform from URL
      autoSelectPlatform(val);

      // Debounce fetch by 900ms after user stops typing
      fetchTimer = setTimeout(() => tryFetchURL(val), 900);
    });

    urlInput.addEventListener('blur', () => {
      clearTimeout(fetchTimer);
      const val = urlInput.value.trim();
      if (val && val.length > 20) tryFetchURL(val);
    });
  }

  function autoSelectPlatform(url) {
    let detected = null;
    if (url.includes('youtube.com') || url.includes('youtu.be')) detected = 'youtube';
    else if (url.includes('instagram.com'))  detected = 'instagram';
    else if (url.includes('facebook.com') || url.includes('fb.watch')) detected = 'facebook';
    else if (url.includes('tiktok.com'))     detected = 'tiktok';
    else if (url.includes('twitter.com') || url.includes('x.com')) detected = 'twitter';
    else if (url.includes('bsky.app'))       detected = 'bluesky';

    if (detected) {
      const btn = document.querySelector(`.ae-platform-btn[data-platform="${detected}"]`);
      if (btn && !btn.classList.contains('active')) {
        $$('.ae-platform-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.platform = detected;
      }
    }
  }

  async function tryFetchURL(url) {
    const spinner = $('url-spinner');
    if (spinner) spinner.classList.add('active');

    try {
      const params = new URLSearchParams({ url });
      const res  = await fetch(`/api/fetch-url?${params}`);
      const data = await res.json();

      if (spinner) spinner.classList.remove('active');

      // Needs platform connection
      if (data.needs_connect) {
        showURLNote(`Connect your ${(data.platform || 'platform').replace(/^\w/, c => c.toUpperCase())} account via the Connections button to auto-populate real metrics.`);
        return;
      }

      if (data.error && data.needs_manual) {
        showURLNote(data.error);
        return;
      }

      if (data.error && !data.metrics) {
        showURLNote(data.error);
        return;
      }

      // ✅ Success — populate the form
      if (data.title) {
        showURLPreview(data.thumbnail, data.title, data);
        // Auto-select platform
        if (data.platform && data.platform !== 'unknown') {
          const btn = document.querySelector(`.ae-platform-btn[data-platform="${data.platform}"]`);
          if (btn && !btn.classList.contains('active')) {
            $$('.ae-platform-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.platform = data.platform;
          }
        }
      }

      populateMetrics(data);
      if (data.notes) showURLNote(data.notes);

    } catch (err) {
      if (spinner) spinner.classList.remove('active');
      showURLNote('Network error fetching URL metadata.');
    }
  }

  function populateMetrics(data) {
    const m = data.metrics || {};

    // Fill numeric inputs only if value > 0
    const fields = {
      'M-views':    m.views,
      'm-views':    m.views,
      'm-likes':    m.likes,
      'm-comments': m.comments,
      'm-shares':   m.shares,
      'm-saves':    m.saves,
      'm-watchtime': m.watch_time_pct,
    };
    if ($('m-views') && m.views > 0)            $('m-views').value    = m.views;
    if ($('m-likes') && m.likes > 0)            $('m-likes').value    = m.likes;
    if ($('m-comments') && m.comments > 0)      $('m-comments').value = m.comments;
    if ($('m-shares') && m.shares > 0)          $('m-shares').value   = m.shares;
    if ($('m-saves') && m.saves > 0)            $('m-saves').value    = m.saves;
    if ($('m-watchtime') && m.watch_time_pct > 0) $('m-watchtime').value = m.watch_time_pct;

    // Duration
    if ($('duration') && data.duration_sec > 0) $('duration').value = data.duration_sec;

    // Flash filled inputs
    ['m-views','m-likes','m-comments','m-shares','m-saves','m-watchtime','duration'].forEach(id => {
      const el = $(id);
      if (el && el.value && parseFloat(el.value) > 0) {
        el.style.borderColor = 'rgba(52,211,153,0.5)';
        setTimeout(() => { el.style.borderColor = ''; }, 2000);
      }
    });

    const count = Object.values(m).filter(v => v > 0).length;
    if (count > 0) {
      state.hasRealData = true;
      state.fetchedPlatform = data.platform || state.platform;
      showToast(`${count} metric${count > 1 ? 's' : ''} auto-filled from ${(data.platform || 'URL').toUpperCase()}`, 'success');
    }
    // Remove any stale no-data warning
    $('ae-no-data-banner')?.remove();
  }

  function showURLPreview(thumb, title, data) {
    const preview = $('url-preview');
    const thumbEl = $('url-thumb');
    const titleEl = $('url-preview-title');
    const metaEl  = $('url-preview-meta');
    if (!preview) return;

    if (thumbEl && thumb) { thumbEl.src = thumb; thumbEl.style.display = 'block'; }
    else if (thumbEl) thumbEl.style.display = 'none';
    if (titleEl) titleEl.textContent = title || '';
    if (metaEl) {
      const parts = [];
      if (data.channel)      parts.push(data.channel);
      if (data.duration_sec) parts.push(formatDuration(data.duration_sec));
      if (data.platform)     parts.push(data.platform.toUpperCase());
      metaEl.textContent = parts.join(' · ');
    }
    preview.classList.add('visible');
  }

  function hideURLPreview() {
    const preview = $('url-preview');
    if (preview) preview.classList.remove('visible');
  }

  function showURLNote(msg) {
    const el = $('url-fetch-note');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function clearURLNote() {
    const el = $('url-fetch-note');
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  }

  function formatDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

})();
