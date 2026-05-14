/* ════════════════════════════════════════════════════════════════
   SPECTRA — DISTRIBUTION SCHEDULER WORKER
   Runs every 5 minutes via Cloudflare Cron Trigger.
   Polls distribution_posts for due scheduled items and publishes.
   Deploy separately: cd workers && npx wrangler deploy
   ════════════════════════════════════════════════════════════════ */

interface Env {
  DB:             D1Database
  ENCRYPTION_KEY: string
}

// ── WEB CRYPTO HELPERS (mirror of main app) ───────────────────────
async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt'])
}

async function decryptKey(encrypted: string, iv: string, base64Key: string): Promise<string> {
  const key     = await importKey(base64Key)
  const encData = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
  const ivData  = Uint8Array.from(atob(iv),        c => c.charCodeAt(0))
  const dec     = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivData }, key, encData)
  return new TextDecoder().decode(dec)
}

// ── INSTAGRAM PUBLISH ─────────────────────────────────────────────
async function publishToInstagram(accessToken: string, post: any): Promise<string> {
  const igBase = 'https://graph.instagram.com/v21.0'

  const caption = [
    post.caption || '',
    post.hashtags ? JSON.parse(post.hashtags).map((h: string) => `#${h}`).join(' ') : '',
  ].filter(Boolean).join('\n\n')

  const createParams = new URLSearchParams({
    media_type:   'REELS',
    video_url:    post.video_url,
    caption:      caption,
    access_token: accessToken,
  })
  if (post.cover_url) createParams.set('cover_url', post.cover_url)

  const createRes  = await fetch(`${igBase}/me/media`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    createParams.toString(),
  })
  const createData: any = await createRes.json()
  if (!createData.id) {
    throw new Error(createData.error?.message || 'Instagram container creation failed')
  }

  // Poll until FINISHED
  const containerId = createData.id
  let ready = false
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(r => setTimeout(r, 5000))
    const statusRes  = await fetch(
      `${igBase}/${containerId}?fields=status_code&access_token=${accessToken}`
    )
    const statusData: any = await statusRes.json()
    if (statusData.status_code === 'FINISHED') { ready = true; break }
    if (statusData.status_code === 'ERROR') throw new Error('Instagram media processing failed')
  }
  if (!ready) throw new Error('Instagram media processing timed out')

  const publishRes  = await fetch(`${igBase}/me/media_publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ creation_id: containerId, access_token: accessToken }).toString(),
  })
  const publishData: any = await publishRes.json()
  if (!publishData.id) {
    throw new Error(publishData.error?.message || 'Instagram publish failed')
  }
  return publishData.id
}

// ── YOUTUBE PUBLISH ───────────────────────────────────────────────
async function publishToYouTube(accessToken: string, post: any): Promise<string> {
  const tags  = post.tags ? JSON.parse(post.tags) : []
  const title = post.title || post.caption?.slice(0, 60) || 'Spectra Video'

  const videoRes = await fetch(post.video_url)
  if (!videoRes.ok) throw new Error('Could not fetch video for YouTube upload')
  const videoBuffer = await videoRes.arrayBuffer()

  const boundary = '---spectra_yt_boundary'
  const metadata = JSON.stringify({
    snippet: {
      title:       title.slice(0, 100),
      description: post.caption || '',
      tags:        tags.slice(0, 500),
      categoryId:  '22',
    },
    status: {
      privacyStatus:           'public',
      selfDeclaredMadeForKids: false,
    },
  })

  const metaPart   = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
  const videoPart  = `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`
  const closing    = `\r\n--${boundary}--`

  const enc        = new TextEncoder()
  const metaBytes  = enc.encode(metaPart)
  const videoBytes = enc.encode(videoPart)
  const videoData  = new Uint8Array(videoBuffer)
  const closeBytes = enc.encode(closing)

  const body = new Uint8Array(metaBytes.length + videoBytes.length + videoData.length + closeBytes.length)
  let off = 0
  body.set(metaBytes,  off); off += metaBytes.length
  body.set(videoBytes, off); off += videoBytes.length
  body.set(videoData,  off); off += videoData.length
  body.set(closeBytes, off)

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status',
    {
      method:  'POST',
      headers: {
        'Authorization':  `Bearer ${accessToken}`,
        'Content-Type':   `multipart/related; boundary=${boundary}`,
        'Content-Length': body.length.toString(),
      },
      body,
    }
  )
  const uploadData: any = await uploadRes.json()
  if (!uploadData.id) {
    throw new Error(uploadData.error?.message || 'YouTube upload failed')
  }
  return uploadData.id
}

// ── CORE PUBLISH HELPER ───────────────────────────────────────────
async function publishPost(env: Env, postId: string): Promise<void> {
  const post = await env.DB.prepare(`
    SELECT dp.*, sa.access_token as enc_access, sa.refresh_token as enc_refresh,
           sa.platform as sa_platform, sa.account_id as sa_account_id
    FROM distribution_posts dp
    LEFT JOIN social_accounts sa ON dp.account_id = sa.id
    WHERE dp.id = ?
  `).bind(postId).first<any>()

  if (!post) return

  // Mark as in-flight so concurrent cron runs don't double-publish
  const claimed = await env.DB.prepare(`
    UPDATE distribution_posts
    SET status='posting', updated_at=datetime('now')
    WHERE id=? AND status='scheduled'
  `).bind(postId).run()

  // If no row was updated another cron run already claimed it
  if ((claimed.meta?.changes ?? 1) === 0) return

  try {
    let platformPostId: string | null = null
    const encAccessObj = JSON.parse(post.enc_access || '{}')
    const accessToken  = await decryptKey(
      encAccessObj.encrypted, encAccessObj.iv, env.ENCRYPTION_KEY
    )

    if (post.platform === 'instagram') {
      platformPostId = await publishToInstagram(accessToken, post)
    } else if (post.platform === 'youtube') {
      platformPostId = await publishToYouTube(accessToken, post)
    }

    await env.DB.prepare(`
      UPDATE distribution_posts
      SET status='posted', platform_post_id=?, posted_at=datetime('now'), updated_at=datetime('now')
      WHERE id=?
    `).bind(platformPostId, postId).run()
  } catch (err: any) {
    const retryCount = (post.retry_count || 0) + 1
    await env.DB.prepare(`
      UPDATE distribution_posts
      SET status='failed', error_message=?, retry_count=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(err.message || 'Unknown publish error', retryCount, postId).run()
  }
}

