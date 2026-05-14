/* ════════════════════════════════════════════════════════════════
   SPECTRA — DISTRIBUTION ENGINE  v1.0
   /tools/distribution/
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
  if (abs < 60000)      return future ? 'in a moment'     : 'just now';
  if (abs < 3600000)    return future ? `in ${Math.round(abs/60000)}m` : `${Math.round(abs/60000)}m ago`;
  if (abs < 86400000)   return future ? `in ${Math.round(abs/3600000)}h` : `${Math.round(abs/3600000)}h ago`;
  return future ? `in ${Math.round(abs/86400000)}d` : `${Math.round(abs/86400000)}d ago`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function showToast(msg, type = 'info', duration = 3000) {
  const el = $('dn-toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = `dn-toast show ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'dn-toast'; }, duration);
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res;
}

/* ── STATE ────────────────────────────────────────────────────── */
const DN = {
  user:         null,          // { email, tier }
  accounts:     [],            // connected social accounts
  queue:        [],            // distribution posts
  activeTab:    'queue',
  activeFilter: 'all',
  compose: {
    videoUrl:    '',
    projectId:   null,
    projectName: '',
    platforms:   [],           // ['instagram','youtube']
    concept:     '',
    igCaption:   '',
    igHashtags:  [],
    ytTitle:     '',
    ytDesc:      '',
    ytTags:      [],
    timing:      'now',
    scheduledAt: null,
  },
};

/* ── OPTIMAL POST TIMES (best-practice, platform-specific) ───── */
const OPTIMAL_TIMES = {
  instagram: [
    { label: 'Mon 11am',  value: () => nextWeekday(1, 11, 0) },
    { label: 'Wed 1pm',   value: () => nextWeekday(3, 13, 0) },
    { label: 'Fri 9am',   value: () => nextWeekday(5, 9, 0)  },
    { label: 'Sat 10am',  value: () => nextWeekday(6, 10, 0) },
  ],
  youtube: [
    { label: 'Tue 2pm',   value: () => nextWeekday(2, 14, 0) },
    { label: 'Thu 3pm',   value: () => nextWeekday(4, 15, 0) },
    { label: 'Sat 12pm',  value: () => nextWeekday(6, 12, 0) },
    { label: 'Sun 11am',  value: () => nextWeekday(0, 11, 0) },
  ],
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
  // Check auth
  try {
    const res = await api('GET', '/api/me');
    if (!res.ok) { showAuthGate(); return; }
    const data = await res.json();
    DN.user = data;
    $('dn-user-email').textContent = data.email || '';
  } catch {
    showAuthGate();
    return;
  }

  $('dn-auth-gate').style.display = 'none';
  $('dn-app').style.display = 'block';

  bindUI();
  await Promise.all([loadAccounts(), loadQueue()]);

  // Check if launched from Video Generator with a project pre-selected
  const params = new URLSearchParams(location.search);
  const preProjectId   = params.get('project_id');
  const preVideoUrl    = params.get('video_url');
  const preProjectName = params.get('project_name') || '';
  if (preVideoUrl || preProjectId) {
    switchTab('new');
    if (preVideoUrl) {
      DN.compose.videoUrl    = preVideoUrl;
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
  const email    = $('dn-auth-email')?.value?.trim() || '';
  const password = $('dn-auth-pass')?.value || '';
  const errEl    = $('dn-auth-err');
  const btn      = $('dn-auth-submit');

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
  // Tabs
  $$('.dn-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Queue filter
  $$('.dn-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.dn-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      DN.activeFilter = btn.dataset.filter;
      renderQueue();
    });
  });

  // Refresh queue
  $('btn-refresh-queue')?.addEventListener('click', () => loadQueue());

  // OAuth connect buttons
  $$('.dn-btn-connect').forEach(btn => {
    btn.addEventListener('click', () => startOAuth(btn.dataset.platform));
  });

  // Disconnect buttons
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
    setTimeout(() => {
      const url = e.target.value.trim();
      if (url) applyVideoUrl(url);
    }, 50);
  });

  // From Project picker
  $('btn-load-from-project')?.addEventListener('click', openProjectPicker);
  $('btn-close-picker')?.addEventListener('click', closeProjectPicker);
  $('dn-project-picker')?.addEventListener('click', e => {
    if (e.target === $('dn-project-picker')) closeProjectPicker();
  });

  // Clear video
  $('btn-clear-video')?.addEventListener('click', clearVideo);

  // Platform toggles
  $$('.dn-platform-toggle').forEach(btn => {
    btn.addEventListener('click', () => togglePlatform(btn.dataset.platform));
  });

  // Generate caption
  $('btn-gen-caption')?.addEventListener('click', generateCaption);

  // Caption char count
  $('dn-ig-caption')?.addEventListener('input', updateIgCharCount);

  // Timing buttons
  $$('.dn-timing-btn').forEach(btn => {
    btn.addEventListener('click', () => setTiming(btn.dataset.timing));
  });

  // Schedule datetime
  $('dn-scheduled-at')?.addEventListener('change', e => {
    DN.compose.scheduledAt = e.target.value ? new Date(e.target.value).toISOString() : null;
    updateReview();
  });

  // Fire post
  $('btn-fire-post')?.addEventListener('click', firePost);

  // Smart time chips — rendered dynamically, delegate
  $('dn-smart-chips')?.addEventListener('click', e => {
    const chip = e.target.closest('.dn-smart-chip');
    if (!chip) return;
    const iso = chip.dataset.iso;
    if (iso) {
      const d = new Date(iso);
      $('dn-scheduled-at').value = toLocalDatetimeInput(d);
      DN.compose.scheduledAt = d.toISOString();
      setTiming('schedule');
      updateReview();
    }
  });

  // Retry / cancel — delegated on queue list
  $('dn-queue-list')?.addEventListener('click', async e => {
    const retry  = e.target.closest('[data-retry-id]');
    const cancel = e.target.closest('[data-cancel-id]');
    const pull   = e.target.closest('[data-pull-id]');
    if (retry)  await retryPost(retry.dataset.retryId);
    if (cancel) await cancelPost(cancel.dataset.cancelId);
    if (pull)   await pullMetrics(pull.dataset.pullId);
  });

  renderSmartTimes();
}

