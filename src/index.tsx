import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import OpenAI from 'openai'

/* ══════════════════════════════════════════════════════════════════
   BINDINGS
══════════════════════════════════════════════════════════════════ */
type Bindings = {
  DB:               D1Database
  STORAGE:          R2Bucket
  OPENAI_API_KEY:   string
  OPENAI_BASE_URL:  string
  ENCRYPTION_KEY:   string   // 32-byte hex string for AES-256-GCM
  JWT_SECRET:       string
  YOUTUBE_API_KEY:  string
  FB_ACCESS_TOKEN:  string
}

/* ══════════════════════════════════════════════════════════════════
   TIER LIMITS
══════════════════════════════════════════════════════════════════ */
const TIER_LIMITS: Record<string, { projects: number; shots_per_month: number; storage_mb: number }> = {
  free:    { projects: 1,         shots_per_month: 10,  storage_mb: 500   },
  creator: { projects: 5,         shots_per_month: 100, storage_mb: 5120  },
  studio:  { projects: 25,        shots_per_month: 500, storage_mb: 25600 },
  pro:     { projects: 999999,    shots_per_month: 999999, storage_mb: 102400 },
}

/* ══════════════════════════════════════════════════════════════════
   HIGGSFIELD MODELS
══════════════════════════════════════════════════════════════════ */
// Model IDs validated against Higgsfield platform.higgsfield.ai API
// DoP path: /higgsfield-ai/dop/{lite|standard|turbo}  (image-to-video, image_url required)
// Soul path: /higgsfield-ai/soul/{standard}            (text-to-image, no image_url needed)
// Kling path: /kling-video/{version}/{quality}/{mode}  (confirmed via 403 not credits)
const HF_MODELS = [
  { id: 'higgsfield-ai/dop/lite',                       label: 'DoP Lite (Fast)',     category: 'video', type: 'image-to-video', requires_image: true },
  { id: 'higgsfield-ai/dop/standard',                   label: 'DoP Standard',        category: 'video', type: 'image-to-video', requires_image: true },
  { id: 'higgsfield-ai/dop/turbo',                      label: 'DoP Turbo',           category: 'video', type: 'image-to-video', requires_image: true },
  { id: 'kling-video/v2.1/pro/image-to-video',          label: 'Kling 2.1 Pro',       category: 'video', type: 'image-to-video', requires_image: true },
  { id: 'kling-video/v2.1/standard/image-to-video',     label: 'Kling 2.1 Standard',  category: 'video', type: 'image-to-video', requires_image: true },
  { id: 'bytedance/seedance/v1/pro/image-to-video',     label: 'Seedance v1 Pro',     category: 'video', type: 'image-to-video', requires_image: true },
  { id: 'bytedance/seedance/v1/lite/image-to-video',    label: 'Seedance v1 Lite',    category: 'video', type: 'image-to-video', requires_image: true },
  { id: 'higgsfield-ai/soul/standard',                  label: 'Soul (Text→Image)',   category: 'image', type: 'text-to-image',  requires_image: false },
  { id: 'flux-pro/kontext/max/text-to-image',           label: 'Flux Kontext Max',    category: 'image', type: 'text-to-image',  requires_image: false },
]

const HF_BASE = 'https://platform.higgsfield.ai'

/* ══════════════════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════════════════ */
function uuid(): string {
  return crypto.randomUUID()
}

function nowISO(): string {
  return new Date().toISOString()
}

// AES-256-GCM encryption — pure Web Crypto (Cloudflare Workers compatible)
async function encryptKey(plaintext: string, hexKey: string): Promise<{ encrypted: string; iv: string }> {
  const keyBytes = hexToBytes(hexKey.slice(0, 64)) // 32 bytes
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, cryptoKey, enc.encode(plaintext)
  )
  return {
    encrypted: bytesToBase64(new Uint8Array(ciphertext)),
    iv:        bytesToBase64(iv),
  }
}

async function decryptKey(encrypted: string, iv: string, hexKey: string): Promise<string> {
  const keyBytes = hexToBytes(hexKey.slice(0, 64))
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
  )
  const cipherBytes = base64ToBytes(encrypted)
  const ivBytes     = base64ToBytes(iv)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes }, cryptoKey, cipherBytes
  )
  return new TextDecoder().decode(plain)
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return arr
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach(b => { binary += String.fromCharCode(b) })
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const arr = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i)
  return arr
}

// Constant-time compare for session tokens
async function safeCompare(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false
  const enc = new TextEncoder()
  const aKey = await crypto.subtle.importKey('raw', enc.encode(a), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bKey = await crypto.subtle.importKey('raw', enc.encode(b), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const msg  = enc.encode('compare')
  const [aSig, bSig] = await Promise.all([
    crypto.subtle.sign('HMAC', aKey, msg),
    crypto.subtle.sign('HMAC', bKey, msg),
  ])
  const aArr = new Uint8Array(aSig), bArr = new Uint8Array(bSig)
  let diff = 0
  for (let i = 0; i < aArr.length; i++) diff |= aArr[i] ^ bArr[i]
  return diff === 0
}

// Simple password hashing using PBKDF2 (Web Crypto)
async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256
  )
  const hash = new Uint8Array(bits)
  return bytesToBase64(salt) + ':' + bytesToBase64(hash)
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(':')
  if (!saltB64 || !hashB64) return false
  const enc  = new TextEncoder()
  const salt = base64ToBytes(saltB64)
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256
  )
  const newHash = bytesToBase64(new Uint8Array(bits))
  return await safeCompare(newHash, hashB64)
}

function generateSessionToken(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
}

/* ══════════════════════════════════════════════════════════════════
   AUTH MIDDLEWARE
══════════════════════════════════════════════════════════════════ */
async function requireAuth(c: any, next: any) {
  const token = getCookie(c, 'session') || c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  const session = await c.env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.tier, u.credits, u.email
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).bind(token).first<{ user_id: string; expires_at: string; tier: string; credits: number; email: string }>()

  if (!session) return c.json({ error: 'Session expired or invalid' }, 401)

  c.set('userId', session.user_id)
  c.set('userTier', session.tier)
  c.set('userCredits', session.credits)
  c.set('userEmail', session.email)
  await next()
}

/* ══════════════════════════════════════════════════════════════════
   HIGGSFIELD ADAPTER
══════════════════════════════════════════════════════════════════ */
async function hfSubmitJob(params: {
  model:        string
  prompt:       string
  image_url?:   string
  duration?:    number
  aspect_ratio?: string
  credentials:  string   // KEY_ID:KEY_SECRET — decrypted server-side
}): Promise<{ request_id: string; status: string; status_url: string }> {
  const { model, prompt, image_url, duration, aspect_ratio, credentials } = params

  const body: Record<string, any> = { prompt }
  if (image_url)   body.image_url    = image_url
  if (duration)    body.duration     = duration
  if (aspect_ratio) body.aspect_ratio = aspect_ratio

  const res = await fetch(`${HF_BASE}/${model}`, {
    method:  'POST',
    headers: {
      'Authorization': `Key ${credentials}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText)
    throw new Error(`Higgsfield ${res.status}: ${txt}`)
  }

  return res.json() as any
}

async function hfCheckStatus(request_id: string, credentials: string): Promise<{
  status:    string
  video?:    { url: string }
  images?:   Array<{ url: string }>
  error?:    string
}> {
  const res = await fetch(`${HF_BASE}/requests/${request_id}/status`, {
    headers: {
      'Authorization': `Key ${credentials}`,
      'Accept':        'application/json',
    },
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText)
    throw new Error(`Higgsfield status ${res.status}: ${txt}`)
  }

  return res.json() as any
}

/* ══════════════════════════════════════════════════════════════════
   OPENAI CLIENT
══════════════════════════════════════════════════════════════════ */
function getAIClient(env: Bindings): OpenAI {
  return new OpenAI({
    apiKey:  env?.OPENAI_API_KEY  || '',
    baseURL: env?.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  })
}

/* ══════════════════════════════════════════════════════════════════
   GPT-4o PROMPT ENHANCER
══════════════════════════════════════════════════════════════════ */
async function enhancePrompt(env: Bindings, params: {
  prompt:      string
  style_bible?: string
  model:        string
  aspect_ratio: string
}): Promise<string> {
  try {
    const ai = getAIClient(env)
    const systemPrompt = `You are a world-class AI video director. Your job is to transform a basic user prompt into a rich, cinematic, production-quality prompt optimized for AI video generation.

Rules:
- Keep the core idea but make it cinematic and specific
- Add camera movement language (dolly, pan, tracking shot, etc.)
- Add lighting and atmosphere details
- Add motion description for subjects
- Reference the model style: ${params.model}
- Target aspect ratio: ${params.aspect_ratio}
${params.style_bible ? `- Project style bible: ${params.style_bible}` : ''}
- Output ONLY the enhanced prompt, no explanation, no quotes. Max 150 words.`

    const resp = await ai.chat.completions.create({
      model:       'gpt-4o',
      messages:    [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: params.prompt },
      ],
      temperature: 0.7,
      max_tokens:  200,
    })
    return resp.choices[0]?.message?.content?.trim() || params.prompt
  } catch {
    return params.prompt // fallback to original
  }
}

/* ══════════════════════════════════════════════════════════════════
   TIER ENFORCEMENT HELPER
══════════════════════════════════════════════════════════════════ */
async function checkTierLimits(db: D1Database, userId: string, tier: string): Promise<{ ok: boolean; reason?: string }> {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free

  // Check project count
  const { count: projCount } = await db.prepare(
    `SELECT COUNT(*) as count FROM projects WHERE user_id = ?`
  ).bind(userId).first<{ count: number }>() || { count: 0 }

  if (projCount >= limits.projects) {
    return { ok: false, reason: `Project limit reached (${limits.projects} on ${tier} plan). Upgrade to create more.` }
  }

  // Check shots this month
  const { count: shotCount } = await db.prepare(
    `SELECT COUNT(*) as count FROM shots WHERE user_id = ? AND created_at >= datetime('now', 'start of month')`
  ).bind(userId).first<{ count: number }>() || { count: 0 }

  if (shotCount >= limits.shots_per_month) {
    return { ok: false, reason: `Monthly generation limit reached (${limits.shots_per_month} on ${tier} plan). Upgrade for more.` }
  }

  return { ok: true }
}

/* ══════════════════════════════════════════════════════════════════
   APP
══════════════════════════════════════════════════════════════════ */
const app = new Hono<{ Bindings: Bindings; Variables: {
  userId:       string
  userTier:     string
  userCredits:  number
  userEmail:    string
}}>()

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

/* ══════════════════════════════════════════════════════════════════
   AUTH ROUTES
══════════════════════════════════════════════════════════════════ */

// POST /api/auth/register
app.post('/api/auth/register', async (c) => {
  try {
    const { email, password } = await c.req.json()
    if (!email || !password) return c.json({ error: 'Email and password required' }, 400)
    if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Invalid email address' }, 400)

    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first()
    if (existing) return c.json({ error: 'An account with this email already exists' }, 409)

    const id   = uuid()
    const hash = await hashPassword(password)
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, tier, credits) VALUES (?, ?, ?, 'free', 10)`
    ).bind(id, email.toLowerCase(), hash).run()

    // Create session
    const token   = generateSessionToken()
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    await c.env.DB.prepare(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`
    ).bind(token, id, expires).run()

    setCookie(c, 'session', token, {
      httpOnly: true,
      secure:   true,
      sameSite: 'Lax',
      maxAge:   30 * 24 * 60 * 60,
      path:     '/',
    })

    return c.json({ ok: true, user: { id, email: email.toLowerCase(), tier: 'free', credits: 10 } })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// POST /api/auth/login
app.post('/api/auth/login', async (c) => {
  try {
    const { email, password } = await c.req.json()
    if (!email || !password) return c.json({ error: 'Email and password required' }, 400)

    const user = await c.env.DB.prepare(
      `SELECT id, email, password_hash, tier, credits FROM users WHERE email = ?`
    ).bind(email.toLowerCase()).first<{ id: string; email: string; password_hash: string; tier: string; credits: number }>()

    if (!user || !await verifyPassword(password, user.password_hash)) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }

    const token   = generateSessionToken()
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    await c.env.DB.prepare(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`
    ).bind(token, user.id, expires).run()

    setCookie(c, 'session', token, {
      httpOnly: true,
      secure:   true,
      sameSite: 'Lax',
      maxAge:   30 * 24 * 60 * 60,
      path:     '/',
    })

    return c.json({ ok: true, user: { id: user.id, email: user.email, tier: user.tier, credits: user.credits } })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// POST /api/auth/logout
app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, 'session') || c.req.header('Authorization')?.replace('Bearer ', '')
  if (token) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(token).run().catch(() => {})
  }
  deleteCookie(c, 'session', { path: '/' })
  return c.json({ ok: true })
})

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, async (c) => {
  return c.json({
    id:      c.get('userId'),
    email:   c.get('userEmail'),
    tier:    c.get('userTier'),
    credits: c.get('userCredits'),
    limits:  TIER_LIMITS[c.get('userTier')] || TIER_LIMITS.free,
  })
})