// ── SCHEDULED HANDLER ─────────────────────────────────────────────
async function handleScheduled(env: Env): Promise<void> {
  // Fetch up to 20 posts due right now (scheduled_at <= now, status = 'scheduled')
  const due = await env.DB.prepare(`
    SELECT id FROM distribution_posts
    WHERE status = 'scheduled'
      AND scheduled_at <= datetime('now')
    ORDER BY scheduled_at ASC
    LIMIT 20
  `).all<{ id: string }>()

  if (!due.results || due.results.length === 0) return

  console.log(`[Spectra Scheduler] Firing ${due.results.length} due post(s)`)

  // Publish concurrently (each is independently error-handled)
  await Promise.allSettled(
    due.results.map(row => publishPost(env, row.id))
  )
}

// ── WORKER EXPORT ─────────────────────────────────────────────────
export default {
  // Cron trigger entry point — fires every 5 minutes
  async scheduled(
    _event:   ScheduledEvent,
    env:      Env,
    _ctx:     ExecutionContext
  ): Promise<void> {
    await handleScheduled(env)
  },

  // HTTP fetch handler (health check / manual trigger for testing)
  async fetch(
    request: Request,
    env:     Env,
    _ctx:    ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, worker: 'spectra-scheduler' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Manual trigger endpoint (protect with a simple bearer check in prod)
    if (url.pathname === '/trigger' && request.method === 'POST') {
      try {
        await handleScheduled(env)
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Spectra Scheduler Worker', { status: 200 })
  },
}