/* ════════════════════════════════════════════════════════════════
   TABS
   ════════════════════════════════════════════════════════════════ */
function switchTab(tab) {
  DN.activeTab = tab;
  $$('.dn-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.dn-panel').forEach(p => p.classList.toggle('active', p.id === `dn-panel-${tab}`));
}

/* ════════════════════════════════════════════════════════════════
   ACCOUNTS
   ════════════════════════════════════════════════════════════════ */
async function loadAccounts() {
  try {
    const res  = await api('GET', '/api/distribution/accounts');
    const data = await res.json();
    DN.accounts = data.accounts || [];
    renderAccounts();
  } catch (err) {
    showToast('Could not load accounts: ' + err.message, 'error');
  }
}

function renderAccounts() {
  const count = DN.accounts.length;
  $('dn-accounts-count').textContent = count;

  ['instagram', 'youtube'].forEach(platform => {
    const acct = DN.accounts.find(a => a.platform === platform);
    const card  = $(`card-${platform}`);
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

  // Update platform toggles in compose
  updatePlatformToggles();
}

/* ── OAuth connect ───────────────────────────────────────────── */
async function startOAuth(platform) {
  let clientId, clientSecret, redirectUri;

  if (platform === 'instagram') {
    clientId     = $('ig-client-id')?.value.trim();
    clientSecret = $('ig-client-secret')?.value.trim();
    redirectUri  = $('ig-redirect-uri')?.value.trim();
  } else if (platform === 'youtube') {
    clientId     = $('yt-client-id')?.value.trim();
    clientSecret = $('yt-client-secret')?.value.trim();
    redirectUri  = $('yt-redirect-uri')?.value.trim();
  }

  if (!clientId || !redirectUri) {
    showToast(`Enter App ID / Client ID and Redirect URI first`, 'error');
    return;
  }

  const btn = document.querySelector(`.dn-btn-connect[data-platform="${platform}"]`);
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="dn-spin"></span> Opening…`; }

  try {
    const res  = await api('POST', '/api/distribution/accounts/connect', {
      platform, client_id: clientId, redirect_uri: redirectUri,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get auth URL');

    // Store client_secret in sessionStorage so callback page can retrieve it if needed
    // (For Cloudflare Workers: client_secret must be stored as env var INSTAGRAM_CLIENT_SECRET / YOUTUBE_CLIENT_SECRET)
    sessionStorage.setItem(`${platform}_client_secret`, clientSecret || '');

    // Open OAuth popup
    const popup = window.open(data.auth_url, 'spectra_oauth', 'width=540,height=680,scrollbars=yes');

    // Listen for postMessage from callback
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

    // Cleanup if popup closes without message
    const pollClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(pollClosed);
        window.removeEventListener('message', handler);
      }
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
  if (!confirm(`Disconnect ${platform}? Any scheduled posts for this account will fail.`)) return;
  try {
    await api('DELETE', `/api/distribution/accounts/${acct.id}`);
    showToast(`${platform} disconnected`, 'info');
    await loadAccounts();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ════════════════════════════════════════════════════════════════
   QUEUE
   ════════════════════════════════════════════════════════════════ */
async function loadQueue() {
  try {
    const res  = await api('GET', '/api/distribution/queue');
    const data = await res.json();
    DN.queue = data.posts || [];
    renderQueue();
  } catch (err) {
    showToast('Could not load queue: ' + err.message, 'error');
  }
}

function renderQueue() {
  const listEl  = $('dn-queue-list');
  const emptyEl = $('dn-queue-empty');
  if (!listEl) return;

  const filtered = DN.activeFilter === 'all'
    ? DN.queue
    : DN.queue.filter(p => p.status === DN.activeFilter);

  // Badge counts
  const scheduled = DN.queue.filter(p => p.status === 'scheduled' || p.status === 'posting').length;
  $('dn-queue-count').textContent = scheduled || DN.queue.length;

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML = filtered.map(post => renderQueueCard(post)).join('');
}

function renderQueueCard(post) {
  const platformIcon = post.platform === 'instagram'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg>`;

  const timingLine = post.status === 'posted'
    ? `Posted ${relativeTime(post.posted_at)}`
    : post.status === 'scheduled' && post.scheduled_at
    ? `Scheduled for ${formatDateTime(post.scheduled_at)}`
    : post.status === 'posting'
    ? `Publishing now…`
    : post.status === 'failed'
    ? ''
    : post.status === 'cancelled'
    ? 'Cancelled'
    : '';

  const metrics24 = (post.views_24h != null)
    ? `<div class="dn-qcard-metrics">
        <div class="dn-qcard-metric"><span class="dn-qcard-metric-val">${fmtNum(post.views_24h)}</span><span class="dn-qcard-metric-label">Views</span></div>
        <div class="dn-qcard-metric"><span class="dn-qcard-metric-val">${fmtNum(post.likes_24h||0)}</span><span class="dn-qcard-metric-label">Likes</span></div>
        ${post.views_72h != null ? `<div class="dn-qcard-metric"><span class="dn-qcard-metric-val">${fmtNum(post.views_72h)}</span><span class="dn-qcard-metric-label">72h Views</span></div>` : ''}
       </div>`
    : '';

  const actions = [];
  if (post.status === 'scheduled' || post.status === 'posting') {
    actions.push(`<button class="dn-btn-sm danger" data-cancel-id="${post.id}">Cancel</button>`);
  }
  if (post.status === 'failed' && (post.retry_count || 0) < 3) {
    actions.push(`<button class="dn-btn-sm retry" data-retry-id="${post.id}">Retry</button>`);
  }
  if (post.status === 'posted' && post.views_24h == null) {
    actions.push(`<button class="dn-btn-sm" data-pull-id="${post.id}" title="Pull 24h metrics">Pull Metrics</button>`);
  }

  const caption = post.title || post.caption || '';

  return `
  <div class="dn-queue-card status-${post.status}">
    <div class="dn-qcard-thumb">
      <video src="${escHtml(post.video_url)}" muted preload="metadata" style="pointer-events:none"></video>
    </div>
    <div class="dn-qcard-body">
      <div class="dn-qcard-top">
        <span class="dn-qcard-platform-badge ${post.platform}">${platformIcon} ${post.platform}</span>
        <span class="dn-qcard-status-badge ${post.status}">${post.status}</span>
        ${post.account_handle ? `<span class="dn-qcard-project">${post.platform === 'instagram' ? '@' : ''}${escHtml(post.account_handle)}</span>` : ''}
      </div>
      ${caption ? `<div class="dn-qcard-caption">${escHtml(caption.slice(0,100))}${caption.length>100?'…':''}</div>` : ''}
      ${post.project_name ? `<div class="dn-qcard-timing" style="margin-top:0.15rem">Project: ${escHtml(post.project_name)}</div>` : ''}
      ${timingLine ? `<div class="dn-qcard-timing">${timingLine}</div>` : ''}
      ${post.error_message ? `<div class="dn-qcard-error">Error: ${escHtml(post.error_message)}</div>` : ''}
      ${metrics24}
    </div>
    <div class="dn-qcard-actions">
      ${actions.join('')}
    </div>
  </div>`;
}

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n/1000).toFixed(1) + 'K';
  return String(n);
}

