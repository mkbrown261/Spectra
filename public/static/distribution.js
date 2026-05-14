/* ════════════════════════════════════════════════════════════════
   SPECTRA — DISTRIBUTION ENGINE  v2.0
   /tools/distribution-engine/
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* ── HELPERS ──────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs  = Math.abs(diff);
  const future = diff < 0;
  if (abs < 60000)    return future ? 'in a moment'               : 'just now';
  if (abs < 3600000)  return future ? `in ${Math.round(abs/60000)}m` : `${Math.round(abs/60000)}m ago`;
  if (abs < 86400000) return future ? `in ${Math.round(abs/3600000)}h` : `${Math.round(abs/3600000)}h ago`;
  return future ? `in ${Math.round(abs/86400000)}d` : `${Math.round(abs/86400000)}d ago`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function fmtCountdown(ms) {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0)  return `${d}d ${h % 24}h`;
  if (h > 0)  return `${h}h ${m % 60}m`;
  if (m > 0)  return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n/1000).toFixed(1) + 'K';
  return String(n);
}

function showToast(msg, type = 'info', duration = 3500) {
  const el = $('dn-toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = `dn-toast show ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'dn-toast'; }, duration);
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
  if (body) opts.body = JSON.stringify(body);
  return fetch(path, opts);
}

/* ── MOMENTUM ─────────────────────────────────────────────────── */
function momentumScore(post) {
  // velocity-based: views per hour since posted
  if (!post.posted_at || post.views_24h == null) return null;
  const hoursLive = Math.max(1, (Date.now() - new Date(post.posted_at).getTime()) / 3600000);
  const vph = (post.views_24h || 0) / hoursLive;
  if (vph >= 500)  return { emoji: '🔥', label: 'Fire',    cls: 'momentum-fire'  };
  if (vph >= 100)  return { emoji: '⚡', label: 'Rising',  cls: 'momentum-rise'  };
  if (vph >= 20)   return { emoji: '💤', label: 'Slow',    cls: 'momentum-slow'  };
  return           { emoji: '❄️', label: 'Cold',    cls: 'momentum-cold'  };
}

/* ── STATE ────────────────────────────────────────────────────── */
const DN = {
  user:         null,
  accounts:     [],
  queue:        [],
  activeTab:    'queue',
  activeFilter: 'all',
  liveChart:    null,
  livePoller:   null,
  countdownTimer: null,
  compose: {
    videoUrl:    '',
    videoKey:    '',      // R2 key if uploaded from device
    projectId:   null,
    projectName: '',
    platforms:   [],
    concept:     '',
    igCaptionA:  '',
    igCaptionB:  '',
    igActiveAB:  'A',
    igHashtags:  [],
    ytTitle:     '',
    ytDesc:      '',
    ytTags:      [],
    timing:      'now',
    scheduledAt: null,
  },
  batch: {
    items:     [],        // [{ videoUrl, videoKey, name, platforms, concept }]
    dripHours: 24,
    template:  'daily',
  },
  upload: {
    active:   false,
    progress: 0,
    name:     '',
  },
};

/* ── OPTIMAL POST TIMES ───────────────────────────────────────── */
const OPTIMAL_TIMES = {
  instagram: [
    { label: 'Mon 11am', value: () => nextWeekday(1, 11, 0) },
    { label: 'Wed 1pm',  value: () => nextWeekday(3, 13, 0) },
    { label: 'Fri 9am',  value: () => nextWeekday(5, 9,  0) },
    { label: 'Sat 10am', value: () => nextWeekday(6, 10, 0) },
  ],
  youtube: [
    { label: 'Tue 2pm',  value: () => nextWeekday(2, 14, 0) },
    { label: 'Thu 3pm',  value: () => nextWeekday(4, 15, 0) },
    { label: 'Sat 12pm', value: () => nextWeekday(6, 12, 0) },
    { label: 'Sun 11am', value: () => nextWeekday(0, 11, 0) },
  ],
};

const DRIP_TEMPLATES = {
  daily:      { label: '3-Day Daily',   hours: 24,  count: 3,  desc: 'Posts every 24h — consistent daily cadence' },
  weekly:     { label: 'Weekly',        hours: 168, count: 4,  desc: 'One post per week — slow-burn strategy' },
  launch:     { label: 'Launch Week',   hours: 48,  count: 5,  desc: 'Every 48h — high-momentum launch sequence' },
  blitz:      { label: '6-Hour Blitz',  hours: 6,   count: 4,  desc: 'Every 6h — aggressive same-day push' },
  custom:     { label: 'Custom',        hours: 24,  count: 0,  desc: 'Set your own interval' },
};