/* ══════════════════════════════════════════════════════════════════
   API KEY MANAGEMENT
══════════════════════════════════════════════════════════════════ */

// POST /api/keys/save — saves encrypted API key
app.post('/api/keys/save', requireAuth, async (c) => {
  try {
    const { provider, key } = await c.req.json()
    if (!provider || !key) return c.json({ error: 'Provider and key required' }, 400)
    if (!['higgsfield', 'openai'].includes(provider)) return c.json({ error: 'Invalid provider' }, 400)
    if (!c.env.ENCRYPTION_KEY) return c.json({ error: 'Server encryption not configured' }, 500)

    const userId = c.get('userId')
    const { encrypted, iv } = await encryptKey(key.trim(), c.env.ENCRYPTION_KEY)

    await c.env.DB.prepare(
      `INSERT INTO api_keys (id, user_id, provider, encrypted_key, iv)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET encrypted_key=excluded.encrypted_key, iv=excluded.iv`
    ).bind(uuid(), userId, provider, encrypted, iv).run()

    return c.json({ ok: true, provider })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/keys/status — returns which providers have keys (never the key itself)
app.get('/api/keys/status', requireAuth, async (c) => {
  const userId = c.get('userId')
  const rows = await c.env.DB.prepare(
    `SELECT provider, created_at FROM api_keys WHERE user_id = ?`
  ).bind(userId).all<{ provider: string; created_at: string }>()

  const status: Record<string, any> = {}
  for (const row of rows.results) {
    status[row.provider] = { connected: true, saved_at: row.created_at }
  }
  return c.json(status)
})

// DELETE /api/keys/:provider
app.delete('/api/keys/:provider', requireAuth, async (c) => {
  const provider = c.req.param('provider')
  const userId   = c.get('userId')
  await c.env.DB.prepare(
    `DELETE FROM api_keys WHERE user_id = ? AND provider = ?`
  ).bind(userId, provider).run()
  return c.json({ ok: true })
})

/* ══════════════════════════════════════════════════════════════════
   PROJECT ROUTES
══════════════════════════════════════════════════════════════════ */

// POST /api/projects
app.post('/api/projects', requireAuth, async (c) => {
  try {
    const userId = c.get('userId')
    const tier   = c.get('userTier')

    // Tier check: project count
    const limits = TIER_LIMITS[tier] || TIER_LIMITS.free
    const { count } = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM projects WHERE user_id = ?`
    ).bind(userId).first<{ count: number }>() || { count: 0 }
    if (count >= limits.projects) {
      return c.json({ error: `Project limit reached (${limits.projects} on ${tier} plan). Upgrade to create more.` }, 403)
    }

    const { name, style_bible, default_provider, default_model } = await c.req.json()
    if (!name?.trim()) return c.json({ error: 'Project name required' }, 400)

    const id = uuid()
    await c.env.DB.prepare(
      `INSERT INTO projects (id, user_id, name, style_bible, default_provider, default_model)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      id, userId, name.trim(),
      style_bible ? JSON.stringify(style_bible) : null,
      default_provider || 'higgsfield',
      default_model    || 'higgsfield-ai/dop/preview',
    ).run()

    return c.json({ ok: true, id, name: name.trim() }, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/projects
app.get('/api/projects', requireAuth, async (c) => {
  const userId = c.get('userId')
  const rows = await c.env.DB.prepare(
    `SELECT id, name, style_bible, default_provider, default_model, thumbnail_url, shot_count, created_at, updated_at
     FROM projects WHERE user_id = ? ORDER BY updated_at DESC`
  ).bind(userId).all()
  return c.json(rows.results)
})

// GET /api/projects/:id
app.get('/api/projects/:id', requireAuth, async (c) => {
  const userId    = c.get('userId')
  const projectId = c.req.param('id')

  const project = await c.env.DB.prepare(
    `SELECT * FROM projects WHERE id = ? AND user_id = ?`
  ).bind(projectId, userId).first()
  if (!project) return c.json({ error: 'Project not found' }, 404)

  const shots = await c.env.DB.prepare(
    `SELECT id, prompt_raw, prompt_enhanced, provider, model, aspect_ratio, duration,
            status, video_url, thumbnail_url, error_message, created_at, completed_at
     FROM shots WHERE project_id = ? ORDER BY created_at DESC`
  ).bind(projectId).all()

  const characters = await c.env.DB.prepare(
    `SELECT id, name, description, ref_image_url, soul_id, created_at
     FROM characters WHERE project_id = ? ORDER BY created_at ASC`
  ).bind(projectId).all()

  return c.json({ ...project, shots: shots.results, characters: characters.results })
})

// PATCH /api/projects/:id
app.patch('/api/projects/:id', requireAuth, async (c) => {
  try {
    const userId    = c.get('userId')
    const projectId = c.req.param('id')
    const body      = await c.req.json()

    const project = await c.env.DB.prepare(
      `SELECT id FROM projects WHERE id = ? AND user_id = ?`
    ).bind(projectId, userId).first()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const fields: string[] = []
    const values: any[]    = []

    if (body.name !== undefined)             { fields.push('name = ?');             values.push(body.name) }
    if (body.style_bible !== undefined)      { fields.push('style_bible = ?');      values.push(JSON.stringify(body.style_bible)) }
    if (body.default_provider !== undefined) { fields.push('default_provider = ?'); values.push(body.default_provider) }
    if (body.default_model !== undefined)    { fields.push('default_model = ?');    values.push(body.default_model) }

    if (!fields.length) return c.json({ error: 'Nothing to update' }, 400)

    fields.push("updated_at = datetime('now')")
    values.push(projectId, userId)

    await c.env.DB.prepare(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
    ).bind(...values).run()

    return c.json({ ok: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// DELETE /api/projects/:id
app.delete('/api/projects/:id', requireAuth, async (c) => {
  const userId    = c.get('userId')
  const projectId = c.req.param('id')

  const project = await c.env.DB.prepare(
    `SELECT id FROM projects WHERE id = ? AND user_id = ?`
  ).bind(projectId, userId).first()
  if (!project) return c.json({ error: 'Project not found' }, 404)

  await c.env.DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(projectId).run()
  return c.json({ ok: true })
})

/* ══════════════════════════════════════════════════════════════════
   CHARACTER ROUTES
══════════════════════════════════════════════════════════════════ */

// POST /api/projects/:id/characters
app.post('/api/projects/:id/characters', requireAuth, async (c) => {
  try {
    const userId    = c.get('userId')
    const projectId = c.req.param('id')

    const project = await c.env.DB.prepare(
      `SELECT id FROM projects WHERE id = ? AND user_id = ?`
    ).bind(projectId, userId).first()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const { name, description, ref_image_url } = await c.req.json()
    if (!name?.trim()) return c.json({ error: 'Character name required' }, 400)

    const id = uuid()
    await c.env.DB.prepare(
      `INSERT INTO characters (id, project_id, name, description, ref_image_url)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(id, projectId, name.trim(), description || null, ref_image_url || null).run()

    return c.json({ ok: true, id, name: name.trim() }, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// DELETE /api/projects/:projectId/characters/:characterId
app.delete('/api/projects/:projectId/characters/:characterId', requireAuth, async (c) => {
  const userId      = c.get('userId')
  const projectId   = c.req.param('projectId')
  const characterId = c.req.param('characterId')

  const project = await c.env.DB.prepare(
    `SELECT id FROM projects WHERE id = ? AND user_id = ?`
  ).bind(projectId, userId).first()
  if (!project) return c.json({ error: 'Project not found' }, 404)

  await c.env.DB.prepare(
    `DELETE FROM characters WHERE id = ? AND project_id = ?`
  ).bind(characterId, projectId).run()
  return c.json({ ok: true })
})

/* ══════════════════════════════════════════════════════════════════
   GENERATION ROUTES
══════════════════════════════════════════════════════════════════ */

// GET /api/models — list available Higgsfield models
app.get('/api/models', (c) => c.json(HF_MODELS))

// POST /api/generate — submit generation job
app.post('/api/generate', requireAuth, async (c) => {
  try {
    const userId = c.get('userId')
    const tier   = c.get('userTier')

    // Check monthly shot limit
    const limits = TIER_LIMITS[tier] || TIER_LIMITS.free
    const { count: shotCount } = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM shots
       WHERE user_id = ? AND created_at >= datetime('now', 'start of month')`
    ).bind(userId).first<{ count: number }>() || { count: 0 }
    if (shotCount >= limits.shots_per_month) {
      return c.json({ error: `Monthly limit reached (${limits.shots_per_month} generations on ${tier} plan). Upgrade for more.` }, 403)
    }

    const body = await c.req.json()
    const {
      project_id,
      prompt,
      model        = 'higgsfield-ai/dop/preview',
      aspect_ratio = '16:9',
      duration     = 5,
      image_url,
    } = body

    if (!project_id) return c.json({ error: 'project_id required' }, 400)
    if (!prompt?.trim()) return c.json({ error: 'Prompt required' }, 400)

    // Verify project ownership
    const project = await c.env.DB.prepare(
      `SELECT id, style_bible FROM projects WHERE id = ? AND user_id = ?`
    ).bind(project_id, userId).first<{ id: string; style_bible: string | null }>()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    // Decrypt Higgsfield credentials — never exposed to client
    const keyRow = await c.env.DB.prepare(
      `SELECT encrypted_key, iv FROM api_keys WHERE user_id = ? AND provider = 'higgsfield'`
    ).bind(userId).first<{ encrypted_key: string; iv: string }>()
    if (!keyRow) return c.json({ error: 'No Higgsfield API key saved. Go to Settings to add your key.' }, 400)
    if (!c.env.ENCRYPTION_KEY) return c.json({ error: 'Server encryption not configured' }, 500)

    const credentials = await decryptKey(keyRow.encrypted_key, keyRow.iv, c.env.ENCRYPTION_KEY)

    // Enhance prompt with GPT-4o
    const styleBible = project.style_bible ? JSON.parse(project.style_bible) : null
    const promptEnhanced = await enhancePrompt(c.env, {
      prompt,
      style_bible:  styleBible ? JSON.stringify(styleBible) : undefined,
      model,
      aspect_ratio,
    })

    // Create shot record with pending status
    const shotId = uuid()
    await c.env.DB.prepare(
      `INSERT INTO shots (id, project_id, user_id, prompt_raw, prompt_enhanced, provider, model, aspect_ratio, duration, status)
       VALUES (?, ?, ?, ?, ?, 'higgsfield', ?, ?, ?, 'pending')`
    ).bind(shotId, project_id, userId, prompt, promptEnhanced, model, aspect_ratio, duration).run()

    // Submit to Higgsfield
    let hfResult: any
    try {
      hfResult = await hfSubmitJob({
        model,
        prompt:      promptEnhanced,
        image_url,
        duration,
        aspect_ratio,
        credentials,
      })
    } catch (hfErr: any) {
      await c.env.DB.prepare(
        `UPDATE shots SET status='failed', error_message=? WHERE id=?`
      ).bind(hfErr.message, shotId).run()
      return c.json({ error: `Higgsfield error: ${hfErr.message}` }, 502)
    }

    // Store request_id and update status to queued
    await c.env.DB.prepare(
      `UPDATE shots SET hf_request_id=?, status='queued' WHERE id=?`
    ).bind(hfResult.request_id, shotId).run()

    // Update project shot count + timestamp
    await c.env.DB.prepare(
      `UPDATE projects SET shot_count = shot_count + 1, updated_at = datetime('now') WHERE id = ?`
    ).bind(project_id).run()

    return c.json({
      ok:             true,
      shot_id:        shotId,
      request_id:     hfResult.request_id,
      status:         'queued',
      prompt_enhanced: promptEnhanced,
    }, 202)

  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/shots/:shotId/status — poll shot status
app.get('/api/shots/:shotId/status', requireAuth, async (c) => {
  try {
    const userId = c.get('userId')
    const shotId = c.req.param('shotId')

    const shot = await c.env.DB.prepare(
      `SELECT id, hf_request_id, status, video_url, thumbnail_url, error_message, prompt_enhanced
       FROM shots WHERE id = ? AND user_id = ?`
    ).bind(shotId, userId).first<any>()
    if (!shot) return c.json({ error: 'Shot not found' }, 404)

    // Already terminal
    if (['completed', 'failed', 'nsfw'].includes(shot.status)) {
      return c.json(shot)
    }

    // No request ID yet — still pending
    if (!shot.hf_request_id) {
      return c.json({ ...shot, status: 'pending' })
    }

    // Decrypt key and poll Higgsfield
    const keyRow = await c.env.DB.prepare(
      `SELECT encrypted_key, iv FROM api_keys WHERE user_id = ? AND provider = 'higgsfield'`
    ).bind(userId).first<{ encrypted_key: string; iv: string }>()
    if (!keyRow) return c.json({ error: 'API key not found' }, 400)

    const credentials = await decryptKey(keyRow.encrypted_key, keyRow.iv, c.env.ENCRYPTION_KEY)
    const hfStatus    = await hfCheckStatus(shot.hf_request_id, credentials)

    // Map Higgsfield status to our status
    let newStatus = shot.status
    let videoUrl  = shot.video_url
    let errorMsg  = shot.error_message

    if (hfStatus.status === 'completed') {
      newStatus = 'completed'
      videoUrl  = hfStatus.video?.url || hfStatus.images?.[0]?.url || null
    } else if (hfStatus.status === 'failed') {
      newStatus = 'failed'
      errorMsg  = hfStatus.error || 'Generation failed'
    } else if (hfStatus.status === 'nsfw') {
      newStatus = 'nsfw'
      errorMsg  = 'Content flagged by moderation. Credits refunded.'
    } else if (hfStatus.status === 'in_progress') {
      newStatus = 'in_progress'
    }

    // Update DB if status changed
    if (newStatus !== shot.status) {
      await c.env.DB.prepare(
        `UPDATE shots SET status=?, hf_video_url=?, video_url=?, error_message=?,
         completed_at = CASE WHEN ? IN ('completed','failed','nsfw') THEN datetime('now') ELSE NULL END
         WHERE id=?`
      ).bind(newStatus, videoUrl, videoUrl, errorMsg, newStatus, shotId).run()
    }

    return c.json({
      id:              shotId,
      status:          newStatus,
      video_url:       videoUrl,
      thumbnail_url:   shot.thumbnail_url,
      error_message:   errorMsg,
      prompt_enhanced: shot.prompt_enhanced,
    })

  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// DELETE /api/shots/:shotId
app.delete('/api/shots/:shotId', requireAuth, async (c) => {
  const userId = c.get('userId')
  const shotId = c.req.param('shotId')
  await c.env.DB.prepare(
    `DELETE FROM shots WHERE id = ? AND user_id = ?`
  ).bind(shotId, userId).run()
  return c.json({ ok: true })
})

// POST /api/enhance-prompt — standalone prompt enhancer
app.post('/api/enhance-prompt', requireAuth, async (c) => {
  try {
    const { prompt, model = 'higgsfield-ai/dop/preview', aspect_ratio = '16:9', style_bible } = await c.req.json()
    if (!prompt?.trim()) return c.json({ error: 'Prompt required' }, 400)

    const enhanced = await enhancePrompt(c.env, { prompt, model, aspect_ratio, style_bible })
    return c.json({ original: prompt, enhanced })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   PLATFORM WEIGHTS (Attention Engine — preserved)
══════════════════════════════════════════════════════════════════ */
const PLATFORM_WEIGHTS: Record<string, Record<string, number>> = {
  tiktok:    { watch_time:0.32, shares:0.22, comments:0.18, likes:0.14, saves:0.08, views:0.06 },
  instagram: { saves:0.26, shares:0.22, watch_time:0.20, comments:0.16, likes:0.10, views:0.06 },
  youtube:   { watch_time:0.35, comments:0.20, likes:0.18, shares:0.14, saves:0.08, views:0.05 },
  twitter:   { shares:0.30, comments:0.24, likes:0.18, watch_time:0.16, saves:0.08, views:0.04 },
  facebook:  { shares:0.28, comments:0.24, watch_time:0.20, likes:0.14, saves:0.08, views:0.06 },
  ads:       { watch_time:0.30, views:0.20, likes:0.18, shares:0.14, comments:0.12, saves:0.06 },
}

function computeWeightedScore(metrics: any, platform: string): Record<string, number> {
  const weights = PLATFORM_WEIGHTS[platform] || PLATFORM_WEIGHTS.tiktok
  const { views=0, likes=0, comments=0, shares=0, saves=0, watch_time_pct=0 } = metrics
  const likeRate    = views > 0 ? Math.min((likes    / views)*100*20, 100) : 0
  const commentRate = views > 0 ? Math.min((comments / views)*100*40, 100) : 0
  const shareRate   = views > 0 ? Math.min((shares   / views)*100*50, 100) : 0
  const saveRate    = views > 0 ? Math.min((saves    / views)*100*60, 100) : 0
  const wtScore     = Math.min(watch_time_pct, 100)
  const viewScore   = Math.min(views / 1000, 100)
  const raw: Record<string, number> = { likes: likeRate, comments: commentRate, shares: shareRate, saves: saveRate, watch_time: wtScore, views: viewScore }
  let composite = 0
  for (const [k, w] of Object.entries(weights)) composite += (raw[k] || 0) * w
  return { composite: Math.round(composite), like_score: Math.round(likeRate), comment_score: Math.round(commentRate), share_score: Math.round(shareRate), save_score: Math.round(saveRate), watch_score: Math.round(wtScore), view_score: Math.round(viewScore) }
}

function buildSegments(duration_sec: number, dropoff_points: number[]): any[] {
  const segCount = Math.min(Math.max(Math.ceil(duration_sec / 5), 4), 20)
  const segLen   = duration_sec / segCount
  const segs     = []
  for (let i = 0; i < segCount; i++) {
    const tStart = Math.round(i * segLen), tEnd = Math.round((i+1) * segLen)
    let retention = Math.max(100 - (i / segCount)*35 - Math.random()*8, 10)
    const isDropoff = dropoff_points.some(dp => dp >= tStart && dp <= tEnd)
    if (isDropoff) retention = Math.max(retention - 25 - Math.random()*15, 5)
    segs.push({ index:i, start:tStart, end:tEnd, label:`${tStart}s–${tEnd}s`, retention:Math.round(retention), is_dropoff:isDropoff, severity:isDropoff?(retention<30?'critical':'warning'):'normal' })
  }
  return segs
}

/* ══════════════════════════════════════════════════════════════════
   ATTENTION ENGINE ROUTES (preserved)
══════════════════════════════════════════════════════════════════ */
app.post('/api/attention/analyze', async (c) => {
  try {
    const body = await c.req.json()
    const { platform='tiktok', content_url='', content_description='', duration_sec=60, metrics={}, dropoff_points=[], hook_text='', script_excerpt='' } = body
    const scores   = computeWeightedScore(metrics, platform)
    const segments = buildSegments(duration_sec, dropoff_points)
    const weights  = PLATFORM_WEIGHTS[platform] || PLATFORM_WEIGHTS.tiktok

    const systemPrompt = `You are Spectra's Attention Engine — an elite content performance analyst for Pano Marketing.
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
  "dropoff_analysis": [{ "timestamp":"string","cause":"string","severity":"critical|warning","fix":"string" }],
  "top_issues": ["string","string","string"],
  "top_strengths": ["string","string"],
  "optimization_plan": [{ "priority":1-5,"action":"string","impact":"High|Medium|Low","effort":"Low|Medium|High","detail":"string" }],
  "platform_insights": { "algorithm_note":"string","trend_alignment":"string","posting_recommendation":"string" },
  "overall_verdict": "string"
}`

    const userPrompt = `Analyze this ${platform.toUpperCase()} content:
CONTENT URL: ${content_url||'Not provided'}\nCONTENT DESCRIPTION: ${content_description||'Not provided'}\nHOOK TEXT: ${hook_text||'Not provided'}\nSCRIPT EXCERPT: ${script_excerpt||'Not provided'}\nDURATION: ${duration_sec} seconds
WEIGHTED SCORES: Composite: ${scores.composite}/100, Watch: ${scores.watch_score}/100, Share: ${scores.share_score}/100
DROP-OFF POINTS: ${dropoff_points.length>0?dropoff_points.map((p:number)=>`${p}s`).join(', '):'None'}
TIMELINE:\n${segments.map((s:any)=>`[${s.label}] Retention: ${s.retention}% ${s.is_dropoff?'⚠️ DROP-OFF':''}`).join('\n')}`

    const ai     = getAIClient(c.env)
    const stream = await ai.chat.completions.create({ model:'gpt-4o', messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}], stream:true, temperature:0.4, max_tokens:2800 })
    const metaChunk = JSON.stringify({ type:'meta', scores, segments, platform, weights })
    return new Response(new ReadableStream({ async start(ctrl) {
      const enc = new TextEncoder()
      ctrl.enqueue(enc.encode(`data: ${metaChunk}\n\n`))
      let buf = ''
      for await (const chunk of stream) { const txt=chunk.choices[0]?.delta?.content||''; buf+=txt; ctrl.enqueue(enc.encode(`data: ${JSON.stringify({type:'token',text:txt})}\n\n`)) }
      ctrl.enqueue(enc.encode(`data: ${JSON.stringify({type:'done',full:buf})}\n\n`))
      ctrl.close()
    }}), { headers: {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'} })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

app.post('/api/attention/rewrite', async (c) => {
  try {
    const body = await c.req.json()
    const { platform='tiktok', hook_text='', script_excerpt='', issues=[], target_audience='', tone='engaging' } = body
    const systemPrompt = `You are Spectra's Script Rewrite Engine. Output valid JSON:
{"hooks":[{"version":1,"text":"string","strategy":"string","why_it_works":"string"},{"version":2,"text":"string","strategy":"string","why_it_works":"string"},{"version":3,"text":"string","strategy":"string","why_it_works":"string"}],"script_rewrites":[{"version":1,"title":"string","script":"string","structure":"string","tone":"string"},{"version":2,"title":"string","script":"string","structure":"string","tone":"string"}],"pattern_interrupts":["string","string","string"],"cta_options":["string","string","string"],"storytelling_framework":{"name":"string","structure":["string"],"example_applied":"string"},"platform_notes":"string"}`
    const userPrompt = `Rewrite this ${platform} content:\nORIGINAL HOOK: ${hook_text||'Not provided'}\nORIGINAL SCRIPT: ${script_excerpt||'Not provided'}\nISSUES: ${issues.join(', ')||'General optimization'}\nAUDIENCE: ${target_audience||'General'}\nTONE: ${tone}`
    const ai = getAIClient(c.env)
    const stream = await ai.chat.completions.create({ model:'gpt-4o', messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}], stream:true, temperature:0.7, max_tokens:2500 })
    return new Response(new ReadableStream({ async start(ctrl) {
      const enc = new TextEncoder(); let buf = ''
      for await (const chunk of stream) { const txt=chunk.choices[0]?.delta?.content||''; buf+=txt; ctrl.enqueue(enc.encode(`data: ${JSON.stringify({type:'token',text:txt})}\n\n`)) }
      ctrl.enqueue(enc.encode(`data: ${JSON.stringify({type:'done',full:buf})}\n\n`)); ctrl.close()
    }}), { headers: {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'} })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

app.post('/api/attention/score', async (c) => {
  try {
    const body = await c.req.json()
    const { platform='tiktok', metrics={}, duration_sec=60, dropoff_points=[] } = body
    const scores   = computeWeightedScore(metrics, platform)
    const segments = buildSegments(duration_sec, dropoff_points)
    const weights  = PLATFORM_WEIGHTS[platform]
    const hookScore       = dropoff_points.some((d:number)=>d<=5) ? Math.max(scores.composite-30,10) : Math.min(scores.watch_score+15,100)
    const retentionScore  = Math.round(segments.reduce((a:number,s:any)=>a+s.retention,0)/segments.length)
    const engagementScore = Math.round((scores.like_score+scores.comment_score+scores.share_score+scores.save_score)/4)
    const viralScore      = Math.round((scores.share_score*(platform==='tiktok'?1.3:1.0)+scores.comment_score*0.8)/2)
    return c.json({ platform, weights, scores:{ composite:scores.composite, hook:Math.min(hookScore,100), retention:retentionScore, engagement:engagementScore, viral:Math.min(viralScore,100), watch_time:scores.watch_score, shareability:scores.share_score }, segments, signal_breakdown:{ likes:{raw:metrics.likes||0,score:scores.like_score,weight:weights?.likes||0}, comments:{raw:metrics.comments||0,score:scores.comment_score,weight:weights?.comments||0}, shares:{raw:metrics.shares||0,score:scores.share_score,weight:weights?.shares||0}, saves:{raw:metrics.saves||0,score:scores.save_score,weight:weights?.saves||0}, watch_time:{raw:metrics.watch_time_pct||0,score:scores.watch_score,weight:weights?.watch_time||0}, views:{raw:metrics.views||0,score:scores.view_score,weight:weights?.views||0} } })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

app.get('/api/fetch-url', async (c) => {
  const url    = c.req.query('url') || ''
  const ytKey  = c.req.query('yt_key') || c.env.YOUTUBE_API_KEY || ''
  const fbToken = c.req.query('fb_token') || c.env.FB_ACCESS_TOKEN || ''
  if (!url) return c.json({ error: 'No URL provided' }, 400)
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  if (ytMatch) {
    const videoId = ytMatch[1]
    if (!ytKey) return c.json({ error:'YouTube API key required', platform:'youtube', needs_key:true }, 200)
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${ytKey}&part=snippet,statistics,contentDetails`)
      const data: any = await res.json()
      if (!data.items?.length) return c.json({ error:'Video not found', platform:'youtube' }, 200)
      const item=data.items[0]; const stats=item.statistics||{}; const snippet=item.snippet||{}
      const dur=item.contentDetails?.duration||'PT0S'; const dm=dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
      const durSec=(parseInt(dm?.[1]||'0')*3600)+(parseInt(dm?.[2]||'0')*60)+parseInt(dm?.[3]||'0')
      return c.json({ platform:'youtube', title:snippet.title||'', channel:snippet.channelTitle||'', thumbnail:snippet.thumbnails?.high?.url||'', published:snippet.publishedAt||'', duration_sec:durSec, metrics:{ views:parseInt(stats.viewCount||'0'), likes:parseInt(stats.likeCount||'0'), comments:parseInt(stats.commentCount||'0'), shares:0, saves:0, watch_time_pct:0 }, notes:'Shares/saves/watch time not in public API.' })
    } catch(err:any) { return c.json({ error:err.message, platform:'youtube' }, 500) }
  }
  let dp = 'unknown'
  if (url.includes('tiktok.com')) dp='tiktok'
  if (url.includes('twitter.com')||url.includes('x.com')) dp='twitter'
  return c.json({ platform:dp, error:'Auto-populate not available for this platform.', needs_manual:true })
})

/* ══════════════════════════════════════════════════════════════════
   PAGE ROUTES
══════════════════════════════════════════════════════════════════ */
app.get('/tools/attention-engine',   (c) => c.redirect('/tools/attention-engine/'))
app.get('/tools/attention-engine/',  (c) => c.html(attentionEnginePage()))
app.get('/tools/video-generator',    (c) => c.redirect('/tools/video-generator/'))
app.get('/tools/video-generator/',   (c) => c.html(videoGeneratorPage()))
app.get('/tools/distribution-engine',  (c) => c.redirect('/tools/distribution-engine/'))
app.get('/tools/distribution-engine/', (c) => c.html(toolShell('Content Distribution Engine', 'distribution', '#60A5FA')))
app.get('/tools/motion-engine',  (c) => c.redirect('/tools/motion-engine/'))
app.get('/tools/motion-engine/', (c) => c.html(toolShell('Motion Composition Engine', 'motion', '#FB923C')))
app.get('/tools/persona-engine',  (c) => c.redirect('/tools/persona-engine/'))
app.get('/tools/persona-engine/', (c) => c.html(toolShell('Spectra Persona Engine', 'persona', '#F87171')))
app.get('/', (c) => c.html(landingPage()))

export default app

/* ══════════════════════════════════════════════════════════════════
   VIDEO GENERATOR PAGE
══════════════════════════════════════════════════════════════════ */
function videoGeneratorPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Video Generator — Spectra</title>
  <meta name="description" content="AI-powered video production with persistent project memory, character consistency, and multi-model generation.">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/video-generator.css"/>
</head>
<body>
<nav id="vg-nav">
  <a href="/" class="vg-nav-logo">
    <span class="vg-logo-mark">S</span>
    <span>SPECTRA</span>
  </a>
  <div class="vg-nav-center">
    <span class="vg-tool-badge">
      <span class="vg-tool-pip"></span>
      Video Generator
    </span>
  </div>
  <div class="vg-nav-right">
    <button class="vg-keys-btn" id="btn-open-settings" title="Settings">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
      Settings
      <span class="vg-keys-status-dot" id="hf-key-dot"></span>
    </button>
    <a href="/" class="vg-nav-back">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Suite
    </a>
  </div>
</nav>

<!-- AUTH GATE -->
<div id="vg-auth-gate">
  <div class="vg-auth-card">
    <div class="vg-auth-logo"><span class="vg-logo-mark">S</span></div>
    <h2>Video Generator</h2>
    <p>Sign in to access your projects and start generating.</p>
    <div class="vg-auth-tabs">
      <button class="vg-auth-tab active" data-auth-tab="login">Sign In</button>
      <button class="vg-auth-tab" data-auth-tab="register">Create Account</button>
    </div>
    <form id="vg-auth-form">
      <div class="vg-field">
        <input type="email" id="auth-email" class="vg-input" placeholder="Email address" autocomplete="email" required/>
      </div>
      <div class="vg-field">
        <input type="password" id="auth-password" class="vg-input" placeholder="Password (min 8 chars)" autocomplete="current-password" required/>
      </div>
      <div id="auth-error" class="vg-auth-error" style="display:none"></div>
      <button type="submit" class="vg-btn-generate" id="btn-auth-submit" style="width:100%;justify-content:center">
        Sign In
      </button>
    </form>
    <div class="vg-auth-tier-info">
      <div class="vg-tier-chip free">Free — 10 generations/mo</div>
      <div class="vg-tier-chip creator">Creator $29 — 100/mo</div>
      <div class="vg-tier-chip studio">Studio $79 — 500/mo</div>
      <div class="vg-tier-chip pro">Pro $149 — Unlimited</div>
    </div>
  </div>
</div>

<!-- SETTINGS DRAWER -->
<div class="vg-drawer-overlay" id="settings-overlay"></div>
<aside class="vg-settings-drawer" id="settings-drawer">
  <div class="vg-drawer-header">
    <div class="vg-drawer-title">Settings</div>
    <div class="vg-drawer-subtitle">API keys are encrypted at rest and never exposed</div>
    <button class="vg-drawer-close" id="btn-close-settings">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  </div>
  <div class="vg-drawer-body">
    <!-- Account info -->
    <div class="vg-key-block">
      <div class="vg-key-block-header">
        <div class="vg-key-block-info">
          <div class="vg-key-block-name">Account</div>
          <div class="vg-key-block-desc" id="settings-account-info">Loading...</div>
        </div>
        <button class="vg-key-save" id="btn-logout" style="background:rgba(248,113,113,0.1);border-color:rgba(248,113,113,0.3);color:#F87171">Sign Out</button>
      </div>
      <div class="vg-tier-limits-grid" id="settings-limits"></div>
    </div>

    <!-- Higgsfield key -->
    <div class="vg-key-block">
      <div class="vg-key-block-header">
        <div class="vg-key-block-info">
          <div class="vg-key-block-name">Higgsfield API</div>
          <div class="vg-key-block-desc">Format: KEY_ID:KEY_SECRET — found in your Higgsfield Cloud dashboard</div>
        </div>
        <div class="vg-key-block-status" id="hf-key-status">
          <span class="vg-key-dot inactive"></span>
          <span class="vg-key-status-text">Not set</span>
        </div>
      </div>
      <div class="vg-key-input-row">
        <div class="vg-key-field">
          <input type="password" class="vg-key-input" id="key-higgsfield" placeholder="KEY_ID:KEY_SECRET" autocomplete="off" spellcheck="false"/>
          <button class="vg-key-toggle" data-target="key-higgsfield" title="Show/hide">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <button class="vg-key-save" data-save-provider="higgsfield">Save</button>
      </div>
      <a class="vg-key-get-link" href="https://cloud.higgsfield.ai" target="_blank" rel="noopener">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Get your keys → Higgsfield Cloud Dashboard
      </a>
    </div>

    <!-- Upgrade teaser -->
    <div class="vg-upgrade-card">
      <div class="vg-upgrade-title">Upgrade Your Plan</div>
      <div class="vg-upgrade-tiers">
        <div class="vg-upgrade-tier"><span class="vg-ut-name">Creator</span><span class="vg-ut-price">$29/mo</span><span class="vg-ut-shots">100 shots · 5 projects</span></div>
        <div class="vg-upgrade-tier"><span class="vg-ut-name">Studio</span><span class="vg-ut-price">$79/mo</span><span class="vg-ut-shots">500 shots · 25 projects</span></div>
        <div class="vg-upgrade-tier featured"><span class="vg-ut-name">Pro</span><span class="vg-ut-price">$149/mo</span><span class="vg-ut-shots">Unlimited</span></div>
      </div>
      <button class="vg-btn-upgrade" id="btn-upgrade">Upgrade Plan</button>
    </div>
  </div>
</aside>

<!-- MAIN APP (shown after auth) -->
<main id="vg-app" style="display:none">

  <!-- LEFT PANEL -->
  <aside id="vg-input-panel">

    <!-- Project selector -->
    <div class="vg-section">
      <div class="vg-section-label-row">
        <span class="vg-section-label">Project</span>
        <button class="vg-btn-new-project" id="btn-new-project">+ New</button>
      </div>
      <div id="vg-project-selector">
        <div class="vg-project-loading">Loading projects...</div>
      </div>
    </div>

    <!-- Model selector -->
    <div class="vg-section" id="vg-model-section">
      <div class="vg-section-label">Generation Model</div>
      <select id="vg-model-select" class="vg-input vg-select">
        <option value="higgsfield-ai/dop/lite">DoP Lite (Fast · image-to-video)</option>
        <option value="higgsfield-ai/dop/standard" selected>DoP Standard (image-to-video)</option>
        <option value="higgsfield-ai/dop/turbo">DoP Turbo (image-to-video)</option>
        <option value="kling-video/v2.1/pro/image-to-video">Kling 2.1 Pro (Cinematic · i2v)</option>
        <option value="kling-video/v2.1/standard/image-to-video">Kling 2.1 Standard (i2v)</option>
        <option value="bytedance/seedance/v1/pro/image-to-video">Seedance v1 Pro (i2v)</option>
        <option value="bytedance/seedance/v1/lite/image-to-video">Seedance v1 Lite (Fast · i2v)</option>
        <option value="higgsfield-ai/soul/standard">Soul — Text to Image</option>
        <option value="flux-pro/kontext/max/text-to-image">Flux Kontext Max — Text to Image</option>
      </select>
      <div id="vg-model-hint" style="font-size:0.68rem;color:var(--ice-dim);margin-top:0.4rem"></div>
    </div>

    <!-- Aspect ratio -->
    <div class="vg-section">
      <div class="vg-section-label">Aspect Ratio</div>
      <div class="vg-aspect-row">
        <button class="vg-aspect-btn" data-aspect="9:16"><div class="vg-aspect-icon vg-aspect-916"></div><span>9:16</span></button>
        <button class="vg-aspect-btn active" data-aspect="16:9"><div class="vg-aspect-icon vg-aspect-169"></div><span>16:9</span></button>
        <button class="vg-aspect-btn" data-aspect="1:1"><div class="vg-aspect-icon vg-aspect-11"></div><span>1:1</span></button>
        <button class="vg-aspect-btn" data-aspect="4:5"><div class="vg-aspect-icon vg-aspect-45"></div><span>4:5</span></button>
      </div>
    </div>

    <!-- Image input (required for i2v models) -->
    <div class="vg-section" id="vg-image-section">
      <div class="vg-section-label">Reference Image URL <span class="vg-optional" id="vg-image-label-note">(required for video models)</span></div>
      <input type="url" id="vg-image-url" class="vg-input" placeholder="https://... (JPG, PNG, WebP — publicly accessible)"/>
    </div>

    <!-- Prompt -->
    <div class="vg-section">
      <div class="vg-section-label">Shot Prompt <span class="vg-required">*</span></div>
      <div class="vg-textarea-wrap">
        <textarea id="vg-prompt" class="vg-textarea" rows="4"
          placeholder="Describe the shot — subject, action, camera movement, atmosphere...&#10;&#10;e.g. A woman walks through neon-lit Tokyo streets at night, slow tracking shot, rain on pavement, cinematic shallow depth of field"
          maxlength="500"></textarea>
        <span class="vg-char-count" id="vg-prompt-count">0/500</span>
      </div>
      <div class="vg-enhance-row">
        <button class="vg-btn-enhance" id="btn-enhance-prompt">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          Enhance with AI
        </button>
        <span class="vg-enhance-note">GPT-4o rewrites for cinematic quality</span>
      </div>
    </div>

    <!-- Duration -->
    <div class="vg-section">
      <div class="vg-section-label">Duration</div>
      <div class="vg-duration-row">
        <button class="vg-dur-btn active" data-dur="5">5s</button>
        <button class="vg-dur-btn" data-dur="8">8s</button>
        <button class="vg-dur-btn" data-dur="10">10s</button>
        <button class="vg-dur-btn" data-dur="15">15s</button>
      </div>
    </div>

    <!-- Generate button -->
    <div class="vg-actions">
      <button class="vg-btn-generate" id="btn-generate">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Generate Shot
      </button>
      <div class="vg-usage-bar" id="vg-usage-bar">
        <div class="vg-usage-fill" id="vg-usage-fill"></div>
      </div>
      <div class="vg-usage-label" id="vg-usage-label"></div>
    </div>

  </aside>

  <!-- RIGHT PANEL — SHOTS -->
  <section id="vg-output-panel">

    <!-- Project header -->
    <div class="vg-project-header" id="vg-project-header" style="display:none">
      <div class="vg-project-header-left">
        <h2 class="vg-project-name" id="vg-current-project-name"></h2>
        <span class="vg-project-shot-count" id="vg-project-shot-count"></span>
      </div>
      <div class="vg-project-header-right">
        <button class="vg-btn-icon" id="btn-edit-project" title="Edit style bible">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <div id="vg-empty" class="vg-empty-state">
      <div class="vg-empty-icon">
        <svg viewBox="0 0 64 64" fill="none">
          <rect x="6" y="14" width="40" height="28" rx="3" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
          <path d="M46 14l12-6v36l-12-6V14z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" opacity="0.3"/>
          <circle cx="20" cy="26" r="3" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
          <path d="M6 35l12-10 8 8 8-6 12 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
        </svg>
      </div>
      <h2 class="vg-empty-title">Select or create a project</h2>
      <p class="vg-empty-sub">Projects remember your style, characters, and every shot you generate. Your creative memory lives here.</p>
      <button class="vg-btn-generate" id="btn-new-project-empty" style="margin-top:1.5rem">
        + Create First Project
      </button>
    </div>

    <!-- Shot grid -->
    <div id="vg-shot-grid" class="vg-shot-grid" style="display:none"></div>

  </section>

</main>

<!-- NEW PROJECT MODAL -->
<div class="vg-modal-overlay" id="project-modal-overlay">
  <div class="vg-modal" id="project-modal">
    <div class="vg-modal-header">
      <h3 id="project-modal-title">New Project</h3>
      <button class="vg-drawer-close" id="btn-close-project-modal">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="vg-modal-body">
      <div class="vg-field">
        <label class="vg-label">Project Name <span class="vg-required">*</span></label>
        <input type="text" id="project-name-input" class="vg-input" placeholder="e.g. Dark Fantasy Trailer, Brand Campaign Q2"/>
      </div>
      <div class="vg-field">
        <label class="vg-label">Visual Style</label>
        <input type="text" id="project-style-input" class="vg-input" placeholder="e.g. Dark cinematic, neon noir, warm golden hour"/>
      </div>
      <div class="vg-field">
        <label class="vg-label">Mood & Tone</label>
        <input type="text" id="project-mood-input" class="vg-input" placeholder="e.g. Dramatic, melancholic, energetic, ethereal"/>
      </div>
      <div class="vg-field">
        <label class="vg-label">Color Palette</label>
        <input type="text" id="project-palette-input" class="vg-input" placeholder="e.g. Deep blues, teal highlights, desaturated"/>
      </div>
      <div class="vg-field">
        <label class="vg-label">Default Model</label>
        <select id="project-model-select" class="vg-input vg-select">
          <option value="higgsfield-ai/dop/preview">DoP Preview (Recommended)</option>
          <option value="higgsfield-ai/dop/standard">DoP Standard</option>
          <option value="kling-video/v2.1/pro/image-to-video">Kling 2.1 Pro</option>
          <option value="bytedance/seedance/v1/pro/image-to-video">Seedance v1 Pro</option>
        </select>
      </div>
      <div id="project-modal-error" class="vg-auth-error" style="display:none"></div>
    </div>
    <div class="vg-modal-footer">
      <button class="vg-btn-ghost" id="btn-cancel-project-modal">Cancel</button>
      <button class="vg-btn-generate" id="btn-save-project" style="min-width:140px;justify-content:center">Create Project</button>
    </div>
  </div>
</div>

<!-- STYLE BIBLE EDITOR MODAL -->
<div class="vg-modal-overlay" id="bible-modal-overlay">
  <div class="vg-modal" id="bible-modal">
    <div class="vg-modal-header">
      <h3>Edit Style Bible</h3>
      <button class="vg-drawer-close" id="btn-close-bible-modal">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="vg-modal-body">
      <p style="color:var(--ice-dim);font-size:0.82rem;margin-bottom:1.2rem;line-height:1.6">The style bible is injected into every prompt enhancement automatically — keeping all your shots consistent.</p>
      <div class="vg-field">
        <label class="vg-label">Visual Style</label>
        <input type="text" id="bible-style-input" class="vg-input"/>
      </div>
      <div class="vg-field">
        <label class="vg-label">Mood & Tone</label>
        <input type="text" id="bible-mood-input" class="vg-input"/>
      </div>
      <div class="vg-field">
        <label class="vg-label">Color Palette</label>
        <input type="text" id="bible-palette-input" class="vg-input"/>
      </div>
      <div class="vg-field">
        <label class="vg-label">Camera Language</label>
        <input type="text" id="bible-camera-input" class="vg-input" placeholder="e.g. Handheld, Steadicam, Wide establishing shots"/>
      </div>
    </div>
    <div class="vg-modal-footer">
      <button class="vg-btn-ghost" id="btn-cancel-bible-modal">Cancel</button>
      <button class="vg-btn-generate" id="btn-save-bible" style="min-width:140px;justify-content:center">Save Style Bible</button>
    </div>
  </div>
</div>

<div class="vg-copied-toast" id="vg-toast">Copied!</div>

<script src="/static/video-generator.js"></script>
</body>
</html>`
}

/* ══════════════════════════════════════════════════════════════════
   ATTENTION ENGINE PAGE (preserved)
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
<nav id="ae-nav">
  <a href="/" class="ae-nav-logo"><span class="ae-logo-mark">S</span><span class="ae-logo-text">SPECTRA</span></a>
  <div class="ae-nav-center"><span class="ae-tool-badge"><span class="ae-tool-pip"></span>Attention Engine</span></div>
  <div class="ae-nav-right">
    <button class="ae-keys-btn" id="btn-open-keys" title="API Keys">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3"/><path d="M18 5l2 2"/></svg>
      API Keys
      <span class="ae-keys-status-dot" id="keys-status-dot"></span>
    </button>
    <a href="/" class="ae-nav-back"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Suite</a>
  </div>
</nav>
<div class="ae-drawer-overlay" id="keys-overlay"></div>
<aside class="ae-keys-drawer" id="keys-drawer">
  <div class="ae-drawer-header">
    <div class="ae-drawer-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3"/><path d="M18 5l2 2"/></svg>API Keys</div>
    <div class="ae-drawer-subtitle">Keys are stored in your browser only — never sent to our servers</div>
    <button class="ae-drawer-close" id="btn-close-keys"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
  </div>
  <div class="ae-drawer-body">
    <div class="ae-key-block" data-platform="youtube">
      <div class="ae-key-block-header">
        <div class="ae-key-block-icon" style="--kc:#F87171"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg></div>
        <div class="ae-key-block-info"><div class="ae-key-block-name">YouTube Data API v3</div><div class="ae-key-block-desc">Auto-fills title, duration, views, likes, comments from any YouTube URL</div></div>
        <div class="ae-key-block-status" id="yt-status"><span class="ae-key-dot inactive"></span><span class="ae-key-status-text">Not set</span></div>
      </div>
      <div class="ae-key-input-row">
        <div class="ae-key-field"><input type="password" class="ae-key-input" id="key-youtube" placeholder="AIzaSy..." autocomplete="off" spellcheck="false"/><button class="ae-key-toggle" data-target="key-youtube" title="Show/hide"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
        <button class="ae-key-save" data-key="youtube">Save</button>
      </div>
    </div>
    <div class="ae-key-block" data-platform="meta">
      <div class="ae-key-block-header">
        <div class="ae-key-block-icon" style="--kc:#A78BFA"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg></div>
        <div class="ae-key-block-info"><div class="ae-key-block-name">Meta Graph API</div><div class="ae-key-block-desc">Powers both Instagram and Facebook auto-population</div></div>
        <div class="ae-key-block-status" id="meta-status"><span class="ae-key-dot inactive"></span><span class="ae-key-status-text">Not set</span></div>
      </div>
      <div class="ae-key-input-row">
        <div class="ae-key-field"><input type="password" class="ae-key-input" id="key-meta" placeholder="EAAGm0P..." autocomplete="off" spellcheck="false"/><button class="ae-key-toggle" data-target="key-meta" title="Show/hide"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
        <button class="ae-key-save" data-key="meta">Save</button>
      </div>
    </div>
    <div class="ae-keys-summary" id="keys-summary">
      <div class="ae-summary-title">Connection Status</div>
      <div class="ae-summary-row"><span class="ae-sum-label">YouTube</span><span class="ae-sum-val" id="sum-youtube">—</span></div>
      <div class="ae-summary-row"><span class="ae-sum-label">Instagram</span><span class="ae-sum-val" id="sum-instagram">—</span></div>
      <div class="ae-summary-row"><span class="ae-sum-label">Facebook</span><span class="ae-sum-val" id="sum-facebook">—</span></div>
    </div>
  </div>
</aside>
<main id="ae-main">
  <aside id="ae-input-panel">
    <div class="ae-section"><div class="ae-section-label">Platform</div><div class="ae-platform-grid" id="platform-grid"><button class="ae-platform-btn active" data-platform="tiktok"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.75a4.85 4.85 0 01-1.01-.06z"/></svg>TikTok</button><button class="ae-platform-btn" data-platform="instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>Instagram</button><button class="ae-platform-btn" data-platform="youtube"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg>YouTube</button><button class="ae-platform-btn" data-platform="twitter"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>Twitter/X</button><button class="ae-platform-btn" data-platform="facebook"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.024 4.388 11.02 10.125 11.927v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.254h3.328l-.532 3.49h-2.796v8.437C19.612 23.093 24 18.097 24 12.073z"/></svg>Facebook</button><button class="ae-platform-btn" data-platform="ads"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 15l3-4 3 4 3-5"/></svg>Paid Ads</button></div></div>
    <div class="ae-section"><div class="ae-section-label">Content Input</div><div class="ae-input-tabs"><button class="ae-tab active" data-tab="url">URL / Link</button><button class="ae-tab" data-tab="manual">Manual Entry</button></div><div class="ae-tab-content active" id="tab-url"><div class="ae-field"><label class="ae-label">Video / Post URL<span class="ae-url-fetch-spinner" id="url-spinner"></span></label><div class="ae-url-input-wrap"><svg class="ae-input-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13a3 3 0 100-6 3 3 0 000 6z"/><path d="M10 2C5.58 2 2 5.58 2 10s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8z"/></svg><input type="url" id="content-url" class="ae-input" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off"/></div><div class="ae-url-preview" id="url-preview"><img class="ae-url-preview-thumb" id="url-thumb" src="" alt=""/><div class="ae-url-preview-info"><div class="ae-url-preview-title" id="url-preview-title"></div><div class="ae-url-preview-meta" id="url-preview-meta"></div></div></div><div id="url-fetch-note" style="display:none;font-size:0.68rem;color:var(--ice-dim);margin-top:0.4rem;font-style:italic;line-height:1.5"></div></div><div class="ae-field"><label class="ae-label">Hook / Opening Line</label><input type="text" id="hook-text" class="ae-input" placeholder="First 3 seconds of your content..."/></div></div><div class="ae-tab-content" id="tab-manual"><div class="ae-field"><label class="ae-label">Content Description</label><textarea id="content-desc" class="ae-textarea" rows="3" placeholder="Describe your content — topic, format, target audience..."></textarea></div><div class="ae-field"><label class="ae-label">Hook / Opening Line</label><input type="text" id="hook-text-2" class="ae-input" placeholder="First 3 seconds..."/></div><div class="ae-field"><label class="ae-label">Script / Caption</label><textarea id="script-text" class="ae-textarea" rows="4" placeholder="Paste your script or caption here..."></textarea></div></div></div>
    <div class="ae-section"><div class="ae-section-label">Performance Metrics</div><div class="ae-metrics-grid"><div class="ae-field"><label class="ae-label">Views</label><input type="number" id="m-views" class="ae-input ae-metric-input" placeholder="0" min="0"/></div><div class="ae-field"><label class="ae-label">Likes</label><input type="number" id="m-likes" class="ae-input ae-metric-input" placeholder="0" min="0"/></div><div class="ae-field"><label class="ae-label">Comments</label><input type="number" id="m-comments" class="ae-input ae-metric-input" placeholder="0" min="0"/></div><div class="ae-field"><label class="ae-label">Shares</label><input type="number" id="m-shares" class="ae-input ae-metric-input" placeholder="0" min="0"/></div><div class="ae-field"><label class="ae-label">Saves</label><input type="number" id="m-saves" class="ae-input ae-metric-input" placeholder="0" min="0"/></div><div class="ae-field"><label class="ae-label">Watch Time %</label><input type="number" id="m-watchtime" class="ae-input ae-metric-input" placeholder="0" min="0" max="100"/></div></div></div>
    <div class="ae-section"><div class="ae-section-label">Timeline</div><div class="ae-two-col"><div class="ae-field"><label class="ae-label">Duration (seconds)</label><input type="number" id="duration" class="ae-input" placeholder="60" value="60" min="1"/></div><div class="ae-field"><label class="ae-label">Drop-off Points (sec)</label><input type="text" id="dropoff-points" class="ae-input" placeholder="e.g. 3, 15, 42"/></div></div></div>
    <div class="ae-section"><div class="ae-section-label">Rewrite Settings</div><div class="ae-two-col"><div class="ae-field"><label class="ae-label">Target Audience</label><input type="text" id="target-audience" class="ae-input" placeholder="e.g. 18-24 fitness enthusiasts"/></div><div class="ae-field"><label class="ae-label">Tone</label><select id="tone-select" class="ae-input ae-select"><option value="engaging">Engaging</option><option value="urgent">Urgent</option><option value="educational">Educational</option><option value="entertaining">Entertaining</option><option value="professional">Professional</option><option value="raw/authentic">Raw / Authentic</option></select></div></div></div>
    <div class="ae-actions"><button class="ae-btn-analyze" id="btn-analyze"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>Run Analysis</button><button class="ae-btn-score" id="btn-score"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Score Only</button></div>
  </aside>
  <section id="ae-output-panel">
    <div class="ae-empty-state" id="ae-empty"><div class="ae-empty-icon"><svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.3"/><circle cx="32" cy="32" r="16" stroke="currentColor" stroke-width="1.5" opacity="0.5"/><circle cx="32" cy="32" r="5" fill="currentColor" opacity="0.7"/><circle cx="32" cy="12" r="2.5" fill="currentColor" opacity="0.4"/><circle cx="50" cy="42" r="2.5" fill="currentColor" opacity="0.4"/><circle cx="14" cy="42" r="2.5" fill="currentColor" opacity="0.4"/><line x1="32" y1="32" x2="32" y2="14.5" stroke="currentColor" stroke-width="1" opacity="0.3"/><line x1="32" y1="32" x2="48" y2="40.5" stroke="currentColor" stroke-width="1" opacity="0.3"/><line x1="32" y1="32" x2="16" y2="40.5" stroke="currentColor" stroke-width="1" opacity="0.3"/></svg></div><h2 class="ae-empty-title">Attention Engine Ready</h2><p class="ae-empty-sub">Enter your content details and performance metrics on the left, then run the analysis to get a full breakdown.</p><div class="ae-empty-chips"><span class="ae-chip">Drop-off Detection</span><span class="ae-chip">Intelligent Diagnosis</span><span class="ae-chip">Hook Scoring</span><span class="ae-chip">Script Rewrite</span><span class="ae-chip">Platform Weights</span><span class="ae-chip">Optimization Plan</span></div></div>
    <div class="ae-loading" id="ae-loading" style="display:none"><div class="ae-loading-ring"></div><div class="ae-loading-label" id="loading-label">Initializing analysis...</div><div class="ae-loading-stream" id="loading-stream"></div></div>
    <div class="ae-results" id="ae-results" style="display:none">
      <div class="ae-results-header"><div class="ae-results-title"><span class="ae-results-platform-badge" id="results-platform-badge"></span><h2>Analysis Complete</h2></div><div class="ae-results-actions"><button class="ae-btn-icon" id="btn-export" title="Export Report"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button><button class="ae-btn-icon" id="btn-copy" title="Copy Results"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button><button class="ae-btn-icon" id="btn-rerun" title="Re-run Analysis"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg></button></div></div>
      <div class="ae-output-tabs"><button class="ae-output-tab active" data-output-tab="scores">Scores</button><button class="ae-output-tab" data-output-tab="timeline">Timeline</button><button class="ae-output-tab" data-output-tab="diagnosis">Diagnosis</button><button class="ae-output-tab" data-output-tab="optimize">Optimize</button><button class="ae-output-tab" data-output-tab="rewrite">Rewrite</button></div>
      <div class="ae-output-content active" id="out-scores"><div class="ae-score-row" id="score-cards-row"></div><div class="ae-signal-section"><div class="ae-signal-title">Signal Breakdown<span class="ae-signal-platform-label" id="signal-platform-label"></span></div><div class="ae-signal-bars" id="signal-bars"></div></div><div class="ae-verdict-card" id="verdict-card" style="display:none"><div class="ae-verdict-label">INTELLIGENT VERDICT</div><div class="ae-verdict-text" id="verdict-text"></div></div></div>
      <div class="ae-output-content" id="out-timeline"><div class="ae-timeline-header"><div class="ae-tl-legend"><span class="ae-tl-dot normal"></span>Strong<span class="ae-tl-dot warning"></span>Warning<span class="ae-tl-dot critical"></span>Critical Drop-off</div></div><div class="ae-timeline-chart" id="timeline-chart"></div><div class="ae-dropoff-list" id="dropoff-list"></div></div>
      <div class="ae-output-content" id="out-diagnosis"><div class="ae-diagnosis-grid" id="diagnosis-grid"></div><div class="ae-issues-section" id="issues-section" style="display:none"><div class="ae-issues-col"><div class="ae-issues-label critical">⚠ Top Issues</div><ul class="ae-issues-list" id="top-issues-list"></ul></div><div class="ae-issues-col"><div class="ae-issues-label positive">✓ Strengths</div><ul class="ae-issues-list positive" id="strengths-list"></ul></div></div></div>
      <div class="ae-output-content" id="out-optimize"><div class="ae-optimize-list" id="optimize-list"></div><div class="ae-platform-insight-card" id="platform-insight-card" style="display:none"><div class="ae-pi-label">Platform Intelligence</div><div class="ae-pi-grid" id="platform-insight-grid"></div></div></div>
      <div class="ae-output-content" id="out-rewrite"><div class="ae-rewrite-actions"><button class="ae-btn-rewrite" id="btn-run-rewrite"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>Generate Rewrites</button><span class="ae-rewrite-note">Engine will generate 3 hooks + 2 full script rewrites</span></div><div class="ae-rewrite-output" id="rewrite-output"></div></div>
    </div>
  </section>
</main>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="/static/attention-engine.js"></script>
</body>
</html>`
}

/* ══════════════════════════════════════════════════════════════════
   TOOL SHELL
══════════════════════════════════════════════════════════════════ */
function toolShell(name: string, _id: string, color: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${name} — Spectra</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet"><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}:root{--bg:#060810;--ice:#E8F4FD;--accent:#7BB8D4;--glow:#A8D8F0;--border:rgba(168,216,240,0.10);--tool-color:${color}}body{background:var(--bg);color:var(--ice);font-family:'Space Grotesk',sans-serif;min-height:100vh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}nav{display:flex;align-items:center;justify-content:space-between;padding:1.4rem 3rem;border-bottom:1px solid var(--border)}.nav-logo{font-family:'Space Mono',monospace;font-size:0.85rem;letter-spacing:0.30em;color:var(--glow);text-decoration:none;display:flex;align-items:center;gap:0.5rem}.nav-logo-mark{width:26px;height:26px;border:1px solid rgba(168,216,240,0.30);border-radius:5px;display:grid;place-items:center;font-size:0.70rem;font-weight:700}.nav-back{color:rgba(232,244,253,0.45);text-decoration:none;font-size:0.75rem;letter-spacing:0.08em;transition:color 0.2s;display:flex;align-items:center;gap:0.4rem}.nav-back:hover{color:var(--ice)}main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5rem 2rem;text-align:center;gap:2rem}.tool-badge{display:inline-flex;align-items:center;gap:0.55rem;font-family:'Space Mono',monospace;font-size:0.58rem;letter-spacing:0.30em;text-transform:uppercase;color:var(--tool-color);padding:0.35rem 0.85rem;border-radius:20px;border:1px solid color-mix(in srgb,var(--tool-color) 35%,transparent);background:color-mix(in srgb,var(--tool-color) 8%,transparent)}.badge-dot{width:5px;height:5px;border-radius:50%;background:var(--tool-color);animation:blink 2.2s ease-in-out infinite}@keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}.pulse-ring{width:80px;height:80px;border-radius:50%;border:1px solid color-mix(in srgb,var(--tool-color) 40%,transparent);animation:pulse 2.6s ease-in-out infinite}@keyframes pulse{0%,100%{transform:scale(1);opacity:0.4}50%{transform:scale(1.22);opacity:0.85}}h1{font-size:clamp(2.2rem,5vw,3.8rem);font-weight:300;letter-spacing:-0.025em;line-height:1.1}h1 em{font-style:italic;font-weight:400;color:var(--tool-color)}p{color:rgba(232,244,253,0.45);max-width:420px;line-height:1.78;font-size:0.97rem}.btn{display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 1.7rem;border-radius:8px;font-size:0.82rem;font-weight:600;letter-spacing:0.04em;text-decoration:none;transition:all 0.25s;border:1px solid rgba(168,216,240,0.18);color:rgba(232,244,253,0.55)}.btn:hover{border-color:rgba(168,216,240,0.35);color:var(--ice);background:rgba(168,216,240,0.05)}</style></head><body><nav><a href="/" class="nav-logo"><span class="nav-logo-mark">S</span>SPECTRA</a><a href="/" class="nav-back"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Back</a></nav><main><div class="pulse-ring"></div><div class="tool-badge"><span class="badge-dot"></span>Coming Soon</div><h1>${name.split(' ').slice(0,-1).join(' ')} <em>${name.split(' ').at(-1)}</em></h1><p>This module is under active development and will be available in the next Spectra release.</p><a href="/" class="btn">← Return to Spectra</a></main></body></html>`
}

/* ══════════════════════════════════════════════════════════════════
   LANDING PAGE
══════════════════════════════════════════════════════════════════ */
function landingPage(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Spectra — Intelligent Creative Suite</title><meta name="description" content="Spectra — Five Intelligent systems. One unified platform. Infinite creative output."><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet"><link rel="stylesheet" href="/static/style.css"/></head><body><div id="loader"><div class="loader-inner"><div class="loader-word"><span>S</span><span>P</span><span>E</span><span>C</span><span>T</span><span>R</span><span>A</span></div><div class="loader-bar-track"><div class="loader-bar-fill"></div></div><div class="loader-status">Initializing</div></div></div><div id="cursor-dot"></div><div id="cursor-ring"></div><div id="hyper-overlay"></div><div id="node-tooltip"></div><nav id="nav" role="navigation"><a href="/" class="nav-logo"><span class="nav-logo-mark">S</span><span class="nav-logo-text">SPECTRA</span></a><ul class="nav-links" role="list"><li><a href="#scene-tools" class="nav-link">System</a></li><li><a href="#scene-features" class="nav-link">Architecture</a></li><li><a href="#scene-about" class="nav-link">Metrics</a></li><li><a href="#scene-cta" class="nav-link">Launch</a></li></ul><div class="nav-progress"><div class="nav-progress-fill"></div></div></nav><canvas id="world-canvas" aria-hidden="true"></canvas><div id="tool-hud" role="complementary"><div class="hud-label">ACTIVE SYSTEM</div><div class="hud-name"></div><div class="hud-desc"></div><a class="hud-link" href="#">Open Tool <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div><div id="scroll-container"><section class="scene" id="scene-hero" data-scene="0"><div class="scene-ui" id="ui-hero"><p class="hero-pre">Intelligent Creative Suite</p><p class="hero-sub">Five Intelligent systems. One platform.<br>Infinite creative output.</p><div class="hero-ctas"><a href="#scene-tools" class="btn-primary btn-glow cta-scroll"><span>Enter the System</span><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a><a href="#scene-about" class="btn-ghost cta-scroll">Learn More</a></div></div><div class="scroll-cue" aria-hidden="true"><span class="sc-label">scroll</span><div class="sc-line"></div></div></section><section class="scene" id="scene-tools" data-scene="1"><div class="scene-ui" id="ui-tools"><div class="section-eyebrow"><span class="eyebrow-pip"></span>INTELLIGENT SUITE — SELECT A SYSTEM</div><h2 class="section-title">Five Tools.<br><em>One Platform.</em></h2><div class="tools-orbital" role="list" id="tools-list"><button class="tool-node" data-node="0" data-color="purple" role="listitem"><div class="node-accent-bar"></div><div class="node-core"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3" opacity="0.5"/><circle cx="16" cy="16" r="2" fill="currentColor"/></svg></div><div class="node-label"><span class="node-num">01</span><span class="node-name">Attention Engine</span></div><span class="node-status active">Active</span></button><button class="tool-node" data-node="1" data-color="green" role="listitem"><div class="node-accent-bar"></div><div class="node-core"><svg viewBox="0 0 32 32" fill="none"><rect x="3" y="7" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M23 12l6-3v10l-6-3V12z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></div><div class="node-label"><span class="node-num">02</span><span class="node-name">Video Generator</span></div><span class="node-status active">Active</span></button><button class="tool-node" data-node="2" data-color="blue" role="listitem"><div class="node-accent-bar"></div><div class="node-core"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="24" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="27" cy="24" r="3" stroke="currentColor" stroke-width="1.5"/><line x1="16" y1="8" x2="5" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="8" x2="27" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="8" x2="16" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div><div class="node-label"><span class="node-num">03</span><span class="node-name">Distribution Engine</span></div><span class="node-status">Build</span></button><button class="tool-node" data-node="3" data-color="orange" role="listitem"><div class="node-accent-bar"></div><div class="node-core"><svg viewBox="0 0 32 32" fill="none"><path d="M2 20 C8 12, 14 24, 20 14 S28 6, 30 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="30" cy="10" r="2" fill="currentColor"/></svg></div><div class="node-label"><span class="node-num">04</span><span class="node-name">Motion Engine</span></div><span class="node-status">Build</span></button><button class="tool-node" data-node="4" data-color="red" role="listitem"><div class="node-accent-bar"></div><div class="node-core"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="10" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M4 28c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div><div class="node-label"><span class="node-num">05</span><span class="node-name">Persona Engine</span></div><span class="node-status">Build</span></button></div></div></section><section class="scene" id="scene-features" data-scene="2"><div class="scene-ui" id="ui-features"><div class="section-eyebrow"><span class="eyebrow-pip"></span>ARCHITECTURE</div><h2 class="section-title">Built Different.<br><em>By Design.</em></h2><div class="feature-fragments" id="feature-grid"><button class="frag" data-frag="0"><div class="frag-icon-wrap" style="--fc:#A78BFA"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 10V3L4 14h7v7l9-11h-7z" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="frag-body"><div class="frag-title">Real-Time Analysis</div><div class="frag-label">Intelligently processes content at inference speed</div></div></button><button class="frag" data-frag="1"><div class="frag-icon-wrap" style="--fc:#34D399"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg></div><div class="frag-body"><div class="frag-title">Drop-Off Detection</div><div class="frag-label">Pinpoints engagement loss moments</div></div></button><button class="frag" data-frag="2"><div class="frag-icon-wrap" style="--fc:#60A5FA"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div><div class="frag-body"><div class="frag-title">Script Rewrite Engine</div><div class="frag-label">GPT-powered content optimization</div></div></button><button class="frag" data-frag="3"><div class="frag-icon-wrap" style="--fc:#FB923C"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div><div class="frag-body"><div class="frag-title">Performance Scoring</div><div class="frag-label">Quantified content quality metrics</div></div></button><button class="frag" data-frag="4"><div class="frag-icon-wrap" style="--fc:#F472B6"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg></div><div class="frag-body"><div class="frag-title">Multi-Platform Distribution</div><div class="frag-label">Optimal timing across all channels</div></div></button><button class="frag" data-frag="5"><div class="frag-icon-wrap" style="--fc:#A8D8F0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg></div><div class="frag-body"><div class="frag-title">Cinematic Motion Intelligence</div><div class="frag-label">Intelligently composed video motion systems</div></div></button></div></div></section><section class="scene" id="scene-about" data-scene="3"><div class="scene-ui" id="ui-about"><div class="section-eyebrow"><span class="eyebrow-pip"></span>SPECTRA</div><h2 class="section-title">Intelligent at the Speed<br><em>of Thought.</em></h2><p class="section-body">A closed-loop intelligent creative system — content is analyzed, generated, optimized, and distributed at machine speed.</p><div class="metric-row" role="list"><div class="metric" role="listitem"><div class="metric-val" data-count="5">0</div><div class="metric-label">Intelligent Engines</div></div><div class="metric" role="listitem"><div class="metric-val" data-count="100">0</div><div class="metric-label">% Automated</div></div><div class="metric" role="listitem"><div class="metric-val">∞</div><div class="metric-label">Scale</div></div><div class="metric" role="listitem"><div class="metric-val" data-count="1">0</div><div class="metric-label">Unified Platform</div></div></div></div></section><section class="scene" id="scene-cta" data-scene="4"><div class="scene-ui" id="ui-cta"><div class="section-eyebrow"><span class="eyebrow-pip"></span>BEGIN</div><h2 class="cta-title">The system<br><em>is ready.</em></h2><p class="cta-body">Launch the Intelligent Attention Engine — your first portal into the Spectra suite.</p><div class="cta-actions"><a href="/tools/attention-engine/" class="btn-primary btn-glow"><span>Launch Attention Engine</span><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a><a href="#scene-tools" class="btn-ghost cta-scroll">Explore Systems</a></div><div class="cta-brand"><div class="cta-brand-mark">S</div><span class="cta-brand-name">SPECTRA</span></div></div></section></div><script src="https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js"></script><script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script><script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script><script src="/static/main.js"></script></body></html>`
}
