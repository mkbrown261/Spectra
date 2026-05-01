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
  };

  /* ── DOM REFS ───────────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  /* ── INIT ───────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    bindPlatform();
    bindInputTabs();
    bindOutputTabs();
    bindActions();
    bindResultsButtons();
    injectToast();
  });

  /* ══════════════════════════════════════════════════════════════════
     PLATFORM SELECTOR
  ══════════════════════════════════════════════════════════════════ */
  function bindPlatform() {
    $$('.ae-platform-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.ae-platform-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.platform = btn.dataset.platform;
        // Update URL placeholder
        const urlInput = $('content-url');
        if (urlInput) {
          const placeholders = {
            tiktok: 'https://www.tiktok.com/@user/video/...',
            instagram: 'https://www.instagram.com/reel/...',
            youtube: 'https://www.youtube.com/watch?v=...',
            twitter: 'https://twitter.com/user/status/...',
            facebook: 'https://www.facebook.com/watch/?v=...',
            ads: 'Paste ad URL or leave blank...',
          };
          urlInput.placeholder = placeholders[state.platform] || 'Paste your content URL...';
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

  async function runScoreOnly() {
    if (state.isAnalyzing) return;
    const data = collectFormData();

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
    $('ae-empty').style.display = 'flex';
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
    // Platform badge
    const badge = $('results-platform-badge');
    if (badge && meta) badge.textContent = meta.platform?.toUpperCase() || state.platform.toUpperCase();

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
    if (signalLabel && meta) signalLabel.textContent = meta.platform?.toUpperCase() || '';

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
    const chart = $('timeline-chart');
    if (!chart || !segments?.length) return;

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
    const dropoffList = $('dropoff-list');
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

})();
