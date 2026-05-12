import { Hono } from 'hono'
import { cors } from 'hono/cors'
import OpenAI from 'openai'

/* ── Cloudflare env bindings ─────────────────────────────────────── */
type Bindings = {
  OPENAI_API_KEY:   string
  OPENAI_BASE_URL:  string
  YOUTUBE_API_KEY:  string
  FB_ACCESS_TOKEN:  string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

// NOTE: Cloudflare Pages serves public/ automatically at root.
// No explicit static routes needed — /static/*, /favicon.svg etc.
// are handled by the Pages CDN directly from the public/ directory.

/* ── AI Client (Cloudflare Workers compatible) ───────────────────── */
function getAIClient(env: Bindings): OpenAI {
  return new OpenAI({
    apiKey:  env?.OPENAI_API_KEY  || '',
    baseURL: env?.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  })
}

/* ══════════════════════════════════════════════════════════════════
   PLATFORM WEIGHT PRESETS
   Weights reflect how each platform's algorithm actually values signals.
   These are calibrated to 2024-2025 platform priorities.
══════════════════════════════════════════════════════════════════ */
const PLATFORM_WEIGHTS: Record<string, Record<string, number>> = {
  tiktok: {
    watch_time:    0.32,  // completion rate is #1 signal
    shares:        0.22,  // virality is rewarded heavily
    comments:      0.18,  // conversation = boost
    likes:         0.14,
    saves:         0.08,
    views:         0.06,
  },
  instagram: {
    saves:         0.26,  // saves = high-intent, algo loves it
    shares:        0.22,  // DM shares especially
    watch_time:    0.20,
    comments:      0.16,
    likes:         0.10,
    views:         0.06,
  },
  youtube: {
    watch_time:    0.35,  // #1 on YouTube
    comments:      0.20,
    likes:         0.18,
    shares:        0.14,
    saves:         0.08,  // playlist adds
    views:         0.05,
  },
  twitter: {
    shares:        0.30,  // retweets/reposts drive reach
    comments:      0.24,  // quote tweets = gold
    likes:         0.18,
    watch_time:    0.16,
    saves:         0.08,
    views:         0.04,
  },
  facebook: {
    shares:        0.28,
    comments:      0.24,
    watch_time:    0.20,
    likes:         0.14,
    saves:         0.08,
    views:         0.06,
  },
  ads: {
    watch_time:    0.30,  // completion = ad quality
    views:         0.20,  // reach
    likes:         0.18,
    shares:        0.14,
    comments:      0.12,
    saves:         0.06,
  },
}

/* ── Weighted composite score ────────────────────────────────────── */
function computeWeightedScore(metrics: any, platform: string): Record<string, number> {
  const weights = PLATFORM_WEIGHTS[platform] || PLATFORM_WEIGHTS.tiktok
  const {
    views = 0, likes = 0, comments = 0, shares = 0,
    saves = 0, watch_time_pct = 0,
  } = metrics

  // Normalize each signal 0-100
  const likeRate    = views > 0 ? Math.min((likes    / views) * 100 * 20, 100) : 0
  const commentRate = views > 0 ? Math.min((comments / views) * 100 * 40, 100) : 0
  const shareRate   = views > 0 ? Math.min((shares   / views) * 100 * 50, 100) : 0
  const saveRate    = views > 0 ? Math.min((saves    / views) * 100 * 60, 100) : 0
  const wtScore     = Math.min(watch_time_pct, 100)
  const viewScore   = Math.min(views / 1000, 100)

  const raw: Record<string, number> = {
    likes:     likeRate,
    comments:  commentRate,
    shares:    shareRate,
    saves:     saveRate,
    watch_time: wtScore,
    views:     viewScore,
  }

  // Weighted composite
  let composite = 0
  for (const [k, w] of Object.entries(weights)) {
    composite += (raw[k] || 0) * w
  }

  return {
    composite:    Math.round(composite),
    like_score:   Math.round(likeRate),
    comment_score: Math.round(commentRate),
    share_score:  Math.round(shareRate),
    save_score:   Math.round(saveRate),
    watch_score:  Math.round(wtScore),
    view_score:   Math.round(viewScore),
  }
}

/* ── Build timeline segments from duration + drop-off data ───────── */
function buildSegments(duration_sec: number, dropoff_points: number[]): any[] {
  const segCount = Math.min(Math.max(Math.ceil(duration_sec / 5), 4), 20)
  const segLen   = duration_sec / segCount
  const segs     = []

  for (let i = 0; i < segCount; i++) {
    const tStart = Math.round(i * segLen)
    const tEnd   = Math.round((i + 1) * segLen)
    // Retention curve: natural decay + sharp drops at specified points
    let retention = Math.max(100 - (i / segCount) * 35 - Math.random() * 8, 10)
    const isDropoff = dropoff_points.some(dp => dp >= tStart && dp <= tEnd)
    if (isDropoff) retention = Math.max(retention - 25 - Math.random() * 15, 5)
    segs.push({
      index: i,
      start: tStart,
      end:   tEnd,
      label: `${tStart}s–${tEnd}s`,
      retention: Math.round(retention),
      is_dropoff: isDropoff,
      severity: isDropoff ? (retention < 30 ? 'critical' : 'warning') : 'normal',
    })
  }
  return segs
}

/* ══════════════════════════════════════════════════════════════════
   API: POST /api/attention/analyze  (streaming SSE)
══════════════════════════════════════════════════════════════════ */
app.post('/api/attention/analyze', async (c) => {
  try {
    const body = await c.req.json()
    const {
      platform = 'tiktok',
      content_url = '',
      content_description = '',
      duration_sec = 60,
      metrics = {},
      dropoff_points = [],
      hook_text = '',
      script_excerpt = '',
    } = body

    const scores  = computeWeightedScore(metrics, platform)
    const segments = buildSegments(duration_sec, dropoff_points)
    const weights  = PLATFORM_WEIGHTS[platform] || PLATFORM_WEIGHTS.tiktok

    const systemPrompt = `You are Spectra's Attention Engine — an elite content performance analyst for Pano Marketing.
You analyze social media content with surgical precision, identifying exactly why audiences disengage and exactly how to fix it.
Your analysis is always:
- Data-driven: reference the actual metrics and scores provided
- Specific: name exact timestamps, exact phrases, exact structural issues
- Actionable: every problem you identify must come with a concrete fix
- Platform-aware: your recommendations reflect how ${platform.toUpperCase()}'s algorithm actually works in 2025
- Culturally calibrated: you understand what hooks, pacing, and structures perform on ${platform} right now

Output format: You must return a valid JSON object with this exact structure:
{
  "diagnosis": {
    "hook_effectiveness": { "score": 0-100, "verdict": "string", "reasoning": "string", "fix": "string" },
    "pacing": { "score": 0-100, "verdict": "string", "reasoning": "string", "fix": "string" },
    "visual_engagement": { "score": 0-100, "verdict": "string", "reasoning": "string", "fix": "string" },
    "messaging_clarity": { "score": 0-100, "verdict": "string", "reasoning": "string", "fix": "string" },
    "emotional_impact": { "score": 0-100, "verdict": "string", "reasoning": "string", "fix": "string" },
    "cta_strength": { "score": 0-100, "verdict": "string", "reasoning": "string", "fix": "string" }
  },
  "dropoff_analysis": [
    { "timestamp": "string", "cause": "string", "severity": "critical|warning", "fix": "string" }
  ],
  "top_issues": ["string", "string", "string"],
  "top_strengths": ["string", "string"],
  "optimization_plan": [
    { "priority": 1-5, "action": "string", "impact": "High|Medium|Low", "effort": "Low|Medium|High", "detail": "string" }
  ],
  "platform_insights": { "algorithm_note": "string", "trend_alignment": "string", "posting_recommendation": "string" },
  "overall_verdict": "string"
}`

    const userPrompt = `Analyze this ${platform.toUpperCase()} content:

CONTENT URL: ${content_url || 'Not provided'}
CONTENT DESCRIPTION: ${content_description || 'Not provided'}
HOOK TEXT: ${hook_text || 'Not provided'}
SCRIPT EXCERPT: ${script_excerpt || 'Not provided'}
DURATION: ${duration_sec} seconds

PERFORMANCE METRICS:
- Views: ${metrics.views || 0}
- Likes: ${metrics.likes || 0}
- Comments: ${metrics.comments || 0}
- Shares: ${metrics.shares || 0}
- Saves: ${metrics.saves || 0}
- Watch Time %: ${metrics.watch_time_pct || 0}%

WEIGHTED SCORES (${platform} algorithm weights applied):
- Composite Score: ${scores.composite}/100
- Watch Time Score: ${scores.watch_score}/100
- Share Score: ${scores.share_score}/100
- Comment Score: ${scores.comment_score}/100
- Like Score: ${scores.like_score}/100
- Save Score: ${scores.save_score}/100

PLATFORM WEIGHT PROFILE for ${platform}:
${Object.entries(weights).map(([k,v]) => `- ${k}: ${(v*100).toFixed(0)}%`).join('\n')}

DROP-OFF POINTS DETECTED: ${dropoff_points.length > 0 ? dropoff_points.map(p => `${p}s`).join(', ') : 'None specified'}

TIMELINE SEGMENTS:
${segments.map(s => `[${s.label}] Retention: ${s.retention}% ${s.is_dropoff ? '⚠️ DROP-OFF' : ''}`).join('\n')}

Provide a complete analysis. Be brutally honest and highly specific.`

    const ai = getAIClient(c.env)
    const stream = await ai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      stream: true,
      temperature: 0.4,
      max_tokens: 2800,
    })

    // Stream response as SSE, prepend metadata
    const metaChunk = JSON.stringify({ type: 'meta', scores, segments, platform, weights })
    return new Response(
      new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder()
          controller.enqueue(enc.encode(`data: ${metaChunk}\n\n`))
          let buffer = ''
          for await (const chunk of stream) {
            const txt = chunk.choices[0]?.delta?.content || ''
            buffer += txt
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'token', text: txt })}\n\n`))
          }
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done', full: buffer })}\n\n`))
          controller.close()
        }
      }),
      { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } }
    )
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   API: POST /api/attention/rewrite  (streaming SSE)
══════════════════════════════════════════════════════════════════ */
app.post('/api/attention/rewrite', async (c) => {
  try {
    const body = await c.req.json()
    const { platform = 'tiktok', hook_text = '', script_excerpt = '', issues = [], target_audience = '', tone = 'engaging' } = body

    const systemPrompt = `You are Spectra's Script Rewrite Engine — a world-class copywriter who specializes in high-converting social media scripts for ${platform.toUpperCase()}.
You write hooks that stop the scroll, scripts that hold attention, and CTAs that convert.
You understand the cultural language, trends, and content styles that perform on ${platform} in 2025.

Output format — return valid JSON:
{
  "hooks": [
    { "version": 1, "text": "string", "strategy": "string", "why_it_works": "string" },
    { "version": 2, "text": "string", "strategy": "string", "why_it_works": "string" },
    { "version": 3, "text": "string", "strategy": "string", "why_it_works": "string" }
  ],
  "script_rewrites": [
    { "version": 1, "title": "string", "script": "string", "structure": "string", "tone": "string" },
    { "version": 2, "title": "string", "script": "string", "structure": "string", "tone": "string" }
  ],
  "pattern_interrupts": ["string", "string", "string"],
  "cta_options": ["string", "string", "string"],
  "storytelling_framework": { "name": "string", "structure": ["string"], "example_applied": "string" },
  "platform_notes": "string"
}`

    const userPrompt = `Rewrite this ${platform} content for maximum performance:

ORIGINAL HOOK: ${hook_text || 'Not provided'}
ORIGINAL SCRIPT: ${script_excerpt || 'Not provided'}
IDENTIFIED ISSUES: ${issues.join(', ') || 'General optimization'}
TARGET AUDIENCE: ${target_audience || 'General'}
DESIRED TONE: ${tone}

Generate 3 killer hook variations, 2 full script rewrites, pattern interrupt ideas, and CTA options. Make them native to ${platform}'s culture and format.`

    const ai = getAIClient(c.env)
    const stream = await ai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      stream: true,
      temperature: 0.7,
      max_tokens: 2500,
    })

    return new Response(
      new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder()
          let buffer = ''
          for await (const chunk of stream) {
            const txt = chunk.choices[0]?.delta?.content || ''
            buffer += txt
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'token', text: txt })}\n\n`))
          }
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done', full: buffer })}\n\n`))
          controller.close()
        }
      }),
      { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } }
    )
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   API: POST /api/attention/score  (instant JSON)
══════════════════════════════════════════════════════════════════ */
app.post('/api/attention/score', async (c) => {
  try {
    const body = await c.req.json()
    const { platform = 'tiktok', metrics = {}, duration_sec = 60, dropoff_points = [] } = body
    const scores   = computeWeightedScore(metrics, platform)
    const segments = buildSegments(duration_sec, dropoff_points)
    const weights  = PLATFORM_WEIGHTS[platform]

    // Derived scores
    const hookScore       = dropoff_points.some(d => d <= 5) ? Math.max(scores.composite - 30, 10) : Math.min(scores.watch_score + 15, 100)
    const retentionScore  = Math.round(segments.reduce((a,s) => a + s.retention, 0) / segments.length)
    const engagementScore = Math.round((scores.like_score + scores.comment_score + scores.share_score + scores.save_score) / 4)
    const viralScore      = Math.round((scores.share_score * (platform === 'tiktok' ? 1.3 : 1.0) + scores.comment_score * 0.8) / 2)

    return c.json({
      platform,
      weights,
      scores: {
        composite:   scores.composite,
        hook:        Math.min(hookScore, 100),
        retention:   retentionScore,
        engagement:  engagementScore,
        viral:       Math.min(viralScore, 100),
        watch_time:  scores.watch_score,
        shareability: scores.share_score,
      },
      segments,
      signal_breakdown: {
        likes:     { raw: metrics.likes || 0,    score: scores.like_score,    weight: weights?.likes || 0 },
        comments:  { raw: metrics.comments || 0, score: scores.comment_score, weight: weights?.comments || 0 },
        shares:    { raw: metrics.shares || 0,   score: scores.share_score,   weight: weights?.shares || 0 },
        saves:     { raw: metrics.saves || 0,    score: scores.save_score,    weight: weights?.saves || 0 },
        watch_time:{ raw: metrics.watch_time_pct || 0, score: scores.watch_score, weight: weights?.watch_time || 0 },
        views:     { raw: metrics.views || 0,    score: scores.view_score,    weight: weights?.views || 0 },
      },
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   API: GET /api/fetch-url  — auto-populate metrics from a content URL
   Supports: YouTube (public), Instagram (token), Facebook (token)
══════════════════════════════════════════════════════════════════ */
app.get('/api/fetch-url', async (c) => {
  const url    = c.req.query('url') || ''
  const ytKey  = c.req.query('yt_key') || c.env.YOUTUBE_API_KEY || ''
  const fbToken = c.req.query('fb_token') || c.env.FB_ACCESS_TOKEN || ''

  if (!url) return c.json({ error: 'No URL provided' }, 400)

  // ── YouTube ──────────────────────────────────────────────────────
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  if (ytMatch) {
    const videoId = ytMatch[1]
    if (!ytKey) return c.json({ error: 'YouTube API key required', platform: 'youtube', needs_key: true }, 200)
    try {
      const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${ytKey}&part=snippet,statistics,contentDetails`
      const res = await fetch(apiUrl)
      const data: any = await res.json()
      if (!data.items?.length) return c.json({ error: 'Video not found', platform: 'youtube' }, 200)
      const item = data.items[0]
      const stats = item.statistics || {}
      const snippet = item.snippet || {}
      // Parse ISO 8601 duration (PT1M30S → 90s)
      const dur = item.contentDetails?.duration || 'PT0S'
      const durMatch = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
      const durSec = (parseInt(durMatch?.[1]||'0')*3600) + (parseInt(durMatch?.[2]||'0')*60) + parseInt(durMatch?.[3]||'0')
      return c.json({
        platform:     'youtube',
        title:        snippet.title || '',
        channel:      snippet.channelTitle || '',
        thumbnail:    snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
        published:    snippet.publishedAt || '',
        duration_sec: durSec,
        metrics: {
          views:           parseInt(stats.viewCount   || '0'),
          likes:           parseInt(stats.likeCount   || '0'),
          comments:        parseInt(stats.commentCount|| '0'),
          shares:          0,   // YouTube API does not expose shares
          saves:           0,   // YouTube API does not expose saves/playlists
          watch_time_pct:  0,   // Only available in YouTube Studio (private)
        },
        notes: 'Shares, saves, and watch time % are not available via the public YouTube API. Enter manually.',
      })
    } catch (err: any) {
      return c.json({ error: err.message, platform: 'youtube' }, 500)
    }
  }

  // ── Instagram Reel / Post ─────────────────────────────────────────
  const igMatch = url.match(/instagram\.com\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/)
  if (igMatch) {
    if (!fbToken) return c.json({ error: 'Facebook/Instagram access token required', platform: 'instagram', needs_key: true }, 200)
    try {
      // Step 1: resolve shortcode to media ID via oEmbed (no auth needed for basic info)
      const oembedUrl = `https://graph.facebook.com/v19.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${fbToken}`
      const oRes = await fetch(oembedUrl)
      const oData: any = await oRes.json()

      // Step 2: search user's media for this post by shortcode
      const meUrl = `https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account&access_token=${fbToken}`
      const meRes = await fetch(meUrl)
      const meData: any = await meRes.json()

      return c.json({
        platform:  'instagram',
        title:     oData.title || oData.author_name || '',
        thumbnail: oData.thumbnail_url || '',
        author:    oData.author_name || '',
        metrics: {
          views:          0,
          likes:          0,
          comments:       0,
          shares:         0,
          saves:          0,
          watch_time_pct: 0,
        },
        notes: 'To get full Instagram metrics (likes, comments, saves, reach) you need to connect your Instagram Business Account. Basic info loaded from oEmbed.',
        oembed: oData,
      })
    } catch (err: any) {
      return c.json({ error: err.message, platform: 'instagram' }, 500)
    }
  }

  // ── Facebook Video ────────────────────────────────────────────────
  const fbMatch = url.match(/facebook\.com\/(?:watch\/?\?v=|.*\/videos\/)(\d+)/)
  if (fbMatch) {
    const videoId = fbMatch[1]
    if (!fbToken) return c.json({ error: 'Facebook access token required', platform: 'facebook', needs_key: true }, 200)
    try {
      const fbUrl = `https://graph.facebook.com/v19.0/${videoId}?fields=title,description,length,views,likes.limit(0).summary(true),comments.limit(0).summary(true),shares&access_token=${fbToken}`
      const res = await fetch(fbUrl)
      const data: any = await res.json()
      if (data.error) return c.json({ error: data.error.message, platform: 'facebook' }, 200)
      return c.json({
        platform:     'facebook',
        title:        data.title || data.description?.slice(0,80) || '',
        duration_sec: Math.round(data.length || 0),
        metrics: {
          views:          parseInt(data.views || '0'),
          likes:          data.likes?.summary?.total_count || 0,
          comments:       data.comments?.summary?.total_count || 0,
          shares:         data.shares?.count || 0,
          saves:          0,
          watch_time_pct: 0,
        },
        notes: 'Saves and watch time % are not available via the public Facebook Graph API.',
      })
    } catch (err: any) {
      return c.json({ error: err.message, platform: 'facebook' }, 500)
    }
  }

  // ── Unknown platform — return detection only ──────────────────────
  let detectedPlatform = 'unknown'
  if (url.includes('tiktok.com'))    detectedPlatform = 'tiktok'
  if (url.includes('twitter.com') || url.includes('x.com')) detectedPlatform = 'twitter'

  return c.json({
    platform: detectedPlatform,
    error: 'Auto-populate not available for this platform yet. Enter metrics manually.',
    needs_manual: true,
  })
})

/* ══════════════════════════════════════════════════════════════════
   TOOL ROUTES
══════════════════════════════════════════════════════════════════ */
app.get('/tools/attention-engine',  (c) => c.redirect('/tools/attention-engine/'))
app.get('/tools/attention-engine/', (c) => c.html(attentionEnginePage()))

app.get('/tools/video-generator',   (c) => c.redirect('/tools/video-generator/'))
app.get('/tools/video-generator/',  (c) => c.html(toolShell('Intelligent Video Generator', 'video', '#34D399')))
app.get('/tools/distribution-engine',  (c) => c.redirect('/tools/distribution-engine/'))
app.get('/tools/distribution-engine/', (c) => c.html(toolShell('Content Distribution Engine', 'distribution', '#60A5FA')))
app.get('/tools/motion-engine',  (c) => c.redirect('/tools/motion-engine/'))
app.get('/tools/motion-engine/', (c) => c.html(toolShell('Motion Composition Engine', 'motion', '#FB923C')))
app.get('/tools/persona-engine',  (c) => c.redirect('/tools/persona-engine/'))
app.get('/tools/persona-engine/', (c) => c.html(toolShell('Spectra Persona Engine', 'persona', '#F87171')))

app.get('/', (c) => c.html(landingPage()))

export default app

/* ══════════════════════════════════════════════════════════════════
   ATTENTION ENGINE PAGE
══════════════════════════════════════════════════════════════════ */
function attentionEnginePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Attention Engine — Spectra</title>
  <meta name="description" content="Intelligent content performance analysis. Drop-off detection, engagement scoring, and script optimization.">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/attention-engine.css"/>
</head>
<body>

<!-- NAV -->
<nav id="ae-nav">
  <a href="/" class="ae-nav-logo">
    <span class="ae-logo-mark">S</span>
    <span class="ae-logo-text">SPECTRA</span>
  </a>
  <div class="ae-nav-center">
    <span class="ae-tool-badge">
      <span class="ae-tool-pip"></span>
      Attention Engine
    </span>
  </div>
  <div class="ae-nav-right">
    <button class="ae-keys-btn" id="btn-open-keys" title="API Keys">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3"/><path d="M18 5l2 2"/></svg>
      API Keys
      <span class="ae-keys-status-dot" id="keys-status-dot"></span>
    </button>
    <a href="/" class="ae-nav-back">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Suite
    </a>
  </div>
</nav>

<!-- ═══ API KEYS DRAWER ════════════════════════════════════════════ -->
<div class="ae-drawer-overlay" id="keys-overlay"></div>
<aside class="ae-keys-drawer" id="keys-drawer" aria-label="API Keys Configuration">

  <div class="ae-drawer-header">
    <div class="ae-drawer-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3"/><path d="M18 5l2 2"/></svg>
      API Keys
    </div>
    <div class="ae-drawer-subtitle">Keys are stored in your browser only — never sent to our servers</div>
    <button class="ae-drawer-close" id="btn-close-keys">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  </div>

  <div class="ae-drawer-body">

    <!-- YOUTUBE -->
    <div class="ae-key-block" data-platform="youtube">
      <div class="ae-key-block-header">
        <div class="ae-key-block-icon" style="--kc:#F87171">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg>
        </div>
        <div class="ae-key-block-info">
          <div class="ae-key-block-name">YouTube Data API v3</div>
          <div class="ae-key-block-desc">Auto-fills title, duration, views, likes, comments from any YouTube URL</div>
        </div>
        <div class="ae-key-block-status" id="yt-status">
          <span class="ae-key-dot inactive"></span>
          <span class="ae-key-status-text">Not set</span>
        </div>
      </div>
      <div class="ae-key-input-row">
        <div class="ae-key-field">
          <input type="password" class="ae-key-input" id="key-youtube" placeholder="AIzaSy..." autocomplete="off" spellcheck="false"/>
          <button class="ae-key-toggle" data-target="key-youtube" title="Show/hide">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <button class="ae-key-save" data-key="youtube">Save</button>
      </div>
      <div class="ae-key-what-you-get">
        <div class="ae-kwg-title">What auto-populates</div>
        <div class="ae-kwg-tags">
          <span class="ae-kwg-tag available">Title</span>
          <span class="ae-kwg-tag available">Duration</span>
          <span class="ae-kwg-tag available">Views</span>
          <span class="ae-kwg-tag available">Likes</span>
          <span class="ae-kwg-tag available">Comments</span>
          <span class="ae-kwg-tag unavailable">Shares*</span>
          <span class="ae-kwg-tag unavailable">Watch Time*</span>
        </div>
        <div class="ae-kwg-note">* Not available via public API — enter manually</div>
      </div>
      <a class="ae-key-get-link" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Get free key → Google Cloud Console
      </a>
      <div class="ae-key-steps">
        <div class="ae-key-step"><span class="ae-step-num">1</span>Create or open a Google Cloud project</div>
        <div class="ae-key-step"><span class="ae-step-num">2</span>Enable <strong>YouTube Data API v3</strong></div>
        <div class="ae-key-step"><span class="ae-step-num">3</span>Go to Credentials → Create API Key</div>
        <div class="ae-key-step"><span class="ae-step-num">4</span>Paste it above and hit Save</div>
      </div>
    </div>

    <!-- INSTAGRAM / FACEBOOK -->
    <div class="ae-key-block" data-platform="meta">
      <div class="ae-key-block-header">
        <div class="ae-key-block-icon" style="--kc:#A78BFA">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>
        </div>
        <div class="ae-key-block-info">
          <div class="ae-key-block-name">Meta Graph API</div>
          <div class="ae-key-block-desc">Powers both Instagram and Facebook auto-population with one token</div>
        </div>
        <div class="ae-key-block-status" id="meta-status">
          <span class="ae-key-dot inactive"></span>
          <span class="ae-key-status-text">Not set</span>
        </div>
      </div>
      <div class="ae-key-input-row">
        <div class="ae-key-field">
          <input type="password" class="ae-key-input" id="key-meta" placeholder="EAAGm0P..." autocomplete="off" spellcheck="false"/>
          <button class="ae-key-toggle" data-target="key-meta" title="Show/hide">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <button class="ae-key-save" data-key="meta">Save</button>
      </div>

      <!-- Instagram what you get -->
      <div class="ae-kwg-platform-split">
        <div>
          <div class="ae-kwg-title" style="color:var(--c-orange)">Instagram</div>
          <div class="ae-kwg-tags">
            <span class="ae-kwg-tag available">Views</span>
            <span class="ae-kwg-tag available">Likes</span>
            <span class="ae-kwg-tag available">Comments</span>
            <span class="ae-kwg-tag available">Saves</span>
            <span class="ae-kwg-tag available">Reach</span>
            <span class="ae-kwg-tag unavailable">Watch Time*</span>
          </div>
        </div>
        <div>
          <div class="ae-kwg-title" style="color:var(--c-blue)">Facebook</div>
          <div class="ae-kwg-tags">
            <span class="ae-kwg-tag available">Views</span>
            <span class="ae-kwg-tag available">Likes</span>
            <span class="ae-kwg-tag available">Comments</span>
            <span class="ae-kwg-tag available">Shares</span>
            <span class="ae-kwg-tag unavailable">Saves*</span>
            <span class="ae-kwg-tag unavailable">Watch Time*</span>
          </div>
        </div>
      </div>
      <div class="ae-kwg-note">* Requires Business Account connected. Watch time only in Insights dashboard.</div>

      <a class="ae-key-get-link" href="https://developers.facebook.com/apps/" target="_blank" rel="noopener">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Get token → Meta Developer Portal
      </a>
      <div class="ae-key-steps">
        <div class="ae-key-step"><span class="ae-step-num">1</span>Create a <strong>Business</strong> app at developers.facebook.com</div>
        <div class="ae-key-step"><span class="ae-step-num">2</span>Add products: <strong>Instagram Graph API</strong> + <strong>Facebook Graph API</strong></div>
        <div class="ae-key-step"><span class="ae-step-num">3</span>Go to Tools → <strong>Graph API Explorer</strong></div>
        <div class="ae-key-step"><span class="ae-step-num">4</span>Generate a User Token with <strong>instagram_basic, pages_read_engagement</strong> permissions</div>
        <div class="ae-key-step"><span class="ae-step-num">5</span>Paste the token above and hit Save</div>
      </div>
    </div>

    <!-- TIKTOK (via Instagram API note) -->
    <div class="ae-key-block ae-key-block-inactive" data-platform="tiktok">
      <div class="ae-key-block-header">
        <div class="ae-key-block-icon" style="--kc:rgba(232,244,253,0.2)">
          <svg viewBox="0 0 24 24" fill="currentColor" style="opacity:0.35"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.75a4.85 4.85 0 01-1.01-.06z"/></svg>
        </div>
        <div class="ae-key-block-info">
          <div class="ae-key-block-name" style="opacity:0.4">TikTok</div>
          <div class="ae-key-block-desc" style="opacity:0.35">Available once Instagram is connected — TikTok uses the same Meta cross-posting pipeline</div>
        </div>
        <div class="ae-key-block-status">
          <span class="ae-key-dot" style="background:rgba(255,255,255,0.12)"></span>
          <span class="ae-key-status-text" style="opacity:0.35">Pending Instagram</span>
        </div>
      </div>
    </div>

    <!-- STATUS SUMMARY -->
    <div class="ae-keys-summary" id="keys-summary">
      <div class="ae-summary-title">Connection Status</div>
      <div class="ae-summary-row">
        <span class="ae-sum-label">YouTube</span>
        <span class="ae-sum-val" id="sum-youtube">—</span>
      </div>
      <div class="ae-summary-row">
        <span class="ae-sum-label">Instagram</span>
        <span class="ae-sum-val" id="sum-instagram">—</span>
      </div>
      <div class="ae-summary-row">
        <span class="ae-sum-label">Facebook</span>
        <span class="ae-sum-val" id="sum-facebook">—</span>
      </div>
    </div>

  </div><!-- /ae-drawer-body -->
</aside>

<!-- MAIN LAYOUT -->
<main id="ae-main">

  <!-- ═══ LEFT PANEL — INPUT ══════════════════════════════════════ -->
  <aside id="ae-input-panel">

    <!-- Platform selector -->
    <div class="ae-section">
      <div class="ae-section-label">Platform</div>
      <div class="ae-platform-grid" id="platform-grid">
        <button class="ae-platform-btn active" data-platform="tiktok">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.75a4.85 4.85 0 01-1.01-.06z"/></svg>
          TikTok
        </button>
        <button class="ae-platform-btn" data-platform="instagram">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>
          Instagram
        </button>
        <button class="ae-platform-btn" data-platform="youtube">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg>
          YouTube
        </button>
        <button class="ae-platform-btn" data-platform="twitter">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Twitter/X
        </button>
        <button class="ae-platform-btn" data-platform="facebook">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.024 4.388 11.02 10.125 11.927v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.254h3.328l-.532 3.49h-2.796v8.437C19.612 23.093 24 18.097 24 12.073z"/></svg>
          Facebook
        </button>
        <button class="ae-platform-btn" data-platform="ads">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 15l3-4 3 4 3-5"/></svg>
          Paid Ads
        </button>
      </div>
    </div>

    <!-- Content input -->
    <div class="ae-section">
      <div class="ae-section-label">Content Input</div>
      <div class="ae-input-tabs">
        <button class="ae-tab active" data-tab="url">URL / Link</button>
        <button class="ae-tab" data-tab="manual">Manual Entry</button>
      </div>

      <div class="ae-tab-content active" id="tab-url">
        <div class="ae-field">
          <label class="ae-label">Video / Post URL
            <span class="ae-url-fetch-spinner" id="url-spinner"></span>
          </label>
          <div class="ae-url-input-wrap">
            <svg class="ae-input-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13a3 3 0 100-6 3 3 0 000 6z"/><path d="M10 2C5.58 2 2 5.58 2 10s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8z"/></svg>
            <input type="url" id="content-url" class="ae-input" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off"/>
          </div>
          <!-- Preview strip shown after successful fetch -->
          <div class="ae-url-preview" id="url-preview">
            <img class="ae-url-preview-thumb" id="url-thumb" src="" alt=""/>
            <div class="ae-url-preview-info">
              <div class="ae-url-preview-title" id="url-preview-title"></div>
              <div class="ae-url-preview-meta" id="url-preview-meta"></div>
            </div>
          </div>
          <div id="url-fetch-note" style="display:none;font-size:0.68rem;color:var(--ice-dim);margin-top:0.4rem;font-style:italic;line-height:1.5"></div>
        </div>
        <div class="ae-field">
          <label class="ae-label">Hook / Opening Line</label>
          <input type="text" id="hook-text" class="ae-input" placeholder="First 3 seconds of your content..."/>
        </div>
      </div>

      <div class="ae-tab-content" id="tab-manual">
        <div class="ae-field">
          <label class="ae-label">Content Description</label>
          <textarea id="content-desc" class="ae-textarea" rows="3" placeholder="Describe your content — topic, format, target audience..."></textarea>
        </div>
        <div class="ae-field">
          <label class="ae-label">Hook / Opening Line</label>
          <input type="text" id="hook-text-2" class="ae-input" placeholder="First 3 seconds..."/>
        </div>
        <div class="ae-field">
          <label class="ae-label">Script / Caption</label>
          <textarea id="script-text" class="ae-textarea" rows="4" placeholder="Paste your script or caption here..."></textarea>
        </div>
      </div>
    </div>

    <!-- Metrics input -->
    <div class="ae-section">
      <div class="ae-section-label">Performance Metrics</div>
      <div class="ae-metrics-grid">
        <div class="ae-field">
          <label class="ae-label">Views</label>
          <input type="number" id="m-views" class="ae-input ae-metric-input" placeholder="0" min="0"/>
        </div>
        <div class="ae-field">
          <label class="ae-label">Likes</label>
          <input type="number" id="m-likes" class="ae-input ae-metric-input" placeholder="0" min="0"/>
        </div>
        <div class="ae-field">
          <label class="ae-label">Comments</label>
          <input type="number" id="m-comments" class="ae-input ae-metric-input" placeholder="0" min="0"/>
        </div>
        <div class="ae-field">
          <label class="ae-label">Shares</label>
          <input type="number" id="m-shares" class="ae-input ae-metric-input" placeholder="0" min="0"/>
        </div>
        <div class="ae-field">
          <label class="ae-label">Saves</label>
          <input type="number" id="m-saves" class="ae-input ae-metric-input" placeholder="0" min="0"/>
        </div>
        <div class="ae-field">
          <label class="ae-label">Watch Time %</label>
          <input type="number" id="m-watchtime" class="ae-input ae-metric-input" placeholder="0" min="0" max="100"/>
        </div>
      </div>
    </div>

    <!-- Timeline config -->
    <div class="ae-section">
      <div class="ae-section-label">Timeline</div>
      <div class="ae-two-col">
        <div class="ae-field">
          <label class="ae-label">Duration (seconds)</label>
          <input type="number" id="duration" class="ae-input" placeholder="60" value="60" min="1"/>
        </div>
        <div class="ae-field">
          <label class="ae-label">Drop-off Points (sec, comma-sep)</label>
          <input type="text" id="dropoff-points" class="ae-input" placeholder="e.g. 3, 15, 42"/>
        </div>
      </div>
    </div>

    <!-- Rewrite options -->
    <div class="ae-section">
      <div class="ae-section-label">Rewrite Settings</div>
      <div class="ae-two-col">
        <div class="ae-field">
          <label class="ae-label">Target Audience</label>
          <input type="text" id="target-audience" class="ae-input" placeholder="e.g. 18-24 fitness enthusiasts"/>
        </div>
        <div class="ae-field">
          <label class="ae-label">Tone</label>
          <select id="tone-select" class="ae-input ae-select">
            <option value="engaging">Engaging</option>
            <option value="urgent">Urgent</option>
            <option value="educational">Educational</option>
            <option value="entertaining">Entertaining</option>
            <option value="professional">Professional</option>
            <option value="raw/authentic">Raw / Authentic</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="ae-actions">
      <button class="ae-btn-analyze" id="btn-analyze">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        Run Analysis
      </button>
      <button class="ae-btn-score" id="btn-score">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Score Only
      </button>
    </div>

  </aside>

  <!-- ═══ RIGHT PANEL — OUTPUT ══════════════════════════════════════ -->
  <section id="ae-output-panel">

    <!-- Empty state -->
    <div class="ae-empty-state" id="ae-empty">
      <div class="ae-empty-icon">
        <svg viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.3"/>
          <circle cx="32" cy="32" r="16" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
          <circle cx="32" cy="32" r="5" fill="currentColor" opacity="0.7"/>
          <circle cx="32" cy="12" r="2.5" fill="currentColor" opacity="0.4"/>
          <circle cx="50" cy="42" r="2.5" fill="currentColor" opacity="0.4"/>
          <circle cx="14" cy="42" r="2.5" fill="currentColor" opacity="0.4"/>
          <line x1="32" y1="32" x2="32" y2="14.5" stroke="currentColor" stroke-width="1" opacity="0.3"/>
          <line x1="32" y1="32" x2="48" y2="40.5" stroke="currentColor" stroke-width="1" opacity="0.3"/>
          <line x1="32" y1="32" x2="16" y2="40.5" stroke="currentColor" stroke-width="1" opacity="0.3"/>
        </svg>
      </div>
      <h2 class="ae-empty-title">Attention Engine Ready</h2>
      <p class="ae-empty-sub">Enter your content details and performance metrics on the left, then run the analysis to get a full breakdown.</p>
      <div class="ae-empty-chips">
        <span class="ae-chip">Drop-off Detection</span>
        <span class="ae-chip">Intelligent Diagnosis</span>
        <span class="ae-chip">Hook Scoring</span>
        <span class="ae-chip">Script Rewrite</span>
        <span class="ae-chip">Platform Weights</span>
        <span class="ae-chip">Optimization Plan</span>
      </div>
    </div>

    <!-- Loading state -->
    <div class="ae-loading" id="ae-loading" style="display:none">
      <div class="ae-loading-ring"></div>
      <div class="ae-loading-label" id="loading-label">Initializing analysis...</div>
      <div class="ae-loading-stream" id="loading-stream"></div>
    </div>

    <!-- Results -->
    <div class="ae-results" id="ae-results" style="display:none">

      <!-- Results header -->
      <div class="ae-results-header">
        <div class="ae-results-title">
          <span class="ae-results-platform-badge" id="results-platform-badge"></span>
          <h2>Analysis Complete</h2>
        </div>
        <div class="ae-results-actions">
          <button class="ae-btn-icon" id="btn-export" title="Export Report">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="ae-btn-icon" id="btn-copy" title="Copy Results">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button class="ae-btn-icon" id="btn-rerun" title="Re-run Analysis">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          </button>
        </div>
      </div>

      <!-- Output tabs -->
      <div class="ae-output-tabs">
        <button class="ae-output-tab active" data-output-tab="scores">Scores</button>
        <button class="ae-output-tab" data-output-tab="timeline">Timeline</button>
        <button class="ae-output-tab" data-output-tab="diagnosis">Diagnosis</button>
        <button class="ae-output-tab" data-output-tab="optimize">Optimize</button>
        <button class="ae-output-tab" data-output-tab="rewrite">Rewrite</button>
      </div>

      <!-- TAB: SCORES -->
      <div class="ae-output-content active" id="out-scores">
        <div class="ae-score-row" id="score-cards-row"></div>
        <div class="ae-signal-section">
          <div class="ae-signal-title">Signal Breakdown
            <span class="ae-signal-platform-label" id="signal-platform-label"></span>
          </div>
          <div class="ae-signal-bars" id="signal-bars"></div>
        </div>
        <div class="ae-verdict-card" id="verdict-card" style="display:none">
          <div class="ae-verdict-label">INTELLIGENT VERDICT</div>
          <div class="ae-verdict-text" id="verdict-text"></div>
        </div>
      </div>

      <!-- TAB: TIMELINE -->
      <div class="ae-output-content" id="out-timeline">
        <div class="ae-timeline-header">
          <div class="ae-tl-legend">
            <span class="ae-tl-dot normal"></span>Strong
            <span class="ae-tl-dot warning"></span>Warning
            <span class="ae-tl-dot critical"></span>Critical Drop-off
          </div>
        </div>
        <div class="ae-timeline-chart" id="timeline-chart"></div>
        <div class="ae-dropoff-list" id="dropoff-list"></div>
      </div>

      <!-- TAB: DIAGNOSIS -->
      <div class="ae-output-content" id="out-diagnosis">
        <div class="ae-diagnosis-grid" id="diagnosis-grid"></div>
        <div class="ae-issues-section" id="issues-section" style="display:none">
          <div class="ae-issues-col">
            <div class="ae-issues-label critical">⚠ Top Issues</div>
            <ul class="ae-issues-list" id="top-issues-list"></ul>
          </div>
          <div class="ae-issues-col">
            <div class="ae-issues-label positive">✓ Strengths</div>
            <ul class="ae-issues-list positive" id="strengths-list"></ul>
          </div>
        </div>
      </div>

      <!-- TAB: OPTIMIZE -->
      <div class="ae-output-content" id="out-optimize">
        <div class="ae-optimize-list" id="optimize-list"></div>
        <div class="ae-platform-insight-card" id="platform-insight-card" style="display:none">
          <div class="ae-pi-label">Platform Intelligence</div>
          <div class="ae-pi-grid" id="platform-insight-grid"></div>
        </div>
      </div>

      <!-- TAB: REWRITE -->
      <div class="ae-output-content" id="out-rewrite">
        <div class="ae-rewrite-actions">
          <button class="ae-btn-rewrite" id="btn-run-rewrite">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            Generate Rewrites
          </button>
          <span class="ae-rewrite-note">Engine will generate 3 hooks + 2 full script rewrites</span>
        </div>
        <div class="ae-rewrite-output" id="rewrite-output"></div>
      </div>

    </div><!-- /ae-results -->

  </section>

</main>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="/static/attention-engine.js"></script>
</body>
</html>`
}

/* ══════════════════════════════════════════════════════════════════
   TOOL SHELL (other tools)
══════════════════════════════════════════════════════════════════ */
function toolShell(name: string, _id: string, color: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${name} — Spectra</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#060810;--ice:#E8F4FD;--accent:#7BB8D4;--glow:#A8D8F0;--border:rgba(168,216,240,0.10);--tool-color:${color}}
    body{background:var(--bg);color:var(--ice);font-family:'Space Grotesk',sans-serif;min-height:100vh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
    nav{display:flex;align-items:center;justify-content:space-between;padding:1.4rem 3rem;border-bottom:1px solid var(--border)}
    .nav-logo{font-family:'Space Mono',monospace;font-size:0.85rem;letter-spacing:0.30em;color:var(--glow);text-decoration:none;display:flex;align-items:center;gap:0.5rem}
    .nav-logo-mark{width:26px;height:26px;border:1px solid rgba(168,216,240,0.30);border-radius:5px;display:grid;place-items:center;font-size:0.70rem;font-weight:700}
    .nav-back{color:rgba(232,244,253,0.45);text-decoration:none;font-size:0.75rem;letter-spacing:0.08em;transition:color 0.2s;display:flex;align-items:center;gap:0.4rem}
    .nav-back:hover{color:var(--ice)}
    main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5rem 2rem;text-align:center;gap:2rem}
    .tool-badge{display:inline-flex;align-items:center;gap:0.55rem;font-family:'Space Mono',monospace;font-size:0.58rem;letter-spacing:0.30em;text-transform:uppercase;color:var(--tool-color);padding:0.35rem 0.85rem;border-radius:20px;border:1px solid color-mix(in srgb,var(--tool-color) 35%,transparent);background:color-mix(in srgb,var(--tool-color) 8%,transparent)}
    .badge-dot{width:5px;height:5px;border-radius:50%;background:var(--tool-color);animation:blink 2.2s ease-in-out infinite}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}
    .pulse-ring{width:80px;height:80px;border-radius:50%;border:1px solid color-mix(in srgb,var(--tool-color) 40%,transparent);animation:pulse 2.6s ease-in-out infinite}
    @keyframes pulse{0%,100%{transform:scale(1);opacity:0.4}50%{transform:scale(1.22);opacity:0.85}}
    h1{font-size:clamp(2.2rem,5vw,3.8rem);font-weight:300;letter-spacing:-0.025em;line-height:1.1}
    h1 em{font-style:italic;font-weight:400;color:var(--tool-color)}
    p{color:rgba(232,244,253,0.45);max-width:420px;line-height:1.78;font-size:0.97rem}
    .btn{display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 1.7rem;border-radius:8px;font-size:0.82rem;font-weight:600;letter-spacing:0.04em;text-decoration:none;transition:all 0.25s;border:1px solid rgba(168,216,240,0.18);color:rgba(232,244,253,0.55)}
    .btn:hover{border-color:rgba(168,216,240,0.35);color:var(--ice);background:rgba(168,216,240,0.05)}
  </style>
</head>
<body>
  <nav>
    <a href="/" class="nav-logo"><span class="nav-logo-mark">S</span>SPECTRA</a>
    <a href="/" class="nav-back"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Back</a>
  </nav>
  <main>
    <div class="pulse-ring"></div>
    <div class="tool-badge"><span class="badge-dot"></span>Coming Soon</div>
    <h1>${name.split(' ').slice(0,-1).join(' ')} <em>${name.split(' ').at(-1)}</em></h1>
    <p>This module is under active development and will be available in the next Spectra release.</p>
    <a href="/" class="btn">← Return to Spectra</a>
  </main>
</body>
</html>`
}

/* ══════════════════════════════════════════════════════════════════
   LANDING PAGE
══════════════════════════════════════════════════════════════════ */
function landingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Spectra — Intelligent Creative Suite</title>
  <meta name="description" content="Spectra — Five Intelligent systems. One unified platform. Infinite creative output.">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/style.css"/>
</head>
<body>
<div id="loader"><div class="loader-inner"><div class="loader-word"><span>S</span><span>P</span><span>E</span><span>C</span><span>T</span><span>R</span><span>A</span></div><div class="loader-bar-track"><div class="loader-bar-fill"></div></div><div class="loader-status">Initializing</div></div></div>
<div id="cursor-dot"></div><div id="cursor-ring"></div>
<div id="hyper-overlay"></div>
<div id="node-tooltip"></div>
<nav id="nav" role="navigation">
  <a href="/" class="nav-logo"><span class="nav-logo-mark">S</span><span class="nav-logo-text">SPECTRA</span></a>
  <ul class="nav-links" role="list">
    <li><a href="#scene-tools" class="nav-link">System</a></li>
    <li><a href="#scene-features" class="nav-link">Architecture</a></li>
    <li><a href="#scene-about" class="nav-link">Metrics</a></li>
    <li><a href="#scene-cta" class="nav-link">Launch</a></li>
  </ul>
  <div class="nav-progress"><div class="nav-progress-fill"></div></div>
</nav>
<canvas id="world-canvas" aria-hidden="true"></canvas>
<div id="tool-hud" role="complementary">
  <div class="hud-label">ACTIVE SYSTEM</div><div class="hud-name"></div><div class="hud-desc"></div>
  <a class="hud-link" href="#">Open Tool <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
</div>
<div id="scroll-container">
  <section class="scene" id="scene-hero" data-scene="0">
    <div class="scene-ui" id="ui-hero">
      <p class="hero-pre">Intelligent Creative Suite</p>
      <p class="hero-sub">Five Intelligent systems. One platform.<br>Infinite creative output.</p>
      <div class="hero-ctas">
        <a href="#scene-tools" class="btn-primary btn-glow cta-scroll"><span>Enter the System</span><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
        <a href="#scene-about" class="btn-ghost cta-scroll">Learn More</a>
      </div>
    </div>
    <div class="scroll-cue" aria-hidden="true"><span class="sc-label">scroll</span><div class="sc-line"></div></div>
  </section>
  <section class="scene" id="scene-tools" data-scene="1">
    <div class="scene-ui" id="ui-tools">
      <div class="section-eyebrow"><span class="eyebrow-pip"></span>INTELLIGENT SUITE — SELECT A SYSTEM</div>
      <h2 class="section-title">Five Tools.<br><em>One Platform.</em></h2>
      <div class="tools-orbital" role="list" id="tools-list">
        <button class="tool-node" data-node="0" data-color="purple" role="listitem"><div class="node-accent-bar"></div><div class="node-core"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3" opacity="0.5"/><circle cx="16" cy="16" r="2" fill="currentColor"/></svg></div><div class="node-label"><span class="node-num">01</span><span class="node-name">Attention Engine</span></div><span class="node-status active">Active</span></button>
        <button class="tool-node" data-node="1" data-color="green" role="listitem"><div class="node-accent-bar"></div><div class="node-core"><svg viewBox="0 0 32 32" fill="none"><rect x="3" y="7" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M23 12l6-3v10l-6-3V12z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></div><div class="node-label"><span class="node-num">02</span><span class="node-name">Video Generator</span></div><span class="node-status">Build</span></button>
        <button class="tool-node" data-node="2" data-color="blue" role="listitem"><div class="node-accent-bar"></div><div class="node-core"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="24" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="27" cy="24" r="3" stroke="currentColor" stroke-width="1.5"/><line x1="16" y1="8" x2="5" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="8" x2="27" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="8" x2="16" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div><div class="node-label"><span class="node-num">03</span><span class="node-name">Distribution Engine</span></div><span class="node-status">Build</span></button>
        <button class="tool-node" data-node="3" data-color="orange" role="listitem"><div class="node-accent-bar"></div><div class="node-core"><svg viewBox="0 0 32 32" fill="none"><path d="M2 20 C8 12, 14 24, 20 14 S28 6, 30 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="30" cy="10" r="2" fill="currentColor"/></svg></div><div class="node-label"><span class="node-num">04</span><span class="node-name">Motion Engine</span></div><span class="node-status">Build</span></button>
        <button class="tool-node" data-node="4" data-color="red" role="listitem"><div class="node-accent-bar"></div><div class="node-core"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="10" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M4 28c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div><div class="node-label"><span class="node-num">05</span><span class="node-name">Persona Engine</span></div><span class="node-status">Build</span></button>
      </div>
    </div>
  </section>
  <section class="scene" id="scene-features" data-scene="2">
    <div class="scene-ui" id="ui-features">
      <div class="section-eyebrow"><span class="eyebrow-pip"></span>ARCHITECTURE</div>
      <h2 class="section-title">Built Different.<br><em>By Design.</em></h2>
      <div class="feature-fragments" id="feature-grid">
        <button class="frag" data-frag="0"><div class="frag-icon-wrap" style="--fc:#A78BFA"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 10V3L4 14h7v7l9-11h-7z" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="frag-body"><div class="frag-title">Real-Time Analysis</div><div class="frag-label">Intelligently processes content at inference speed</div></div></button>
        <button class="frag" data-frag="1"><div class="frag-icon-wrap" style="--fc:#34D399"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg></div><div class="frag-body"><div class="frag-title">Drop-Off Detection</div><div class="frag-label">Pinpoints engagement loss moments</div></div></button>
        <button class="frag" data-frag="2"><div class="frag-icon-wrap" style="--fc:#60A5FA"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div><div class="frag-body"><div class="frag-title">Script Rewrite Engine</div><div class="frag-label">GPT-powered content optimization</div></div></button>
        <button class="frag" data-frag="3"><div class="frag-icon-wrap" style="--fc:#FB923C"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div><div class="frag-body"><div class="frag-title">Performance Scoring</div><div class="frag-label">Quantified content quality metrics</div></div></button>
        <button class="frag" data-frag="4"><div class="frag-icon-wrap" style="--fc:#F472B6"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg></div><div class="frag-body"><div class="frag-title">Multi-Platform Distribution</div><div class="frag-label">Optimal timing across all channels</div></div></button>
        <button class="frag" data-frag="5"><div class="frag-icon-wrap" style="--fc:#A8D8F0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg></div><div class="frag-body"><div class="frag-title">Cinematic Motion Intelligence</div><div class="frag-label">Intelligently composed video motion systems</div></div></button>
      </div>
    </div>
  </section>
  <section class="scene" id="scene-about" data-scene="3">
    <div class="scene-ui" id="ui-about">
      <div class="section-eyebrow"><span class="eyebrow-pip"></span>SPECTRA</div>
      <h2 class="section-title">Intelligent at the Speed<br><em>of Thought.</em></h2>
      <p class="section-body">A closed-loop intelligent creative system — content is analyzed, generated, optimized, and distributed at machine speed.</p>
      <div class="metric-row" role="list">
        <div class="metric" role="listitem"><div class="metric-val" data-count="5">0</div><div class="metric-label">Intelligent Engines</div></div>
        <div class="metric" role="listitem"><div class="metric-val" data-count="100">0</div><div class="metric-label">% Automated</div></div>
        <div class="metric" role="listitem"><div class="metric-val">∞</div><div class="metric-label">Scale</div></div>
        <div class="metric" role="listitem"><div class="metric-val" data-count="1">0</div><div class="metric-label">Unified Platform</div></div>
      </div>
    </div>
  </section>
  <section class="scene" id="scene-cta" data-scene="4">
    <div class="scene-ui" id="ui-cta">
      <div class="section-eyebrow"><span class="eyebrow-pip"></span>BEGIN</div>
      <h2 class="cta-title">The system<br><em>is ready.</em></h2>
      <p class="cta-body">Launch the Intelligent Attention Engine — your first portal into the Spectra suite.</p>
      <div class="cta-actions">
        <a href="/tools/attention-engine/" class="btn-primary btn-glow"><span>Launch Attention Engine</span><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
        <a href="#scene-tools" class="btn-ghost cta-scroll">Explore Systems</a>
      </div>
      <div class="cta-brand"><div class="cta-brand-mark">S</div><span class="cta-brand-name">SPECTRA</span></div>
    </div>
  </section>
</div>
<script src="https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
<script src="/static/main.js"></script>
</body>
</html>`
}