function nextWeekday(dow, hour, min) {
  const d = new Date();
  const diff = (dow - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(hour, min, 0, 0);
  return d;
}

function toLocalDatetimeInput(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  try {
    const res = await api('GET', '/api/me');
    if (!res.ok) { showAuthGate(); return; }
    DN.user = await res.json();
    $('dn-user-email').textContent = DN.user.email || '';
  } catch { showAuthGate(); return; }

  $('dn-auth-gate').style.display = 'none';
  $('dn-app').style.display = 'block';

  bindUI();
  await Promise.all([loadAccounts(), loadQueue()]);
  startCountdownTicker();

  const params = new URLSearchParams(location.search);
  const preProjectId   = params.get('project_id');
  const preVideoUrl    = params.get('video_url');
  const preProjectName = params.get('project_name') || '';
  if (preVideoUrl || preProjectId) {
    switchTab('new');
    if (preVideoUrl) {
      DN.compose.projectId   = preProjectId;
      DN.compose.projectName = preProjectName;
      applyVideoUrl(preVideoUrl);
    }
  }
}

/* ── AUTH GATE ────────────────────────────────────────────────── */
function showAuthGate() {
  $('dn-auth-gate').style.display = 'flex';
  $('dn-app').style.display = 'none';
  $('dn-auth-form')?.addEventListener('submit', handleAuthSubmit);
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = $('dn-auth-email')?.value?.trim() || '';
  const password = $('dn-auth-pass')?.value || '';
  const errEl = $('dn-auth-err');
  const btn   = $('dn-auth-submit');
  if (!email || !password) { if (errEl) errEl.textContent = 'Email and password required'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  if (errEl) errEl.textContent = '';
  try {
    const res  = await api('POST', '/api/auth/login', { email, password });
    const data = await res.json();
    if (!res.ok) { if (errEl) errEl.textContent = data.error || 'Sign in failed'; return; }
    DN.user = data.user || { email };
    $('dn-auth-gate').style.display = 'none';
    $('dn-app').style.display = 'block';
    $('dn-user-email').textContent = DN.user.email || '';
    bindUI();
    await Promise.all([loadAccounts(), loadQueue()]);
    startCountdownTicker();
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
  $$('.dn-tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  $$('.dn-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.dn-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      DN.activeFilter = btn.dataset.filter;
      renderQueue();
    });
  });

  $('btn-refresh-queue')?.addEventListener('click', () => loadQueue());

  $$('.dn-btn-connect').forEach(btn => {
    btn.addEventListener('click', () => startOAuth(btn.dataset.platform));
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('.dn-btn-disconnect');
    if (btn) disconnectAccount(btn.dataset.platform);
  });

  // Video URL input
  $('dn-video-url')?.addEventListener('change', e => {
    const url = e.target.value.trim();
    if (url) applyVideoUrl(url);
  });
  $('dn-video-url')?.addEventListener('paste', e => {
    setTimeout(() => { const url = e.target.value.trim(); if (url) applyVideoUrl(url); }, 50);
  });

  // File upload — drop zone
  initDropZone();

  // Upload tab toggle
  $('btn-upload-tab-url')?.addEventListener('click',  () => setVideoInputTab('url'));
  $('btn-upload-tab-file')?.addEventListener('click', () => setVideoInputTab('file'));

  // From Project picker
  $('btn-load-from-project')?.addEventListener('click', openProjectPicker);
  $('btn-close-picker')?.addEventListener('click', closeProjectPicker);
  $('dn-project-picker')?.addEventListener('click', e => {
    if (e.target === $('dn-project-picker')) closeProjectPicker();
  });

  $('btn-clear-video')?.addEventListener('click', clearVideo);

  $$('.dn-platform-toggle').forEach(btn => {
    btn.addEventListener('click', () => togglePlatform(btn.dataset.platform));
  });

  $('btn-gen-caption')?.addEventListener('click', generateCaption);
  $('dn-ig-caption-a')?.addEventListener('input', () => {
    DN.compose.igCaptionA = $('dn-ig-caption-a').value;
    updateIgCharCount('a');
  });
  $('dn-ig-caption-b')?.addEventListener('input', () => {
    DN.compose.igCaptionB = $('dn-ig-caption-b').value;
    updateIgCharCount('b');
  });

  // A/B toggle
  $('btn-ab-a')?.addEventListener('click', () => setActiveAB('A'));
  $('btn-ab-b')?.addEventListener('click', () => setActiveAB('B'));

  $$('.dn-timing-btn').forEach(btn => {
    btn.addEventListener('click', () => setTiming(btn.dataset.timing));
  });

  $('dn-scheduled-at')?.addEventListener('change', e => {
    DN.compose.scheduledAt = e.target.value ? new Date(e.target.value).toISOString() : null;
    updateReview();
  });

  $('btn-fire-post')?.addEventListener('click', firePost);

  $('dn-smart-chips')?.addEventListener('click', e => {
    const chip = e.target.closest('.dn-smart-chip');
    if (!chip) return;
    const d = new Date(chip.dataset.iso);
    $('dn-scheduled-at').value = toLocalDatetimeInput(d);
    DN.compose.scheduledAt = d.toISOString();
    setTiming('schedule');
    updateReview();
  });

  $('dn-queue-list')?.addEventListener('click', async e => {
    const retry  = e.target.closest('[data-retry-id]');
    const cancel = e.target.closest('[data-cancel-id]');
    const pull   = e.target.closest('[data-pull-id]');
    if (retry)  await retryPost(retry.dataset.retryId);
    if (cancel) await cancelPost(cancel.dataset.cancelId);
    if (pull)   await pullMetrics(pull.dataset.pullId);
  });

  // Batch mode
  $('btn-open-batch')?.addEventListener('click', () => switchTab('batch'));
  $('btn-batch-add-file')?.addEventListener('click', () => openBatchFilePicker());
  $('btn-batch-fire')?.addEventListener('click', fireBatch);
  $$('.dn-drip-template-btn').forEach(btn => {
    btn.addEventListener('click', () => selectDripTemplate(btn.dataset.template));
  });
  $('dn-batch-drip-custom')?.addEventListener('change', e => {
    DN.batch.dripHours = parseInt(e.target.value) || 24;
  });
  $('dn-batch-list')?.addEventListener('click', e => {
    const rm = e.target.closest('[data-batch-remove]');
    if (rm) removeBatchItem(parseInt(rm.dataset.batchRemove));
    const plat = e.target.closest('[data-batch-platform]');
    if (plat) toggleBatchItemPlatform(parseInt(plat.dataset.batchIndex), plat.dataset.batchPlatform);
  });

  renderSmartTimes();
  selectDripTemplate('daily');
}

/* ════════════════════════════════════════════════════════════════
   TABS
   ════════════════════════════════════════════════════════════════ */
function switchTab(tab) {
  DN.activeTab = tab;
  $$('.dn-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.dn-panel').forEach(p => p.classList.toggle('active', p.id === `dn-panel-${tab}`));
  if (tab === 'metrics') initLiveChart();
}

/* ════════════════════════════════════════════════════════════════
   ACCOUNTS + HEALTH BAR
   ════════════════════════════════════════════════════════════════ */
async function loadAccounts() {
  try {
    const res  = await api('GET', '/api/distribution/accounts');
    const data = await res.json();
    DN.accounts = data.accounts || [];
    renderAccounts();
    renderHealthBar();
  } catch (err) {
    showToast('Could not load accounts: ' + err.message, 'error');
  }
}

function renderAccounts() {
  $('dn-accounts-count').textContent = DN.accounts.length;

  ['instagram', 'youtube'].forEach(platform => {
    const acct       = DN.accounts.find(a => a.platform === platform);
    const card        = $(`card-${platform}`);
    const statusEl    = $(`status-${platform}`);
    const connectedEl = $(`connected-${platform}`);
    const oauthFormEl = $(`oauth-form-${platform}`);

    if (acct) {
      card?.classList.add('connected');
      if (statusEl) statusEl.innerHTML = `<span class="dn-status-dot connected"></span><span class="dn-status-text">Connected</span>`;
      if (connectedEl) {
        connectedEl.style.display = 'flex';
        const avatarEl = $(`avatar-${platform}`);
        const handleEl = $(`handle-${platform}`);
        if (avatarEl && acct.avatar_url) avatarEl.src = acct.avatar_url;
        if (handleEl) handleEl.textContent = platform === 'instagram' ? `@${acct.handle}` : acct.handle;
        connectedEl.querySelector('.dn-btn-disconnect').dataset.platform = platform;
      }
      if (oauthFormEl) oauthFormEl.style.display = 'none';
    } else {
      card?.classList.remove('connected');
      if (statusEl) statusEl.innerHTML = `<span class="dn-status-dot disconnected"></span><span class="dn-status-text">Not connected</span>`;
      if (connectedEl) connectedEl.style.display = 'none';
      if (oauthFormEl) oauthFormEl.style.display = 'flex';
    }
  });

  updatePlatformToggles();
}