async function retryPost(postId) {
  try {
    const res = await api('POST', `/api/distribution/queue/${postId}/retry`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Retrying post…', 'info');
    await loadQueue();
  } catch (err) { showToast(err.message, 'error'); }
}

async function cancelPost(postId) {
  if (!confirm('Cancel this scheduled post?')) return;
  try {
    const res  = await api('DELETE', `/api/distribution/queue/${postId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Post cancelled', 'info');
    await loadQueue();
  } catch (err) { showToast(err.message, 'error'); }
}

async function pullMetrics(postId) {
  const btn = document.querySelector(`[data-pull-id="${postId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Pulling…'; }
  try {
    const res  = await api('POST', `/api/distribution/metrics/${postId}/pull`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Metrics updated ✓', 'success');
    await loadQueue();
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Pull Metrics'; }
  }
}

/* ════════════════════════════════════════════════════════════════
   COMPOSE — VIDEO
   ════════════════════════════════════════════════════════════════ */
function applyVideoUrl(url) {
  DN.compose.videoUrl = url;
  const preview = $('dn-video-preview');
  const player  = $('dn-video-player');
  const input   = $('dn-video-url');
  if (player) { player.src = url; }
  if (preview) preview.style.display = 'block';
  if (input)  input.value = url;
  updateReview();
}

function clearVideo() {
  DN.compose.videoUrl    = '';
  DN.compose.projectId   = null;
  DN.compose.projectName = '';
  const preview = $('dn-video-preview');
  const player  = $('dn-video-player');
  const input   = $('dn-video-url');
  if (player) player.src = '';
  if (preview) preview.style.display = 'none';
  if (input)  input.value = '';
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
    // Fetch projects with completed shots
    const res  = await api('GET', '/api/projects');
    const data = await res.json();
    const projects = data.projects || [];

    if (projects.length === 0) {
      list.innerHTML = '<div class="dn-picker-loading">No projects found</div>';
      return;
    }

    // Fetch shots for each project to find completed ones with video URLs
    // For performance: load shots for all projects in parallel
    const shotsPerProject = await Promise.all(
      projects.slice(0, 20).map(async p => {
        try {
          const r = await api('GET', `/api/projects/${p.id}/shots`);
          const d = await r.json();
          return { project: p, shots: (d.shots || []).filter(s => s.status === 'completed' && s.video_url) };
        } catch { return { project: p, shots: [] }; }
      })
    );

    const allShots = shotsPerProject.flatMap(({ project, shots }) =>
      shots.map(s => ({ ...s, project_name: project.name, project_id: project.id }))
    );

    if (allShots.length === 0) {
      list.innerHTML = '<div class="dn-picker-loading">No completed shots with video URLs found</div>';
      return;
    }

    list.innerHTML = allShots.slice(0, 50).map(shot => `
      <div class="dn-picker-shot" data-video="${escHtml(shot.video_url)}" data-project-id="${shot.project_id}" data-project-name="${escHtml(shot.project_name)}" data-prompt="${escHtml(shot.prompt||'')}">
        <video class="dn-picker-shot-thumb" src="${escHtml(shot.video_url)}" muted preload="metadata"></video>
        <div class="dn-picker-shot-info">
          <div class="dn-picker-shot-project">${escHtml(shot.project_name)}</div>
          <div class="dn-picker-shot-prompt">${escHtml((shot.prompt||'').slice(0,80))}${(shot.prompt||'').length>80?'…':''}</div>
        </div>
      </div>`).join('');

    // Bind clicks
    list.querySelectorAll('.dn-picker-shot').forEach(el => {
      el.addEventListener('click', () => {
        const videoUrl   = el.dataset.video;
        const projectId  = el.dataset.projectId;
        const projectName= el.dataset.projectName;
        const prompt     = el.dataset.prompt;
        DN.compose.projectId   = projectId;
        DN.compose.projectName = projectName;
        // Pre-fill concept from shot prompt
        if (prompt && $('dn-concept-input')) $('dn-concept-input').value = prompt;
        applyVideoUrl(videoUrl);
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

  // Show/hide connect prompt
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
    // Show caption block
    $(`caption-block-${platform}`)?.style && ($(`caption-block-${platform}`).style.display = 'flex');
  } else {
    DN.compose.platforms.splice(idx, 1);
    btn?.classList.remove('selected');
    $(`caption-block-${platform}`)?.style && ($(`caption-block-${platform}`).style.display = 'none');
  }
  updateReview();
  renderSmartTimes();
}

/* ════════════════════════════════════════════════════════════════
   COMPOSE — CAPTION GENERATION
   ════════════════════════════════════════════════════════════════ */
async function generateCaption() {
  const concept  = $('dn-concept-input')?.value.trim() || '';
  if (!concept) { showToast('Enter a video concept first', 'error'); return; }
  if (DN.compose.platforms.length === 0) { showToast('Select at least one platform first', 'error'); return; }

  const btn = $('btn-gen-caption');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="dn-spin"></span> Generating…`; }

  try {
    // Generate for all selected platforms in parallel
    const results = await Promise.all(
      DN.compose.platforms.map(platform =>
        api('POST', '/api/distribution/caption', {
          platform,
          prompt:       concept,
          style_preset: '',
          duration_sec: 30,
        }).then(r => r.json().then(d => ({ platform, ...d })))
      )
    );

    results.forEach(result => {
      if (result.platform === 'instagram') {
        if (result.caption) {
          const ta = $('dn-ig-caption');
          if (ta) ta.value = result.caption;
          DN.compose.igCaption  = result.caption;
          DN.compose.igHashtags = result.hashtags || [];
          updateIgCharCount();
          renderHashtags('ig-hashtag-row', result.hashtags || [], 'instagram');
        }
      }
      if (result.platform === 'youtube') {
        if (result.title) {
          const titleEl = $('dn-yt-title');
          if (titleEl) titleEl.value = result.title;
          DN.compose.ytTitle = result.title;
        }
        if (result.description) {
          const descEl = $('dn-yt-description');
          if (descEl) descEl.value = result.description;
          DN.compose.ytDesc = result.description;
        }
        DN.compose.ytTags = result.tags || [];
        renderHashtags('yt-tag-row', result.tags || [], 'youtube');
      }
    });

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
    return `<span class="dn-hashtag-chip" title="Click to remove" data-tag="${escHtml(clean)}">#${escHtml(clean)}</span>`;
  }).join('');

  // Click to remove tag
  el.querySelectorAll('.dn-hashtag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.remove();
      if (platform === 'instagram') {
        DN.compose.igHashtags = DN.compose.igHashtags.filter(t => t !== chip.dataset.tag);
      } else {
        DN.compose.ytTags = DN.compose.ytTags.filter(t => t !== chip.dataset.tag);
      }
    });
  });
}

function updateIgCharCount() {
  const ta    = $('dn-ig-caption');
  const count = $('ig-char-count');
  if (!ta || !count) return;
  const len = ta.value.length;
  count.textContent = `${len}/2200`;
  count.style.color = len > 2200 ? 'var(--red)' : len > 2000 ? 'var(--yellow)' : 'var(--ice-muted)';
  DN.compose.igCaption = ta.value;
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

  // Merge optimal times for selected platforms
  const platforms = DN.compose.platforms.length > 0
    ? DN.compose.platforms
    : ['instagram', 'youtube'];

  const seen  = new Set();
  const chips = [];

  platforms.forEach(p => {
    (OPTIMAL_TIMES[p] || []).forEach(t => {
      if (!seen.has(t.label)) {
        seen.add(t.label);
        chips.push(t);
      }
    });
  });

  container.innerHTML = chips.slice(0, 6).map(t => {
    const d   = t.value();
    const iso = d.toISOString();
    return `<button class="dn-smart-chip" data-iso="${iso}">${t.label}</button>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════════
   COMPOSE — REVIEW
   ════════════════════════════════════════════════════════════════ */
function updateReview() {
  const rvVideo = $('rv-video');
  const rvPlatforms = $('rv-platforms');
  const rvTiming    = $('rv-timing');
  const fireLabel   = $('btn-fire-label');

  if (rvVideo) {
    rvVideo.textContent = DN.compose.projectName
      ? DN.compose.projectName
      : DN.compose.videoUrl
      ? 'Custom URL'
      : '—';
  }

  if (rvPlatforms) {
    rvPlatforms.textContent = DN.compose.platforms.length > 0
      ? DN.compose.platforms.join(' + ')
      : '—';
  }

  if (rvTiming) {
    rvTiming.textContent = DN.compose.timing === 'now'
      ? 'Post Now'
      : DN.compose.scheduledAt
      ? `${formatDateTime(DN.compose.scheduledAt)}`
      : 'Schedule (select time above)';
  }

  if (fireLabel) {
    fireLabel.textContent = DN.compose.timing === 'now' ? 'Post Now' : 'Schedule Post';
  }
}

/* ════════════════════════════════════════════════════════════════
   COMPOSE — FIRE
   ════════════════════════════════════════════════════════════════ */
async function firePost() {
  const noteEl = $('dn-fire-note');
  const btn    = $('btn-fire-post');

  // Validate
  if (!DN.compose.videoUrl) {
    if (noteEl) { noteEl.textContent = 'Add a video URL first.'; noteEl.className = 'dn-fire-note error'; }
    return;
  }
  if (DN.compose.platforms.length === 0) {
    if (noteEl) { noteEl.textContent = 'Select at least one platform.'; noteEl.className = 'dn-fire-note error'; }
    return;
  }
  if (DN.compose.timing === 'schedule' && !DN.compose.scheduledAt) {
    if (noteEl) { noteEl.textContent = 'Pick a scheduled time.'; noteEl.className = 'dn-fire-note error'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="dn-spin"></span> Scheduling…`; }
  if (noteEl) { noteEl.textContent = ''; noteEl.className = 'dn-fire-note'; }

  const errors  = [];
  const success = [];

  // Fire one post per selected platform
  for (const platform of DN.compose.platforms) {
    const acct = DN.accounts.find(a => a.platform === platform);
    if (!acct) { errors.push(`${platform}: account not connected`); continue; }

    const caption = platform === 'instagram'
      ? ($('dn-ig-caption')?.value || DN.compose.igCaption || '')
      : ($('dn-yt-description')?.value || DN.compose.ytDesc || '');

    const title = platform === 'youtube'
      ? ($('dn-yt-title')?.value || DN.compose.ytTitle || '')
      : undefined;

    const tags     = platform === 'youtube'  ? DN.compose.ytTags     : undefined;
    const hashtags = platform === 'instagram'? DN.compose.igHashtags : undefined;

    try {
      const res  = await api('POST', '/api/distribution/schedule', {
        project_id:   DN.compose.projectId || null,
        account_id:   acct.id,
        platform,
        video_url:    DN.compose.videoUrl,
        caption,
        title,
        tags,
        hashtags,
        scheduled_at: DN.compose.timing === 'schedule' ? DN.compose.scheduledAt : null,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Schedule failed');
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
        ? `${success[0]} post ${DN.compose.timing === 'now' ? 'queued for publishing' : 'scheduled'} ✓`
        : `Posted to ${success.join(' + ')} ✓`;
      noteEl.className = 'dn-fire-note success';
    }
    showToast('Post scheduled ✓', 'success');
    await loadQueue();
    // Optionally switch to queue tab after 1s
    setTimeout(() => switchTab('queue'), 1200);
  } else if (errors.length > 0) {
    if (noteEl) {
      noteEl.textContent = errors.join(' · ');
      noteEl.className = 'dn-fire-note error';
    }
    showToast('Some posts failed — see details above', 'error');
  }
}