function renderHealthBar() {
  const el = $('dn-health-bar');
  if (!el) return;

  const platforms = ['instagram', 'youtube'];
  const html = platforms.map(platform => {
    const acct = DN.accounts.find(a => a.platform === platform);
    const icon = platform === 'instagram'
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="11" height="11"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg>`;

    if (!acct) {
      return `<div class="dn-health-item offline">
        ${icon}<span>${platform}</span>
        <span class="dn-health-status-dot offline"></span>
        <span class="dn-health-label">Not connected</span>
      </div>`;
    }

    // Token expiry hint: warn if token_expires_at < now + 7 days
    let expiryHtml = '';
    if (acct.token_expires_at) {
      const expiresIn = new Date(acct.token_expires_at).getTime() - Date.now();
      const days = Math.floor(expiresIn / 86400000);
      if (expiresIn < 0) {
        expiryHtml = `<span class="dn-health-expiry expired">Token expired</span>`;
      } else if (days < 7) {
        expiryHtml = `<span class="dn-health-expiry warn">Expires in ${days}d</span>`;
      } else {
        expiryHtml = `<span class="dn-health-expiry ok">Token OK</span>`;
      }
    } else {
      expiryHtml = `<span class="dn-health-expiry ok">Connected</span>`;
    }

    // Last post status from queue
    const lastPost = DN.queue.filter(p => p.platform === platform).sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
    const lastHtml = lastPost
      ? `<span class="dn-health-last ${lastPost.status}">${lastPost.status === 'posted' ? '✓' : lastPost.status === 'failed' ? '✗' : '…'} ${relativeTime(lastPost.posted_at || lastPost.created_at)}</span>`
      : '';

    return `<div class="dn-health-item ok">
      ${icon}<span>${platform === 'instagram' ? '@' + acct.handle : acct.handle}</span>
      <span class="dn-health-status-dot connected"></span>
      ${expiryHtml}
      ${lastHtml}
    </div>`;
  }).join('');

  el.innerHTML = html;
}

/* ── OAuth ───────────────────────────────────────────────────── */
async function startOAuth(platform) {
  let clientId, clientSecret, redirectUri;
  if (platform === 'instagram') {
    clientId     = $('ig-client-id')?.value.trim();
    clientSecret = $('ig-client-secret')?.value.trim();
    redirectUri  = $('ig-redirect-uri')?.value.trim();
  } else {
    clientId     = $('yt-client-id')?.value.trim();
    clientSecret = $('yt-client-secret')?.value.trim();
    redirectUri  = $('yt-redirect-uri')?.value.trim();
  }
  if (!clientId || !redirectUri) { showToast('Enter App ID / Client ID and Redirect URI first', 'error'); return; }

  const btn = document.querySelector(`.dn-btn-connect[data-platform="${platform}"]`);
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="dn-spin"></span> Opening…`; }

  try {
    const res  = await api('POST', '/api/distribution/accounts/connect', { platform, client_id: clientId, redirect_uri: redirectUri });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get auth URL');
    sessionStorage.setItem(`${platform}_client_secret`, clientSecret || '');

    const popup = window.open(data.auth_url, 'spectra_oauth', 'width=540,height=680,scrollbars=yes');
    const handler = async (event) => {
      if (event.data?.type === 'oauth_success' && event.data.platform === platform) {
        window.removeEventListener('message', handler);
        popup?.close();
        showToast(`${platform === 'instagram' ? 'Instagram' : 'YouTube'} connected ✓`, 'success');
        await loadAccounts();
      } else if (event.data?.type === 'oauth_error') {
        window.removeEventListener('message', handler);
        popup?.close();
        showToast(`OAuth failed: ${event.data.error}`, 'error');
      }
    };
    window.addEventListener('message', handler);
    const pollClosed = setInterval(() => {
      if (popup?.closed) { clearInterval(pollClosed); window.removeEventListener('message', handler); }
    }, 800);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      const label = platform === 'instagram' ? 'Connect Instagram' : 'Connect YouTube';
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>${label}`;
    }
  }
}

async function disconnectAccount(platform) {
  const acct = DN.accounts.find(a => a.platform === platform);
  if (!acct) return;
  if (!confirm(`Disconnect ${platform}? Scheduled posts for this account will fail.`)) return;
  try {
    await api('DELETE', `/api/distribution/accounts/${acct.id}`);
    showToast(`${platform} disconnected`, 'info');
    await loadAccounts();
  } catch (err) { showToast(err.message, 'error'); }
}

/* ════════════════════════════════════════════════════════════════
   QUEUE + COUNTDOWN TICKER
   ════════════════════════════════════════════════════════════════ */
async function loadQueue() {
  try {
    const res  = await api('GET', '/api/distribution/queue');
    const data = await res.json();
    DN.queue = data.posts || [];
    renderQueue();
    renderHealthBar();
  } catch (err) { showToast('Could not load queue: ' + err.message, 'error'); }
}

function renderQueue() {
  const listEl  = $('dn-queue-list');
  const emptyEl = $('dn-queue-empty');
  if (!listEl) return;

  const filtered = DN.activeFilter === 'all'
    ? DN.queue
    : DN.queue.filter(p => p.status === DN.activeFilter);

  const scheduled = DN.queue.filter(p => p.status === 'scheduled' || p.status === 'posting').length;
  $('dn-queue-count').textContent = scheduled || DN.queue.length;

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // Group by batch_id
  const batches = {};
  const solo    = [];
  filtered.forEach(post => {
    if (post.batch_id) {
      if (!batches[post.batch_id]) batches[post.batch_id] = [];
      batches[post.batch_id].push(post);
    } else {
      solo.push(post);
    }
  });

  let html = '';

  // Render batch groups
  Object.entries(batches).forEach(([batchId, posts]) => {
    posts.sort((a, b) => (a.batch_position || 0) - (b.batch_position || 0));
    html += `<div class="dn-batch-group">
      <div class="dn-batch-group-header">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Batch · ${posts.length} posts
        <span class="dn-batch-id-label">${batchId.slice(0,8)}</span>
      </div>
      ${posts.map(p => renderQueueCard(p, true)).join('')}
    </div>`;
  });

  // Render solo posts
  solo.forEach(post => { html += renderQueueCard(post, false); });

  listEl.innerHTML = html;
}

function renderQueueCard(post, inBatch = false) {
  const platformIcon = post.platform === 'instagram'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg>`;

  // Countdown
  let countdownHtml = '';
  if ((post.status === 'scheduled') && post.scheduled_at) {
    const ms = new Date(post.scheduled_at).getTime() - Date.now();
    countdownHtml = `<div class="dn-countdown" data-scheduled="${post.scheduled_at}">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="dn-countdown-val">${ms > 0 ? fmtCountdown(ms) : 'imminent'}</span>
    </div>`;
  }

  const timingLine = post.status === 'posted'
    ? `Posted ${relativeTime(post.posted_at)}`
    : post.status === 'scheduled' && post.scheduled_at
    ? `Scheduled ${formatDateTime(post.scheduled_at)}`
    : post.status === 'posting'
    ? `Publishing now…`
    : post.status === 'cancelled'
    ? 'Cancelled'
    : '';

  // Momentum badge
  const mom = momentumScore(post);
  const momentumHtml = mom
    ? `<span class="dn-momentum-badge ${mom.cls}" title="${mom.label}: ${fmtNum(post.views_24h)} views">${mom.emoji} ${mom.label}</span>`
    : '';

  const metrics24 = post.views_24h != null
    ? `<div class="dn-qcard-metrics">
        <div class="dn-qcard-metric"><span class="dn-qcard-metric-val">${fmtNum(post.views_24h)}</span><span class="dn-qcard-metric-label">Views</span></div>
        <div class="dn-qcard-metric"><span class="dn-qcard-metric-val">${fmtNum(post.likes_24h||0)}</span><span class="dn-qcard-metric-label">Likes</span></div>
        ${post.views_72h != null ? `<div class="dn-qcard-metric"><span class="dn-qcard-metric-val">${fmtNum(post.views_72h)}</span><span class="dn-qcard-metric-label">72h</span></div>` : ''}
      </div>`
    : '';

  const actions = [];
  if (post.status === 'scheduled' || post.status === 'posting')
    actions.push(`<button class="dn-btn-sm danger" data-cancel-id="${post.id}">Cancel</button>`);
  if (post.status === 'failed' && (post.retry_count || 0) < 3)
    actions.push(`<button class="dn-btn-sm retry" data-retry-id="${post.id}">Retry</button>`);
  if (post.status === 'posted' && post.views_24h == null)
    actions.push(`<button class="dn-btn-sm" data-pull-id="${post.id}">Pull Metrics</button>`);

  const caption = post.title || post.caption || '';
  const batchPosBadge = inBatch ? `<span class="dn-batch-pos">#${(post.batch_position||0)+1}</span>` : '';

  return `
  <div class="dn-queue-card status-${post.status}${inBatch ? ' in-batch' : ''}">
    <div class="dn-qcard-thumb">
      <video src="${escHtml(post.video_url)}" muted preload="metadata" style="pointer-events:none"></video>
    </div>
    <div class="dn-qcard-body">
      <div class="dn-qcard-top">
        ${batchPosBadge}
        <span class="dn-qcard-platform-badge ${post.platform}">${platformIcon} ${post.platform}</span>
        <span class="dn-qcard-status-badge ${post.status}">${post.status}</span>
        ${momentumHtml}
        ${post.account_handle ? `<span class="dn-qcard-project">${post.platform==='instagram'?'@':''}${escHtml(post.account_handle)}</span>` : ''}
      </div>
      ${caption ? `<div class="dn-qcard-caption">${escHtml(caption.slice(0,100))}${caption.length>100?'…':''}</div>` : ''}
      ${post.project_name ? `<div class="dn-qcard-timing" style="margin-top:0.1rem">Project: ${escHtml(post.project_name)}</div>` : ''}
      ${timingLine ? `<div class="dn-qcard-timing">${timingLine}</div>` : ''}
      ${countdownHtml}
      ${post.error_message ? `<div class="dn-qcard-error">Error: ${escHtml(post.error_message)}</div>` : ''}
      ${metrics24}
    </div>
    <div class="dn-qcard-actions">${actions.join('')}</div>
  </div>`;
}

/* ── Countdown ticker ────────────────────────────────────────── */
function startCountdownTicker() {
  if (DN.countdownTimer) clearInterval(DN.countdownTimer);
  DN.countdownTimer = setInterval(() => {
    $$('.dn-countdown').forEach(el => {
      const scheduled = el.dataset.scheduled;
      if (!scheduled) return;
      const ms = new Date(scheduled).getTime() - Date.now();
      const valEl = el.querySelector('.dn-countdown-val');
      if (valEl) valEl.textContent = ms > 0 ? fmtCountdown(ms) : 'imminent';
    });
  }, 1000);
}

async function retryPost(postId) {
  try {
    const res = await api('POST', `/api/distribution/queue/${postId}/retry`);
    const d   = await res.json();
    if (!res.ok) throw new Error(d.error);
    showToast('Retrying…', 'info');
    await loadQueue();
  } catch (err) { showToast(err.message, 'error'); }
}

async function cancelPost(postId) {
  if (!confirm('Cancel this scheduled post?')) return;
  try {
    const res = await api('DELETE', `/api/distribution/queue/${postId}`);
    const d   = await res.json();
    if (!res.ok) throw new Error(d.error);
    showToast('Post cancelled', 'info');
    await loadQueue();
  } catch (err) { showToast(err.message, 'error'); }
}

async function pullMetrics(postId) {
  const btn = document.querySelector(`[data-pull-id="${postId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Pulling…'; }
  try {
    const res = await api('POST', `/api/distribution/metrics/${postId}/pull`);
    const d   = await res.json();
    if (!res.ok) throw new Error(d.error);
    showToast('Metrics updated ✓', 'success');
    await loadQueue();
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Pull Metrics'; }
  }
}

/* ════════════════════════════════════════════════════════════════
   LIVE METRICS CHART
   ════════════════════════════════════════════════════════════════ */
function initLiveChart() {
  const canvas = $('dn-live-chart');
  if (!canvas) return;

  const posted = DN.queue.filter(p => p.status === 'posted' && p.views_24h != null).slice(0, 10);

  if (posted.length === 0) {
    $('dn-live-chart-empty')?.style && ($('dn-live-chart-empty').style.display = 'flex');
    canvas.style.display = 'none';
    return;
  }
  $('dn-live-chart-empty') && ($('dn-live-chart-empty').style.display = 'none');
  canvas.style.display = 'block';

  const labels  = posted.map(p => `${p.platform.slice(0,2).toUpperCase()} ${formatDateTime(p.posted_at)}`);
  const views   = posted.map(p => p.views_24h || 0);
  const likes   = posted.map(p => p.likes_24h || 0);

  if (DN.liveChart) {
    DN.liveChart.data.labels  = labels;
    DN.liveChart.data.datasets[0].data = views;
    DN.liveChart.data.datasets[1].data = likes;
    DN.liveChart.update('active');
    return;
  }

  DN.liveChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Views (24h)',
          data: views,
          borderColor: '#A78BFA',
          backgroundColor: 'rgba(167,139,250,0.12)',
          tension: 0.4,
          fill: true,
          pointBackgroundColor: '#A78BFA',
          pointRadius: 5,
          pointHoverRadius: 7,
        },
        {
          label: 'Likes (24h)',
          data: likes,
          borderColor: '#34D399',
          backgroundColor: 'rgba(52,211,153,0.08)',
          tension: 0.4,
          fill: true,
          pointBackgroundColor: '#34D399',
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: 'rgba(232,244,253,0.55)', font: { family: 'Space Grotesk', size: 12 } } },
        tooltip: {
          backgroundColor: '#0b0f1a',
          borderColor: 'rgba(168,216,240,0.15)',
          borderWidth: 1,
          titleColor: '#E8F4FD',
          bodyColor: 'rgba(232,244,253,0.7)',
        },
      },
      scales: {
        x: {
          ticks: { color: 'rgba(232,244,253,0.35)', font: { size: 11 } },
          grid:  { color: 'rgba(168,216,240,0.05)' },
        },
        y: {
          ticks: { color: 'rgba(232,244,253,0.35)', font: { size: 11 } },
          grid:  { color: 'rgba(168,216,240,0.05)' },
        },
      },
    },
  });

  // Start live poller
  if (DN.livePoller) clearInterval(DN.livePoller);
  DN.livePoller = setInterval(pollLiveMetrics, 60000);
}

async function pollLiveMetrics() {
  const posted = DN.queue.filter(p => p.status === 'posted').slice(0, 20);
  if (posted.length === 0) return;
  try {
    const ids = posted.map(p => p.id).join(',');
    const res = await api('GET', `/api/distribution/metrics/live?ids=${ids}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.metrics) return;
    // Merge updated metrics into queue
    data.metrics.forEach(m => {
      const idx = DN.queue.findIndex(p => p.id === m.post_id);
      if (idx !== -1) {
        DN.queue[idx].views_24h = m.views_24h;
        DN.queue[idx].likes_24h = m.likes_24h;
        DN.queue[idx].views_72h = m.views_72h;
      }
    });
    renderQueue();
    initLiveChart(); // refresh chart
    showToast('Live metrics refreshed', 'info', 1500);
  } catch {}
}

/* ════════════════════════════════════════════════════════════════
   FILE UPLOAD — DROP ZONE
   ════════════════════════════════════════════════════════════════ */
function setVideoInputTab(tab) {
  const urlPanel  = $('video-input-url-panel');
  const filePanel = $('video-input-file-panel');
  const btnUrl    = $('btn-upload-tab-url');
  const btnFile   = $('btn-upload-tab-file');
  if (tab === 'url') {
    urlPanel  && (urlPanel.style.display  = 'flex');
    filePanel && (filePanel.style.display = 'none');
    btnUrl?.classList.add('active');
    btnFile?.classList.remove('active');
  } else {
    urlPanel  && (urlPanel.style.display  = 'none');
    filePanel && (filePanel.style.display = 'block');
    btnUrl?.classList.remove('active');
    btnFile?.classList.add('active');
  }
}

function initDropZone() {
  const zone      = $('dn-drop-zone');
  const fileInput = $('dn-file-input');
  if (!zone) return;

  zone.addEventListener('click', () => fileInput?.click());

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  });

  fileInput?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  });
}

async function uploadFile(file) {
  const ALLOWED = ['video/mp4','video/quicktime','video/webm','video/x-m4v','video/x-msvideo'];
  const MAX_MB  = 500;
  if (!ALLOWED.includes(file.type)) { showToast('Unsupported format — use MP4, MOV, or WEBM', 'error'); return; }
  if (file.size > MAX_MB * 1024 * 1024) { showToast(`File too large (max ${MAX_MB}MB)`, 'error'); return; }

  DN.upload.active   = true;
  DN.upload.progress = 0;
  DN.upload.name     = file.name;
  renderUploadProgress(0, file.name);

  try {
    const formData = new FormData();
    formData.append('video', file);

    // XHR so we can track progress
    const result = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/distribution/upload');
      xhr.withCredentials = true;

      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          DN.upload.progress = pct;
          renderUploadProgress(pct, file.name);
        }
      });

      xhr.addEventListener('load', () => {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Upload response parse error')); }
      });
      xhr.addEventListener('error', () => reject(new Error('Upload failed')));
      xhr.send(formData);
    });

    if (!result.ok) throw new Error(result.error || 'Upload failed');

    DN.upload.active = false;
    DN.compose.videoKey = result.key;
    applyVideoUrl(result.url, file.name);
    showToast(`${file.name} uploaded ✓`, 'success');
    renderUploadProgress(100, file.name, true);
  } catch (err) {
    DN.upload.active = false;
    showToast('Upload failed: ' + err.message, 'error');
    renderUploadProgress(0, file.name, false, err.message);
  }
}

function renderUploadProgress(pct, name, done = false, errMsg = null) {
  const el = $('dn-upload-progress');
  if (!el) return;
  if (errMsg) {
    el.innerHTML = `<div class="dn-upload-err">✗ ${escHtml(errMsg)}</div>`;
    el.style.display = 'block';
    return;
  }
  if (done) {
    el.innerHTML = `<div class="dn-upload-done">✓ Uploaded — ready to post</div>`;
    el.style.display = 'block';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = `
    <div class="dn-upload-filename">${escHtml(name)}</div>
    <div class="dn-upload-bar-wrap">
      <div class="dn-upload-bar" style="width:${pct}%"></div>
    </div>
    <div class="dn-upload-pct">${pct}%</div>`;
}

/* ════════════════════════════════════════════════════════════════
   COMPOSE — VIDEO
   ════════════════════════════════════════════════════════════════ */
function applyVideoUrl(url, label) {
  DN.compose.videoUrl = url;
  const preview = $('dn-video-preview');
  const player  = $('dn-video-player');
  const input   = $('dn-video-url');
  const fileNameEl = $('dn-video-filename');
  if (player) player.src = url;
  if (preview) preview.style.display = 'block';
  if (input && !label) input.value = url;
  if (fileNameEl) fileNameEl.textContent = label || '';
  updateReview();
  // Switch back to URL panel so preview is visible
  setVideoInputTab('url');
}

function clearVideo() {
  DN.compose.videoUrl    = '';
  DN.compose.videoKey    = '';
  DN.compose.projectId   = null;
  DN.compose.projectName = '';
  const preview = $('dn-video-preview');
  const player  = $('dn-video-player');
  const input   = $('dn-video-url');
  const fileNameEl = $('dn-video-filename');
  const upProg  = $('dn-upload-progress');
  const fileInput = $('dn-file-input');
  if (player) player.src = '';
  if (preview) preview.style.display = 'none';
  if (input)  input.value = '';
  if (fileNameEl) fileNameEl.textContent = '';
  if (upProg) { upProg.style.display = 'none'; upProg.innerHTML = ''; }
  if (fileInput) fileInput.value = '';
  updateReview();
}

/* ── Project picker ──────────────────────────────────────────── */
async function openProjectPicker() {
  const picker = $('dn-project-picker');
  const list   = $('dn-picker-list');
  if (!picker || !list) return;
  picker.style.display = 'flex';
  list.innerHTML = '<div class="dn-picker-loading">Loading projects…</div>';
  try {
    const res  = await api('GET', '/api/projects');
    const data = await res.json();
    const projects = data.projects || [];
    if (!projects.length) { list.innerHTML = '<div class="dn-picker-loading">No projects found</div>'; return; }
    const shotsPerProject = await Promise.all(
      projects.slice(0, 20).map(async p => {
        try {
          const r = await api('GET', `/api/projects/${p.id}/shots`);
          const d = await r.json();
          return { project: p, shots: (d.shots||[]).filter(s => s.status==='completed' && s.video_url) };
        } catch { return { project: p, shots: [] }; }
      })
    );
    const allShots = shotsPerProject.flatMap(({ project, shots }) =>
      shots.map(s => ({ ...s, project_name: project.name, project_id: project.id }))
    );
    if (!allShots.length) { list.innerHTML = '<div class="dn-picker-loading">No completed shots found</div>'; return; }
    list.innerHTML = allShots.slice(0, 50).map(shot => `
      <div class="dn-picker-shot"
        data-video="${escHtml(shot.video_url)}"
        data-project-id="${shot.project_id}"
        data-project-name="${escHtml(shot.project_name)}"
        data-prompt="${escHtml(shot.prompt||'')}">
        <video class="dn-picker-shot-thumb" src="${escHtml(shot.video_url)}" muted preload="metadata"></video>
        <div class="dn-picker-shot-info">
          <div class="dn-picker-shot-project">${escHtml(shot.project_name)}</div>
          <div class="dn-picker-shot-prompt">${escHtml((shot.prompt||'').slice(0,80))}${(shot.prompt||'').length>80?'…':''}</div>
        </div>
      </div>`).join('');
    list.querySelectorAll('.dn-picker-shot').forEach(el => {
      el.addEventListener('click', () => {
        DN.compose.projectId   = el.dataset.projectId;
        DN.compose.projectName = el.dataset.projectName;
        if (el.dataset.prompt && $('dn-concept-input'))
          $('dn-concept-input').value = el.dataset.prompt;
        applyVideoUrl(el.dataset.video);
        closeProjectPicker();
        showToast('Shot loaded ✓', 'success');
      });
    });
  } catch (err) {
    list.innerHTML = `<div class="dn-picker-loading">Error: ${escHtml(err.message)}</div>`;
  }
}

function closeProjectPicker() {
  const picker = $('dn-project-picker');
  if (picker) picker.style.display = 'none';
}

/* ════════════════════════════════════════════════════════════════
   COMPOSE — PLATFORMS
   ════════════════════════════════════════════════════════════════ */
function updatePlatformToggles() {
  $$('.dn-platform-toggle').forEach(btn => {
    const platform = btn.dataset.platform;
    const acct = DN.accounts.find(a => a.platform === platform);
    if (acct) {
      btn.disabled = false;
      const sub = btn.querySelector('.dn-platform-toggle-sub');
      if (sub) sub.textContent = platform === 'instagram' ? `@${acct.handle}` : acct.handle;
    } else {
      btn.disabled = true;
      const sub = btn.querySelector('.dn-platform-toggle-sub');
      if (sub) sub.textContent = 'Not connected';
    }
  });
  const anyConnected = DN.accounts.length > 0;
  const promptEl = $('dn-connect-prompt');
  if (promptEl) promptEl.style.display = anyConnected ? 'none' : 'inline-flex';
}

function togglePlatform(platform) {
  const idx = DN.compose.platforms.indexOf(platform);
  const btn = document.querySelector(`.dn-platform-toggle[data-platform="${platform}"]`);
  if (idx === -1) {
    DN.compose.platforms.push(platform);
    btn?.classList.add('selected');
    $(`caption-block-${platform}`) && ($(`caption-block-${platform}`).style.display = 'flex');
  } else {
    DN.compose.platforms.splice(idx, 1);
    btn?.classList.remove('selected');
    $(`caption-block-${platform}`) && ($(`caption-block-${platform}`).style.display = 'none');
  }
  updateReview();
  renderSmartTimes();
}

/* ════════════════════════════════════════════════════════════════
   COMPOSE — CAPTION GENERATION + A/B
   ════════════════════════════════════════════════════════════════ */
function setActiveAB(variant) {
  DN.compose.igActiveAB = variant;
  $('btn-ab-a')?.classList.toggle('active', variant === 'A');
  $('btn-ab-b')?.classList.toggle('active', variant === 'B');
  $('panel-ab-a') && ($('panel-ab-a').style.display = variant === 'A' ? 'block' : 'none');
  $('panel-ab-b') && ($('panel-ab-b').style.display = variant === 'B' ? 'block' : 'none');
}

async function generateCaption() {
  const concept = $('dn-concept-input')?.value.trim() || '';
  if (!concept) { showToast('Enter a video concept first', 'error'); return; }
  if (!DN.compose.platforms.length) { showToast('Select at least one platform', 'error'); return; }

  const btn = $('btn-gen-caption');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="dn-spin"></span> Generating…`; }

  try {
    // Generate 2x for Instagram (A/B), 1x for YouTube
    const requests = [];
    DN.compose.platforms.forEach(platform => {
      requests.push(api('POST', '/api/distribution/caption', {
        platform, prompt: concept, style_preset: '', duration_sec: 30,
      }).then(r => r.json().then(d => ({ platform, variant: 'A', ...d }))));
      if (platform === 'instagram') {
        // Second generation for B variant — slightly different style hint
        requests.push(api('POST', '/api/distribution/caption', {
          platform, prompt: concept + ' (alternative hook)', style_preset: '', duration_sec: 30,
        }).then(r => r.json().then(d => ({ platform, variant: 'B', ...d }))));
      }
    });

    const results = await Promise.all(requests);

    results.forEach(result => {
      if (result.platform === 'instagram') {
        if (result.variant === 'A') {
          const ta = $('dn-ig-caption-a');
          if (ta) ta.value = result.caption || '';
          DN.compose.igCaptionA = result.caption || '';
          DN.compose.igHashtags = result.hashtags || [];
          updateIgCharCount('a');
          renderHashtags('ig-hashtag-row', result.hashtags || [], 'instagram');
        } else {
          const ta = $('dn-ig-caption-b');
          if (ta) ta.value = result.caption || '';
          DN.compose.igCaptionB = result.caption || '';
        }
      }
      if (result.platform === 'youtube' && result.variant === 'A') {
        const titleEl = $('dn-yt-title');
        if (titleEl) titleEl.value = result.title || '';
        DN.compose.ytTitle = result.title || '';
        const descEl = $('dn-yt-description');
        if (descEl) descEl.value = result.description || '';
        DN.compose.ytDesc = result.description || '';
        DN.compose.ytTags = result.tags || [];
        renderHashtags('yt-tag-row', result.tags || [], 'youtube');
      }
    });

    // Show B variant tab if IG selected
    if (DN.compose.platforms.includes('instagram')) {
      $('dn-ab-tabs') && ($('dn-ab-tabs').style.display = 'flex');
      setActiveAB('A');
    }
    showToast('Captions generated ✓', 'success');
  } catch (err) {
    showToast('Caption generation failed: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Generate`;
    }
  }
}

function renderHashtags(containerId, tags, platform) {
  const el = $(containerId);
  if (!el || !tags.length) return;
  el.innerHTML = tags.slice(0, 30).map(tag => {
    const clean = tag.replace(/^#/, '');
    return `<span class="dn-hashtag-chip" data-tag="${escHtml(clean)}">#${escHtml(clean)}</span>`;
  }).join('');
  el.querySelectorAll('.dn-hashtag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.remove();
      if (platform === 'instagram') DN.compose.igHashtags = DN.compose.igHashtags.filter(t => t !== chip.dataset.tag);
      else DN.compose.ytTags = DN.compose.ytTags.filter(t => t !== chip.dataset.tag);
    });
  });
}

function updateIgCharCount(variant = 'a') {
  const ta    = $(`dn-ig-caption-${variant}`);
  const count = $(`ig-char-count-${variant}`);
  if (!ta || !count) return;
  const len = ta.value.length;
  count.textContent = `${len}/2200`;
  count.style.color = len > 2200 ? 'var(--red)' : len > 2000 ? 'var(--yellow)' : 'var(--ice-muted)';
  if (variant === 'a') DN.compose.igCaptionA = ta.value;
  else DN.compose.igCaptionB = ta.value;
}

/* ════════════════════════════════════════════════════════════════
   COMPOSE — TIMING
   ════════════════════════════════════════════════════════════════ */
function setTiming(timing) {
  DN.compose.timing = timing;
  $$('.dn-timing-btn').forEach(b => b.classList.toggle('active', b.dataset.timing === timing));
  const picker = $('dn-schedule-picker');
  if (picker) picker.style.display = timing === 'schedule' ? 'block' : 'none';
  if (timing === 'now') DN.compose.scheduledAt = null;
  updateReview();
}

function renderSmartTimes() {
  const container = $('dn-smart-chips');
  if (!container) return;
  const platforms = DN.compose.platforms.length > 0 ? DN.compose.platforms : ['instagram', 'youtube'];
  const seen = new Set(), chips = [];
  platforms.forEach(p => {
    (OPTIMAL_TIMES[p] || []).forEach(t => {
      if (!seen.has(t.label)) { seen.add(t.label); chips.push(t); }
    });
  });
  container.innerHTML = chips.slice(0, 6).map(t => {
    const d = t.value();
    return `<button class="dn-smart-chip" data-iso="${d.toISOString()}">${t.label}</button>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════════
   COMPOSE — REVIEW
   ════════════════════════════════════════════════════════════════ */
function updateReview() {
  const rvVideo     = $('rv-video');
  const rvPlatforms = $('rv-platforms');
  const rvTiming    = $('rv-timing');
  const fireLabel   = $('btn-fire-label');

  if (rvVideo) {
    rvVideo.textContent = DN.compose.projectName || (DN.compose.videoKey ? DN.upload.name || 'Uploaded file' : DN.compose.videoUrl ? 'Custom URL' : '—');
  }
  if (rvPlatforms) rvPlatforms.textContent = DN.compose.platforms.length > 0 ? DN.compose.platforms.join(' + ') : '—';
  if (rvTiming) {
    rvTiming.textContent = DN.compose.timing === 'now'
      ? 'Post Now'
      : DN.compose.scheduledAt ? formatDateTime(DN.compose.scheduledAt) : 'Pick a time above';
  }
  if (fireLabel) fireLabel.textContent = DN.compose.timing === 'now' ? 'Post Now' : 'Schedule Post';
}

/* ════════════════════════════════════════════════════════════════
   COMPOSE — FIRE
   ════════════════════════════════════════════════════════════════ */
async function firePost() {
  const noteEl = $('dn-fire-note');
  const btn    = $('btn-fire-post');

  if (!DN.compose.videoUrl) {
    if (noteEl) { noteEl.textContent = 'Add a video first.'; noteEl.className = 'dn-fire-note error'; }
    return;
  }
  if (!DN.compose.platforms.length) {
    if (noteEl) { noteEl.textContent = 'Select at least one platform.'; noteEl.className = 'dn-fire-note error'; }
    return;
  }
  if (DN.compose.timing === 'schedule' && !DN.compose.scheduledAt) {
    if (noteEl) { noteEl.textContent = 'Pick a scheduled time.'; noteEl.className = 'dn-fire-note error'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="dn-spin"></span> Scheduling…`; }
  if (noteEl) { noteEl.textContent = ''; noteEl.className = 'dn-fire-note'; }

  const errors = [], success = [];

  for (const platform of DN.compose.platforms) {
    const acct = DN.accounts.find(a => a.platform === platform);
    if (!acct) { errors.push(`${platform}: account not connected`); continue; }

    // Use active A/B variant for Instagram
    const caption = platform === 'instagram'
      ? (DN.compose.igActiveAB === 'B'
          ? ($('dn-ig-caption-b')?.value || DN.compose.igCaptionB || '')
          : ($('dn-ig-caption-a')?.value || DN.compose.igCaptionA || ''))
      : ($('dn-yt-description')?.value || DN.compose.ytDesc || '');

    const title    = platform === 'youtube' ? ($('dn-yt-title')?.value || DN.compose.ytTitle || '') : undefined;
    const tags     = platform === 'youtube'   ? DN.compose.ytTags     : undefined;
    const hashtags = platform === 'instagram' ? DN.compose.igHashtags : undefined;

    try {
      const res = await api('POST', '/api/distribution/schedule', {
        project_id:   DN.compose.projectId || null,
        account_id:   acct.id,
        platform,
        video_url:    DN.compose.videoUrl,
        caption, title, tags, hashtags,
        scheduled_at: DN.compose.timing === 'schedule' ? DN.compose.scheduledAt : null,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Schedule failed');
      success.push(platform);
    } catch (err) {
      errors.push(`${platform}: ${err.message}`);
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg><span id="btn-fire-label">${DN.compose.timing === 'now' ? 'Post Now' : 'Schedule Post'}</span>`;
  }

  if (success.length > 0 && errors.length === 0) {
    if (noteEl) {
      noteEl.textContent = success.length === 1
        ? `${success[0]} ${DN.compose.timing === 'now' ? 'queued' : 'scheduled'} ✓`
        : `Posted to ${success.join(' + ')} ✓`;
      noteEl.className = 'dn-fire-note success';
    }
    showToast('Post scheduled ✓', 'success');
    await loadQueue();
    setTimeout(() => switchTab('queue'), 1200);
  } else if (errors.length > 0) {
    if (noteEl) { noteEl.textContent = errors.join(' · '); noteEl.className = 'dn-fire-note error'; }
    showToast('Some posts failed', 'error');
  }
}

/* ════════════════════════════════════════════════════════════════
   BATCH MODE
   ════════════════════════════════════════════════════════════════ */
function selectDripTemplate(tmpl) {
  DN.batch.template  = tmpl;
  const t = DRIP_TEMPLATES[tmpl] || DRIP_TEMPLATES.daily;
  DN.batch.dripHours = t.hours;

  $$('.dn-drip-template-btn').forEach(b => b.classList.toggle('active', b.dataset.template === tmpl));

  const descEl   = $('dn-drip-desc');
  const customEl = $('dn-batch-custom-row');
  if (descEl) descEl.textContent = t.desc;
  if (customEl) customEl.style.display = tmpl === 'custom' ? 'flex' : 'none';
  updateBatchPreview();
}

function openBatchFilePicker() {
  // Create ephemeral input
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v';
  inp.multiple = true;
  inp.addEventListener('change', async () => {
    const files = Array.from(inp.files || []);
    for (const file of files) {
      await addBatchFile(file);
    }
  });
  inp.click();
}

async function addBatchFile(file) {
  const ALLOWED = ['video/mp4','video/quicktime','video/webm','video/x-m4v','video/x-msvideo'];
  if (!ALLOWED.includes(file.type)) { showToast(`${file.name}: unsupported format`, 'error'); return; }
  if (file.size > 500 * 1024 * 1024) { showToast(`${file.name}: too large (max 500MB)`, 'error'); return; }

  const idx = DN.batch.items.length;
  DN.batch.items.push({ videoUrl: '', videoKey: '', name: file.name, platforms: ['instagram'], concept: '', uploading: true });
  renderBatchList();

  try {
    const formData = new FormData();
    formData.append('video', file);
    const res    = await fetch('/api/distribution/upload', { method: 'POST', credentials: 'include', body: formData });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || 'Upload failed');
    DN.batch.items[idx].videoUrl  = result.url;
    DN.batch.items[idx].videoKey  = result.key;
    DN.batch.items[idx].uploading = false;
    showToast(`${file.name} ready ✓`, 'success');
  } catch (err) {
    DN.batch.items.splice(idx, 1);
    showToast(`${file.name}: ${err.message}`, 'error');
  }
  renderBatchList();
  updateBatchPreview();
}

function removeBatchItem(idx) {
  DN.batch.items.splice(idx, 1);
  renderBatchList();
  updateBatchPreview();
}

function toggleBatchItemPlatform(idx, platform) {
  const item = DN.batch.items[idx];
  if (!item) return;
  const i = item.platforms.indexOf(platform);
  if (i === -1) item.platforms.push(platform);
  else item.platforms.splice(i, 1);
  renderBatchList();
}

function renderBatchList() {
  const el = $('dn-batch-list');
  if (!el) return;

  if (!DN.batch.items.length) {
    el.innerHTML = `<div class="dn-batch-empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
      <p>No videos yet — click Add Videos or drag files below</p>
    </div>`;
    return;
  }

  el.innerHTML = DN.batch.items.map((item, idx) => {
    const igSel = item.platforms.includes('instagram');
    const ytSel = item.platforms.includes('youtube');
    return `
    <div class="dn-batch-item${item.uploading ? ' uploading' : ''}">
      <div class="dn-batch-item-thumb">
        ${item.videoUrl ? `<video src="${escHtml(item.videoUrl)}" muted preload="metadata"></video>` : `<div class="dn-batch-uploading-indicator"><span class="dn-spin"></span></div>`}
      </div>
      <div class="dn-batch-item-body">
        <div class="dn-batch-item-name">${escHtml(item.name)}</div>
        <div class="dn-batch-item-platforms">
          <button class="dn-batch-platform-btn instagram${igSel?' selected':''}" data-batch-index="${idx}" data-batch-platform="instagram">IG</button>
          <button class="dn-batch-platform-btn youtube${ytSel?' selected':''}" data-batch-index="${idx}" data-batch-platform="youtube">YT</button>
        </div>
        <input class="dn-input dn-input-sm" placeholder="Concept / prompt (for caption gen)" value="${escHtml(item.concept)}"
          oninput="DN.batch.items[${idx}].concept=this.value"/>
      </div>
      <button class="dn-batch-remove" data-batch-remove="${idx}" title="Remove">✕</button>
    </div>`;
  }).join('');
}

function updateBatchPreview() {
  const el = $('dn-batch-preview');
  if (!el) return;
  const items = DN.batch.items.filter(i => !i.uploading && i.videoUrl);
  if (!items.length) { el.innerHTML = ''; return; }

  const t = DRIP_TEMPLATES[DN.batch.template] || DRIP_TEMPLATES.daily;
  let d = new Date();
  el.innerHTML = items.map((item, idx) => {
    const dt = new Date(d.getTime() + idx * DN.batch.dripHours * 3600000);
    return `<div class="dn-batch-preview-row">
      <span class="dn-batch-preview-num">${idx+1}</span>
      <span class="dn-batch-preview-name">${escHtml(item.name.slice(0,30))}</span>
      <span class="dn-batch-preview-plat">${item.platforms.map(p=>p==='instagram'?'IG':'YT').join('+')}</span>
      <span class="dn-batch-preview-time">${formatDateTime(dt.toISOString())}</span>
    </div>`;
  }).join('');
}

async function fireBatch() {
  const btn = $('btn-batch-fire');
  const items = DN.batch.items.filter(i => !i.uploading && i.videoUrl && i.platforms.length > 0);

  if (!items.length) { showToast('Add at least one video with a platform selected', 'error'); return; }

  const missingAccounts = new Set();
  items.forEach(item => {
    item.platforms.forEach(p => {
      if (!DN.accounts.find(a => a.platform === p)) missingAccounts.add(p);
    });
  });
  if (missingAccounts.size > 0) {
    showToast(`Connect accounts first: ${[...missingAccounts].join(', ')}`, 'error');
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="dn-spin"></span> Scheduling batch…`; }

  try {
    // Generate captions for all items in parallel
    const captionedItems = await Promise.all(items.flatMap(item =>
      item.platforms.map(async platform => {
        const acct = DN.accounts.find(a => a.platform === platform);
        let caption = '', title = '', tags = [], hashtags = [];
        if (item.concept) {
          try {
            const res = await api('POST', '/api/distribution/caption', {
              platform, prompt: item.concept, style_preset: '', duration_sec: 30,
            });
            const d = await res.json();
            if (platform === 'instagram') { caption = d.caption || ''; hashtags = d.hashtags || []; }
            else { title = d.title || ''; caption = d.description || ''; tags = d.tags || []; }
          } catch {}
        }
        return {
          account_id: acct.id,
          platform,
          video_url: item.videoUrl,
          caption,
          title: title || undefined,
          tags:  tags.length ? tags : undefined,
          hashtags: hashtags.length ? hashtags : undefined,
        };
      })
    ));

    const res  = await api('POST', '/api/distribution/batch', {
      items:      captionedItems,
      drip_hours: DN.batch.dripHours,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Batch failed');

    showToast(`Batch of ${data.count} posts scheduled ✓`, 'success', 5000);
    DN.batch.items = [];
    renderBatchList();
    updateBatchPreview();
    await loadQueue();
    setTimeout(() => switchTab('queue'), 1500);
  } catch (err) {
    showToast('Batch failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>Schedule Batch`; }
  }
}
