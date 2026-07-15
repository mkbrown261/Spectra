import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import OpenAI from 'openai'

/* ══════════════════════════════════════════════════════════════════
   BINDINGS
══════════════════════════════════════════════════════════════════ */
type Bindings = {
  DB:                    D1Database
  STORAGE:               R2Bucket
  OPENAI_API_KEY:        string
  OPENAI_BASE_URL:       string
  ENCRYPTION_KEY:        string   // 32-byte hex string for AES-256-GCM
  JWT_SECRET:            string
  YOUTUBE_API_KEY:       string
  YOUTUBE_CLIENT_ID:     string
  YOUTUBE_CLIENT_SECRET: string
  FB_ACCESS_TOKEN:       string
  STRIPE_SECRET_KEY:     string   // sk_live_... or sk_test_...
  STRIPE_WEBHOOK_SECRET: string   // whsec_...
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
   R2 VIDEO COPY HELPER  (Item 1)
══════════════════════════════════════════════════════════════════ */
async function copyVideoToR2(params: {
  hfVideoUrl: string
  storage:    R2Bucket
  userId:     string
  shotId:     string
}): Promise<string | null> {
  try {
    const { hfVideoUrl, storage, userId, shotId } = params
    const res = await fetch(hfVideoUrl, { headers: { 'User-Agent': 'Spectra/1.0' } })
    if (!res.ok || !res.body) return null
    const key = `videos/${userId}/${shotId}.mp4`
    await storage.put(key, res.body, {
      httpMetadata: { contentType: 'video/mp4' },
    })
    return key
  } catch {
    return null
  }
}

/* ══════════════════════════════════════════════════════════════════
   STRIPE HELPERS  (Item 2)
══════════════════════════════════════════════════════════════════ */
// Stripe plan IDs — update these with real IDs from your Stripe dashboard
const STRIPE_PRICES: Record<string, string> = {
  creator: 'price_creator_monthly',
  studio:  'price_studio_monthly',
  pro:     'price_pro_monthly',
}

async function stripeRequest(
  path: string,
  method: string,
  body: Record<string, any> | null,
  secretKey: string
): Promise<any> {
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
  }
  if (body) {
    opts.body = new URLSearchParams(
      Object.entries(body).flatMap(([k, v]) =>
        Array.isArray(v) ? v.map((vi, i) => [`${k}[${i}]`, String(vi)]) : [[k, String(v)]]
      )
    ).toString()
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, opts)
  return res.json()
}

// Constant-time HMAC-SHA256 signature verification for Stripe webhooks
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<boolean> {
  try {
    const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')))
    const ts = parts['t']
    const v1 = parts['v1']
    if (!ts || !v1) return false

    const signed = `${ts}.${payload}`
    const enc    = new TextEncoder()
    const key    = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const sig    = await crypto.subtle.sign('HMAC', key, enc.encode(signed))
    const hex    = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
    return hex === v1
  } catch {
    return false
  }
}

/* ══════════════════════════════════════════════════════════════════
   HIGGSFIELD ADAPTER
══════════════════════════════════════════════════════════════════ */
async function hfSubmitJob(params: {
  model:            string
  prompt:           string
  image_url?:       string
  duration?:        number
  aspect_ratio?:    string
  credentials:      string   // KEY_ID:KEY_SECRET — decrypted server-side
  motion_strength?: number   // 1–10, from quality slider
  style_strength?:  number   // 1–10, from quality slider
  detail_strength?: number   // 1–10, from quality slider
}): Promise<{ request_id: string; status: string; status_url: string }> {
  const { model, prompt, image_url, duration, aspect_ratio, credentials,
          motion_strength, style_strength, detail_strength } = params

  const body: Record<string, any> = { prompt }
  if (image_url)    body.image_url       = image_url
  if (duration)     body.duration        = duration
  if (aspect_ratio) body.aspect_ratio    = aspect_ratio
  // Quality parameters — only forward if explicitly set (non-null)
  if (motion_strength != null) body.motion_strength = motion_strength
  if (style_strength  != null) body.style_strength  = style_strength
  if (detail_strength != null) body.detail_strength = detail_strength

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
  const baseURL = env?.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const isOpenRouter = baseURL.includes('openrouter.ai')
  return new OpenAI({
    apiKey:  env?.OPENAI_API_KEY  || '',
    baseURL,
    // OpenRouter requires these headers to identify the app and avoid 403s
    defaultHeaders: isOpenRouter ? {
      'HTTP-Referer': 'https://spectra-b8s.pages.dev',
      'X-Title':      'Spectra',
    } : {},
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
   GPT-4o PROMPT ENHANCER — ADVANCED (mode-aware)
══════════════════════════════════════════════════════════════════ */

// Style preset definitions — injected into prompt enhancement
const STYLE_PRESETS: Record<string, { label: string; modifier: string }> = {
  neon_noir:        { label: 'Neon Noir',        modifier: 'neon-lit cyberpunk noir, wet reflective streets, deep shadows with colored light, high contrast chiaroscuro' },
  golden_hour:      { label: 'Golden Hour',      modifier: 'warm golden hour cinematography, long shadows, lens flare, rich amber and orange tones, hazy atmosphere' },
  studio_clean:     { label: 'Studio Clean',     modifier: 'pristine studio lighting, pure white or charcoal background, sharp product-level detail, commercial photography' },
  analog_grain:     { label: 'Analog Film',      modifier: 'analog 35mm film grain, Kodachrome color palette, slight vignette, vintage lens softness, warm nostalgic tones' },
  arctic_cold:      { label: 'Arctic Cold',      modifier: 'icy cold color palette, desaturated blues and whites, stark minimalist composition, crisp frozen atmosphere' },
  hyperreal:        { label: 'Hyperreal',        modifier: 'hyperrealistic detail, ultra-sharp 8K texture, photorealistic lighting simulation, no stylization' },
  dreamlike:        { label: 'Dreamlike',        modifier: 'ethereal dream sequence, soft bloom, pastel haze, floating particles, surreal impossible geometry' },
  brutalist:        { label: 'Brutalist',        modifier: 'harsh brutalist architecture aesthetic, raw concrete textures, severe geometric shadows, monochrome urban grit' },
  sunset_epic:      { label: 'Sunset Epic',      modifier: 'epic sunset cinematography, silhouette compositions, deep magenta and gold sky, dramatic cloud formations' },
  underwater:       { label: 'Underwater',       modifier: 'underwater cinematography, caustic light patterns, blue-green color wash, floating debris, depth haze' },
  infrared:         { label: 'Infrared',         modifier: 'infrared photography aesthetic, white foliage, dark skies, surreal high-contrast tones, dreamlike landscape' },
  fashion_editorial: { label: 'Fashion Editorial', modifier: 'high-fashion editorial photography, bold graphic composition, strong single light source, luxury aesthetic' },
  horror_dread:     { label: 'Horror Dread',     modifier: 'atmospheric horror cinematography, low key lighting, oppressive shadows, desaturated palette, unsettling stillness' },
  retro_wave:       { label: 'Retrowave',        modifier: 'retrowave synthwave aesthetic, neon pink and blue gradients, grid lines, chrome reflections, 80s futurism' },
  nature_epic:      { label: 'Nature Epic',      modifier: 'epic nature documentary cinematography, drone aerial perspective, sweeping landscape, neutral natural light' },
  minimalist:       { label: 'Minimalist',       modifier: 'stark minimalist composition, single subject, vast negative space, muted neutral palette, clean lines' },
  smoke_haze:       { label: 'Smoke & Haze',    modifier: 'heavy atmospheric haze and smoke, volumetric light shafts, fog machine density, mysterious silhouettes' },
  raw_documentary:  { label: 'Documentary',      modifier: 'raw handheld documentary style, natural available light, observational framing, authentic unposed moments' },
  sci_fi_clinical:  { label: 'Sci-Fi Clinical',  modifier: 'clean sci-fi laboratory aesthetic, cold blue-white lighting, holographic UI elements, antiseptic precision' },
  western_dust:     { label: 'Western Dust',     modifier: 'spaghetti western cinematography, dusty warm tones, extreme closeup eye shots, sparse arid landscape' },
}

// Mode-specific system prompts
const ENHANCE_MODE_PROMPTS: Record<string, string> = {
  cinematic: `You are a world-class AI video director. Transform the prompt into a rich, cinematic production-quality prompt.
- Add specific camera movement (dolly push, orbital tracking, static locked, handheld verité)
- Add precise lighting description (motivated key light, golden fill, practical neon, moonlight)  
- Add lens and depth of field (wide 24mm, compressed 85mm telephoto, anamorphic, deep focus)
- Add atmospheric elements (volumetric fog, dust motes, lens flare, bokeh quality)
- Keep subject/action faithful to original — amplify the visual language
- Output ONLY the enhanced prompt. Max 160 words.`,

  realism: `You are a photorealistic video director. Transform the prompt to maximize believability.
- Emphasize naturalistic lighting (overcast diffuse, window light, practical sources)
- Specify realistic camera (Sony Venice, ARRI Alexa, handheld subtle drift)
- Add authentic environmental detail (ambient occlusion, micro-textures, real physics)
- Remove fantastical elements — ground everything in observable reality
- Mention realistic color grade (low contrast, skin-accurate, slight digital grain)
- Output ONLY the enhanced prompt. Max 160 words.`,

  motion: `You are a motion-design director. Transform the prompt to emphasize movement and dynamics.
- Describe specific movement arcs (sweeping 180° arc, rapid whip pan, slow creep push)
- Add subject motion details (flowing fabric, hair movement, liquid physics, crowd energy)
- Specify momentum and pacing (sudden burst, graceful deceleration, rhythmic pulse)
- Add particle and environmental motion (wind, dust, water, fire behavior)
- Consider frame rate feel (slow-motion stretch, overcranked silky motion)
- Output ONLY the enhanced prompt. Max 160 words.`,

  storytelling: `You are a narrative film director. Transform the prompt to tell a visual story.
- Establish clear subject emotional state and arc
- Add visual storytelling elements (symbolic framing, negative space meaning, color as emotion)
- Specify POV and perspective relationship (intimate close-up, god-eye overhead, character POV)
- Add temporal context (time of day, season, before/during/after key moment)
- Include subtle environmental storytelling (setting details that reveal character)
- Output ONLY the enhanced prompt. Max 160 words.`,

  camera: `You are a cinematography expert. Transform the prompt to showcase exceptional camera craft.
- Lead with the specific shot type (extreme close-up, medium two-shot, cowboy shot, establishing wide)
- Specify exact lens focal length and characteristic (35mm Cooke S4, 50mm vintage Zeiss)
- Define camera movement with precision (fluid head tilt, doorway dolly, shoulder rig walk)
- Add focus technique (rack focus hero-to-background, shallow 1.4 bokeh, deep focus 22)
- Specify exposure and sensor feel (slightly overexposed highlights, lifted blacks)
- Output ONLY the enhanced prompt. Max 160 words.`,
}

async function enhancePromptAdvanced(env: Bindings, params: {
  prompt:       string
  style_bible?: string
  model:        string
  aspect_ratio: string
  mode?:        string
  style_preset?: string
}): Promise<string> {
  try {
    const ai   = getAIClient(env)
    const mode = params.mode || 'cinematic'

    // Build system prompt from mode
    const modePrompt = ENHANCE_MODE_PROMPTS[mode] || ENHANCE_MODE_PROMPTS.cinematic

    // Append style preset modifier if provided
    const presetModifier = params.style_preset && STYLE_PRESETS[params.style_preset]
      ? `\n- Apply this visual style: ${STYLE_PRESETS[params.style_preset].modifier}`
      : ''

    const systemPrompt = `${modePrompt}${presetModifier}
- Reference the generation model: ${params.model}
- Target aspect ratio: ${params.aspect_ratio}${params.style_bible ? `\n- Project style bible: ${params.style_bible}` : ''}`

    const resp = await ai.chat.completions.create({
      model:       'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: params.prompt },
      ],
      temperature: 0.75,
      max_tokens:  220,
    })
    return resp.choices[0]?.message?.content?.trim() || params.prompt
  } catch {
    return params.prompt
  }
}


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
  // Restrict to same origin (pages.dev subdomain) — wildcard + credentials is a browser security violation
  origin: (origin) => {
    if (!origin) return origin  // same-origin requests have no Origin header
    // Allow any *.pages.dev subdomain and localhost for local dev
    if (origin.endsWith('.pages.dev') || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      return origin
    }
    return null  // reject cross-origin credential requests from unknown origins
  },
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
    `SELECT id, name, style_bible, default_provider, default_model, thumbnail_url, shot_count, campaign_id, created_at, updated_at
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
            status, video_url, thumbnail_url, error_message, created_at, completed_at,
            sort_order, seed, style_preset, quality
     FROM shots WHERE project_id = ? ORDER BY sort_order ASC, created_at DESC`
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

// PATCH /api/projects/:projectId/characters/:characterId — edit name / description / ref_image_url
app.patch('/api/projects/:projectId/characters/:characterId', requireAuth, async (c) => {
  try {
    const userId      = c.get('userId')
    const projectId   = c.req.param('projectId')
    const characterId = c.req.param('characterId')

    const project = await c.env.DB.prepare(
      `SELECT id FROM projects WHERE id = ? AND user_id = ?`
    ).bind(projectId, userId).first()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const body = await c.req.json()
    const fields: string[] = []
    const values: any[]    = []

    if (body.name        !== undefined) { fields.push('name = ?');          values.push(body.name.trim()) }
    if (body.description !== undefined) { fields.push('description = ?');   values.push(body.description || null) }
    if (body.ref_image_url !== undefined) { fields.push('ref_image_url = ?'); values.push(body.ref_image_url || null) }

    if (!fields.length) return c.json({ error: 'Nothing to update' }, 400)

    values.push(characterId, projectId)
    await c.env.DB.prepare(
      `UPDATE characters SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`
    ).bind(...values).run()

    return c.json({ ok: true })
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
   CAMPAIGN ROUTES  (H-6: moved from localStorage → D1)
══════════════════════════════════════════════════════════════════ */

// GET /api/campaigns — list all campaigns for the current user
app.get('/api/campaigns', requireAuth, async (c) => {
  const userId = c.get('userId')
  const rows = await c.env.DB.prepare(
    `SELECT id, name, created_at FROM campaigns WHERE user_id = ? ORDER BY created_at ASC`
  ).bind(userId).all<{ id: string; name: string; created_at: string }>()
  return c.json(rows.results ?? [])
})

// POST /api/campaigns — create a new campaign
app.post('/api/campaigns', requireAuth, async (c) => {
  const userId = c.get('userId')
  const body   = await c.req.json()
  const name   = body?.name?.trim()
  if (!name) return c.json({ error: 'name required' }, 400)
  if (name.length > 60) return c.json({ error: 'name too long (max 60 chars)' }, 400)

  const id = uuid()
  await c.env.DB.prepare(
    `INSERT INTO campaigns (id, user_id, name) VALUES (?, ?, ?)`
  ).bind(id, userId, name).run()

  return c.json({ id, name, created_at: new Date().toISOString() }, 201)
})

// DELETE /api/campaigns/:id — delete a campaign (unassigns all projects)
app.delete('/api/campaigns/:id', requireAuth, async (c) => {
  const userId     = c.get('userId')
  const campaignId = c.req.param('id')

  const campaign = await c.env.DB.prepare(
    `SELECT id FROM campaigns WHERE id = ? AND user_id = ?`
  ).bind(campaignId, userId).first()
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404)

  // Unassign all projects that belong to this campaign
  await c.env.DB.prepare(
    `UPDATE projects SET campaign_id = NULL WHERE campaign_id = ? AND user_id = ?`
  ).bind(campaignId, userId).run()

  await c.env.DB.prepare(
    `DELETE FROM campaigns WHERE id = ? AND user_id = ?`
  ).bind(campaignId, userId).run()

  return c.json({ ok: true })
})

// PUT /api/projects/:id/campaign — assign or unassign a project from a campaign
app.put('/api/projects/:id/campaign', requireAuth, async (c) => {
  const userId    = c.get('userId')
  const projectId = c.req.param('id')
  const body      = await c.req.json()

  // campaign_id: string → assign; null → unassign
  const campaignId: string | null = body?.campaign_id ?? null

  // Verify project ownership
  const project = await c.env.DB.prepare(
    `SELECT id FROM projects WHERE id = ? AND user_id = ?`
  ).bind(projectId, userId).first()
  if (!project) return c.json({ error: 'Project not found' }, 404)

  // If assigning, verify the campaign belongs to this user
  if (campaignId !== null) {
    const camp = await c.env.DB.prepare(
      `SELECT id FROM campaigns WHERE id = ? AND user_id = ?`
    ).bind(campaignId, userId).first()
    if (!camp) return c.json({ error: 'Campaign not found' }, 404)
  }

  await c.env.DB.prepare(
    `UPDATE projects SET campaign_id = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
  ).bind(campaignId, projectId, userId).run()

  return c.json({ ok: true, campaign_id: campaignId })
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
      model        = 'higgsfield-ai/dop/standard',
      aspect_ratio = '16:9',
      duration     = 5,
      image_url,
      seed,
      style_preset,
      quality,
      enhance_mode = 'cinematic',
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

    // Enhance prompt with GPT-4o (advanced mode-aware)
    const styleBible = project.style_bible ? JSON.parse(project.style_bible) : null
    const promptEnhanced = await enhancePromptAdvanced(c.env, {
      prompt,
      style_bible:  styleBible ? JSON.stringify(styleBible) : undefined,
      model,
      aspect_ratio,
      mode:         enhance_mode,
      style_preset,
    })

    // Create shot record with pending status (includes new upgrade fields)
    const shotId = uuid()
    await c.env.DB.prepare(
      `INSERT INTO shots (id, project_id, user_id, prompt_raw, prompt_enhanced, provider, model, aspect_ratio, duration, status, seed, style_preset, quality)
       VALUES (?, ?, ?, ?, ?, 'higgsfield', ?, ?, ?, 'pending', ?, ?, ?)`
    ).bind(
      shotId, project_id, userId, prompt, promptEnhanced,
      model, aspect_ratio, duration,
      seed ?? null, style_preset ?? null, quality ?? null,
    ).run()

    // Resolve image_url to absolute — Higgsfield needs a public URL it can fetch
    // If user uploaded via /api/upload, the URL is relative (/api/image/...) — make it absolute
    let absoluteImageUrl: string | undefined = undefined
    if (image_url) {
      if (image_url.startsWith('/')) {
        // Derive origin from the incoming request
        const origin = new URL(c.req.url).origin
        absoluteImageUrl = `${origin}${image_url}`
      } else {
        absoluteImageUrl = image_url
      }
    }

    // Parse quality string "motion:N,style:N,detail:N" → individual strength params
    let motion_strength: number | undefined
    let style_strength:  number | undefined
    let detail_strength: number | undefined
    if (quality) {
      const qParts: Record<string, number> = {}
      String(quality).split(',').forEach(part => {
        const [k, v] = part.trim().split(':')
        const n = parseFloat(v)
        if (k && !isNaN(n)) qParts[k.trim()] = n
      })
      if (qParts.motion != null) motion_strength = qParts.motion
      if (qParts.style  != null) style_strength  = qParts.style
      if (qParts.detail != null) detail_strength = qParts.detail
    }

    // Build Higgsfield body — include seed + quality params if provided
    const hfBody: Record<string, any> = {
      model,
      prompt:      promptEnhanced,
      image_url:   absoluteImageUrl,
      duration,
      aspect_ratio,
      credentials,
      motion_strength,
      style_strength,
      detail_strength,
    }
    if (seed !== undefined && seed !== null) hfBody.seed = seed

    // Submit to Higgsfield
    let hfResult: any
    try {
      hfResult = await hfSubmitJob(hfBody)
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
      ok:              true,
      shot_id:         shotId,
      request_id:      hfResult.request_id,
      status:          'queued',
      prompt_enhanced: promptEnhanced,
      seed:            seed ?? null,
      style_preset:    style_preset ?? null,
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
      const rawUrl = hfStatus.video?.url || hfStatus.images?.[0]?.url || null
      videoUrl  = rawUrl

      // ── Item 1: Copy HF video to R2 for permanent storage ──────
      if (rawUrl && c.env.STORAGE) {
        const r2Key = await copyVideoToR2({
          hfVideoUrl: rawUrl,
          storage:    c.env.STORAGE,
          userId,
          shotId,
        })
        if (r2Key) {
          // Build absolute R2 serve URL
          const origin = new URL(c.req.url).origin
          videoUrl = `${origin}/api/video/${encodeURIComponent(r2Key)}`
        }
      }

      // ── Item 3: Capture thumbnail from HF response ──────────────
      // Higgsfield may return a thumbnail/preview field on completion
      const hfAny = hfStatus as any
      const thumbUrl = hfAny.thumbnail || hfAny.preview || hfAny.poster || null
      if (thumbUrl) {
        await c.env.DB.prepare(
          `UPDATE shots SET thumbnail_url=? WHERE id=?`
        ).bind(thumbUrl, shotId).run()
      }
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

/* ══════════════════════════════════════════════════════════════════
   ITEM 1 — R2 VIDEO SERVE
══════════════════════════════════════════════════════════════════ */

// GET /api/video/:key — serve an R2 video (public — keys are unguessable UUIDs)
app.get('/api/video/:key', async (c) => {
  try {
    if (!c.env.STORAGE) return c.json({ error: 'Storage not configured' }, 500)
    const key    = decodeURIComponent(c.req.param('key'))
    const object = await c.env.STORAGE.get(key)
    if (!object) return c.json({ error: 'Video not found' }, 404)
    const headers = new Headers()
    headers.set('Content-Type', object.httpMetadata?.contentType || 'video/mp4')
    headers.set('Cache-Control', 'public, max-age=31536000')
    headers.set('Accept-Ranges', 'bytes')
    return new Response(object.body, { headers })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   ITEM 2 — STRIPE BILLING
══════════════════════════════════════════════════════════════════ */

// GET /api/billing/status
app.get('/api/billing/status', requireAuth, async (c) => {
  try {
    const userId = c.get('userId')
    const user   = await c.env.DB.prepare(
      `SELECT tier, stripe_customer_id, stripe_subscription_id FROM users WHERE id = ?`
    ).bind(userId).first<{ tier: string; stripe_customer_id: string | null; stripe_subscription_id: string | null }>()
    if (!user) return c.json({ error: 'User not found' }, 404)
    return c.json({
      tier:                    user.tier,
      stripe_customer_id:      user.stripe_customer_id,
      stripe_subscription_id:  user.stripe_subscription_id,
      limits:                  TIER_LIMITS[user.tier] || TIER_LIMITS.free,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// POST /api/billing/checkout — create Stripe Checkout session
app.post('/api/billing/checkout', requireAuth, async (c) => {
  try {
    if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Stripe not configured' }, 500)
    const userId = c.get('userId')
    const email  = c.get('userEmail')
    const { tier } = await c.req.json()
    const priceId = STRIPE_PRICES[tier]
    if (!priceId) return c.json({ error: 'Invalid tier' }, 400)

    const origin = new URL(c.req.url).origin

    // Get or create Stripe customer
    const userRow = await c.env.DB.prepare(
      `SELECT stripe_customer_id FROM users WHERE id = ?`
    ).bind(userId).first<{ stripe_customer_id: string | null }>()

    let customerId = userRow?.stripe_customer_id
    if (!customerId) {
      const customer = await stripeRequest('/customers', 'POST', {
        email,
        metadata: { spectra_user_id: userId },
      }, c.env.STRIPE_SECRET_KEY)
      customerId = customer.id
      await c.env.DB.prepare(
        `UPDATE users SET stripe_customer_id = ? WHERE id = ?`
      ).bind(customerId, userId).run()
    }

    // Create Checkout session
    const session = await stripeRequest('/checkout/sessions', 'POST', {
      customer:             customerId,
      mode:                 'subscription',
      'line_items[0][price]':    priceId,
      'line_items[0][quantity]': '1',
      success_url:          `${origin}/tools/video-generator/?upgraded=1`,
      cancel_url:           `${origin}/tools/video-generator/?upgrade_cancel=1`,
      'metadata[spectra_user_id]': userId,
      'metadata[tier]':     tier,
    }, c.env.STRIPE_SECRET_KEY)

    if (session.error) return c.json({ error: session.error.message }, 400)
    return c.json({ ok: true, url: session.url, session_id: session.id })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// POST /api/billing/webhook — Stripe webhook handler
app.post('/api/billing/webhook', async (c) => {
  try {
    if (!c.env.STRIPE_WEBHOOK_SECRET) return c.json({ error: 'Webhook secret not configured' }, 500)
    const payload   = await c.req.text()
    const sigHeader = c.req.header('stripe-signature') || ''
    const valid     = await verifyStripeSignature(payload, sigHeader, c.env.STRIPE_WEBHOOK_SECRET)
    if (!valid) return c.json({ error: 'Invalid signature' }, 400)

    const event = JSON.parse(payload)

    if (event.type === 'checkout.session.completed') {
      const session  = event.data.object
      const userId   = session.metadata?.spectra_user_id
      const tier     = session.metadata?.tier
      const subId    = session.subscription
      if (userId && tier && TIER_LIMITS[tier]) {
        await c.env.DB.prepare(
          `UPDATE users SET tier = ?, stripe_subscription_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(tier, subId || null, userId).run()
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub      = event.data.object
      const custId   = sub.customer
      if (custId) {
        await c.env.DB.prepare(
          `UPDATE users SET tier = 'free', stripe_subscription_id = NULL, updated_at = datetime('now')
           WHERE stripe_customer_id = ?`
        ).bind(custId).run()
      }
    } else if (event.type === 'customer.subscription.updated') {
      const sub    = event.data.object
      const custId = sub.customer
      const status = sub.status
      // If subscription becomes past_due or unpaid, downgrade
      if (custId && ['past_due', 'unpaid', 'canceled'].includes(status)) {
        await c.env.DB.prepare(
          `UPDATE users SET tier = 'free', updated_at = datetime('now') WHERE stripe_customer_id = ?`
        ).bind(custId).run()
      }
    }

    return c.json({ received: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   ITEM 3 — THUMBNAIL
══════════════════════════════════════════════════════════════════ */

// PATCH /api/shots/:shotId/thumbnail — manually set thumbnail URL
app.patch('/api/shots/:shotId/thumbnail', requireAuth, async (c) => {
  try {
    const userId  = c.get('userId')
    const shotId  = c.req.param('shotId')
    const { thumbnail_url } = await c.req.json()
    if (!thumbnail_url) return c.json({ error: 'thumbnail_url required' }, 400)

    const shot = await c.env.DB.prepare(
      `SELECT id FROM shots WHERE id = ? AND user_id = ?`
    ).bind(shotId, userId).first()
    if (!shot) return c.json({ error: 'Shot not found' }, 404)

    await c.env.DB.prepare(
      `UPDATE shots SET thumbnail_url = ? WHERE id = ?`
    ).bind(thumbnail_url, shotId).run()

    return c.json({ ok: true, thumbnail_url })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   ITEM 4 — SHOT REORDER
══════════════════════════════════════════════════════════════════ */

// PATCH /api/projects/:projectId/reorder — reorder shots
app.patch('/api/projects/:projectId/reorder', requireAuth, async (c) => {
  try {
    const userId    = c.get('userId')
    const projectId = c.req.param('projectId')

    const project = await c.env.DB.prepare(
      `SELECT id FROM projects WHERE id = ? AND user_id = ?`
    ).bind(projectId, userId).first()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const { shot_ids } = await c.req.json()
    if (!Array.isArray(shot_ids) || shot_ids.length === 0) {
      return c.json({ error: 'shot_ids array required' }, 400)
    }

    // Apply sort_order in one batch (D1 supports individual prepare/run)
    const stmts = shot_ids.map((id: string, idx: number) =>
      c.env.DB.prepare(
        `UPDATE shots SET sort_order = ? WHERE id = ? AND project_id = ? AND user_id = ?`
      ).bind(idx, id, projectId, userId)
    )
    await c.env.DB.batch(stmts)

    return c.json({ ok: true, count: shot_ids.length })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   ITEM 5 — CHARACTER SOUL TRAINING
══════════════════════════════════════════════════════════════════ */

// POST /api/projects/:id/characters/train — initiate Higgsfield Soul training
app.post('/api/projects/:id/characters/train', requireAuth, async (c) => {
  try {
    const userId    = c.get('userId')
    const projectId = c.req.param('id')

    const project = await c.env.DB.prepare(
      `SELECT id FROM projects WHERE id = ? AND user_id = ?`
    ).bind(projectId, userId).first()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const { character_id } = await c.req.json()
    if (!character_id) return c.json({ error: 'character_id required' }, 400)

    const character = await c.env.DB.prepare(
      `SELECT id, name, ref_image_url, soul_id FROM characters WHERE id = ? AND project_id = ?`
    ).bind(character_id, projectId).first<{
      id: string; name: string; ref_image_url: string | null; soul_id: string | null
    }>()
    if (!character) return c.json({ error: 'Character not found' }, 404)
    if (!character.ref_image_url) return c.json({ error: 'Character needs a reference image before training' }, 400)

    // Decrypt Higgsfield key
    const keyRow = await c.env.DB.prepare(
      `SELECT encrypted_key, iv FROM api_keys WHERE user_id = ? AND provider = 'higgsfield'`
    ).bind(userId).first<{ encrypted_key: string; iv: string }>()
    if (!keyRow) return c.json({ error: 'No Higgsfield API key saved. Go to Settings.' }, 400)
    if (!c.env.ENCRYPTION_KEY) return c.json({ error: 'Server encryption not configured' }, 500)
    const credentials = await decryptKey(keyRow.encrypted_key, keyRow.iv, c.env.ENCRYPTION_KEY)

    // Resolve ref_image_url to absolute if relative
    let refImageUrl = character.ref_image_url
    if (refImageUrl.startsWith('/')) {
      const origin = new URL(c.req.url).origin
      refImageUrl  = `${origin}${refImageUrl}`
    }

    // Submit Soul training job to Higgsfield
    // Soul training endpoint: POST /higgsfield-ai/soul/train
    const res = await fetch(`${HF_BASE}/higgsfield-ai/soul/train`, {
      method:  'POST',
      headers: {
        'Authorization': `Key ${credentials}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify({
        name:       character.name,
        image_url:  refImageUrl,
      }),
    })

    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText)
      return c.json({ error: `Higgsfield Soul training error ${res.status}: ${txt}` }, 502)
    }

    const trainResult: any = await res.json()
    const soulId = trainResult.soul_id || trainResult.id || null

    // If Higgsfield returned a soul_id immediately (sync response) → store it.
    // If training is async (soul_id comes later via poll) → store placeholder 'pending'
    // so the UI knows training is in-flight without overwriting a real soul_id later.
    const valueToStore = soulId || 'pending'
    await c.env.DB.prepare(
      `UPDATE characters SET soul_id = ? WHERE id = ?`
    ).bind(valueToStore, character_id).run()

    return c.json({
      ok:          true,
      character_id,
      soul_id:     soulId,
      status:      trainResult.status || 'submitted',
      message:     soulId ? 'Soul training started — Soul ready!' : 'Soul training submitted — polling for completion…',
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   CHARACTER SOUL STATUS POLL
══════════════════════════════════════════════════════════════════ */

// GET /api/projects/:id/characters/:charId/soul-status
// Checks Higgsfield for training completion, writes soul_id to D1 when done
app.get('/api/projects/:id/characters/:charId/soul-status', requireAuth, async (c) => {
  try {
    const userId      = c.get('userId')
    const projectId   = c.req.param('id')
    const characterId = c.req.param('charId')

    const project = await c.env.DB.prepare(
      `SELECT id FROM projects WHERE id = ? AND user_id = ?`
    ).bind(projectId, userId).first()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const character = await c.env.DB.prepare(
      `SELECT id, name, soul_id FROM characters WHERE id = ? AND project_id = ?`
    ).bind(characterId, projectId).first<{ id: string; name: string; soul_id: string | null }>()
    if (!character) return c.json({ error: 'Character not found' }, 404)

    // Already trained — no need to poll
    if (character.soul_id) {
      return c.json({ status: 'ready', soul_id: character.soul_id })
    }

    // Need Higgsfield key to poll
    const keyRow = await c.env.DB.prepare(
      `SELECT encrypted_key, iv FROM api_keys WHERE user_id = ? AND provider = 'higgsfield'`
    ).bind(userId).first<{ encrypted_key: string; iv: string }>()
    if (!keyRow) return c.json({ status: 'no_key' })
    if (!c.env.ENCRYPTION_KEY) return c.json({ error: 'Server encryption not configured' }, 500)

    const credentials = await decryptKey(keyRow.encrypted_key, keyRow.iv, c.env.ENCRYPTION_KEY)

    // Poll Higgsfield for this character's soul by name
    // GET /higgsfield-ai/soul/list — returns array of { soul_id, name, status }
    const listRes = await fetch(`${HF_BASE}/higgsfield-ai/soul/list`, {
      method:  'GET',
      headers: {
        'Authorization': `Key ${credentials}`,
        'Accept':        'application/json',
      },
    })

    if (!listRes.ok) {
      return c.json({ status: 'pending' })   // Can't reach API — treat as still pending
    }

    const souls: any[] = await listRes.json().catch(() => [])
    const match = Array.isArray(souls)
      ? souls.find((s: any) =>
          s.name === character.name ||
          s.soul_id === character.soul_id ||
          s.id === character.soul_id
        )
      : null

    if (!match) return c.json({ status: 'pending' })

    const soulStatus = match.status || 'unknown'
    const soulId     = match.soul_id || match.id || null

    // If training finished, persist soul_id
    if ((soulStatus === 'ready' || soulStatus === 'trained' || soulStatus === 'completed') && soulId) {
      await c.env.DB.prepare(
        `UPDATE characters SET soul_id = ? WHERE id = ?`
      ).bind(soulId, characterId).run()
      return c.json({ status: 'ready', soul_id: soulId })
    }

    return c.json({ status: soulStatus, soul_id: soulId })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   ANALYTICS ROUTE
══════════════════════════════════════════════════════════════════ */

// GET /api/analytics?range=7d|30d|90d|all
app.get('/api/analytics', requireAuth, async (c) => {
  try {
    const userId = c.get('userId')
    const range  = c.req.query('range') || '30d'

    // Build date filter
    const dateFilter: Record<string, string> = {
      '7d':  `datetime('now', '-7 days')`,
      '30d': `datetime('now', '-30 days')`,
      '90d': `datetime('now', '-90 days')`,
      'all': `datetime('2000-01-01')`,
    }
    const since = dateFilter[range] || dateFilter['30d']

    // ── 1. OVERVIEW STATS ─────────────────────────────────────────
    const overview = await c.env.DB.prepare(`
      SELECT
        COUNT(*)                                                  AS total_shots,
        SUM(CASE WHEN status='completed'   THEN 1 ELSE 0 END)    AS completed,
        SUM(CASE WHEN status='failed'      THEN 1 ELSE 0 END)    AS failed,
        SUM(CASE WHEN status='nsfw'        THEN 1 ELSE 0 END)    AS nsfw,
        SUM(CASE WHEN status IN ('queued','in_progress') THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status='completed' AND duration IS NOT NULL THEN duration ELSE 0 END) AS total_seconds,
        AVG(CASE WHEN status='completed'
            AND completed_at IS NOT NULL AND created_at IS NOT NULL
            THEN (julianday(completed_at) - julianday(created_at)) * 86400.0
            ELSE NULL END) AS avg_gen_time_sec,
        -- P50 estimate via count-based approximation (SQLite has no PERCENTILE)
        MIN(CASE WHEN status='completed'
            AND completed_at IS NOT NULL
            THEN (julianday(completed_at) - julianday(created_at)) * 86400.0
            ELSE NULL END) AS min_gen_time_sec,
        MAX(CASE WHEN status='completed'
            AND completed_at IS NOT NULL
            THEN (julianday(completed_at) - julianday(created_at)) * 86400.0
            ELSE NULL END) AS max_gen_time_sec
      FROM shots
      WHERE user_id = ? AND created_at >= ${since}
    `).bind(userId).first<any>()

    // ── 2. PER-MODEL BREAKDOWN ────────────────────────────────────
    const modelRows = await c.env.DB.prepare(`
      SELECT
        model,
        COUNT(*)                                                  AS total,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)      AS completed,
        SUM(CASE WHEN status='failed'    THEN 1 ELSE 0 END)      AS failed,
        SUM(CASE WHEN status='nsfw'      THEN 1 ELSE 0 END)      AS nsfw,
        SUM(CASE WHEN status IN ('queued','in_progress') THEN 1 ELSE 0 END) AS active,
        AVG(CASE WHEN status='completed'
            AND completed_at IS NOT NULL AND created_at IS NOT NULL
            THEN (julianday(completed_at) - julianday(created_at)) * 86400.0
            ELSE NULL END) AS avg_gen_sec,
        MIN(CASE WHEN status='completed'
            AND completed_at IS NOT NULL
            THEN (julianday(completed_at) - julianday(created_at)) * 86400.0
            ELSE NULL END) AS min_gen_sec,
        MAX(CASE WHEN status='completed'
            AND completed_at IS NOT NULL
            THEN (julianday(completed_at) - julianday(created_at)) * 86400.0
            ELSE NULL END) AS max_gen_sec,
        SUM(CASE WHEN status='completed' AND duration IS NOT NULL THEN duration ELSE 0 END) AS total_seconds_gen
      FROM shots
      WHERE user_id = ? AND created_at >= ${since}
      GROUP BY model
      ORDER BY total DESC
    `).bind(userId).all<any>()

    // ── 3. DAILY ACTIVITY (last N days, padded) ───────────────────
    const dailyRows = await c.env.DB.prepare(`
      SELECT
        date(created_at) AS day,
        COUNT(*)         AS total,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status='failed' OR status='nsfw' THEN 1 ELSE 0 END) AS failed
      FROM shots
      WHERE user_id = ? AND created_at >= ${since}
      GROUP BY date(created_at)
      ORDER BY day ASC
    `).bind(userId).all<any>()

    // ── 4. ASPECT RATIO DISTRIBUTION ─────────────────────────────
    const aspectRows = await c.env.DB.prepare(`
      SELECT aspect_ratio, COUNT(*) AS count
      FROM shots
      WHERE user_id = ? AND created_at >= ${since}
      GROUP BY aspect_ratio
      ORDER BY count DESC
    `).bind(userId).all<any>()

    // ── 5. DURATION DISTRIBUTION ──────────────────────────────────
    const durationRows = await c.env.DB.prepare(`
      SELECT duration, COUNT(*) AS count
      FROM shots
      WHERE user_id = ? AND created_at >= ${since}
      GROUP BY duration
      ORDER BY duration ASC
    `).bind(userId).all<any>()

    // ── 6. PROJECT VELOCITY ───────────────────────────────────────
    const projectRows = await c.env.DB.prepare(`
      SELECT
        p.id, p.name,
        COUNT(s.id)                                                     AS total_shots,
        SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END)          AS completed_shots,
        MAX(s.created_at)                                               AS last_shot_at
      FROM projects p
      LEFT JOIN shots s ON s.project_id = p.id AND s.created_at >= ${since}
      WHERE p.user_id = ?
      GROUP BY p.id, p.name
      ORDER BY total_shots DESC
      LIMIT 10
    `).bind(userId).all<any>()

    // ── 7. ESTIMATED COST (rough per-model pricing) ───────────────
    // Approximate credit cost per second of output video
    const MODEL_COST_PER_SEC: Record<string, number> = {
      'higgsfield-ai/dop/lite':                        0.06,
      'higgsfield-ai/dop/standard':                    0.09,
      'higgsfield-ai/dop/turbo':                       0.12,
      'kling-video/v2.1/pro/image-to-video':           0.14,
      'kling-video/v2.1/standard/image-to-video':      0.09,
      'bytedance/seedance/v1/pro/image-to-video':      0.10,
      'bytedance/seedance/v1/lite/image-to-video':     0.06,
      'higgsfield-ai/soul/standard':                   0.05,
      'flux-pro/kontext/max/text-to-image':            0.04,
    }

    // Build per-model cost and P90 estimates
    const models = modelRows.results.map((row: any) => {
      const costPerSec = MODEL_COST_PER_SEC[row.model] || 0.08
      const estCost    = ((row.total_seconds_gen || 0) * costPerSec).toFixed(2)
      // P90 estimate: if avg is available, P90 ≈ avg * 1.3 (rough heuristic without ORDER BY on aggregates)
      const p90 = row.avg_gen_sec ? Math.round(row.avg_gen_sec * 1.3) : null
      const p50 = row.avg_gen_sec ? Math.round(row.avg_gen_sec)       : null
      const successRate = row.total > 0 ? Math.round((row.completed / row.total) * 100) : 0
      return {
        ...row,
        success_rate:   successRate,
        p50_gen_sec:    p50,
        p90_gen_sec:    p90,
        est_cost_usd:   estCost,
        cost_per_sec:   costPerSec,
        label:          modelLabel(row.model),
        family:         modelFamily(row.model),
      }
    })

    // Total estimated cost across all models
    const totalCost = models.reduce((acc: number, m: any) => acc + parseFloat(m.est_cost_usd), 0)

    // Overall success rate
    const successRate = (overview?.total_shots || 0) > 0
      ? Math.round(((overview?.completed || 0) / (overview?.total_shots || 1)) * 100)
      : 0

    return c.json({
      range,
      overview: {
        ...(overview || {}),
        success_rate:   successRate,
        total_cost_usd: totalCost.toFixed(2),
      },
      models,
      daily:        dailyRows.results,
      aspect_ratio: aspectRows.results,
      duration:     durationRows.results,
      projects:     projectRows.results,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// Helper: short label for a model slug
function modelLabel(id: string): string {
  const MAP: Record<string, string> = {
    'higgsfield-ai/dop/lite':                        'DoP Lite',
    'higgsfield-ai/dop/standard':                    'DoP Standard',
    'higgsfield-ai/dop/turbo':                       'DoP Turbo',
    'kling-video/v2.1/pro/image-to-video':           'Kling 2.1 Pro',
    'kling-video/v2.1/standard/image-to-video':      'Kling 2.1 Std',
    'bytedance/seedance/v1/pro/image-to-video':      'Seedance Pro',
    'bytedance/seedance/v1/lite/image-to-video':     'Seedance Lite',
    'higgsfield-ai/soul/standard':                   'Soul',
    'flux-pro/kontext/max/text-to-image':            'Flux Kontext',
  }
  return MAP[id] || id.split('/').pop() || id
}

// Helper: model family for grouping/coloring
function modelFamily(id: string): string {
  if (id.includes('dop'))      return 'dop'
  if (id.includes('soul'))     return 'soul'
  if (id.includes('kling'))    return 'kling'
  if (id.includes('seedance')) return 'seedance'
  if (id.includes('flux'))     return 'flux'
  return 'other'
}

// POST /api/enhance-prompt — standalone prompt enhancer with mode support
app.post('/api/enhance-prompt', requireAuth, async (c) => {
  try {
    const {
      prompt,
      model        = 'higgsfield-ai/dop/standard',
      aspect_ratio = '16:9',
      style_bible,
      mode         = 'cinematic',
      style_preset,
    } = await c.req.json()
    if (!prompt?.trim()) return c.json({ error: 'Prompt required' }, 400)

    const enhanced = await enhancePromptAdvanced(c.env, {
      prompt,
      model,
      aspect_ratio,
      style_bible,
      mode,
      style_preset,
    })
    return c.json({ original: prompt, enhanced, mode })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   #10 AI CREATIVE DIRECTOR — POST /api/director
   Converts a scene concept into a structured shot list via GPT-4o
══════════════════════════════════════════════════════════════════ */
app.post('/api/director', requireAuth, async (c) => {
  try {
    const {
      concept,
      style_bible,
      aspect_ratio = '16:9',
      shot_count   = 4,
    } = await c.req.json()

    if (!concept?.trim()) return c.json({ error: 'Concept required' }, 400)

    const ai = getAIClient(c.env)

    const bibleContext = style_bible
      ? `\nProject style bible: ${typeof style_bible === 'string' ? style_bible : JSON.stringify(style_bible)}`
      : ''

    const systemPrompt = `You are a world-class AI video director. A user gives you a scene concept and you break it down into ${shot_count} production-ready individual shots for an AI video generator.

For each shot return a JSON object with EXACTLY these fields:
- "shot": shot number (1..${shot_count})
- "label": short shot name (≤6 words, e.g. "Hero Arrives" or "Close-Up Product")
- "prompt": rich, cinematic, production-ready prompt (80-140 words) including subject, action, camera movement, lighting, atmosphere, depth of field
- "model": the best model ID from this list for the shot:
    "higgsfield-ai/dop/standard" (all-round i2v)
    "higgsfield-ai/dop/turbo" (max quality i2v)
    "higgsfield-ai/dop/lite" (fast i2v draft)
    "kling-video/v2.1/pro/image-to-video" (cinematic premium i2v)
    "bytedance/seedance/v1/pro/image-to-video" (high fidelity i2v)
    "flux-pro/kontext/max/text-to-image" (text-to-image, no ref needed)
- "aspect_ratio": "16:9", "9:16", or "1:1" — match the mood
- "duration": 5, 8, or 10 — in seconds
- "requires_image": true if model needs a reference image, false otherwise
- "director_note": 1-sentence creative note explaining the shot choice${bibleContext}

Return ONLY a JSON array of ${shot_count} shot objects. No prose, no markdown, no explanation.`

    const resp = await ai.chat.completions.create({
      model:       'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: concept.trim() },
      ],
      temperature:     0.8,
      max_tokens:      2000,
    })

    let raw = resp.choices[0]?.message?.content?.trim() || '[]'

    // GPT sometimes wraps in {"shots":[...]} — unwrap
    let shots: any[]
    try {
      const parsed = JSON.parse(raw)
      shots = Array.isArray(parsed) ? parsed : (parsed.shots || parsed.shot_list || Object.values(parsed)[0] || [])
    } catch {
      return c.json({ error: 'Director failed to parse shot list' }, 500)
    }

    // Clamp and sanitise
    shots = shots.slice(0, shot_count).map((s: any, i: number) => ({
      shot:           s.shot           ?? i + 1,
      label:          String(s.label   ?? `Shot ${i + 1}`).slice(0, 60),
      prompt:         String(s.prompt  ?? '').slice(0, 400),
      model:          String(s.model   ?? 'higgsfield-ai/dop/standard'),
      aspect_ratio:   ['16:9','9:16','1:1'].includes(s.aspect_ratio) ? s.aspect_ratio : '16:9',
      duration:       [5,8,10].includes(Number(s.duration)) ? Number(s.duration) : 5,
      requires_image: Boolean(s.requires_image ?? true),
      director_note:  String(s.director_note ?? '').slice(0, 200),
    }))

    return c.json({ shots, concept: concept.trim() })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// POST /api/upload — upload reference image to R2, return public URL
app.post('/api/upload', requireAuth, async (c) => {
  try {
    if (!c.env.STORAGE) return c.json({ error: 'Storage not configured' }, 500)

    const formData  = await c.req.formData()
    const file      = formData.get('file') as File | null
    if (!file) return c.json({ error: 'No file provided' }, 400)

    // Validate image type
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowed.includes(file.type)) {
      return c.json({ error: 'Only JPEG, PNG, WebP and GIF images are supported' }, 400)
    }

    // 10MB size limit
    if (file.size > 10 * 1024 * 1024) {
      return c.json({ error: 'Image must be under 10MB' }, 400)
    }

    const userId  = c.get('userId')
    const ext     = file.type.split('/')[1].replace('jpeg', 'jpg')
    const key     = `uploads/${userId}/${uuid()}.${ext}`

    const buffer  = await file.arrayBuffer()
    await c.env.STORAGE.put(key, buffer, {
      httpMetadata: { contentType: file.type },
    })

    // Return both relative path (for display) and absolute URL (for Higgsfield)
    const relativeUrl = `/api/image/${encodeURIComponent(key)}`
    const origin      = new URL(c.req.url).origin
    const absoluteUrl = `${origin}${relativeUrl}`

    return c.json({ ok: true, url: relativeUrl, absoluteUrl, key, size: file.size, type: file.type })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/image/:key — serve an R2 image (public — Higgsfield fetches this URL directly)
app.get('/api/image/:key', async (c) => {
  try {
    if (!c.env.STORAGE) return c.json({ error: 'Storage not configured' }, 500)
    const key    = decodeURIComponent(c.req.param('key'))
    const object = await c.env.STORAGE.get(key)
    if (!object) return c.json({ error: 'Image not found' }, 404)
    const headers = new Headers()
    headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg')
    headers.set('Cache-Control', 'public, max-age=31536000')
    return new Response(object.body, { headers })
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

// Content-type-specific normalization multipliers.
// These represent what a "perfect" score (100/100) looks like for each format.
// Higher multiplier = harder to reach 100 (tougher benchmark).
// Lower multiplier = easier to reach 100 (lower expectation for that signal).
const CONTENT_TYPE_BENCHMARKS: Record<string, Record<string, number>> = {
  // Organic video: standard social benchmarks
  organic_video: { likes: 20, comments: 40, shares: 50, saves: 60, watch_time: 1, views: 1000 },
  // Music video: high like/comment norms, rewatch is key — watch_time weighted harder
  music_video:   { likes: 12, comments: 25, shares: 40, saves: 50, watch_time: 1, views: 800 },
  // Commercial: very low like expectations for paid, watch_time is primary success metric
  commercial:    { likes: 100, comments: 200, shares: 80, saves: 120, watch_time: 1, views: 500 },
  // Short-form ad: almost no likes/comments expected, completion is everything
  short_form_ad: { likes: 200, comments: 400, shares: 100, saves: 150, watch_time: 1, views: 300 },
  // Tutorial: saves are the star metric (people bookmark tutorials)
  tutorial:      { likes: 25, comments: 35, shares: 55, saves: 20, watch_time: 1, views: 1200 },
  // Vlog: comments are the primary community signal
  vlog:          { likes: 15, comments: 20, shares: 55, saves: 70, watch_time: 1, views: 1000 },
  // Documentary: long watch time expected, saves+shares matter, likes less so
  documentary:   { likes: 18, comments: 22, shares: 35, saves: 30, watch_time: 1, views: 1500 },
  // Product demo: saves dominate (purchase intent), click-through proxied by shares
  product_demo:  { likes: 22, comments: 30, shares: 45, saves: 15, watch_time: 1, views: 900 },
}

function computeWeightedScore(metrics: any, platform: string, content_type = 'organic_video'): Record<string, number> {
  const platformWeights = PLATFORM_WEIGHTS[platform] || PLATFORM_WEIGHTS.tiktok
  const benchmarks      = CONTENT_TYPE_BENCHMARKS[content_type] || CONTENT_TYPE_BENCHMARKS.organic_video
  const { views=0, likes=0, comments=0, shares=0, saves=0, watch_time_pct=0 } = metrics

  // Normalize each metric against its content-type benchmark multiplier
  // (multiplier is the denominator: higher = tougher standard for 100)
  const likeRate    = views > 0 ? Math.min((likes    / views) * 100 * benchmarks.likes,    100) : 0
  const commentRate = views > 0 ? Math.min((comments / views) * 100 * benchmarks.comments, 100) : 0
  const shareRate   = views > 0 ? Math.min((shares   / views) * 100 * benchmarks.shares,   100) : 0
  const saveRate    = views > 0 ? Math.min((saves    / views) * 100 * benchmarks.saves,    100) : 0
  const wtScore     = Math.min(watch_time_pct, 100)
  const viewScore   = Math.min(views / benchmarks.views, 100)

  const raw: Record<string, number> = { likes: likeRate, comments: commentRate, shares: shareRate, saves: saveRate, watch_time: wtScore, views: viewScore }
  let composite = 0
  for (const [k, w] of Object.entries(platformWeights)) composite += (raw[k] || 0) * w
  return { composite: Math.round(composite), like_score: Math.round(likeRate), comment_score: Math.round(commentRate), share_score: Math.round(shareRate), save_score: Math.round(saveRate), watch_score: Math.round(wtScore), view_score: Math.round(viewScore) }
}

// Returns base retention at segment i/segCount for a given content type.
// Each curve shape reflects the typical audience behavior for that format.
function baseRetention(t: number, contentType: string): number {
  switch (contentType) {
    case 'music_video':
      // Sharp hook spike at start, brief valley, peak at chorus (~40–60%), gradual tail
      // Pattern: high open, slight dip, big chorus peak, slow close
      if (t < 0.05) return 96
      if (t < 0.15) return 88 - Math.random()*5   // slight post-hook settle
      if (t < 0.35) return 78 - t*12              // building to chorus
      if (t < 0.55) return 84 - t*8               // chorus peak — retention goes UP slightly
      if (t < 0.75) return 76 - t*20              // post-chorus decay
      return Math.max(55 - (t - 0.75)*80, 20)     // outro tail

    case 'commercial':
      // Very fast drop-off if hook doesn't land, then stable if it does
      if (t < 0.08) return 95
      if (t < 0.25) return 88 - t*50              // hook test: sharp drop if not compelling
      if (t < 0.70) return Math.max(72 - t*18, 40) // sustained if brand message holds
      return Math.max(65 - (t - 0.70)*60, 25)     // end-card drop

    case 'short_form_ad':
      // Extremely front-loaded — must deliver in first 30% or it's over
      if (t < 0.15) return 97
      if (t < 0.40) return Math.max(85 - t*70, 30) // brutal mid-drop
      return Math.max(45 - (t - 0.40)*50, 15)      // survivors watching through

    case 'tutorial':
      // Step-based plateaus — people pause and rewatch, then skip ahead
      // Natural staircase pattern with occasional spikes at key moments
      if (t < 0.10) return 92
      const step = Math.floor(t / 0.18)
      const baseT = 85 - step * 8                  // each step loses some viewers
      return Math.max(baseT - Math.random()*5, 25)

    case 'vlog':
      // Steady decline with personality-driven retention — loyal fans stay, casual drop early
      if (t < 0.08) return 90
      return Math.max(85 - t*42 - Math.random()*6, 18) // gentle consistent slope

    case 'documentary':
      // Slow start (setup), tension builds through middle, payoff holds people
      if (t < 0.10) return 88                      // opening hook
      if (t < 0.30) return 82 - t*15              // setup/context section — some drop
      if (t < 0.65) return Math.max(72 - t*10, 45) // investigation builds tension
      return Math.max(60 - (t - 0.65)*25, 30)     // conclusion payoff holds some, others done

    case 'product_demo':
      // High hook (unboxing excitement), mid-drop during specs, recovers at price reveal
      if (t < 0.10) return 93
      if (t < 0.35) return 85 - t*20              // post-reveal settle
      if (t < 0.55) return 68 - t*12              // spec/detail section — skip risk
      if (t < 0.75) return 72 - t*8               // price/verdict recovery
      return Math.max(55 - (t - 0.75)*60, 20)

    default: // organic_video
      // Standard gentle decline with scroll-stop recovery potential mid-video
      return Math.max(95 - t*38 - Math.random()*7, 10)
  }
}

function buildSegments(duration_sec: number, dropoff_points: number[], content_type = 'organic_video'): any[] {
  const segCount = Math.min(Math.max(Math.ceil(duration_sec / 5), 4), 20)
  const segLen   = duration_sec / segCount
  const segs     = []
  for (let i = 0; i < segCount; i++) {
    const tStart  = Math.round(i * segLen)
    const tEnd    = Math.round((i+1) * segLen)
    const t       = i / segCount  // normalized position 0–1
    let retention = baseRetention(t, content_type)
    // Apply user-provided drop-off points as additional penalties
    const isDropoff = dropoff_points.some(dp => dp >= tStart && dp <= tEnd)
    if (isDropoff) retention = Math.max(retention - 22 - Math.random()*14, 5)
    segs.push({ index:i, start:tStart, end:tEnd, label:`${tStart}s–${tEnd}s`, retention:Math.round(retention), is_dropoff:isDropoff, severity:isDropoff?(retention<30?'critical':'warning'):'normal' })
  }
  return segs
}

/* ══════════════════════════════════════════════════════════════════
   DISTRIBUTION ENGINE ROUTES
══════════════════════════════════════════════════════════════════ */

// ── OAuth config ─────────────────────────────────────────────────
const OAUTH_CONFIG = {
  instagram: {
    authUrl:      'https://api.instagram.com/oauth/authorize',
    tokenUrl:     'https://api.instagram.com/oauth/access_token',
    longLivedUrl: 'https://graph.instagram.com/access_token',
    scopes:       'instagram_basic,instagram_content_publish,instagram_manage_insights',
    apiBase:      'https://graph.instagram.com',
  },
  youtube: {
    authUrl:   'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl:  'https://oauth2.googleapis.com/token',
    scopes:    'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
    apiBase:   'https://www.googleapis.com/youtube/v3',
  },
}

// ── GET /api/distribution/accounts ───────────────────────────────
// List all connected social accounts for the authenticated user
app.get('/api/distribution/accounts', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string
    const rows = await c.env.DB.prepare(
      `SELECT id, platform, handle, avatar_url, scopes, created_at, token_expiry
       FROM social_accounts WHERE user_id = ? ORDER BY created_at DESC`
    ).bind(userId).all()
    return c.json({ accounts: rows.results || [] })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── POST /api/distribution/accounts/connect ──────────────────────
// Initiate OAuth flow — returns the authorization URL to redirect to
app.post('/api/distribution/accounts/connect', requireAuth, async (c) => {
  try {
    const { platform, client_id, redirect_uri } = await c.req.json()
    if (!platform || !client_id || !redirect_uri) {
      return c.json({ error: 'platform, client_id, redirect_uri required' }, 400)
    }
    if (!['instagram','youtube'].includes(platform)) {
      return c.json({ error: 'Unsupported platform' }, 400)
    }

    const userId  = c.get('userId') as string
    const state   = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)))
    const cfg     = OAUTH_CONFIG[platform as keyof typeof OAUTH_CONFIG]

    // Store state + userId + client_id + redirect_uri in KV-style temp row
    // We reuse D1 with a short-lived nonce approach stored in sessions table comment col
    // (simple: encode all needed info in state JWT-style as base64 JSON)
    const statePayload = btoa(JSON.stringify({
      userId, platform, client_id, redirect_uri,
      nonce: state, exp: Date.now() + 10 * 60 * 1000, // 10 min
    }))

    const params = new URLSearchParams({
      client_id,
      redirect_uri,
      scope:         cfg.scopes,
      response_type: 'code',
      state:         statePayload,
      ...(platform === 'youtube' ? { access_type: 'offline', prompt: 'consent' } : {}),
    })

    return c.json({ auth_url: `${cfg.authUrl}?${params.toString()}` })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── GET /api/distribution/oauth/callback ─────────────────────────
// OAuth redirect handler — exchanges code for tokens, saves account
app.get('/api/distribution/oauth/callback', async (c) => {
  try {
    const code        = c.req.query('code')
    const stateParam  = c.req.query('state')
    const error       = c.req.query('error')

    if (error) {
      return c.html(`<html><body><script>window.opener?.postMessage({type:'oauth_error',error:'${error}'},'*');window.close();</script><p>Authorization failed: ${error}. You can close this window.</p></body></html>`)
    }
    if (!code || !stateParam) {
      return c.html(`<html><body><script>window.opener?.postMessage({type:'oauth_error',error:'missing_params'},'*');window.close();</script><p>Missing parameters. Close this window.</p></body></html>`)
    }

    let stateData: any
    try {
      stateData = JSON.parse(atob(stateParam))
    } catch {
      return c.html(`<html><body><script>window.opener?.postMessage({type:'oauth_error',error:'invalid_state'},'*');window.close();</script></body></html>`)
    }

    if (Date.now() > stateData.exp) {
      return c.html(`<html><body><script>window.opener?.postMessage({type:'oauth_error',error:'state_expired'},'*');window.close();</script><p>Authorization expired. Please try again.</p></body></html>`)
    }

    const { userId, platform, client_id, redirect_uri } = stateData
    const cfg = OAUTH_CONFIG[platform as keyof typeof OAUTH_CONFIG]

    // Exchange code for tokens — client_secret must be sent from frontend or stored
    // For MVP: client_secret stored as env var INSTAGRAM_CLIENT_SECRET / YOUTUBE_CLIENT_SECRET
    const clientSecret = platform === 'instagram'
      ? (c.env as any).INSTAGRAM_CLIENT_SECRET
      : (c.env as any).YOUTUBE_CLIENT_SECRET

    const tokenBody = new URLSearchParams({
      client_id,
      client_secret: clientSecret || '',
      redirect_uri,
      code,
      grant_type: 'authorization_code',
    })

    const tokenRes  = await fetch(cfg.tokenUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    tokenBody.toString(),
    })
    const tokenData: any = await tokenRes.json()

    if (!tokenData.access_token) {
      const errMsg = tokenData.error_description || tokenData.error || 'token_exchange_failed'
      return c.html(`<html><body><script>window.opener?.postMessage({type:'oauth_error',error:'${errMsg}'},'*');window.close();</script><p>Token exchange failed. Close window and try again.</p></body></html>`)
    }

    let accessToken   = tokenData.access_token
    let refreshToken  = tokenData.refresh_token || null
    let expiresIn     = tokenData.expires_in    || null
    let accountId     = ''
    let handle        = ''
    let avatarUrl     = ''

    if (platform === 'instagram') {
      // Exchange short-lived for long-lived token
      const llRes = await fetch(
        `${cfg.longLivedUrl}?grant_type=ig_exchange_token&client_secret=${clientSecret}&access_token=${accessToken}`
      )
      const llData: any = await llRes.json()
      if (llData.access_token) {
        accessToken = llData.access_token
        expiresIn   = llData.expires_in || null
      }
      // Get account info
      const meRes  = await fetch(`${cfg.apiBase}/me?fields=id,username,profile_picture_url&access_token=${accessToken}`)
      const meData: any = await meRes.json()
      accountId = meData.id       || ''
      handle    = meData.username || ''
      avatarUrl = meData.profile_picture_url || ''
    }

    if (platform === 'youtube') {
      // Get channel info
      const chRes = await fetch(
        `${cfg.apiBase}/channels?part=snippet&mine=true&access_token=${accessToken}`
      )
      const chData: any = await chRes.json()
      const channel     = chData.items?.[0]
      accountId = channel?.id || ''
      handle    = channel?.snippet?.title || ''
      avatarUrl = channel?.snippet?.thumbnails?.default?.url || ''
    }

    // Encrypt tokens
    const encKey     = c.env.ENCRYPTION_KEY
    const encAccess  = await encryptKey(accessToken,          encKey)
    const encRefresh = refreshToken ? await encryptKey(refreshToken, encKey) : null

    const tokenExpiry = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null

    // Upsert account (one per platform per user)
    const accountRow = await c.env.DB.prepare(
      `SELECT id FROM social_accounts WHERE user_id = ? AND platform = ?`
    ).bind(userId, platform).first<{ id: string }>()

    const accountRowId = accountRow?.id || uuid()

    await c.env.DB.prepare(`
      INSERT INTO social_accounts
        (id, user_id, platform, account_id, handle, avatar_url,
         access_token, refresh_token, token_expiry, scopes, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(user_id, platform) DO UPDATE SET
        account_id    = excluded.account_id,
        handle        = excluded.handle,
        avatar_url    = excluded.avatar_url,
        access_token  = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_expiry  = excluded.token_expiry,
        scopes        = excluded.scopes,
        updated_at    = datetime('now')
    `).bind(
      accountRowId, userId, platform, accountId, handle, avatarUrl,
      JSON.stringify(encAccess),
      encRefresh ? JSON.stringify(encRefresh) : null,
      tokenExpiry,
      cfg.scopes,
    ).run()

    return c.html(`<html><body><script>window.opener?.postMessage({type:'oauth_success',platform:'${platform}',handle:'${handle}'},'*');window.close();</script><p>Connected! You can close this window.</p></body></html>`)
  } catch (err: any) {
    return c.html(`<html><body><script>window.opener?.postMessage({type:'oauth_error',error:'${err.message}'},'*');window.close();</script><p>Error: ${err.message}</p></body></html>`)
  }
})

// ── DELETE /api/distribution/accounts/:id ────────────────────────
app.delete('/api/distribution/accounts/:id', requireAuth, async (c) => {
  try {
    const userId    = c.get('userId') as string
    const accountId = c.req.param('id')
    await c.env.DB.prepare(
      `DELETE FROM social_accounts WHERE id = ? AND user_id = ?`
    ).bind(accountId, userId).run()
    return c.json({ ok: true })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── POST /api/distribution/caption ───────────────────────────────
// Generate platform-native captions for a video
app.post('/api/distribution/caption', requireAuth, async (c) => {
  try {
    const { platform, prompt, title, style_preset, duration_sec } = await c.req.json()
    if (!platform || !prompt) return c.json({ error: 'platform and prompt required' }, 400)

    const ai = getAIClient(c.env)

    const platformGuide = {
      instagram: `Instagram Reels caption. Rules:
- Hook in first line (no emoji lead — text-first hook)
- 150-220 chars before "more" fold
- 3-5 punchy lines, line breaks for readability
- 20-25 hashtags: mix of niche (10k-500k), mid (500k-5M), broad (5M+)
- End with a soft CTA ("Save this." / "Drop a 🔥 if you agree")
- Hashtags on their own line at the bottom
Return JSON: { "caption": "...", "hashtags": ["tag1","tag2",...], "first_comment": "optional extra hashtag block" }`,
      youtube: `YouTube Shorts description + title. Rules:
- Title: 60 chars max, front-loaded keyword, click-worthy but not clickbait
- Description: 200-300 chars, natural keyword density, include relevant links placeholder
- Tags: 15-20 tags, mix of broad and long-tail
- Add chapter markers if duration > 60s
Return JSON: { "title": "...", "description": "...", "tags": ["tag1","tag2",...] }`,
    }

    const guide = platformGuide[platform as keyof typeof platformGuide]
    if (!guide) return c.json({ error: 'Unsupported platform for caption generation' }, 400)

    const resp = await ai.chat.completions.create({
      model:       'openai/gpt-4o',
      messages: [
        { role: 'system', content: `You are Spectra's Distribution Caption Engine. You write platform-native copy that drives engagement. ${guide}` },
        { role: 'user',   content: `Video prompt/concept: "${prompt}"\n${title ? `Working title: "${title}"\n` : ''}${style_preset ? `Style: ${style_preset}\n` : ''}${duration_sec ? `Duration: ~${duration_sec}s\n` : ''}\nGenerate the caption. Return JSON only.` },
      ],
      temperature: 0.7,
      max_tokens:  800,
    })

    const raw = resp.choices[0]?.message?.content?.trim() || '{}'
    let result: any = {}
    try {
      const m = raw.match(/\{[\s\S]*\}/)
      if (m) result = JSON.parse(m[0])
    } catch { result = {} }

    return c.json({ platform, ...result })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── POST /api/distribution/upload ────────────────────────────────
// Upload a local video file to R2, return a public URL for distribution
app.post('/api/distribution/upload', requireAuth, async (c) => {
  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'No file provided' }, 400)

    const maxBytes = 500 * 1024 * 1024 // 500MB
    if (file.size > maxBytes) return c.json({ error: 'File too large (max 500MB)' }, 400)

    const ext      = file.name.split('.').pop()?.toLowerCase() || 'mp4'
    const allowed  = ['mp4','mov','webm','m4v','avi']
    if (!allowed.includes(ext)) return c.json({ error: 'Invalid file type. Allowed: mp4, mov, webm, m4v' }, 400)

    const userId = c.get('userId') as string
    const key    = `dist/${userId}/${uuid()}.${ext}`
    const buf    = await file.arrayBuffer()

    await c.env.STORAGE.put(key, buf, {
      httpMetadata: { contentType: file.type || 'video/mp4' },
    })

    // Serve through our own R2 proxy route (same pattern as /api/video/:key used elsewhere)
    const serveUrl = `/api/video/${encodeURIComponent(key)}`

    return c.json({ ok: true, key, url: serveUrl, size: file.size, name: file.name })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── POST /api/distribution/schedule ──────────────────────────────
// Create a new scheduled (or immediate) distribution post
app.post('/api/distribution/schedule', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string
    const {
      project_id, account_id, platform, video_url,
      caption, title, tags, hashtags, cover_url,
      scheduled_at, batch_id, batch_position,
    } = await c.req.json()

    if (!account_id || !platform || !video_url) {
      return c.json({ error: 'account_id, platform, video_url required' }, 400)
    }

    const acct = await c.env.DB.prepare(
      `SELECT id FROM social_accounts WHERE id = ? AND user_id = ?`
    ).bind(account_id, userId).first()
    if (!acct) return c.json({ error: 'Account not found' }, 404)

    const postId = uuid()
    const status = scheduled_at ? 'scheduled' : 'posting'

    await c.env.DB.prepare(`
      INSERT INTO distribution_posts
        (id, user_id, project_id, account_id, platform, video_url,
         caption, title, tags, hashtags, cover_url, scheduled_at, status,
         batch_id, batch_position, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
    `).bind(
      postId, userId, project_id || null, account_id, platform, video_url,
      caption || null, title || null,
      tags     ? JSON.stringify(tags)     : null,
      hashtags ? JSON.stringify(hashtags) : null,
      cover_url || null, scheduled_at || null, status,
      batch_id || null, batch_position || 0,
    ).run()

    if (!scheduled_at) {
      publishPost(c.env, postId).catch(() => {})
    }

    return c.json({ ok: true, post_id: postId, status })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── POST /api/distribution/batch ─────────────────────────────────
// Schedule a batch of posts (multiple videos × platforms × drip timing)
app.post('/api/distribution/batch', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string
    const { items, drip_hours = 24 } = await c.req.json()
    // items: [{ account_id, platform, video_url, caption, title, tags, hashtags, project_id, caption_b }]
    if (!Array.isArray(items) || items.length === 0) {
      return c.json({ error: 'items array required' }, 400)
    }
    if (items.length > 50) return c.json({ error: 'Max 50 items per batch' }, 400)

    const batchId  = uuid()
    const postIds: string[] = []
    const now      = Date.now()

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const acct = await c.env.DB.prepare(
        `SELECT id FROM social_accounts WHERE id = ? AND user_id = ?`
      ).bind(item.account_id, userId).first()
      if (!acct) continue

      const postId      = uuid()
      const scheduledAt = new Date(now + i * drip_hours * 3600 * 1000).toISOString()
      const status      = 'scheduled'

      await c.env.DB.prepare(`
        INSERT INTO distribution_posts
          (id, user_id, project_id, account_id, platform, video_url,
           caption, title, tags, hashtags, scheduled_at, status,
           batch_id, batch_position, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
      `).bind(
        postId, userId, item.project_id || null, item.account_id,
        item.platform, item.video_url,
        item.caption || null, item.title || null,
        item.tags     ? JSON.stringify(item.tags)     : null,
        item.hashtags ? JSON.stringify(item.hashtags) : null,
        scheduledAt, status, batchId, i,
      ).run()

      postIds.push(postId)
    }

    return c.json({ ok: true, batch_id: batchId, post_ids: postIds, count: postIds.length })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── GET /api/distribution/metrics/live ───────────────────────────
// Poll live metrics for multiple posted items — used for real-time chart
app.get('/api/distribution/metrics/live', requireAuth, async (c) => {
  try {
    const userId  = c.get('userId') as string
    const postIds = (c.req.query('ids') || '').split(',').filter(Boolean).slice(0, 20)
    if (postIds.length === 0) return c.json({ metrics: [] })

    const placeholders = postIds.map(() => '?').join(',')
    const posts = await c.env.DB.prepare(`
      SELECT dp.id, dp.platform, dp.platform_post_id, dp.posted_at, dp.status,
             sa.access_token as enc_access
      FROM distribution_posts dp
      LEFT JOIN social_accounts sa ON dp.account_id = sa.id
      WHERE dp.id IN (${placeholders}) AND dp.user_id = ? AND dp.status = 'posted'
    `).bind(...postIds, userId).all()

    const results = await Promise.all(
      (posts.results || []).map(async (post: any) => {
        try {
          const m = await pullMetrics(c.env, post)
          if (m) {
            // Upsert into post_metrics
            const window = (() => {
              const h = (Date.now() - new Date(post.posted_at).getTime()) / 3600000
              return h < 48 ? '24h' : '72h'
            })()
            await c.env.DB.prepare(`
              INSERT OR REPLACE INTO post_metrics
                (id, post_id, pull_window, pulled_at, views, likes, comments, shares, reach, saves)
              VALUES (?,?,?,datetime('now'),?,?,?,?,?,?)
            `).bind(uuid(), post.id, window,
              m.views, m.likes, m.comments, m.shares, m.reach, m.saves
            ).run()
          }
          return { id: post.id, platform: post.platform, posted_at: post.posted_at, metrics: m, pulled_at: new Date().toISOString() }
        } catch {
          return { id: post.id, platform: post.platform, metrics: null }
        }
      })
    )

    return c.json({ metrics: results, pulled_at: new Date().toISOString() })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── GET /api/distribution/queue updated to include batch_id ───────


// ── GET /api/distribution/queue ───────────────────────────────────
// List all posts in the user's distribution queue
app.get('/api/distribution/queue', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string
    const status = c.req.query('status') || 'all'

    const whereStatus = status !== 'all' ? `AND dp.status = '${status}'` : ''

    const rows = await c.env.DB.prepare(`
      SELECT dp.id, dp.platform, dp.status, dp.scheduled_at, dp.posted_at,
             dp.caption, dp.title, dp.video_url, dp.cover_url, dp.error_message,
             dp.platform_post_id, dp.retry_count, dp.created_at,
             dp.project_id, p.name as project_name,
             sa.handle as account_handle, sa.avatar_url as account_avatar,
             pm24.views as views_24h, pm24.likes as likes_24h,
             pm72.views as views_72h, pm72.likes as likes_72h
      FROM distribution_posts dp
      LEFT JOIN projects       p    ON dp.project_id  = p.id
      LEFT JOIN social_accounts sa  ON dp.account_id  = sa.id
      LEFT JOIN post_metrics    pm24 ON dp.id = pm24.post_id AND pm24.pull_window = '24h'
      LEFT JOIN post_metrics    pm72 ON dp.id = pm72.post_id AND pm72.pull_window = '72h'
      WHERE dp.user_id = ? ${whereStatus}
      ORDER BY dp.created_at DESC
      LIMIT 100
    `).bind(userId).all()

    return c.json({ posts: rows.results || [] })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── DELETE /api/distribution/queue/:id ───────────────────────────
app.delete('/api/distribution/queue/:id', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string
    const postId = c.req.param('id')

    const post = await c.env.DB.prepare(
      `SELECT status FROM distribution_posts WHERE id = ? AND user_id = ?`
    ).bind(postId, userId).first<{ status: string }>()

    if (!post) return c.json({ error: 'Post not found' }, 404)
    if (post.status === 'posted') return c.json({ error: 'Cannot cancel an already-posted item' }, 400)

    await c.env.DB.prepare(
      `UPDATE distribution_posts SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND user_id = ?`
    ).bind(postId, userId).run()

    return c.json({ ok: true })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── POST /api/distribution/queue/:id/retry ───────────────────────
app.post('/api/distribution/queue/:id/retry', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string
    const postId = c.req.param('id')

    const post = await c.env.DB.prepare(
      `SELECT status, retry_count FROM distribution_posts WHERE id = ? AND user_id = ?`
    ).bind(postId, userId).first<{ status: string; retry_count: number }>()

    if (!post) return c.json({ error: 'Post not found' }, 404)
    if (post.status !== 'failed') return c.json({ error: 'Only failed posts can be retried' }, 400)
    if (post.retry_count >= 3) return c.json({ error: 'Max retries reached' }, 400)

    await c.env.DB.prepare(
      `UPDATE distribution_posts SET status='posting', error_message=NULL, updated_at=datetime('now') WHERE id=?`
    ).bind(postId).run()

    publishPost(c.env, postId).catch(() => {})

    return c.json({ ok: true })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── PATCH /api/distribution/queue/:id ───────────────────────────
// Edit a scheduled post: caption, title, scheduled_at, video_url
app.patch('/api/distribution/queue/:id', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string
    const postId = c.req.param('id')

    const post = await c.env.DB.prepare(
      `SELECT status FROM distribution_posts WHERE id = ? AND user_id = ?`
    ).bind(postId, userId).first<{ status: string }>()

    if (!post) return c.json({ error: 'Post not found' }, 404)
    if (post.status !== 'scheduled' && post.status !== 'failed') {
      return c.json({ error: 'Only scheduled or failed posts can be edited' }, 400)
    }

    const { caption, title, scheduled_at, video_url } = await c.req.json()

    const fields: string[] = []
    const values: any[]   = []

    if (caption      !== undefined) { fields.push('caption=?');      values.push(caption || null) }
    if (title        !== undefined) { fields.push('title=?');        values.push(title   || null) }
    if (scheduled_at !== undefined) { fields.push('scheduled_at=?'); values.push(scheduled_at || null) }
    if (video_url    !== undefined) { fields.push('video_url=?');    values.push(video_url || null) }

    if (fields.length === 0) return c.json({ error: 'Nothing to update' }, 400)

    fields.push("updated_at=datetime('now')")
    values.push(postId, userId)

    await c.env.DB.prepare(
      `UPDATE distribution_posts SET ${fields.join(', ')} WHERE id=? AND user_id=?`
    ).bind(...values).run()

    return c.json({ ok: true })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── GET /api/distribution/analytics ─────────────────────────────
// Aggregated analytics: per-platform stats, best-time analysis, post list with metrics
app.get('/api/distribution/analytics', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string

    // Fetch all posted posts with metrics
    const postsRes = await c.env.DB.prepare(`
      SELECT dp.id, dp.platform, dp.caption, dp.title, dp.posted_at, dp.scheduled_at,
             dp.cover_url, dp.video_url,
             pm24.views as views_24h, pm24.likes as likes_24h,
             pm24.comments as comments_24h, pm24.shares as shares_24h,
             pm24.saves as saves_24h, pm24.reach as reach_24h,
             pm72.views as views_72h, pm72.likes as likes_72h,
             pm72.comments as comments_72h, pm72.shares as shares_72h,
             pm72.saves as saves_72h, pm72.reach as reach_72h
      FROM distribution_posts dp
      LEFT JOIN post_metrics pm24 ON dp.id = pm24.post_id AND pm24.pull_window = '24h'
      LEFT JOIN post_metrics pm72 ON dp.id = pm72.post_id AND pm72.pull_window = '72h'
      WHERE dp.user_id = ? AND dp.status = 'posted'
      ORDER BY dp.posted_at DESC
      LIMIT 50
    `).bind(userId).all<any>()

    const posts = postsRes.results || []

    // Per-platform aggregate
    const platformStats: Record<string, any> = {}
    posts.forEach((p: any) => {
      if (!platformStats[p.platform]) {
        platformStats[p.platform] = { posts: 0, views: 0, likes: 0, comments: 0, shares: 0, saves: 0 }
      }
      const s = platformStats[p.platform]
      s.posts++
      s.views    += p.views_24h    || 0
      s.likes    += p.likes_24h    || 0
      s.comments += p.comments_24h || 0
      s.shares   += p.shares_24h   || 0
      s.saves    += p.saves_24h    || 0
    })

    // Best-time analysis: group by day-of-week + hour-of-day for posted items with views
    const bestTimes: Record<string, { views: number; count: number }> = {}
    posts.forEach((p: any) => {
      if (!p.posted_at || p.views_24h == null) return
      const d    = new Date(p.posted_at)
      const dow  = d.getUTCDay()   // 0=Sun … 6=Sat
      const hour = d.getUTCHours() // rounded to nearest 2h bucket
      const bucket = `${dow}:${Math.floor(hour / 2) * 2}`
      if (!bestTimes[bucket]) bestTimes[bucket] = { views: 0, count: 0 }
      bestTimes[bucket].views += p.views_24h
      bestTimes[bucket].count++
    })

    const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const bestTimesList = Object.entries(bestTimes)
      .map(([key, val]) => {
        const [dow, hour] = key.split(':').map(Number)
        const avgViews = val.count > 0 ? Math.round(val.views / val.count) : 0
        return {
          key,
          dow,
          hour,
          label: `${DOW_LABELS[dow]} ${String(hour).padStart(2,'0')}:00 UTC`,
          avg_views: avgViews,
          count: val.count,
        }
      })
      .sort((a, b) => b.avg_views - a.avg_views)
      .slice(0, 8)

    return c.json({
      posts,
      platform_stats: platformStats,
      best_times: bestTimesList,
    })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── GET /api/distribution/metrics/:postId ────────────────────────
app.get('/api/distribution/metrics/:postId', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string
    const postId = c.req.param('postId')

    const post = await c.env.DB.prepare(
      `SELECT id, platform, platform_post_id, account_id, posted_at, status
       FROM distribution_posts WHERE id = ? AND user_id = ?`
    ).bind(postId, userId).first<any>()

    if (!post) return c.json({ error: 'Post not found' }, 404)
    if (post.status !== 'posted') return c.json({ error: 'Post not yet published' }, 400)

    const metrics = await c.env.DB.prepare(
      `SELECT * FROM post_metrics WHERE post_id = ? ORDER BY pull_window`
    ).bind(postId).all()

    return c.json({ post_id: postId, metrics: metrics.results || [] })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── POST /api/distribution/metrics/:postId/pull ───────────────────
// Manually trigger a metrics pull for a posted item
app.post('/api/distribution/metrics/:postId/pull', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string
    const postId = c.req.param('postId')

    const post = await c.env.DB.prepare(
      `SELECT dp.platform, dp.platform_post_id, dp.account_id, dp.posted_at,
              sa.access_token as enc_access
       FROM distribution_posts dp
       LEFT JOIN social_accounts sa ON dp.account_id = sa.id
       WHERE dp.id = ? AND dp.user_id = ?`
    ).bind(postId, userId).first<any>()

    if (!post || !post.platform_post_id) return c.json({ error: 'Post not published yet' }, 400)

    const metrics = await pullMetrics(c.env, post)
    if (!metrics) return c.json({ error: 'Could not fetch metrics from platform' }, 500)

    // Calculate pull_window based on posted_at
    const postedAt   = new Date(post.posted_at).getTime()
    const hoursLater = (Date.now() - postedAt) / (1000 * 60 * 60)
    const window     = hoursLater < 48 ? '24h' : '72h'

    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO post_metrics
        (id, post_id, pull_window, pulled_at, views, likes, comments, shares, reach, saves)
      VALUES (?,?,?,datetime('now'),?,?,?,?,?,?)
    `).bind(uuid(), postId, window,
      metrics.views, metrics.likes, metrics.comments,
      metrics.shares, metrics.reach, metrics.saves
    ).run()

    return c.json({ ok: true, window, metrics })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── PUBLISH HELPER ────────────────────────────────────────────────
async function publishPost(env: Bindings, postId: string): Promise<void> {
  const post = await env.DB.prepare(`
    SELECT dp.*, sa.access_token as enc_access, sa.refresh_token as enc_refresh,
           sa.platform as sa_platform, sa.account_id as sa_account_id
    FROM distribution_posts dp
    LEFT JOIN social_accounts sa ON dp.account_id = sa.id
    WHERE dp.id = ?
  `).bind(postId).first<any>()

  if (!post) return

  await env.DB.prepare(
    `UPDATE distribution_posts SET status='posting', updated_at=datetime('now') WHERE id=?`
  ).bind(postId).run()

  try {
    let platformPostId: string | null = null
    const encAccessObj = JSON.parse(post.enc_access || '{}')
    const accessToken  = await decryptKey(encAccessObj.encrypted, encAccessObj.iv, env.ENCRYPTION_KEY)

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

// ── INSTAGRAM PUBLISH ─────────────────────────────────────────────
async function publishToInstagram(accessToken: string, post: any): Promise<string> {
  const igBase = 'https://graph.instagram.com/v21.0'

  // Step 1: Create media container
  const caption = [
    post.caption || '',
    post.hashtags ? JSON.parse(post.hashtags).map((h: string) => `#${h}`).join(' ') : '',
  ].filter(Boolean).join('\n\n')

  const createParams = new URLSearchParams({
    media_type:  'REELS',
    video_url:   post.video_url,
    caption:     caption,
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

  // Step 2: Poll until container is FINISHED
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

  // Step 3: Publish
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

  // Fetch the video as a buffer for multipart upload
  const videoRes = await fetch(post.video_url)
  if (!videoRes.ok) throw new Error('Could not fetch video for YouTube upload')
  const videoBuffer = await videoRes.arrayBuffer()

  // Build multipart/related body
  const boundary = '---spectra_yt_boundary'
  const metadata = JSON.stringify({
    snippet: {
      title:       title.slice(0, 100),
      description: post.caption || '',
      tags:        tags.slice(0, 500),
      categoryId:  '22', // People & Blogs — most common for Shorts
    },
    status: {
      privacyStatus:           'public',
      selfDeclaredMadeForKids: false,
    },
  })

  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
  const videoPart = `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`
  const closing   = `\r\n--${boundary}--`

  const enc        = new TextEncoder()
  const metaBytes  = enc.encode(metaPart)
  const videoBytes = enc.encode(videoPart)
  const videoData  = new Uint8Array(videoBuffer)
  const closeBytes = enc.encode(closing)

  const body = new Uint8Array(metaBytes.length + videoBytes.length + videoData.length + closeBytes.length)
  let offset = 0
  body.set(metaBytes,  offset); offset += metaBytes.length
  body.set(videoBytes, offset); offset += videoBytes.length
  body.set(videoData,  offset); offset += videoData.length
  body.set(closeBytes, offset)

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

// ── METRICS PULL HELPER ────────────────────────────────────────────
async function pullMetrics(env: Bindings, post: any): Promise<any> {
  try {
    const encAccessObj = JSON.parse(post.enc_access || '{}')
    const accessToken  = await decryptKey(encAccessObj.encrypted, encAccessObj.iv, env.ENCRYPTION_KEY)

    if (post.platform === 'instagram') {
      const res  = await fetch(
        `https://graph.instagram.com/v21.0/${post.platform_post_id}/insights?metric=reach,likes,comments,shares,saved&access_token=${accessToken}`
      )
      const data: any = await res.json()
      const m: Record<string, number> = {}
      data.data?.forEach((item: any) => { m[item.name] = item.values?.[0]?.value || 0 })
      return { views: m.reach||0, likes: m.likes||0, comments: m.comments||0, shares: m.shares||0, reach: m.reach||0, saves: m.saved||0 }
    }

    if (post.platform === 'youtube') {
      const res  = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?id=${post.platform_post_id}&part=statistics&access_token=${accessToken}`
      )
      const data: any = await res.json()
      const stats = data.items?.[0]?.statistics || {}
      return {
        views:    parseInt(stats.viewCount    || '0'),
        likes:    parseInt(stats.likeCount    || '0'),
        comments: parseInt(stats.commentCount || '0'),
        shares:   0,
        reach:    parseInt(stats.viewCount    || '0'),
        saves:    parseInt(stats.favoriteCount|| '0'),
      }
    }
  } catch { return null }
  return null
}

// ── GET /tools/distribution/ ──────────────────────────────────────
app.get('/tools/distribution/', async (c) => {
  return c.html(distributionPage())
})
app.get('/tools/distribution', async (c) => {
  return c.redirect('/tools/distribution/')
})

/* ══════════════════════════════════════════════════════════════════
   ATTENTION ENGINE ROUTES (preserved)
══════════════════════════════════════════════════════════════════ */
app.post('/api/attention/analyze', requireAuth, async (c) => {
  try {
    const body = await c.req.json()
    const { platform='tiktok', content_type='organic_video', content_url='', content_description='', duration_sec=60, metrics={}, dropoff_points=[], hook_text='', script_excerpt='' } = body
    const scores   = computeWeightedScore(metrics, platform, content_type)
    const segments = buildSegments(duration_sec, dropoff_points, content_type)
    const weights  = PLATFORM_WEIGHTS[platform] || PLATFORM_WEIGHTS.tiktok

    // ── Content-type profiles ──────────────────────────────────────
    const CONTENT_TYPE_PROFILES: Record<string, { label: string; diagKeys: string[]; benchmarks: string; criteria: string }> = {
      organic_video: {
        label: 'Organic Social Video',
        diagKeys: ['hook_effectiveness','pacing','visual_engagement','messaging_clarity','emotional_impact','shareability'],
        benchmarks: 'Organic: avg like rate 3–6%, comment rate 0.5–1.5%, watch-through 35–55%. High shareability and emotional resonance drive organic reach.',
        criteria: 'Evaluate hook in first 3 seconds, pattern interrupts, scroll-stopping visuals, relatability, and share triggers. CTA is optional for organic — focus on emotional resonance and replay value instead.',
      },
      music_video: {
        label: 'Music Video',
        diagKeys: ['hook_effectiveness','visual_storytelling','audio_sync','emotional_resonance','replay_value','pacing'],
        benchmarks: 'Music videos: avg like rate 4–10%, comment rate 1–3%, high rewatch rates are the primary success metric. Drop-off before the chorus is a critical failure point.',
        criteria: 'Evaluate intro hook (first 5s), visual narrative coherence, audio-visual synchronization, chorus/drop moment impact, emotional journey, and replay triggers. CTA is irrelevant. Traditional "messaging clarity" does not apply — instead judge emotional and sensory engagement. Mid-video peaks at chorus/hook sections should show retention spikes, NOT drops.',
      },
      commercial: {
        label: 'Brand Commercial',
        diagKeys: ['hook_effectiveness','brand_recall','messaging_clarity','emotional_impact','cta_strength','visual_engagement'],
        benchmarks: 'Commercial benchmarks: 15–30s ads need >70% view-through, 60s+ need >50%. Like rate above 1% is exceptional for paid. Brand recall within 3s is critical. Clear single message outperforms multi-message.',
        criteria: 'Evaluate brand visibility in first 3s, single core message delivery, emotional brand association, urgency/CTA effectiveness, product/service clarity, and memorability. Pacing must be tight — commercials cannot afford slow sections. Every second must earn its place.',
      },
      short_form_ad: {
        label: 'Short-Form Ad (6–15s)',
        diagKeys: ['hook_effectiveness','message_compression','brand_recall','cta_strength','visual_impact','skip_resistance'],
        benchmarks: 'Short ads: <6s non-skippable need 100% message delivery; 6–15s need brand recall by 3s and CTA by 10s. Like rate is not a success metric — completion rate and click-through are.',
        criteria: 'Evaluate immediate pattern disruption (0s), brand presence within 3s, compressed message delivery, hard CTA placement, visual distinctiveness to stop mid-scroll skip. NO time for storytelling — every frame is a conversion event. Pacing and emotional arc are secondary to message clarity and skip-resistance.',
      },
      tutorial: {
        label: 'Tutorial / How-To',
        diagKeys: ['hook_effectiveness','information_density','pacing','visual_clarity','step_progression','cta_strength'],
        benchmarks: 'Tutorials: avg watch-through 55–75%, save rate 3–8% (saves are the primary success metric), comment rate 1–3%. Drop-off at any step indicates that step is unclear or too slow.',
        criteria: 'Evaluate promise clarity in hook (what will you learn?), information density per minute, visual demonstration quality, step-by-step logical flow, appropriate pacing (not too fast or slow), and end-screen CTA for saves/subscribe. Emotional impact is secondary — clarity and utility drive performance. Each drop-off likely indicates a confusing or skippable section.',
      },
      vlog: {
        label: 'Vlog / Talking Head',
        diagKeys: ['hook_effectiveness','personality_strength','pacing','storytelling','authenticity','audience_connection'],
        benchmarks: 'Vlogs: avg watch-through 40–60%, comment rate 1.5–4% (comments indicate community), like rate 3–7%. Drop-off in first 30s means the hook failed to establish why viewers should stay.',
        criteria: 'Evaluate personality hook (why this creator, why now?), storytelling momentum, authentic moments vs performance, pacing (dead air, repetition, unnecessary tangents), B-roll and visual variety, and community-building language. CTA effectiveness is important but secondary to personality/connection. Traditional brand messaging does not apply.',
      },
      documentary: {
        label: 'Documentary / Long-Form',
        diagKeys: ['hook_effectiveness','narrative_arc','pacing','information_depth','emotional_journey','visual_production'],
        benchmarks: 'Documentary/long-form: avg watch-through 30–50% for 10–30min content, save rate 2–5%, comment depth (long comments) is success indicator. Chapters/timestamps increase completion significantly.',
        criteria: 'Evaluate opening narrative hook (curiosity/tension), structural chapter flow, investigative/informational depth, emotional beats and tension pacing, visual production quality, and narrative payoff at conclusion. Drop-offs map to loss of narrative tension or information overload. CTA is secondary — end cards and chapters matter more than explicit CTAs.',
      },
      product_demo: {
        label: 'Product Demo / Unboxing',
        diagKeys: ['hook_effectiveness','product_clarity','pacing','trust_signals','cta_strength','visual_engagement'],
        benchmarks: 'Product demos: avg watch-through 50–70%, save rate 4–10% (saves = purchase consideration), click-through on product links. Like rate is secondary to save rate and link clicks.',
        criteria: 'Evaluate product reveal timing (too early = no hook, too late = lost interest), feature demonstration clarity, trust signals (honest pros/cons, real reactions), value proposition communication, and purchase CTA placement. Unboxings need genuine reaction moments. Pacing must match product complexity — tech demos need more time per feature than beauty unboxings.',
      },
    }

    const ctProfile = CONTENT_TYPE_PROFILES[content_type] || CONTENT_TYPE_PROFILES.organic_video
    const diagKeys  = ctProfile.diagKeys

    // Build the format-specific diagnosis schema dynamically
    const diagSchemaLines = diagKeys.map(k => `    "${k}": { "score": 0-100, "verdict": "string", "reasoning": "string", "fix": "string" }`).join(',\n')

    const systemPrompt = `You are Spectra's Attention Engine — an elite content performance analyst for Pano Marketing. You specialize in distinguishing performance by content format. Generic analysis is a failure state.

CONTENT TYPE BEING ANALYZED: ${ctProfile.label}
PLATFORM: ${platform.toUpperCase()}

BENCHMARKS FOR THIS FORMAT:
${ctProfile.benchmarks}

EVALUATION CRITERIA FOR THIS FORMAT:
${ctProfile.criteria}

CRITICAL RULES:
1. You MUST apply the benchmarks and criteria above specifically for ${ctProfile.label} content. Do NOT use generic social media analysis.
2. Scores must be calibrated to this format — a 70/100 hook for a music video means something completely different than a 70/100 hook for a commercial.
3. The diagnosis categories below are format-specific. Only evaluate what is listed.
4. Scores must vary meaningfully based on the actual data provided. Do not cluster all scores in the 60–75 range. Use the full 0–100 range.
5. If metrics indicate genuinely strong performance for this format, say so with high scores. If weak, score low.
6. The overall_verdict must be a specific, opinionated diagnosis — not generic praise.

Output format: You must return a valid JSON object with EXACTLY this structure (no extra keys, no markdown):
{
  "diagnosis": {
${diagSchemaLines}
  },
  "dropoff_analysis": [{ "timestamp":"string","cause":"string","severity":"critical|warning","fix":"string" }],
  "top_issues": ["string","string","string"],
  "top_strengths": ["string","string"],
  "optimization_plan": [{ "priority":1-5,"action":"string","impact":"High|Medium|Low","effort":"Low|Medium|High","detail":"string" }],
  "platform_insights": { "algorithm_note":"string","trend_alignment":"string","posting_recommendation":"string" },
  "overall_verdict": "string"
}`

    const userPrompt = `Analyze this ${platform.toUpperCase()} ${ctProfile.label}:
CONTENT URL: ${content_url||'Not provided'}
CONTENT DESCRIPTION: ${content_description||'Not provided'}
HOOK TEXT: ${hook_text||'Not provided'}
SCRIPT EXCERPT: ${script_excerpt||'Not provided'}
DURATION: ${duration_sec} seconds

PERFORMANCE METRICS (calibrate scores against ${ctProfile.label} benchmarks, not generic social):
  Views: ${(metrics as any).views||0}
  Likes: ${(metrics as any).likes||0} (like rate: ${(metrics as any).views > 0 ? (((metrics as any).likes/(metrics as any).views)*100).toFixed(2) : '0'}%)
  Comments: ${(metrics as any).comments||0} (comment rate: ${(metrics as any).views > 0 ? (((metrics as any).comments/(metrics as any).views)*100).toFixed(2) : '0'}%)
  Shares: ${(metrics as any).shares||0}
  Saves: ${(metrics as any).saves||0}
  Watch Time: ${(metrics as any).watch_time_pct||0}%

WEIGHTED COMPOSITE SCORE: ${scores.composite}/100 (${platform} platform weights applied)
INDIVIDUAL SIGNAL SCORES: Watch: ${scores.watch_score}/100 | Shares: ${scores.share_score}/100 | Likes: ${scores.like_score}/100 | Comments: ${scores.comment_score}/100

DROP-OFF POINTS: ${dropoff_points.length>0?dropoff_points.map((p:number)=>`${p}s`).join(', '):'None provided'}
TIMELINE RETENTION:
${segments.map((s:any)=>`[${s.label}] Retention: ${s.retention}% ${s.is_dropoff?'⚠️ DROP-OFF':''}`).join('\n')}

Now give a precise, format-specific analysis. Scores must reflect the actual data above and be calibrated to ${ctProfile.label} norms.`

    const ai     = getAIClient(c.env)
    const stream = await ai.chat.completions.create({ model:'gpt-4o', messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}], stream:true, temperature:0.65, max_tokens:3200 })
    const metaChunk = JSON.stringify({ type:'meta', scores, segments, platform, content_type, content_type_label: ctProfile.label, diag_keys: diagKeys, weights })
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

app.post('/api/attention/rewrite', requireAuth, async (c) => {
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

// POST /api/attention/prescore — pre-publish script scorer (Video Generator lite panel)
// Takes a prompt/script + platform, returns hook score 0-100, verdict, single fix, and
// an improved version of the prompt ready to drop back into the generator.
app.post('/api/attention/prescore', requireAuth, async (c) => {
  try {
    const body = await c.req.json()
    const { prompt = '', platform = 'ads', model = '', style_preset = '' } = body
    if (!prompt?.trim()) return c.json({ error: 'prompt required' }, 400)

    const ai = getAIClient(c.env)

    const systemPrompt = `You are Spectra's Pre-Publish Script Scorer — an elite AI content strategist embedded inside a video generation tool.
A user is about to generate a video shot. You receive their shot prompt and must evaluate it BEFORE they waste a generation credit on something that won't perform.

You must return a single valid JSON object — no markdown, no explanation, just JSON:
{
  "hook_score": <0-100 integer>,
  "verdict": "<one punchy sentence — what works or what's broken>",
  "biggest_issue": "<the single most important thing killing performance — be specific and brutal>",
  "fix": "<one concrete, actionable fix — rewrite the weak part>",
  "improved_prompt": "<the full improved prompt, ready to paste directly into the generator — same intent, stronger execution>",
  "platform_fit": <0-100 integer — how well this prompt fits the selected platform>,
  "flags": ["<any red flags: vague subject, no motion, no emotion, no hook, weak CTA, etc.>"]
}

Scoring rubric for hook_score:
- 90-100: Immediately arresting — clear subject, strong motion, emotional pull, cinematic specificity
- 70-89: Solid — good concept, minor gaps in specificity or motion language
- 50-69: Mediocre — vague subject, generic action, or missing visual tension
- 30-49: Weak — no hook, no motion, nothing to stop a scroll
- 0-29: Dead on arrival — too abstract, no visual, no emotion

Platform context: ${platform === 'ads' ? 'Paid ad — must grab attention in first 1-2 seconds, strong visual hook required' : platform === 'tiktok' ? 'TikTok — pattern interrupt essential, kinetic energy, relatable or surprising' : platform === 'instagram' ? 'Instagram Reel — aesthetic quality, aspirational or emotional resonance' : platform === 'youtube' ? 'YouTube — can build slower but needs strong opening image' : 'General social — hook-first thinking'}.
${model ? `Generation model: ${model} — optimize prompt language for this model's strengths.` : ''}
${style_preset ? `Style preset active: ${style_preset} — keep improved prompt consistent with this style.` : ''}`

    const userPrompt = `Score this shot prompt:\n\n"${prompt.trim()}"\n\nReturn JSON only.`

    const resp = await ai.chat.completions.create({
      model:       'openai/gpt-4o',
      messages:    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: 0.3,
      max_tokens:  600,
    })

    const raw = resp.choices[0]?.message?.content?.trim() || '{}'
    let result: any = {}
    try {
      const m = raw.match(/\{[\s\S]*\}/)
      if (m) result = JSON.parse(m[0])
    } catch { result = { hook_score: 50, verdict: 'Could not parse score', biggest_issue: 'Unknown', fix: 'Try a more specific prompt', improved_prompt: prompt, platform_fit: 50, flags: [] } }

    return c.json({
      hook_score:      Math.min(100, Math.max(0, result.hook_score ?? 50)),
      verdict:         result.verdict         ?? 'Analysis incomplete',
      biggest_issue:   result.biggest_issue   ?? '',
      fix:             result.fix             ?? '',
      improved_prompt: result.improved_prompt ?? prompt,
      platform_fit:    Math.min(100, Math.max(0, result.platform_fit ?? 50)),
      flags:           Array.isArray(result.flags) ? result.flags : [],
    })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

app.post('/api/attention/score', requireAuth, async (c) => {
  try {
    const body = await c.req.json()
    const { platform='tiktok', content_type='organic_video', metrics={}, duration_sec=60, dropoff_points=[] } = body
    const scores   = computeWeightedScore(metrics, platform, content_type)
    const segments = buildSegments(duration_sec, dropoff_points, content_type)
    const weights  = PLATFORM_WEIGHTS[platform]
    const hookScore       = dropoff_points.some((d:number)=>d<=5) ? Math.max(scores.composite-30,10) : Math.min(scores.watch_score+15,100)
    const retentionScore  = Math.round(segments.reduce((a:number,s:any)=>a+s.retention,0)/segments.length)
    const engagementScore = Math.round((scores.like_score+scores.comment_score+scores.share_score+scores.save_score)/4)
    const viralScore      = Math.round((scores.share_score*(platform==='tiktok'?1.3:1.0)+scores.comment_score*0.8)/2)
    return c.json({ platform, weights, scores:{ composite:scores.composite, hook:Math.min(hookScore,100), retention:retentionScore, engagement:engagementScore, viral:Math.min(viralScore,100), watch_time:scores.watch_score, shareability:scores.share_score }, segments, signal_breakdown:{ likes:{raw:metrics.likes||0,score:scores.like_score,weight:weights?.likes||0}, comments:{raw:metrics.comments||0,score:scores.comment_score,weight:weights?.comments||0}, shares:{raw:metrics.shares||0,score:scores.share_score,weight:weights?.shares||0}, saves:{raw:metrics.saves||0,score:scores.save_score,weight:weights?.saves||0}, watch_time:{raw:metrics.watch_time_pct||0,score:scores.watch_score,weight:weights?.watch_time||0}, views:{raw:metrics.views||0,score:scores.view_score,weight:weights?.views||0} } })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

/* ══════════════════════════════════════════════════════════════════
   YOUTUBE OAUTH — /api/auth/youtube/start + /callback + /status + /disconnect
   Uses Authorization Code flow with youtube.readonly scope
══════════════════════════════════════════════════════════════════ */
app.get('/api/auth/youtube/start', requireAuth, async (c) => {
  const clientId    = c.env.YOUTUBE_CLIENT_ID
  const redirectUri = 'https://spectra-b8s.pages.dev/api/auth/youtube/callback'
  if (!clientId) return c.json({ error: 'YouTube OAuth not configured' }, 500)
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.email',
    access_type:   'offline',
    prompt:        'consent',
    state:         c.get('userId'),
  })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

app.get('/api/auth/youtube/callback', async (c) => {
  const code     = c.req.query('code') || ''
  const state    = c.req.query('state') || ''   // userId
  const error    = c.req.query('error') || ''
  if (error || !code) {
    return c.html(`<html><body><script>window.opener?.postMessage({type:'yt-auth',success:false,error:'${error||'cancelled'}'},'*');window.close();</script></body></html>`)
  }
  try {
    const clientId     = c.env.YOUTUBE_CLIENT_ID
    const clientSecret = c.env.YOUTUBE_CLIENT_SECRET
    const redirectUri  = 'https://spectra-b8s.pages.dev/api/auth/youtube/callback'
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    })
    const tokens: any = await tokenRes.json()
    if (tokens.error) throw new Error(tokens.error_description || tokens.error)
    // Get channel info
    const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const channelData: any = await channelRes.json()
    const channel = channelData.items?.[0]
    const channelName = channel?.snippet?.title || 'YouTube Channel'
    const channelId   = channel?.id || ''
    // Encrypt and store tokens in D1
    const encKey = c.env.ENCRYPTION_KEY
    const encAccess  = await encryptKey(tokens.access_token,  encKey)
    const encRefresh = tokens.refresh_token ? await encryptKey(tokens.refresh_token, encKey) : null
    const userId = state
    await c.env.DB.prepare(`
      INSERT INTO platform_connections (user_id, platform, access_token_enc, access_token_iv,
        refresh_token_enc, refresh_token_iv, channel_id, channel_name, connected_at)
      VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, platform) DO UPDATE SET
        access_token_enc=excluded.access_token_enc, access_token_iv=excluded.access_token_iv,
        refresh_token_enc=excluded.refresh_token_enc, refresh_token_iv=excluded.refresh_token_iv,
        channel_id=excluded.channel_id, channel_name=excluded.channel_name, connected_at=CURRENT_TIMESTAMP
    `).bind(userId, 'youtube', encAccess.encrypted, encAccess.iv,
            encRefresh?.encrypted || null, encRefresh?.iv || null,
            channelId, channelName).run()
    return c.html(`<html><body><script>window.opener?.postMessage({type:'yt-auth',success:true,channelName:${JSON.stringify(channelName)},channelId:${JSON.stringify(channelId)}},'*');window.close();</script></body></html>`)
  } catch (err: any) {
    return c.html(`<html><body><script>window.opener?.postMessage({type:'yt-auth',success:false,error:${JSON.stringify(err.message)}},'*');window.close();</script></body></html>`)
  }
})

app.get('/api/auth/youtube/status', requireAuth, async (c) => {
  const userId = c.get('userId')
  const row = await c.env.DB.prepare(
    `SELECT channel_name, channel_id, connected_at FROM platform_connections WHERE user_id=? AND platform='youtube'`
  ).bind(userId).first<any>()
  if (!row) return c.json({ connected: false })
  return c.json({ connected: true, channelName: row.channel_name, channelId: row.channel_id, connectedAt: row.connected_at })
})

app.delete('/api/auth/youtube/disconnect', requireAuth, async (c) => {
  const userId = c.get('userId')
  await c.env.DB.prepare(`DELETE FROM platform_connections WHERE user_id=? AND platform='youtube'`).bind(userId).run()
  return c.json({ success: true })
})

/* ── YouTube: get latest uploads ─────────────────────────────────
   GET /api/auth/youtube/videos?limit=20
   Returns the channel's latest uploads with per-video stats
══════════════════════════════════════════════════════════════════ */
app.get('/api/auth/youtube/videos', requireAuth, async (c) => {
  const userId = c.get('userId')
  const limit  = Math.min(parseInt(c.req.query('limit') || '20'), 50)

  // Get stored OAuth token + channel_id
  const conn = await c.env.DB.prepare(
    `SELECT access_token_enc, access_token_iv, refresh_token_enc, refresh_token_iv, channel_id
     FROM platform_connections WHERE user_id=? AND platform='youtube'`
  ).bind(userId).first<any>()
  if (!conn) return c.json({ error: 'YouTube not connected', needs_connect: true }, 200)

  let accessToken = await decryptKey(conn.access_token_enc, conn.access_token_iv, c.env.ENCRYPTION_KEY)

  // Helper: refresh access token if needed
  async function refreshYTToken(): Promise<string | null> {
    if (!conn.refresh_token_enc || !conn.refresh_token_iv) return null
    try {
      const refreshToken = await decryptKey(conn.refresh_token_enc, conn.refresh_token_iv, c.env.ENCRYPTION_KEY)
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     c.env.YOUTUBE_CLIENT_ID,
          client_secret: c.env.YOUTUBE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type:    'refresh_token',
        }),
      })
      const data: any = await r.json()
      if (!data.access_token) return null
      // Store refreshed token
      const { enc: newEnc, iv: newIv } = await encryptKey(data.access_token, c.env.ENCRYPTION_KEY)
      await c.env.DB.prepare(
        `UPDATE platform_connections SET access_token_enc=?, access_token_iv=? WHERE user_id=? AND platform='youtube'`
      ).bind(newEnc, newIv, userId).run()
      return data.access_token
    } catch { return null }
  }

  // Step 1: Get the uploads playlist ID for this channel
  async function getUploadsPlaylistId(token: string): Promise<string | null> {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const d: any = await r.json()
    if (d.error?.code === 401) return null
    return d.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null
  }

  let uploadsPlaylistId = await getUploadsPlaylistId(accessToken)

  // If 401, try to refresh token
  if (!uploadsPlaylistId) {
    const newToken = await refreshYTToken()
    if (newToken) {
      accessToken = newToken
      uploadsPlaylistId = await getUploadsPlaylistId(accessToken)
    }
  }
  if (!uploadsPlaylistId) return c.json({ error: 'Could not access YouTube channel. Try reconnecting.' }, 200)

  // Step 2: Get video IDs from uploads playlist
  const playlistRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails,snippet&playlistId=${uploadsPlaylistId}&maxResults=${limit}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const playlistData: any = await playlistRes.json()
  if (!playlistData.items?.length) return c.json({ videos: [] })

  const videoIds = playlistData.items
    .map((item: any) => item.contentDetails?.videoId)
    .filter(Boolean)
    .join(',')

  // Step 3: Get full stats for all videos in one call
  const statsRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const statsData: any = await statsRes.json()
  if (!statsData.items?.length) return c.json({ videos: [] })

  const videos = statsData.items.map((item: any) => {
    const stats   = item.statistics   || {}
    const snippet = item.snippet      || {}
    const dur     = item.contentDetails?.duration || 'PT0S'
    const dm      = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
    const durSec  = (parseInt(dm?.[1] || '0') * 3600) + (parseInt(dm?.[2] || '0') * 60) + parseInt(dm?.[3] || '0')
    return {
      id:           item.id,
      url:          `https://www.youtube.com/watch?v=${item.id}`,
      title:        snippet.title        || 'Untitled',
      channel:      snippet.channelTitle || '',
      thumbnail:    snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
      published:    snippet.publishedAt  || '',
      duration_sec: durSec,
      metrics: {
        views:         parseInt(stats.viewCount    || '0'),
        likes:         parseInt(stats.likeCount    || '0'),
        comments:      parseInt(stats.commentCount || '0'),
        shares:        0,
        saves:         0,
        watch_time_pct: 0,
      },
    }
  })

  return c.json({ videos, channel: statsData.items[0]?.snippet?.channelTitle || '' })
})

/* ══════════════════════════════════════════════════════════════════
   BLUESKY — /api/attention/bluesky/connect + /posts + /post/:uri/metrics
   Uses AT Protocol app-password auth — no OAuth needed
══════════════════════════════════════════════════════════════════ */
app.post('/api/attention/bluesky/connect', requireAuth, async (c) => {
  try {
    const userId = c.get('userId')
    const { handle, app_password } = await c.req.json()
    if (!handle || !app_password) return c.json({ error: 'Handle and app password required' }, 400)
    // Authenticate with Bluesky AT Protocol
    const authRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: handle.replace(/^@/, ''), password: app_password }),
    })
    const session: any = await authRes.json()
    if (session.error) return c.json({ error: session.message || session.error }, 400)
    // Encrypt and store tokens
    const encKey     = c.env.ENCRYPTION_KEY
    const encAccess  = await encryptKey(session.accessJwt,  encKey)
    const encRefresh = await encryptKey(session.refreshJwt, encKey)
    await c.env.DB.prepare(`
      INSERT INTO platform_connections (user_id, platform, access_token_enc, access_token_iv,
        refresh_token_enc, refresh_token_iv, channel_id, channel_name, connected_at)
      VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, platform) DO UPDATE SET
        access_token_enc=excluded.access_token_enc, access_token_iv=excluded.access_token_iv,
        refresh_token_enc=excluded.refresh_token_enc, refresh_token_iv=excluded.refresh_token_iv,
        channel_id=excluded.channel_id, channel_name=excluded.channel_name, connected_at=CURRENT_TIMESTAMP
    `).bind(userId, 'bluesky', encAccess.encrypted, encAccess.iv,
            encRefresh.encrypted, encRefresh.iv,
            session.did, session.handle).run()
    return c.json({ success: true, handle: session.handle, did: session.did })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

app.get('/api/attention/bluesky/status', requireAuth, async (c) => {
  const userId = c.get('userId')
  const row = await c.env.DB.prepare(
    `SELECT channel_name, channel_id, connected_at FROM platform_connections WHERE user_id=? AND platform='bluesky'`
  ).bind(userId).first<any>()
  if (!row) return c.json({ connected: false })
  return c.json({ connected: true, handle: row.channel_name, did: row.channel_id, connectedAt: row.connected_at })
})

app.delete('/api/attention/bluesky/disconnect', requireAuth, async (c) => {
  const userId = c.get('userId')
  await c.env.DB.prepare(`DELETE FROM platform_connections WHERE user_id=? AND platform='bluesky'`).bind(userId).run()
  return c.json({ success: true })
})

app.get('/api/attention/bluesky/posts', requireAuth, async (c) => {
  try {
    const userId = c.get('userId')
    const row = await c.env.DB.prepare(
      `SELECT access_token_enc, access_token_iv, refresh_token_enc, refresh_token_iv, channel_id, channel_name
       FROM platform_connections WHERE user_id=? AND platform='bluesky'`
    ).bind(userId).first<any>()
    if (!row) return c.json({ error: 'Bluesky not connected', needs_connect: true }, 401)
    const accessToken = await decryptKey(row.access_token_enc, row.access_token_iv, c.env.ENCRYPTION_KEY)
    const feedRes = await fetch(
      `https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(row.channel_id)}&limit=20&filter=posts_no_replies`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (feedRes.status === 401) {
      // Try refresh
      const refreshToken = await decryptKey(row.refresh_token_enc, row.refresh_token_iv, c.env.ENCRYPTION_KEY)
      const refreshRes = await fetch('https://bsky.social/xrpc/com.atproto.server.refreshSession', {
        method: 'POST', headers: { Authorization: `Bearer ${refreshToken}` }
      })
      const newSession: any = await refreshRes.json()
      if (newSession.error) return c.json({ error: 'Session expired — please reconnect Bluesky', needs_connect: true }, 401)
      const encNew = await encryptKey(newSession.accessJwt, c.env.ENCRYPTION_KEY)
      await c.env.DB.prepare(`UPDATE platform_connections SET access_token_enc=?, access_token_iv=? WHERE user_id=? AND platform='bluesky'`)
        .bind(encNew.encrypted, encNew.iv, userId).run()
      // Retry with new token
      const retryRes = await fetch(
        `https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(row.channel_id)}&limit=20&filter=posts_no_replies`,
        { headers: { Authorization: `Bearer ${newSession.accessJwt}` } }
      )
      const retryData: any = await retryRes.json()
      return c.json(formatBskyFeed(retryData))
    }
    const feedData: any = await feedRes.json()
    return c.json(formatBskyFeed(feedData))
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

function formatBskyFeed(data: any) {
  if (data.error) return { error: data.message || data.error }
  const posts = (data.feed || []).map((item: any) => {
    const post = item.post
    return {
      uri:          post.uri,
      cid:          post.cid,
      text:         post.record?.text || '',
      createdAt:    post.record?.createdAt || post.indexedAt,
      likeCount:    post.likeCount    || 0,
      repostCount:  post.repostCount  || 0,
      replyCount:   post.replyCount   || 0,
      quoteCount:   post.quoteCount   || 0,
      author:       post.author?.handle || '',
      authorName:   post.author?.displayName || post.author?.handle || '',
    }
  })
  return { posts }
}

app.get('/api/attention/bluesky/post/metrics', requireAuth, async (c) => {
  try {
    const userId = c.get('userId')
    const uri    = c.req.query('uri') || ''
    if (!uri) return c.json({ error: 'uri parameter required' }, 400)
    const row = await c.env.DB.prepare(
      `SELECT access_token_enc, access_token_iv FROM platform_connections WHERE user_id=? AND platform='bluesky'`
    ).bind(userId).first<any>()
    if (!row) return c.json({ error: 'Bluesky not connected', needs_connect: true }, 401)
    const accessToken = await decryptKey(row.access_token_enc, row.access_token_iv, c.env.ENCRYPTION_KEY)
    const threadRes = await fetch(
      `https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const threadData: any = await threadRes.json()
    if (threadData.error) return c.json({ error: threadData.message || threadData.error }, 400)
    const post = threadData.thread?.post
    if (!post) return c.json({ error: 'Post not found' }, 404)
    return c.json({
      uri:         post.uri,
      text:        post.record?.text || '',
      createdAt:   post.record?.createdAt || post.indexedAt,
      likeCount:   post.likeCount   || 0,
      repostCount: post.repostCount || 0,
      replyCount:  post.replyCount  || 0,
      quoteCount:  post.quoteCount  || 0,
      author:      post.author?.handle || '',
      authorName:  post.author?.displayName || post.author?.handle || '',
    })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

/* ══════════════════════════════════════════════════════════════════
   FETCH URL — auto-populate metrics from YouTube (OAuth) or Bluesky
   Also handles YouTube via stored OAuth token (no API key needed from user)
══════════════════════════════════════════════════════════════════ */
app.get('/api/fetch-url', async (c) => {
  const url     = c.req.query('url') || ''
  const ytKey   = c.req.query('yt_key') || c.env.YOUTUBE_API_KEY || ''
  const fbToken = c.req.query('fb_token') || c.env.FB_ACCESS_TOKEN || ''
  if (!url) return c.json({ error: 'No URL provided' }, 400)

  // ── YouTube ───────────────────────────────────────────────────────
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  if (ytMatch) {
    const videoId = ytMatch[1]
    // Try to get stored OAuth token for the logged-in user first
    let accessToken = ytKey
    try {
      const sessionToken = getCookie(c, 'session')
      if (sessionToken) {
        // Look up session in D1 (same pattern as requireAuth — sessions are opaque IDs, NOT JWTs)
        const session = await c.env.DB.prepare(
          `SELECT s.user_id FROM sessions s WHERE s.id = ? AND s.expires_at > datetime('now')`
        ).bind(sessionToken).first<{ user_id: string }>()
        if (session?.user_id) {
          const row = await c.env.DB.prepare(
            `SELECT access_token_enc, access_token_iv FROM platform_connections WHERE user_id=? AND platform='youtube'`
          ).bind(session.user_id).first<any>()
          if (row) accessToken = await decryptKey(row.access_token_enc, row.access_token_iv, c.env.ENCRYPTION_KEY)
        }
      }
    } catch {}
    if (!accessToken) return c.json({ error: 'Connect your YouTube account via the Connections button to auto-populate metrics.', platform: 'youtube', needs_connect: true }, 200)
    try {
      // Use OAuth token if it looks like a JWT, otherwise use as API key
      const isOAuth = accessToken.length > 100
      const apiUrl = isOAuth
        ? `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet,statistics,contentDetails`
        : `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${accessToken}&part=snippet,statistics,contentDetails`
      const headers: any = isOAuth ? { Authorization: `Bearer ${accessToken}` } : {}
      const res = await fetch(apiUrl, { headers })
      const data: any = await res.json()
      if (!data.items?.length) return c.json({ error: 'Video not found', platform: 'youtube' }, 200)
      const item = data.items[0]; const stats = item.statistics || {}; const snippet = item.snippet || {}
      const dur = item.contentDetails?.duration || 'PT0S'
      const dm = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
      const durSec = (parseInt(dm?.[1] || '0') * 3600) + (parseInt(dm?.[2] || '0') * 60) + parseInt(dm?.[3] || '0')
      return c.json({ platform: 'youtube', title: snippet.title || '', channel: snippet.channelTitle || '', thumbnail: snippet.thumbnails?.high?.url || '', published: snippet.publishedAt || '', duration_sec: durSec, metrics: { views: parseInt(stats.viewCount || '0'), likes: parseInt(stats.likeCount || '0'), comments: parseInt(stats.commentCount || '0'), shares: 0, saves: 0, watch_time_pct: 0 }, notes: 'Shares/saves/watch time not available via YouTube API.' })
    } catch (err: any) { return c.json({ error: err.message, platform: 'youtube' }, 500) }
  }

  // ── Bluesky ───────────────────────────────────────────────────────
  // Bluesky post URLs: https://bsky.app/profile/{handle}/post/{rkey}
  const bskyMatch = url.match(/bsky\.app\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)/)
  if (bskyMatch) {
    const handle = bskyMatch[1]
    const rkey   = bskyMatch[2]
    const atUri  = `at://${handle}/app.bsky.feed.post/${rkey}`
    try {
      // Try with auth if user is logged in
      let authHeader = ''
      try {
        const sessionToken = getCookie(c, 'session')
        if (sessionToken) {
          const session = await c.env.DB.prepare(
            `SELECT s.user_id FROM sessions s WHERE s.id = ? AND s.expires_at > datetime('now')`
          ).bind(sessionToken).first<{ user_id: string }>()
          if (session?.user_id) {
            const row = await c.env.DB.prepare(
              `SELECT access_token_enc, access_token_iv FROM platform_connections WHERE user_id=? AND platform='bluesky'`
            ).bind(session.user_id).first<any>()
            if (row) {
              const token = await decryptKey(row.access_token_enc, row.access_token_iv, c.env.ENCRYPTION_KEY)
              authHeader = `Bearer ${token}`
            }
          }
        }
      } catch {}
      const fetchHeaders: any = authHeader ? { Authorization: authHeader } : {}
      const threadRes = await fetch(
        `https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(atUri)}&depth=0`,
        { headers: fetchHeaders }
      )
      const threadData: any = await threadRes.json()
      if (threadData.error) return c.json({ error: 'Could not fetch Bluesky post. Connect your Bluesky account for full access.', platform: 'bluesky', needs_connect: !authHeader }, 200)
      const post = threadData.thread?.post
      if (!post) return c.json({ error: 'Post not found', platform: 'bluesky' }, 200)
      return c.json({
        platform:    'bluesky',
        title:       post.record?.text?.slice(0, 80) || 'Bluesky Post',
        channel:     post.author?.displayName || post.author?.handle || handle,
        thumbnail:   post.author?.avatar || '',
        published:   post.record?.createdAt || '',
        duration_sec: 0,
        metrics: {
          views:         0,
          likes:         post.likeCount   || 0,
          comments:      post.replyCount  || 0,
          shares:        post.repostCount || 0,
          saves:         post.quoteCount  || 0,
          watch_time_pct: 0,
        },
        notes: 'Bluesky metrics: Likes, Replies, Reposts, Quotes. Views/watch time not available.',
        bsky_uri: atUri,
      })
    } catch (err: any) { return c.json({ error: err.message, platform: 'bluesky' }, 500) }
  }

  let dp = 'unknown'
  if (url.includes('tiktok.com'))                               dp = 'tiktok'
  if (url.includes('twitter.com') || url.includes('x.com'))    dp = 'twitter'
  if (url.includes('instagram.com'))                            dp = 'instagram'
  return c.json({ platform: dp, error: 'Auto-populate not available for this platform yet.', needs_manual: true })
})

/* ══════════════════════════════════════════════════════════════════
   SHOT COMPARISON — GET /api/projects/:id/compare?shot_ids=a,b,c
══════════════════════════════════════════════════════════════════ */
app.get('/api/projects/:id/compare', requireAuth, async (c) => {
  try {
    const userId    = c.get('userId')
    const projectId = c.req.param('id')
    const idsParam  = c.req.query('shot_ids') || ''
    const shotIds   = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 4)
    if (shotIds.length < 2) return c.json({ error: 'At least 2 shot_ids required' }, 400)

    const project = await c.env.DB.prepare(
      `SELECT id, name FROM projects WHERE id = ? AND user_id = ?`
    ).bind(projectId, userId).first<{ id: string; name: string }>()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const placeholders = shotIds.map(() => '?').join(',')
    const rows = await c.env.DB.prepare(
      `SELECT id, prompt_raw, prompt_enhanced, model, aspect_ratio, duration,
              status, video_url, hf_video_url, thumbnail_url,
              seed, style_preset, quality, sort_order, created_at, completed_at,
              CASE WHEN completed_at IS NOT NULL AND created_at IS NOT NULL
                   THEN ROUND((julianday(completed_at) - julianday(created_at)) * 86400)
                   ELSE NULL END AS gen_time_sec
       FROM shots
       WHERE id IN (${placeholders}) AND project_id = ? AND user_id = ?`
    ).bind(...shotIds, projectId, userId).all<any>()

    // Preserve requested order
    const ordered = shotIds
      .map(id => rows.results.find((r: any) => r.id === id))
      .filter(Boolean)

    return c.json({ project, shots: ordered })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   TIMELINE — GET /api/projects/:id/timeline
   Returns shots in sort_order for the timeline editor
══════════════════════════════════════════════════════════════════ */
app.get('/api/projects/:id/timeline', requireAuth, async (c) => {
  try {
    const userId    = c.get('userId')
    const projectId = c.req.param('id')

    const project = await c.env.DB.prepare(
      `SELECT id, name, style_bible, default_model FROM projects WHERE id = ? AND user_id = ?`
    ).bind(projectId, userId).first<any>()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const shots = await c.env.DB.prepare(
      `SELECT id, prompt_raw, prompt_enhanced, model, aspect_ratio, duration,
              status, video_url, hf_video_url, thumbnail_url, sort_order,
              seed, style_preset, created_at
       FROM shots
       WHERE project_id = ? AND user_id = ? AND status = 'completed'
       ORDER BY sort_order ASC, created_at ASC`
    ).bind(projectId, userId).all<any>()

    return c.json({ project, shots: shots.results })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   TIMELINE EXPORT — POST /api/projects/:id/timeline/export
   Returns a JSON manifest + EDL-style metadata for the sequence
══════════════════════════════════════════════════════════════════ */
app.post('/api/projects/:id/timeline/export', requireAuth, async (c) => {
  try {
    const userId    = c.get('userId')
    const projectId = c.req.param('id')
    const { shot_ids, format = 'json' } = await c.req.json()

    const project = await c.env.DB.prepare(
      `SELECT id, name, style_bible, default_model FROM projects WHERE id = ? AND user_id = ?`
    ).bind(projectId, userId).first<any>()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    // Use supplied order or all completed shots
    let shots: any[]
    if (Array.isArray(shot_ids) && shot_ids.length > 0) {
      const placeholders = shot_ids.map(() => '?').join(',')
      const rows = await c.env.DB.prepare(
        `SELECT id, prompt_raw, prompt_enhanced, model, aspect_ratio, duration,
                video_url, hf_video_url, thumbnail_url, seed, style_preset, sort_order, created_at
         FROM shots WHERE id IN (${placeholders}) AND project_id = ? AND user_id = ? AND status = 'completed'`
      ).bind(...shot_ids, projectId, userId).all<any>()
      const map = new Map(rows.results.map((r: any) => [r.id, r]))
      shots = shot_ids.map((id: string) => map.get(id)).filter(Boolean)
    } else {
      const rows = await c.env.DB.prepare(
        `SELECT id, prompt_raw, prompt_enhanced, model, aspect_ratio, duration,
                video_url, hf_video_url, thumbnail_url, seed, style_preset, sort_order, created_at
         FROM shots WHERE project_id = ? AND user_id = ? AND status = 'completed'
         ORDER BY sort_order ASC, created_at ASC`
      ).bind(projectId, userId).all<any>()
      shots = rows.results
    }

    const origin = new URL(c.req.url).origin
    const manifest = {
      spectra_version: '1.0',
      exported_at:     new Date().toISOString(),
      project: {
        id:    project.id,
        name:  project.name,
        style: project.style_bible ? JSON.parse(project.style_bible) : null,
      },
      sequence: shots.map((s: any, idx: number) => ({
        index:          idx + 1,
        shot_id:        s.id,
        prompt:         s.prompt_enhanced || s.prompt_raw,
        prompt_raw:     s.prompt_raw,
        model:          s.model,
        aspect_ratio:   s.aspect_ratio,
        duration_sec:   s.duration || 5,
        video_url:      s.video_url || s.hf_video_url || null,
        thumbnail_url:  s.thumbnail_url || null,
        seed:           s.seed || null,
        style_preset:   s.style_preset || null,
        timecode_in:    formatTimecode(shots.slice(0, idx).reduce((a: number, sh: any) => a + (sh.duration || 5), 0)),
        timecode_out:   formatTimecode(shots.slice(0, idx + 1).reduce((a: number, sh: any) => a + (sh.duration || 5), 0)),
      })),
      total_duration_sec: shots.reduce((a: number, s: any) => a + (s.duration || 5), 0),
      shot_count:         shots.length,
    }

    return c.json({ ok: true, manifest })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

function formatTimecode(totalSeconds: number): string {
  const h  = Math.floor(totalSeconds / 3600)
  const m  = Math.floor((totalSeconds % 3600) / 60)
  const s  = Math.floor(totalSeconds % 60)
  const fr = 0
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}:${String(fr).padStart(2,'0')}`
}

/* ══════════════════════════════════════════════════════════════════
   ADMIN PANEL — secret-key gated
   ADMIN_SECRET env var must be set; passed as ?secret= or X-Admin-Secret header
══════════════════════════════════════════════════════════════════ */

async function requireAdmin(c: any, next: any) {
  const secret = c.req.query('secret') || c.req.header('X-Admin-Secret') || ''
  const adminSecret = (c.env as any).ADMIN_SECRET || ''
  if (!adminSecret || secret !== adminSecret) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await next()
}

// GET /api/admin/stats — platform-wide overview
app.get('/api/admin/stats', requireAdmin, async (c) => {
  try {
    const [users, shots, projects, sessions, revenue] = await Promise.all([
      c.env.DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN tier='free'    THEN 1 ELSE 0 END) AS free_count,
          SUM(CASE WHEN tier='creator' THEN 1 ELSE 0 END) AS creator_count,
          SUM(CASE WHEN tier='studio'  THEN 1 ELSE 0 END) AS studio_count,
          SUM(CASE WHEN tier='pro'     THEN 1 ELSE 0 END) AS pro_count,
          SUM(CASE WHEN created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS new_7d,
          SUM(CASE WHEN created_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS new_30d
        FROM users`).first<any>(),

      c.env.DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status='completed'   THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status='failed'      THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status='nsfw'        THEN 1 ELSE 0 END) AS nsfw,
          SUM(CASE WHEN status IN ('queued','in_progress') THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN created_at >= datetime('now','-24 hours') THEN 1 ELSE 0 END) AS last_24h,
          SUM(CASE WHEN created_at >= datetime('now','-7 days')   THEN 1 ELSE 0 END) AS last_7d,
          SUM(CASE WHEN status='completed' AND duration IS NOT NULL THEN duration ELSE 0 END) AS total_seconds
        FROM shots`).first<any>(),

      c.env.DB.prepare(`SELECT COUNT(*) AS total FROM projects`).first<any>(),

      c.env.DB.prepare(`
        SELECT COUNT(*) AS active FROM sessions
        WHERE expires_at > datetime('now')`).first<any>(),

      c.env.DB.prepare(`
        SELECT
          SUM(CASE WHEN tier='creator' THEN 29 WHEN tier='studio' THEN 79 WHEN tier='pro' THEN 149 ELSE 0 END) AS mrr
        FROM users WHERE tier != 'free'`).first<any>(),
    ])

    return c.json({ users, shots, projects, sessions, revenue })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/admin/users?page=1&limit=50&search=&tier= — paginated user list
app.get('/api/admin/users', requireAdmin, async (c) => {
  try {
    const page   = Math.max(1, parseInt(c.req.query('page') || '1'))
    const limit  = Math.min(100, parseInt(c.req.query('limit') || '50'))
    const search = c.req.query('search') || ''
    const tier   = c.req.query('tier') || ''
    const offset = (page - 1) * limit

    let where = 'WHERE 1=1'
    const params: any[] = []
    if (search) { where += ` AND (email LIKE ? OR id = ?)`; params.push(`%${search}%`, search) }
    if (tier)   { where += ` AND tier = ?`; params.push(tier) }

    const [rows, countRow] = await Promise.all([
      c.env.DB.prepare(`
        SELECT u.id, u.email, u.tier, u.credits, u.stripe_customer_id,
               u.stripe_subscription_id, u.created_at, u.updated_at,
               (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS project_count,
               (SELECT COUNT(*) FROM shots   s WHERE s.user_id = u.id) AS shot_count,
               (SELECT COUNT(*) FROM shots   s WHERE s.user_id = u.id AND s.status='completed') AS completed_shots
        FROM users u ${where}
        ORDER BY u.created_at DESC
        LIMIT ? OFFSET ?`
      ).bind(...params, limit, offset).all<any>(),

      c.env.DB.prepare(
        `SELECT COUNT(*) AS total FROM users ${where}`
      ).bind(...params).first<any>(),
    ])

    return c.json({
      users:   rows.results,
      total:   countRow?.total || 0,
      page,
      limit,
      pages:   Math.ceil((countRow?.total || 0) / limit),
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// PATCH /api/admin/users/:id — update tier / credits
app.patch('/api/admin/users/:id', requireAdmin, async (c) => {
  try {
    const userId = c.req.param('id')
    const body   = await c.req.json()
    const fields: string[] = []
    const values: any[]    = []

    if (body.tier !== undefined) {
      if (!['free','creator','studio','pro'].includes(body.tier)) {
        return c.json({ error: 'Invalid tier' }, 400)
      }
      fields.push('tier = ?'); values.push(body.tier)
    }
    if (body.credits !== undefined) {
      const cr = parseInt(body.credits)
      if (isNaN(cr) || cr < 0) return c.json({ error: 'Invalid credits' }, 400)
      fields.push('credits = ?'); values.push(cr)
    }
    if (fields.length === 0) return c.json({ error: 'Nothing to update' }, 400)
    fields.push('updated_at = datetime(\'now\')')

    const result = await c.env.DB.prepare(
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`
    ).bind(...values, userId).run()

    if (result.meta.changes === 0) return c.json({ error: 'User not found' }, 404)
    return c.json({ ok: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// DELETE /api/admin/users/:id — hard delete user + cascade
app.delete('/api/admin/users/:id', requireAdmin, async (c) => {
  try {
    const userId = c.req.param('id')
    const user = await c.env.DB.prepare(`SELECT id, email FROM users WHERE id = ?`).bind(userId).first<any>()
    if (!user) return c.json({ error: 'User not found' }, 404)

    await c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run()
    return c.json({ ok: true, deleted: user.email })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/admin/activity — recent shots across all users
app.get('/api/admin/activity', requireAdmin, async (c) => {
  try {
    const limit = Math.min(100, parseInt(c.req.query('limit') || '50'))
    const rows = await c.env.DB.prepare(`
      SELECT s.id, s.status, s.model, s.aspect_ratio, s.duration, s.created_at, s.completed_at,
             u.email, u.tier, p.name AS project_name
      FROM shots s
      JOIN users    u ON s.user_id    = u.id
      JOIN projects p ON s.project_id = p.id
      ORDER BY s.created_at DESC
      LIMIT ?`
    ).bind(limit).all<any>()
    return c.json({ activity: rows.results })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/admin/model-stats — aggregate per-model stats across all users
app.get('/api/admin/model-stats', requireAdmin, async (c) => {
  try {
    const rows = await c.env.DB.prepare(`
      SELECT model,
             COUNT(*) AS total,
             SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN status='failed'    THEN 1 ELSE 0 END) AS failed,
             SUM(CASE WHEN status='nsfw'      THEN 1 ELSE 0 END) AS nsfw,
             AVG(CASE WHEN status='completed' AND completed_at IS NOT NULL
                 THEN (julianday(completed_at)-julianday(created_at))*86400 ELSE NULL END) AS avg_sec
      FROM shots
      GROUP BY model ORDER BY total DESC`
    ).all<any>()
    return c.json({ models: rows.results })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/admin/growth — daily signups + shots for last 30 days
app.get('/api/admin/growth', requireAdmin, async (c) => {
  try {
    const [signups, shots] = await Promise.all([
      c.env.DB.prepare(`
        SELECT date(created_at) AS day, COUNT(*) AS count
        FROM users WHERE created_at >= datetime('now','-30 days')
        GROUP BY date(created_at) ORDER BY day ASC`).all<any>(),
      c.env.DB.prepare(`
        SELECT date(created_at) AS day,
               COUNT(*) AS total,
               SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed
        FROM shots WHERE created_at >= datetime('now','-30 days')
        GROUP BY date(created_at) ORDER BY day ASC`).all<any>(),
    ])
    return c.json({ signups: signups.results, shots: shots.results })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/* ══════════════════════════════════════════════════════════════════
   PAGE ROUTES
══════════════════════════════════════════════════════════════════ */
app.get('/admin',  (c) => c.redirect('/admin/'))
app.get('/admin/', (c) => c.html(adminPage()))
app.get('/tools/attention-engine',   (c) => c.redirect('/tools/attention-engine/'))
app.get('/tools/attention-engine/',  (c) => c.html(attentionEnginePage()))
app.get('/tools/video-generator',    (c) => c.redirect('/tools/video-generator/'))
app.get('/tools/video-generator/',   (c) => c.html(videoGeneratorPage()))
app.get('/tools/distribution-engine',  (c) => c.redirect('/tools/distribution-engine/'))
app.get('/tools/distribution-engine/', (c) => c.html(distributionPage()))
app.get('/tools/motion-engine',  (c) => c.redirect('/tools/motion-engine/'))
app.get('/tools/motion-engine/', (c) => c.html(toolShell('Motion Composition Engine', 'motion', '#FB923C')))
app.get('/tools/persona-engine',  (c) => c.redirect('/tools/persona-engine/'))
app.get('/tools/persona-engine/', (c) => c.html(toolShell('Spectra Persona Engine', 'persona', '#F87171')))
app.get('/', (c) => c.html(landingPage()))

export default app

/* ══════════════════════════════════════════════════════════════════
   VIDEO GENERATOR PAGE — CINEMATIC STUDIO v2
══════════════════════════════════════════════════════════════════ */
function videoGeneratorPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Video Generator — Spectra</title>
  <meta name="description" content="AI-powered cinematic video production. Multi-model generation, style presets, seed control.">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/video-generator.css"/>
</head>
<body>

<!-- NAV -->
<nav id="vg-nav">
  <a href="/" class="vg-nav-logo">
    <span class="vg-logo-mark">S</span>
    <span class="vg-logo-text">SPECTRA</span>
  </a>
  <div class="vg-nav-center">
    <span class="vg-tool-badge">
      <span class="vg-tool-pip"></span>
      Video Generator
    </span>
  </div>
  <div class="vg-nav-right">
    <button class="vg-nav-tab-btn active" id="btn-show-studio" data-view="studio">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Studio
    </button>
    <button class="vg-nav-tab-btn" id="btn-show-analytics" data-view="analytics">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      Analytics
    </button>
    <button class="vg-nav-tab-btn" id="btn-show-compare" data-view="compare">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="9" height="18" rx="1"/><rect x="13" y="3" width="9" height="18" rx="1"/></svg>
      Compare
    </button>
    <button class="vg-nav-tab-btn" id="btn-show-timeline" data-view="timeline">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="7" width="20" height="10" rx="1"/><line x1="6" y1="7" x2="6" y2="17"/><line x1="10" y1="7" x2="10" y2="17"/><line x1="14" y1="7" x2="14" y2="17"/><line x1="18" y1="7" x2="18" y2="17"/></svg>
      Timeline
    </button>
    <button class="vg-keys-btn" id="btn-open-settings" title="Settings">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
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
    <p>Sign in to your studio and start generating.</p>
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
      <button type="submit" class="vg-btn-primary full-width" id="btn-auth-submit">Sign In</button>
    </form>
    <div class="vg-auth-tier-info">
      <div class="vg-tier-chip free">Free — 10/mo</div>
      <div class="vg-tier-chip creator">Creator $29 — 100/mo</div>
      <div class="vg-tier-chip studio">Studio $79 — 500/mo</div>
      <div class="vg-tier-chip pro">Pro $149 — ∞</div>
    </div>
  </div>
</div>

<!-- SETTINGS DRAWER -->
<div class="vg-drawer-overlay" id="settings-overlay"></div>
<aside class="vg-settings-drawer" id="settings-drawer">
  <div class="vg-drawer-header">
    <div class="vg-drawer-title">Studio Settings</div>
    <div class="vg-drawer-subtitle">API keys are encrypted at rest — never exposed</div>
    <button class="vg-drawer-close" id="btn-close-settings">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  </div>
  <div class="vg-drawer-body">
    <div class="vg-key-block">
      <div class="vg-key-block-header">
        <div class="vg-key-block-info">
          <div class="vg-key-block-name">Account</div>
          <div class="vg-key-block-desc" id="settings-account-info">Loading...</div>
        </div>
        <button class="vg-key-save danger" id="btn-logout">Sign Out</button>
      </div>
      <div class="vg-tier-limits-grid" id="settings-limits"></div>
    </div>
    <div class="vg-key-block">
      <div class="vg-key-block-header">
        <div class="vg-key-block-info">
          <div class="vg-key-block-name">Higgsfield API</div>
          <div class="vg-key-block-desc">Format: KEY_ID:KEY_SECRET — from your Higgsfield Cloud dashboard</div>
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
        Get API keys → Higgsfield Cloud
      </a>
    </div>
    <div class="vg-upgrade-card">
      <div class="vg-upgrade-title">Upgrade Your Plan</div>
      <div class="vg-upgrade-tiers">
        <div class="vg-upgrade-tier"><span class="vg-ut-name">Creator</span><span class="vg-ut-price">$29/mo</span><span class="vg-ut-shots">100 shots · 5 projects</span></div>
        <div class="vg-upgrade-tier"><span class="vg-ut-name">Studio</span><span class="vg-ut-price">$79/mo</span><span class="vg-ut-shots">500 shots · 25 projects</span></div>
        <div class="vg-upgrade-tier featured"><span class="vg-ut-name">Pro</span><span class="vg-ut-price">$149/mo</span><span class="vg-ut-shots">Unlimited</span></div>
      </div>
      <button class="vg-btn-primary full-width" id="btn-upgrade">Upgrade Plan</button>
    </div>
  </div>
</aside>

<!-- MAIN STUDIO APP -->
<main id="vg-app" style="display:none">

  <!-- ═══════════════ LEFT PANEL ═══════════════ -->
  <aside id="vg-input-panel">

    <!-- Project selector -->
    <section class="vg-panel-section" id="vg-project-section">
      <div class="vg-section-header">
        <span class="vg-section-label">Project</span>
        <button class="vg-btn-chip" id="btn-new-project">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2v12M2 8h12"/></svg>
          New
        </button>
      </div>
      <!-- #8 Campaign container -->
      <div id="vg-campaign-section">
        <div class="vg-campaign-header">
          <span class="vg-campaign-label">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
            Campaigns
          </span>
          <button class="vg-btn-chip" id="btn-new-campaign" title="Create new campaign">
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2v12M2 8h12"/></svg>
          </button>
        </div>
        <div id="vg-campaign-list"><!-- Injected by JS --></div>
        <!-- New campaign inline input (hidden by default) -->
        <div class="vg-campaign-new-row" id="vg-campaign-new-row" style="display:none">
          <input type="text" class="vg-input vg-campaign-input" id="vg-campaign-name-input" placeholder="Campaign name…" maxlength="60"/>
          <button class="vg-btn-chip" id="btn-campaign-save">Create</button>
          <button class="vg-btn-chip" id="btn-campaign-cancel">✕</button>
        </div>
      </div>
      <div class="vg-campaign-divider"></div>
      <div id="vg-project-selector">
        <div class="vg-project-loading">Loading projects...</div>
      </div>
    </section>

    <!-- Divider -->
    <div class="vg-panel-divider"></div>

    <!-- MODEL PICKER -->
    <section class="vg-panel-section vg-model-picker-section">
      <div class="vg-section-header">
        <span class="vg-section-label">Generation Model</span>
        <span class="vg-model-type-badge" id="vg-model-type-badge">i2v</span>
      </div>
      <!-- Trigger pill -->
      <button class="vg-model-trigger" id="vg-model-trigger" aria-haspopup="listbox" aria-expanded="false">
        <div class="vg-model-trigger-left">
          <span class="vg-model-trigger-icon" id="vg-model-trigger-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          </span>
          <div class="vg-model-trigger-info">
            <span class="vg-model-trigger-name" id="vg-model-trigger-name">DoP Standard</span>
            <span class="vg-model-trigger-desc" id="vg-model-trigger-desc">Balanced quality &amp; speed</span>
          </div>
        </div>
        <div class="vg-model-trigger-right">
          <span class="vg-model-trigger-speed" id="vg-model-trigger-speed">Balanced</span>
          <svg class="vg-model-trigger-chevron" id="vg-model-trigger-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </button>
      <!-- Dropdown -->
      <div class="vg-model-dropdown" id="vg-model-dropdown" role="listbox" aria-hidden="true">
        <div class="vg-model-dropdown-inner" id="vg-model-cards">
          <!-- Injected by JS -->
        </div>
      </div>
    </section>

    <!-- Divider -->
    <div class="vg-panel-divider"></div>

    <!-- ASPECT RATIO -->
    <section class="vg-panel-section">
      <div class="vg-section-header">
        <span class="vg-section-label">Format</span>
      </div>
      <div class="vg-aspect-row">
        <button class="vg-aspect-btn" data-aspect="9:16">
          <div class="vg-aspect-icon vg-aspect-916"></div>
          <span>9:16</span>
        </button>
        <button class="vg-aspect-btn active" data-aspect="16:9">
          <div class="vg-aspect-icon vg-aspect-169"></div>
          <span>16:9</span>
        </button>
        <button class="vg-aspect-btn" data-aspect="1:1">
          <div class="vg-aspect-icon vg-aspect-11"></div>
          <span>1:1</span>
        </button>
        <button class="vg-aspect-btn" data-aspect="4:5">
          <div class="vg-aspect-icon vg-aspect-45"></div>
          <span>4:5</span>
        </button>
      </div>
    </section>

    <!-- Divider -->
    <div class="vg-panel-divider"></div>

    <!-- DURATION -->
    <section class="vg-panel-section">
      <div class="vg-section-header">
        <span class="vg-section-label">Duration</span>
      </div>
      <div class="vg-duration-row">
        <button class="vg-dur-btn active" data-dur="5">5s</button>
        <button class="vg-dur-btn" data-dur="8">8s</button>
        <button class="vg-dur-btn" data-dur="10">10s</button>
        <button class="vg-dur-btn" data-dur="15">15s</button>
      </div>
    </section>

    <!-- Divider -->
    <div class="vg-panel-divider"></div>

    <!-- QUALITY CONTROLS -->
    <section class="vg-panel-section" id="vg-quality-section">
      <div class="vg-section-header">
        <span class="vg-section-label">Quality Controls</span>
        <button class="vg-btn-chip" id="btn-reset-quality">Reset</button>
      </div>
      <div class="vg-quality-sliders">
        <div class="vg-slider-row">
          <div class="vg-slider-info">
            <span class="vg-slider-label">Motion Intensity</span>
            <span class="vg-slider-val" id="val-motion">5</span>
          </div>
          <input type="range" class="vg-slider" id="slider-motion" min="1" max="10" value="5"/>
          <div class="vg-slider-ends"><span>Subtle</span><span>Dynamic</span></div>
        </div>
        <div class="vg-slider-row">
          <div class="vg-slider-info">
            <span class="vg-slider-label">Stylization</span>
            <span class="vg-slider-val" id="val-style">5</span>
          </div>
          <input type="range" class="vg-slider" id="slider-style" min="1" max="10" value="5"/>
          <div class="vg-slider-ends"><span>Natural</span><span>Artistic</span></div>
        </div>
        <div class="vg-slider-row">
          <div class="vg-slider-info">
            <span class="vg-slider-label">Detail Level</span>
            <span class="vg-slider-val" id="val-detail">7</span>
          </div>
          <input type="range" class="vg-slider" id="slider-detail" min="1" max="10" value="7"/>
          <div class="vg-slider-ends"><span>Loose</span><span>Sharp</span></div>
        </div>
      </div>
    </section>

    <!-- Divider -->
    <div class="vg-panel-divider"></div>

    <!-- CHARACTER SOUL PANEL (Item 5) -->
    <section class="vg-panel-section" id="vg-character-section" style="display:none">
      <div class="vg-section-header">
        <span class="vg-section-label">Characters</span>
        <button class="vg-btn-chip" id="btn-add-character">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2v12M2 8h12"/></svg>
          Add
        </button>
      </div>
      <div id="vg-character-list">
        <div class="vg-char-empty">No characters yet. Add one to maintain visual consistency across shots.</div>
      </div>
    </section>

  </aside>

  <!-- ═══════════════ CENTER STAGE ═══════════════ -->
  <section id="vg-stage">

    <!-- COMPOSE PANEL (generation form) -->
    <div id="vg-compose">
      <!-- Compose header row with Director toggle -->
      <div class="vg-compose-top-bar">
        <span class="vg-compose-top-label">Compose Shot</span>
        <button class="vg-btn-chip vg-director-toggle-btn" id="btn-open-director" title="AI Creative Director — generate a full shot list from a concept">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>
          Director
        </button>
      </div>

      <!-- Image upload zone -->
      <div class="vg-compose-block" id="vg-image-block">
        <div class="vg-compose-label">
          Reference Image
          <span class="vg-required-badge" id="vg-image-required-badge">required</span>
          <span class="vg-optional-badge" id="vg-image-optional-badge" style="display:none">optional</span>
        </div>
        <!-- #3 Character Continuity Lock Banner -->
        <div class="vg-char-lock-banner" id="vg-char-lock-banner" style="display:none">
          <div class="vg-char-lock-avatar-placeholder" id="vg-char-lock-avatar-wrap">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div class="vg-char-lock-info">
            <span class="vg-char-lock-name" id="vg-char-lock-name">Character</span>
            <span class="vg-char-lock-sub">🔒 Locked — reference image applied to every shot</span>
          </div>
          <button class="vg-char-lock-clear" id="btn-char-lock-clear" title="Unlock character">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="vg-upload-zone" id="vg-upload-zone">
          <!-- Preview -->
          <div class="vg-upload-preview" id="vg-upload-preview" style="display:none">
            <img id="vg-upload-img" src="" alt="Reference"/>
            <button class="vg-upload-clear" id="btn-clear-image" title="Remove image">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <!-- Drop target -->
          <label class="vg-upload-drop" id="vg-upload-drop" for="vg-file-input">
            <div class="vg-upload-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </div>
            <div class="vg-upload-text">Click to upload from device</div>
            <span class="vg-btn-upload-browse">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload from device
            </span>
            <div class="vg-upload-sub">or drag &amp; drop · or paste URL below</div>
            <input type="url" id="vg-image-url" class="vg-input vg-url-input" placeholder="Paste image URL..." onclick="event.stopPropagation()"/>
          </label>
          <input type="file" id="vg-file-input" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none"/>
        </div>
      </div>

      <!-- Prompt -->
      <div class="vg-compose-block">
        <div class="vg-compose-label-row">
          <span class="vg-compose-label">Shot Prompt <span class="vg-required-star">*</span></span>
          <div class="vg-enhance-modes" id="vg-enhance-modes">
            <button class="vg-mode-btn active" data-mode="cinematic" title="Cinematic — camera language, lighting, lens">🎬</button>
            <button class="vg-mode-btn" data-mode="realism" title="Realism — photorealistic, naturalistic">📷</button>
            <button class="vg-mode-btn" data-mode="motion" title="Motion — movement, dynamics, physics">💫</button>
            <button class="vg-mode-btn" data-mode="storytelling" title="Storytelling — narrative, emotion, POV">🎭</button>
            <button class="vg-mode-btn" data-mode="camera" title="Camera — shot type, focal length, focus">🔭</button>
          </div>
        </div>
        <div class="vg-textarea-wrap">
          <textarea id="vg-prompt" class="vg-textarea" rows="4"
            placeholder="Describe your shot — subject, action, atmosphere, camera movement...&#10;&#10;e.g. A woman walks through rain-soaked Tokyo streets at night, slow push-in, neon reflections"
            maxlength="600"></textarea>
          <span class="vg-char-count" id="vg-prompt-count">0/600</span>
        </div>
        <div class="vg-enhance-bar">
          <button class="vg-btn-enhance" id="btn-enhance-prompt">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            Enhance
          </button>
          <span class="vg-enhance-mode-label" id="enhance-mode-label">cinematic mode</span>
          <div class="vg-enhance-divider"></div>
          <button class="vg-btn-prescore" id="btn-prescore" title="Score this script before generating — catch weak hooks before you waste a credit">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            Score Script
          </button>
          <div class="vg-enhance-divider"></div>
          <span class="vg-enhance-note">GPT-4o rewrite</span>
          <span class="vg-bible-active-badge" id="vg-bible-dot" style="display:none" title="Style bible injected into every enhance">
            <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#34D399"/></svg>
            <span id="vg-bible-tip">bible active</span>
          </span>
        </div>
      </div>

      <!-- Pre-Publish Script Score Panel -->
      <div class="vg-prescore-panel" id="vg-prescore-panel" style="display:none">
        <div class="vg-prescore-header">
          <div class="vg-prescore-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            Script Score
          </div>
          <div class="vg-prescore-header-right">
            <a href="/tools/attention-engine/" target="_blank" class="vg-prescore-fulllink" title="Open full Attention Engine">
              Full Analysis
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
            <button class="vg-prescore-close" id="btn-prescore-close" title="Close">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <!-- Loading state -->
        <div class="vg-prescore-loading" id="vg-prescore-loading" style="display:none">
          <svg class="vg-prescore-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity="0.25"/><path d="M21 12a9 9 0 00-9-9" stroke-linecap="round"/></svg>
          Analyzing your script…
        </div>

        <!-- Results state -->
        <div class="vg-prescore-results" id="vg-prescore-results" style="display:none">
          <!-- Score ring + verdict -->
          <div class="vg-prescore-top">
            <div class="vg-prescore-ring-wrap">
              <svg class="vg-prescore-ring" width="56" height="56" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="22" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="5"/>
                <circle id="vg-prescore-ring-fill" cx="28" cy="28" r="22" fill="none" stroke="#A78BFA" stroke-width="5"
                  stroke-linecap="round" stroke-dasharray="138.2" stroke-dashoffset="138.2"
                  transform="rotate(-90 28 28)" style="transition:stroke-dashoffset 0.7s ease,stroke 0.4s"/>
              </svg>
              <span class="vg-prescore-ring-num" id="vg-prescore-num">—</span>
            </div>
            <div class="vg-prescore-verdict-wrap">
              <div class="vg-prescore-verdict" id="vg-prescore-verdict">—</div>
              <div class="vg-prescore-flags" id="vg-prescore-flags"></div>
            </div>
          </div>

          <!-- Issue + Fix -->
          <div class="vg-prescore-issue-row" id="vg-prescore-issue-row">
            <div class="vg-prescore-issue-label">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Issue
            </div>
            <div class="vg-prescore-issue-text" id="vg-prescore-issue"></div>
            <div class="vg-prescore-fix-label">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Fix
            </div>
            <div class="vg-prescore-fix-text" id="vg-prescore-fix"></div>
          </div>

          <!-- Improved prompt -->
          <div class="vg-prescore-improved-wrap" id="vg-prescore-improved-wrap">
            <div class="vg-prescore-improved-label">Improved Prompt</div>
            <div class="vg-prescore-improved-text" id="vg-prescore-improved"></div>
            <button class="vg-btn-prescore-apply" id="btn-prescore-apply">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>
              Use This Prompt
            </button>
          </div>
        </div>

        <!-- Empty state -->
        <div class="vg-prescore-empty" id="vg-prescore-empty">
          Write your shot prompt above, then click <strong>Score Script</strong> to catch weak hooks before you generate.
        </div>
      </div>

      <!-- Style Presets -->
      <div class="vg-compose-block">
        <div class="vg-compose-label-row">
          <span class="vg-compose-label">Style Preset</span>
          <div class="vg-compose-label-actions">
            <button class="vg-btn-chip" id="btn-save-custom-style" title="Save current preset as a named style">
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2v12M2 8h12"/></svg>
              Save Style
            </button>
            <button class="vg-btn-chip" id="btn-clear-preset">Clear</button>
          </div>
        </div>
        <div class="vg-style-scroll" id="vg-style-scroll">
          <!-- Injected by JS -->
        </div>
        <!-- #6 My Styles -->
        <div id="vg-my-styles-section" style="display:none">
          <div class="vg-my-styles-label">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            My Styles
          </div>
          <div class="vg-style-scroll" id="vg-my-styles-scroll">
            <!-- Injected by JS -->
          </div>
        </div>
      </div>

      <!-- Seed Control -->
      <div class="vg-compose-block vg-seed-block">
        <div class="vg-compose-label">Seed Control</div>
        <div class="vg-seed-row">
          <input type="number" id="vg-seed-input" class="vg-input vg-seed-input" placeholder="Random" min="0" max="2147483647"/>
          <button class="vg-btn-seed-action" id="btn-randomize-seed" title="Randomize seed">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
          </button>
          <button class="vg-btn-seed-action" id="btn-lock-seed" title="Lock current seed">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="lock-icon"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          </button>
        </div>
        <div class="vg-seed-hint">Empty = random each time · Lock to reproduce exact results</div>
      </div>

      <!-- Generate button -->
      <div class="vg-compose-actions">
        <button class="vg-btn-generate" id="btn-generate">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Generate Shot
        </button>
        <div class="vg-usage-wrap">
          <div class="vg-usage-bar"><div class="vg-usage-fill" id="vg-usage-fill"></div></div>
          <div class="vg-usage-label" id="vg-usage-label"></div>
        </div>
        <!-- Credit Intelligence Widget -->
        <div class="vg-credit-widget" id="vg-credit-widget" style="display:none">
          <div class="vg-cw-header">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>Session Usage</span>
            <span class="vg-cw-total" id="vg-cw-total">0 cr used</span>
          </div>
          <div class="vg-cw-history" id="vg-cw-history"></div>
          <div class="vg-cw-tip" id="vg-cw-tip"></div>
        </div>
      </div>

    </div><!-- /vg-compose -->

    <!-- #10 AI CREATIVE DIRECTOR PANEL -->
    <div id="vg-director-panel" style="display:none">
      <div class="vg-director-header">
        <div class="vg-director-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>
          AI Creative Director
        </div>
        <button class="vg-btn-chip" id="btn-close-director">✕</button>
      </div>
      <div class="vg-director-body">
        <div class="vg-director-concept-wrap">
          <textarea id="vg-director-concept" class="vg-textarea vg-director-textarea" rows="3"
            placeholder="Describe your scene or concept in plain language…&#10;&#10;e.g. A luxury perfume ad — golden deserts, a woman in flowing white silk, dramatic light"
            maxlength="500"></textarea>
          <div class="vg-director-controls">
            <select class="vg-input vg-director-count-select" id="vg-director-shot-count">
              <option value="3">3 shots</option>
              <option value="4" selected>4 shots</option>
              <option value="5">5 shots</option>
            </select>
            <button class="vg-btn-generate vg-director-run-btn" id="btn-director-run">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>
              Generate Shot List
            </button>
          </div>
        </div>
        <div id="vg-director-results" style="display:none">
          <div class="vg-director-results-header">
            <span id="vg-director-concept-label"></span>
            <button class="vg-btn-chip" id="btn-director-queue-all">Queue All</button>
          </div>
          <div id="vg-director-shots"><!-- Injected by JS --></div>
        </div>
        <div id="vg-director-loading" style="display:none" class="vg-director-loading">
          <span class="vg-spin-lg"></span>
          <span>Director is planning your shots…</span>
        </div>
        <div id="vg-director-error" class="vg-director-error" style="display:none"></div>
      </div>
    </div><!-- /vg-director-panel -->

    <!-- STORYBOARD PANEL -->
    <div id="vg-storyboard">

      <!-- Project header -->
      <div class="vg-board-header" id="vg-board-header" style="display:none">
        <div class="vg-board-header-left">
          <h2 class="vg-project-name" id="vg-current-project-name"></h2>
          <span class="vg-shot-count" id="vg-project-shot-count"></span>
        </div>
        <div class="vg-board-header-right">
          <button class="vg-btn-icon-sm" id="btn-open-timeline" title="Sequence Timeline Editor" style="display:none">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="4" height="10" rx="1"/><rect x="8" y="4" width="4" height="13" rx="1"/><rect x="14" y="9" width="4" height="8" rx="1"/><rect x="20" y="6" width="2" height="11" rx="1"/></svg>
            Timeline
          </button>
          <button class="vg-btn-icon-sm vg-compare-trigger" id="btn-open-compare" title="Compare shots A/B" style="display:none" disabled>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="9" height="18" rx="1.5"/><rect x="13" y="3" width="9" height="18" rx="1.5"/></svg>
            Compare <span class="vg-compare-count" id="compare-badge">0</span>
          </button>
          <button class="vg-btn-icon-sm" id="btn-edit-project" title="Edit style bible">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="vg-btn-icon-sm" id="btn-toggle-view" title="Toggle view">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="view-toggle-icon"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          </button>
        </div>
      </div>

      <!-- Empty state -->
      <div id="vg-empty" class="vg-empty-state">
        <div class="vg-empty-icon">
          <svg viewBox="0 0 80 80" fill="none">
            <rect x="8" y="18" width="50" height="35" rx="3" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
            <path d="M58 18l16-8v43l-16-8V18z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" opacity="0.25"/>
            <circle cx="25" cy="33" r="4" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
            <path d="M8 44l16-13 10 10 10-8 14 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"/>
            <rect x="4" y="60" width="16" height="12" rx="1.5" stroke="currentColor" stroke-width="1.2" opacity="0.15"/>
            <rect x="24" y="60" width="16" height="12" rx="1.5" stroke="currentColor" stroke-width="1.2" opacity="0.15"/>
            <rect x="44" y="60" width="16" height="12" rx="1.5" stroke="currentColor" stroke-width="1.2" opacity="0.15"/>
          </svg>
        </div>
        <h2 class="vg-empty-title">Select or create a project</h2>
        <p class="vg-empty-sub">Projects remember your style bible, characters, and every shot you generate. Your creative memory lives here.</p>
        <button class="vg-btn-primary" id="btn-new-project-empty">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2v12M2 8h12"/></svg>
          Create First Project
        </button>
      </div>

      <!-- Shot grid / storyboard -->
      <div id="vg-shot-grid" class="vg-shot-grid grid-view" style="display:none"></div>

    </div><!-- /vg-storyboard -->

  </section><!-- /vg-stage -->

</main>

<!-- ═══════════════════════════════════════════════════════════════
     COMPARE MODAL  (A/B Shot Viewer)
     ═══════════════════════════════════════════════════════════════ -->
<div class="vg-compare-overlay" id="compare-overlay">
  <div class="vg-compare-modal">

    <!-- Header -->
    <div class="vg-compare-header">
      <div class="vg-compare-header-left">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="9" height="18" rx="1.5"/><rect x="13" y="3" width="9" height="18" rx="1.5"/></svg>
        <span>Shot Comparison</span>
        <span class="vg-compare-mode-badge" id="compare-mode-badge">2-UP</span>
      </div>
      <div class="vg-compare-header-right">
        <button class="vg-compare-sync-btn" id="compare-sync-btn" title="Sync playback">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
          Sync
        </button>
        <button class="vg-compare-play-all-btn" id="compare-play-all">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Play All
        </button>
        <button class="vg-compare-close-btn" id="compare-close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>

    <!-- Video panels grid -->
    <div class="vg-compare-grid" id="compare-grid"></div>

    <!-- Metadata diff table -->
    <div class="vg-compare-meta-section">
      <div class="vg-compare-meta-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Metadata Diff
      </div>
      <div class="vg-compare-meta-table" id="compare-meta-table"></div>
    </div>

    <!-- Winner row -->
    <div class="vg-compare-footer">
      <span class="vg-compare-footer-label">Select Winner</span>
      <div class="vg-compare-winner-row" id="compare-winner-row"></div>
      <button class="vg-compare-export-btn" id="compare-export-json">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export Diff JSON
      </button>
    </div>

  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════
     TIMELINE PANEL  (Sequence / Timeline Editor)
     ═══════════════════════════════════════════════════════════════ -->
<div class="vg-timeline-overlay" id="timeline-overlay">
  <div class="vg-timeline-panel">

    <!-- Header -->
    <div class="vg-timeline-header">
      <div class="vg-timeline-header-left">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="4" height="10" rx="1"/><rect x="8" y="4" width="4" height="13" rx="1"/><rect x="14" y="9" width="4" height="8" rx="1"/><rect x="20" y="6" width="2" height="11" rx="1"/></svg>
        <span>Sequence Timeline</span>
        <span class="vg-timeline-project-name" id="timeline-project-name"></span>
      </div>
      <div class="vg-timeline-header-right">
        <span class="vg-timeline-duration" id="timeline-total-duration">0:00 total</span>
        <button class="vg-timeline-shuffle-btn" id="timeline-shuffle" title="Auto-sort by creation date">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
          Sort
        </button>
        <button class="vg-timeline-export-btn" id="timeline-export">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export Manifest
        </button>
        <button class="vg-timeline-close-btn" id="timeline-close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>

    <!-- Ruler -->
    <div class="vg-timeline-ruler" id="timeline-ruler"></div>

    <!-- Film strip track -->
    <div class="vg-timeline-track-wrap">
      <div class="vg-timeline-track" id="timeline-track">
        <!-- clips injected by JS -->
      </div>
    </div>

    <!-- Playhead controls -->
    <div class="vg-timeline-controls">
      <button class="vg-tl-ctrl-btn" id="tl-play-seq" title="Play sequence in order">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Preview Sequence
      </button>
      <div class="vg-timeline-order-hint">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        Drag clips to reorder · changes sync to storyboard
      </div>
      <div class="vg-timeline-stats" id="timeline-stats">0 shots</div>
    </div>

    <!-- Sequence preview player (hidden until play pressed) -->
    <div class="vg-timeline-preview" id="timeline-preview" style="display:none">
      <video id="tl-preview-video" autoplay muted style="max-height:260px;border-radius:6px;background:#000"></video>
      <div class="vg-timeline-preview-controls">
        <span id="tl-preview-label" style="font-size:0.72rem;color:var(--text-muted)">Shot 1 / 1</span>
        <button class="vg-tl-ctrl-btn" id="tl-stop-seq">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
          Stop
        </button>
      </div>
    </div>

  </div>
</div>

<!-- NEW PROJECT MODAL -->
<div class="vg-modal-overlay" id="project-modal-overlay">
  <div class="vg-modal vg-modal-wide" id="project-modal">
    <div class="vg-modal-header">
      <h3 id="project-modal-title">New Project</h3>
      <button class="vg-drawer-close" id="btn-close-project-modal">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="vg-modal-body">

      <!-- STEP 1: Use-case picker -->
      <div id="project-step-1">
        <p class="vg-modal-desc" style="margin-bottom:14px">What are you creating? We'll set everything up for you.</p>
        <div class="vg-usecase-grid" id="vg-usecase-grid">
          <button class="vg-usecase-card" data-usecase="commercial">
            <span class="vg-usecase-icon">📺</span>
            <span class="vg-usecase-name">Commercial</span>
            <span class="vg-usecase-hint">Product ads, brand spots</span>
          </button>
          <button class="vg-usecase-card" data-usecase="music_video">
            <span class="vg-usecase-icon">🎵</span>
            <span class="vg-usecase-name">Music Video</span>
            <span class="vg-usecase-hint">Visual storytelling for audio</span>
          </button>
          <button class="vg-usecase-card" data-usecase="fashion">
            <span class="vg-usecase-icon">👗</span>
            <span class="vg-usecase-name">Fashion Ad</span>
            <span class="vg-usecase-hint">Editorial, lookbook, runway</span>
          </button>
          <button class="vg-usecase-card" data-usecase="character">
            <span class="vg-usecase-icon">🎭</span>
            <span class="vg-usecase-name">Character Scene</span>
            <span class="vg-usecase-hint">Narrative, performance</span>
          </button>
          <button class="vg-usecase-card" data-usecase="product">
            <span class="vg-usecase-icon">📦</span>
            <span class="vg-usecase-name">Product Showcase</span>
            <span class="vg-usecase-hint">E-commerce, unboxing, demo</span>
          </button>
          <button class="vg-usecase-card" data-usecase="trailer">
            <span class="vg-usecase-icon">🎬</span>
            <span class="vg-usecase-name">Cinematic Trailer</span>
            <span class="vg-usecase-hint">Epic sequences, film-style</span>
          </button>
          <button class="vg-usecase-card" data-usecase="social">
            <span class="vg-usecase-icon">📱</span>
            <span class="vg-usecase-name">Social Content</span>
            <span class="vg-usecase-hint">Short-form, reels, TikTok</span>
          </button>
          <button class="vg-usecase-card" data-usecase="custom">
            <span class="vg-usecase-icon">✏️</span>
            <span class="vg-usecase-name">Custom</span>
            <span class="vg-usecase-hint">Set everything manually</span>
          </button>
        </div>
      </div>

      <!-- STEP 2: Name + confirm (pre-filled from use-case) -->
      <div id="project-step-2" style="display:none">
        <div class="vg-usecase-selected-banner" id="vg-usecase-banner"></div>
        <div class="vg-field" style="margin-top:14px">
          <label class="vg-label">Project Name <span class="vg-required-star">*</span></label>
          <input type="text" id="project-name-input" class="vg-input" placeholder="e.g. Summer Campaign 2025"/>
        </div>
        <div class="vg-usecase-config-summary" id="vg-usecase-summary"></div>
        <details class="vg-usecase-advanced">
          <summary>Advanced settings</summary>
          <div class="vg-field" style="margin-top:10px">
            <label class="vg-label">Visual Style</label>
            <input type="text" id="project-style-input" class="vg-input" placeholder="e.g. Dark cinematic, neon noir"/>
          </div>
          <div class="vg-field">
            <label class="vg-label">Mood &amp; Tone</label>
            <input type="text" id="project-mood-input" class="vg-input" placeholder="e.g. Dramatic, energetic, ethereal"/>
          </div>
          <div class="vg-field">
            <label class="vg-label">Color Palette</label>
            <input type="text" id="project-palette-input" class="vg-input" placeholder="e.g. Deep blues, teal highlights"/>
          </div>
          <div class="vg-field">
            <label class="vg-label">Default Model</label>
            <select id="project-model-select" class="vg-input vg-select">
              <option value="higgsfield-ai/dop/standard">DoP Standard (Recommended)</option>
              <option value="higgsfield-ai/dop/lite">DoP Lite (Fast)</option>
              <option value="higgsfield-ai/dop/turbo">DoP Turbo (Quality)</option>
              <option value="kling-video/v2.1/pro/image-to-video">Kling 2.1 Pro</option>
              <option value="bytedance/seedance/v1/pro/image-to-video">Seedance v1 Pro</option>
            </select>
          </div>
        </details>
        <div id="project-modal-error" class="vg-auth-error" style="display:none"></div>
      </div>

    </div>
    <div class="vg-modal-footer" id="project-modal-footer">
      <button class="vg-btn-ghost" id="btn-cancel-project-modal">Cancel</button>
      <button class="vg-btn-ghost" id="btn-back-project" style="display:none">← Back</button>
      <button class="vg-btn-primary" id="btn-save-project" style="display:none">Create Project</button>
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
      <p class="vg-modal-desc">The style bible is injected into every AI prompt enhancement — keeping all your shots consistent.</p>
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
      <button class="vg-btn-primary" id="btn-save-bible">Save Style Bible</button>
    </div>
  </div>
</div>

<div class="vg-toast" id="vg-toast"></div>

<!-- CHARACTER ADD MODAL (Item 5) -->
<div class="vg-modal-overlay" id="char-modal-overlay">
  <div class="vg-modal" id="char-modal">
    <div class="vg-modal-header">
      <h3 id="char-modal-title">Add Character</h3>
      <button class="vg-drawer-close" id="btn-close-char-modal">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="vg-modal-body">
      <p class="vg-modal-desc">Characters remember a reference image. Train their Soul for consistent appearance across every shot.</p>
      <div class="vg-field">
        <label class="vg-label">Name <span class="vg-required-star">*</span></label>
        <input type="text" id="char-name-input" class="vg-input" placeholder="e.g. Hero, Villain, Narrator"/>
      </div>
      <div class="vg-field">
        <label class="vg-label">Description</label>
        <input type="text" id="char-desc-input" class="vg-input" placeholder="Physical appearance, style notes..."/>
      </div>
      <div class="vg-field">
        <label class="vg-label">Reference Image</label>
        <div class="vg-char-upload-row">
          <div class="vg-char-upload-preview" id="char-upload-preview" style="display:none">
            <img id="char-upload-img" src="" alt="Character ref"/>
          </div>
          <button class="vg-btn-chip" id="btn-char-browse">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            Browse image
          </button>
          <input type="file" id="char-file-input" accept="image/jpeg,image/png,image/webp" style="display:none"/>
          <span class="vg-char-upload-name" id="char-upload-name"></span>
        </div>
      </div>
      <div id="char-modal-error" class="vg-auth-error" style="display:none"></div>
    </div>
    <div class="vg-modal-footer">
      <button class="vg-btn-ghost" id="btn-cancel-char-modal">Cancel</button>
      <button class="vg-btn-primary" id="btn-save-char">Add Character</button>
    </div>
  </div>
</div>

<!-- UPGRADE MODAL (Item 2) -->
<div class="vg-modal-overlay" id="upgrade-modal-overlay">
  <div class="vg-modal vg-upgrade-modal" id="upgrade-modal">
    <div class="vg-modal-header">
      <h3>Upgrade Your Plan</h3>
      <button class="vg-drawer-close" id="btn-close-upgrade-modal">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="vg-modal-body">
      <div class="vg-upgrade-tiers-full">
        <div class="vg-upgrade-tier-card" data-tier="creator">
          <div class="vg-utc-header">
            <span class="vg-utc-name">Creator</span>
            <span class="vg-utc-price">$29<span class="vg-utc-period">/mo</span></span>
          </div>
          <ul class="vg-utc-features">
            <li>100 shots / month</li>
            <li>5 projects</li>
            <li>5 GB storage</li>
            <li>All 9 models</li>
            <li>Style presets + seed control</li>
          </ul>
          <button class="vg-btn-primary full-width" data-upgrade-tier="creator">Select Creator</button>
        </div>
        <div class="vg-upgrade-tier-card featured" data-tier="studio">
          <div class="vg-utc-badge">Most Popular</div>
          <div class="vg-utc-header">
            <span class="vg-utc-name">Studio</span>
            <span class="vg-utc-price">$79<span class="vg-utc-period">/mo</span></span>
          </div>
          <ul class="vg-utc-features">
            <li>500 shots / month</li>
            <li>25 projects</li>
            <li>25 GB storage</li>
            <li>Character Soul training</li>
            <li>Priority generation queue</li>
          </ul>
          <button class="vg-btn-primary full-width" data-upgrade-tier="studio">Select Studio</button>
        </div>
        <div class="vg-upgrade-tier-card" data-tier="pro">
          <div class="vg-utc-header">
            <span class="vg-utc-name">Pro</span>
            <span class="vg-utc-price">$149<span class="vg-utc-period">/mo</span></span>
          </div>
          <ul class="vg-utc-features">
            <li>Unlimited shots</li>
            <li>Unlimited projects</li>
            <li>100 GB storage</li>
            <li>API access</li>
            <li>White-label exports</li>
          </ul>
          <button class="vg-btn-primary full-width" data-upgrade-tier="pro">Select Pro</button>
        </div>
      </div>
      <div id="upgrade-modal-error" class="vg-auth-error" style="display:none"></div>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════
     ANALYTICS PANEL
═══════════════════════════════════════════════════════ -->
<section id="vg-analytics" style="display:none">

  <div class="an-topbar">
    <div class="an-topbar-left">
      <h2 class="an-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Generation Analytics
      </h2>
      <p class="an-subtitle">Per-model performance, speed, and cost intelligence</p>
    </div>
    <div class="an-topbar-right">
      <div class="an-range-tabs" id="an-range-tabs">
        <button class="an-range-btn" data-range="7d">7D</button>
        <button class="an-range-btn active" data-range="30d">30D</button>
        <button class="an-range-btn" data-range="90d">90D</button>
        <button class="an-range-btn" data-range="all">All</button>
      </div>
      <button class="an-refresh-btn" id="btn-an-refresh" title="Refresh">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
      </button>
    </div>
  </div>

  <div class="an-model-tabs" id="an-model-tabs">
    <button class="an-model-tab active" data-model="all">All Models</button>
    <button class="an-model-tab" data-model="dop">DoP</button>
    <button class="an-model-tab" data-model="soul">Soul</button>
    <button class="an-model-tab" data-model="kling">Kling</button>
    <button class="an-model-tab" data-model="seedance">Seedance</button>
    <button class="an-model-tab" data-model="flux">Flux</button>
  </div>

  <div class="an-summary-row" id="an-summary-row">
    <div class="an-card an-card-accent">
      <div class="an-card-label">Total Requests</div>
      <div class="an-card-value" id="an-total-requests">—</div>
      <div class="an-card-sub" id="an-total-sub">across all models</div>
    </div>
    <div class="an-card">
      <div class="an-card-label">Success Rate</div>
      <div class="an-card-value" id="an-success-rate">—</div>
      <div class="an-card-bar-wrap"><div class="an-card-bar" id="an-success-bar"></div></div>
    </div>
    <div class="an-card">
      <div class="an-card-label">Speed P50</div>
      <div class="an-card-value" id="an-speed-p50">—</div>
      <div class="an-card-sub">median gen time</div>
    </div>
    <div class="an-card">
      <div class="an-card-label">Speed P90</div>
      <div class="an-card-value" id="an-speed-p90">—</div>
      <div class="an-card-sub">90th percentile</div>
    </div>
    <div class="an-card">
      <div class="an-card-label">Est. Cost</div>
      <div class="an-card-value" id="an-total-cost">—</div>
      <div class="an-card-sub">credits consumed</div>
    </div>
    <div class="an-card">
      <div class="an-card-label">Video Generated</div>
      <div class="an-card-value" id="an-total-seconds">—</div>
      <div class="an-card-sub">total output seconds</div>
    </div>
  </div>

  <div class="an-grid">
    <div class="an-col-main">
      <div class="an-panel">
        <div class="an-panel-header">
          <span class="an-panel-title">Job Activity</span>
          <span class="an-panel-badge" id="an-activity-period"></span>
        </div>
        <div class="an-chart-wrap" id="an-activity-chart">
          <svg id="an-activity-svg" class="an-activity-svg" viewBox="0 0 700 120" preserveAspectRatio="none"></svg>
          <div class="an-chart-empty" id="an-activity-empty" style="display:none">No generation activity in this period</div>
        </div>
        <div class="an-chart-legend">
          <span class="an-legend-dot completed"></span><span>Completed</span>
          <span class="an-legend-dot failed"></span><span>Failed/NSFW</span>
        </div>
      </div>
      <div class="an-panel">
        <div class="an-panel-header">
          <span class="an-panel-title">Job Duration Distribution</span>
          <span class="an-panel-hint">seconds per output clip</span>
        </div>
        <div class="an-dur-bars" id="an-dur-bars"><div class="an-loading-state">Loading…</div></div>
      </div>
      <div class="an-panel">
        <div class="an-panel-header"><span class="an-panel-title">Aspect Ratio Usage</span></div>
        <div class="an-aspect-wrap" id="an-aspect-wrap"><div class="an-loading-state">Loading…</div></div>
      </div>
    </div>
    <div class="an-col-side">
      <div class="an-panel">
        <div class="an-panel-header">
          <span class="an-panel-title">Model Performance</span>
          <span class="an-panel-hint">sorted by requests</span>
        </div>
        <div class="an-model-table-wrap" id="an-model-table-wrap"><div class="an-loading-state">Loading…</div></div>
      </div>
      <div class="an-panel">
        <div class="an-panel-header">
          <span class="an-panel-title">Model Comparison</span>
          <span class="an-panel-hint">success rate by model</span>
        </div>
        <div class="an-compare-bars" id="an-compare-bars"><div class="an-loading-state">Loading…</div></div>
      </div>
      <div class="an-panel">
        <div class="an-panel-header">
          <span class="an-panel-title">Project Velocity</span>
          <span class="an-panel-hint">shots per project</span>
        </div>
        <div class="an-project-list" id="an-project-list"><div class="an-loading-state">Loading…</div></div>
      </div>
      <div class="an-panel">
        <div class="an-panel-header"><span class="an-panel-title">Job Status Breakdown</span></div>
        <div class="an-status-row" id="an-status-row"><div class="an-loading-state">Loading…</div></div>
      </div>
    </div>
  </div>

  <div class="an-model-deep" id="an-model-deep">
    <div class="an-panel-header">
      <span class="an-panel-title">Per-Model Deep Dive</span>
      <span class="an-panel-hint">click a model in the table above to focus</span>
    </div>
    <div class="an-deep-cards" id="an-deep-cards">
      <div class="an-loading-state">Select a model to drill into its metrics</div>
    </div>
  </div>

</section>

<!-- ══════════════════════════════════════════════════════
     COMPARE VIEW — A/B Shot Comparison
═══════════════════════════════════════════════════════ -->
<section id="vg-compare" style="display:none">

  <div class="vg-cmp-topbar">
    <div class="vg-cmp-topbar-left">
      <h2 class="vg-cmp-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="9" height="18" rx="1"/><rect x="13" y="3" width="9" height="18" rx="1"/></svg>
        Shot Compare
      </h2>
      <p class="vg-cmp-subtitle">Select up to 4 shots from your project to compare side-by-side</p>
    </div>
    <div class="vg-cmp-topbar-right">
      <button class="vg-cmp-btn" id="btn-cmp-sync" title="Sync playback">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        Sync
      </button>
      <button class="vg-cmp-btn active" id="btn-cmp-sync-toggle">Sync ON</button>
      <button class="vg-cmp-btn" id="btn-cmp-clear">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Clear
      </button>
    </div>
  </div>

  <!-- Shot picker strip -->
  <div class="vg-cmp-picker-bar">
    <span class="vg-cmp-picker-label">Pick shots:</span>
    <div class="vg-cmp-picker-scroll" id="vg-cmp-picker-scroll">
      <div class="vg-cmp-picker-empty">Load a project to see shots here</div>
    </div>
    <span class="vg-cmp-picker-hint" id="vg-cmp-picker-hint">0 / 4 selected</span>
  </div>

  <!-- Compare grid: 1-4 cells, auto-layout -->
  <div class="vg-cmp-grid" id="vg-cmp-grid">
    <div class="vg-cmp-empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><rect x="2" y="3" width="9" height="18" rx="1"/><rect x="13" y="3" width="9" height="18" rx="1"/></svg>
      <p>Select 2–4 shots from the picker above to compare them</p>
    </div>
  </div>

  <!-- Winner bar (appears once ≥2 shots loaded) -->
  <div class="vg-cmp-winner-bar" id="vg-cmp-winner-bar" style="display:none">
    <span class="vg-cmp-winner-label">Mark winner:</span>
    <div class="vg-cmp-winner-btns" id="vg-cmp-winner-btns"></div>
    <span class="vg-cmp-winner-note" id="vg-cmp-winner-note"></span>
  </div>

</section>

<!-- ══════════════════════════════════════════════════════
     TIMELINE EDITOR
═══════════════════════════════════════════════════════ -->
<section id="vg-timeline" style="display:none">

  <div class="vg-tl-topbar">
    <div class="vg-tl-topbar-left">
      <h2 class="vg-tl-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="1"/><line x1="6" y1="7" x2="6" y2="17"/><line x1="10" y1="7" x2="10" y2="17"/><line x1="14" y1="7" x2="14" y2="17"/><line x1="18" y1="7" x2="18" y2="17"/></svg>
        Sequence Editor
      </h2>
      <p class="vg-tl-subtitle">Arrange completed shots into a sequence — drag to reorder, export manifest</p>
    </div>
    <div class="vg-tl-topbar-right">
      <span class="vg-tl-duration-badge" id="vg-tl-total-duration">0:00:00</span>
      <button class="vg-tl-btn" id="btn-tl-play-all" title="Preview sequence" disabled>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Preview
      </button>
      <button class="vg-tl-btn primary" id="btn-tl-export" title="Export JSON manifest" disabled>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export Manifest
      </button>
    </div>
  </div>

  <!-- Timecode ruler -->
  <div class="vg-tl-ruler" id="vg-tl-ruler">
    <div class="vg-tl-ruler-inner" id="vg-tl-ruler-inner"></div>
  </div>

  <!-- Timeline strip -->
  <div class="vg-tl-strip-wrap" id="vg-tl-strip-wrap">
    <div class="vg-tl-track-label">VIDEO</div>
    <div class="vg-tl-strip" id="vg-tl-strip">
      <div class="vg-tl-empty" id="vg-tl-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><rect x="2" y="7" width="20" height="10" rx="1"/></svg>
        <p>No completed shots yet — generate some shots first, then come back to arrange them here</p>
      </div>
    </div>
  </div>

  <!-- Shot bank (pool of available clips) -->
  <div class="vg-tl-bank" id="vg-tl-bank">
    <div class="vg-tl-bank-header">
      <span class="vg-tl-bank-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        Shot Bank
      </span>
      <span class="vg-tl-bank-hint" id="vg-tl-bank-hint">drag clips to timeline</span>
    </div>
    <div class="vg-tl-bank-grid" id="vg-tl-bank-grid">
      <div class="vg-tl-bank-empty">Loading shots…</div>
    </div>
  </div>

  <!-- Sequence details panel -->
  <div class="vg-tl-details" id="vg-tl-details" style="display:none">
    <div class="vg-tl-details-header">
      <span class="vg-tl-details-title">Selected Clip</span>
      <button class="vg-tl-details-close" id="btn-tl-details-close">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="vg-tl-details-body" id="vg-tl-details-body"></div>
  </div>

  <!-- Preview player (hidden until Preview clicked) -->
  <div class="vg-tl-preview" id="vg-tl-preview" style="display:none">
    <div class="vg-tl-preview-header">
      <span class="vg-tl-preview-title">Sequence Preview</span>
      <div class="vg-tl-preview-controls">
        <span class="vg-tl-preview-counter" id="vg-tl-preview-counter">Shot 1 / 1</span>
        <button class="vg-tl-preview-close" id="btn-tl-preview-close">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <video class="vg-tl-preview-video" id="vg-tl-preview-video" controls autoplay></video>
  </div>

</section>

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

<!-- ── AUTH GATE ──────────────────────────────────────────────────── -->
<div id="ae-auth-gate">
  <div class="ae-auth-card">
    <div class="ae-auth-logo">
      <span class="ae-auth-logo-mark">S</span>
    </div>
    <h2>Attention Engine</h2>
    <p>Sign in to analyze your content performance and connect your platforms.</p>
    <div class="ae-auth-tabs">
      <button class="ae-auth-tab active" data-ae-auth-tab="login">Sign In</button>
      <button class="ae-auth-tab" data-ae-auth-tab="register">Create Account</button>
    </div>
    <form class="ae-auth-form" id="ae-auth-form">
      <div class="ae-auth-field">
        <input type="email" id="ae-auth-email" class="ae-auth-input" placeholder="Email address" autocomplete="email" required/>
      </div>
      <div class="ae-auth-field">
        <input type="password" id="ae-auth-password" class="ae-auth-input" placeholder="Password (min 8 chars)" autocomplete="current-password" required/>
      </div>
      <div id="ae-auth-error" class="ae-auth-error"></div>
      <button type="submit" class="ae-auth-submit" id="btn-ae-auth-submit">Sign In</button>
    </form>
  </div>
</div>

<!-- ── MAIN APP (hidden until auth) ─────────────────────────────── -->
<div id="ae-app" style="display:none">
<nav id="ae-nav">
  <a href="/" class="ae-nav-logo"><span class="ae-logo-mark">S</span><span class="ae-logo-text">SPECTRA</span></a>
  <div class="ae-nav-center"><span class="ae-tool-badge"><span class="ae-tool-pip"></span>Attention Engine</span></div>
  <div class="ae-nav-right">
    <button class="ae-keys-btn" id="btn-open-keys" title="Connect Platforms">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
      Connections
      <span class="ae-keys-status-dot" id="keys-status-dot"></span>
    </button>
    <a href="/" class="ae-nav-back"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Suite</a>
  </div>
</nav>
<div class="ae-drawer-overlay" id="keys-overlay"></div>
<aside class="ae-keys-drawer" id="keys-drawer">
  <div class="ae-drawer-header">
    <div class="ae-drawer-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>Connect Platforms</div>
    <div class="ae-drawer-subtitle">Link your accounts to auto-populate real metrics</div>
    <button class="ae-drawer-close" id="btn-close-keys"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
  </div>
  <div class="ae-drawer-body">

    <!-- ── YouTube OAuth ─────────────────────────────────────────── -->
    <div class="ae-key-block" id="yt-block" data-platform="youtube">
      <div class="ae-key-block-header">
        <div class="ae-key-block-icon" style="--kc:#F87171">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg>
        </div>
        <div class="ae-key-block-info">
          <div class="ae-key-block-name">YouTube</div>
          <div class="ae-key-block-desc" id="yt-block-desc">Auto-fills views, likes, comments, duration from any YouTube URL</div>
        </div>
        <div class="ae-key-block-status" id="yt-status"><span class="ae-key-dot inactive"></span><span class="ae-key-status-text">Not connected</span></div>
      </div>
      <!-- Not connected state -->
      <div id="yt-connect-area">
        <button class="ae-oauth-btn" id="btn-connect-youtube">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
          Connect YouTube Account
        </button>
        <div class="ae-oauth-note">Opens a Google sign-in popup. No API key needed.</div>
      </div>
      <!-- Connected state (hidden until auth) -->
      <div id="yt-connected-area" style="display:none">
        <div class="ae-connected-info">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          <span id="yt-channel-name">Connected</span>
        </div>
        <button class="ae-disconnect-btn" id="btn-disconnect-youtube">Disconnect</button>
      </div>
    </div>

    <!-- ── Bluesky ────────────────────────────────────────────────── -->
    <div class="ae-key-block" id="bsky-block" data-platform="bluesky">
      <div class="ae-key-block-header">
        <div class="ae-key-block-icon" style="--kc:#0085ff">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-4.5H8l4-5 4 5h-3v4.5h-2z"/></svg>
        </div>
        <div class="ae-key-block-info">
          <div class="ae-key-block-name">Bluesky</div>
          <div class="ae-key-block-desc">Auto-fills likes, reposts, replies, quotes from any Bluesky post URL</div>
        </div>
        <div class="ae-key-block-status" id="bsky-status"><span class="ae-key-dot inactive"></span><span class="ae-key-status-text">Not connected</span></div>
      </div>
      <!-- Not connected state -->
      <div id="bsky-connect-area">
        <div class="ae-key-input-row" style="margin-bottom:0.5rem">
          <div class="ae-key-field">
            <input type="text" class="ae-key-input" id="bsky-handle" placeholder="yourhandle.bsky.social" autocomplete="off" spellcheck="false"/>
          </div>
        </div>
        <div class="ae-key-input-row">
          <div class="ae-key-field">
            <input type="password" class="ae-key-input" id="bsky-password" placeholder="App password (not your main password)" autocomplete="off" spellcheck="false"/>
            <button class="ae-key-toggle" data-target="bsky-password" title="Show/hide">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <button class="ae-key-save" id="btn-connect-bluesky">Connect</button>
        </div>
        <div class="ae-key-steps" style="margin-top:0.65rem">
          <div class="ae-key-step"><span class="ae-step-num">1</span>Go to <strong>bsky.app → Settings → App Passwords</strong></div>
          <div class="ae-key-step"><span class="ae-step-num">2</span>Click <strong>Add App Password</strong> → name it "Spectra"</div>
          <div class="ae-key-step"><span class="ae-step-num">3</span>Copy the generated password and paste above</div>
        </div>
      </div>
      <!-- Connected state -->
      <div id="bsky-connected-area" style="display:none">
        <div class="ae-connected-info">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          <span id="bsky-handle-display">Connected</span>
        </div>
        <button class="ae-disconnect-btn" id="btn-disconnect-bluesky">Disconnect</button>
      </div>
    </div>

    <!-- ── Instagram (Coming Soon) ───────────────────────────────── -->
    <div class="ae-key-block ae-key-block-coming-soon" data-platform="instagram">
      <div class="ae-key-block-header">
        <div class="ae-key-block-icon" style="--kc:#E1306C">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>
        </div>
        <div class="ae-key-block-info">
          <div class="ae-key-block-name">Instagram <span class="ae-coming-soon-badge">Coming Soon</span></div>
          <div class="ae-key-block-desc">Requires Meta app review approval. We're working on it.</div>
        </div>
        <div class="ae-key-block-status"><span class="ae-key-dot inactive"></span><span class="ae-key-status-text" style="color:var(--ice-dim);opacity:0.5">Pending</span></div>
      </div>
    </div>

    <!-- ── Connection Status Summary ────────────────────────────── -->
    <div class="ae-keys-summary" id="keys-summary">
      <div class="ae-summary-title">Connection Status</div>
      <div class="ae-summary-row"><span class="ae-sum-label">YouTube</span><span class="ae-sum-val" id="sum-youtube">— Not connected</span></div>
      <div class="ae-summary-row"><span class="ae-sum-label">Bluesky</span><span class="ae-sum-val" id="sum-bluesky">— Not connected</span></div>
      <div class="ae-summary-row"><span class="ae-sum-label">Instagram</span><span class="ae-sum-val" style="color:rgba(232,244,253,0.2)">Coming soon</span></div>
    </div>
  </div>
</aside>
<main id="ae-main">
  <aside id="ae-input-panel">
    <div class="ae-section"><div class="ae-section-label">Platform</div><div class="ae-platform-grid" id="platform-grid"><button class="ae-platform-btn active" data-platform="tiktok"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.75a4.85 4.85 0 01-1.01-.06z"/></svg>TikTok</button><button class="ae-platform-btn" data-platform="instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>Instagram</button><button class="ae-platform-btn" data-platform="youtube" id="plat-btn-youtube"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg>YouTube<span class="ae-conn-badge"></span></button><button class="ae-platform-btn" data-platform="twitter"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>Twitter/X</button><button class="ae-platform-btn" data-platform="facebook"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.024 4.388 11.02 10.125 11.927v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.254h3.328l-.532 3.49h-2.796v8.437C19.612 23.093 24 18.097 24 12.073z"/></svg>Facebook</button><button class="ae-platform-btn" data-platform="ads"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 15l3-4 3 4 3-5"/></svg>Paid Ads</button><button class="ae-platform-btn" data-platform="bluesky" id="plat-btn-bluesky"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-4.5H8l4-5 4 5h-3v4.5h-2z"/></svg>Bluesky<span class="ae-conn-badge"></span></button></div></div>
    <div class="ae-section"><div class="ae-section-label">Content Type</div><div class="ae-ct-grid" id="content-type-grid"><button class="ae-ct-btn active" data-ct="organic_video">🎬 Organic Video</button><button class="ae-ct-btn" data-ct="music_video">🎵 Music Video</button><button class="ae-ct-btn" data-ct="commercial">📢 Commercial</button><button class="ae-ct-btn" data-ct="short_form_ad">⚡ Short Ad</button><button class="ae-ct-btn" data-ct="tutorial">📚 Tutorial</button><button class="ae-ct-btn" data-ct="vlog">🎙 Vlog</button><button class="ae-ct-btn" data-ct="documentary">🎞 Documentary</button><button class="ae-ct-btn" data-ct="product_demo">📦 Product Demo</button></div></div>
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
      <div class="ae-results-header"><div class="ae-results-title"><span class="ae-results-platform-badge" id="results-platform-badge"></span><span class="ae-results-ct-badge" id="results-ct-badge"></span><h2>Analysis Complete</h2></div><div class="ae-results-actions"><button class="ae-btn-icon" id="btn-export" title="Export Report"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button><button class="ae-btn-icon" id="btn-copy" title="Copy Results"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button><button class="ae-btn-icon" id="btn-rerun" title="Re-run Analysis"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg></button></div></div>
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
</div><!-- /ae-app -->
</body>
</html>`
}

/* ══════════════════════════════════════════════════════════════════
   DISTRIBUTION ENGINE PAGE
══════════════════════════════════════════════════════════════════ */
function distributionPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Distribution Engine — Spectra</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/distribution.css"/>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
</head>
<body>

<!-- NAV -->
<nav class="dn-nav">
  <a href="/" class="dn-nav-logo">
    <span class="dn-nav-mark">S</span>
    <span class="dn-nav-wordmark">SPECTRA</span>
  </a>
  <div class="dn-nav-center">
    <span class="dn-nav-tool-badge">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
      Distribution Engine
    </span>
  </div>
  <div class="dn-nav-right">
    <a href="/video-generator/" class="dn-nav-back">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      Back to Generator
    </a>
  </div>
</nav>

<!-- AUTH GATE -->
<div id="dn-auth-gate" class="dn-auth-gate" style="display:none">
  <div class="dn-auth-card">
    <div class="dn-auth-logo">
      <span class="dn-nav-mark" style="width:40px;height:40px;font-size:1rem">S</span>
    </div>
    <h2 class="dn-auth-title">Sign in to Spectra</h2>
    <p class="dn-auth-sub">Access your Distribution Engine</p>
    <form id="dn-auth-form" class="dn-auth-form" autocomplete="off">
      <input type="email"    id="dn-auth-email" class="dn-input" placeholder="Email" required autocomplete="email"/>
      <input type="password" id="dn-auth-pass"  class="dn-input" placeholder="Password" required/>
      <button type="submit"  class="dn-btn-primary" id="dn-auth-submit">Sign In</button>
    </form>
    <p class="dn-auth-err" id="dn-auth-err"></p>
  </div>
</div>

<!-- MAIN APP -->
<div id="dn-app" style="display:none">

  <!-- TOP BAR -->
  <div class="dn-topbar">
    <div class="dn-topbar-tabs">
      <button class="dn-tab active" data-tab="queue">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        Queue
        <span class="dn-tab-badge" id="dn-queue-count">0</span>
      </button>
      <button class="dn-tab" data-tab="accounts">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Accounts
        <span class="dn-tab-badge" id="dn-accounts-count">0</span>
      </button>
      <button class="dn-tab" data-tab="new">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        New Post
      </button>
      <button class="dn-tab" data-tab="batch">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Batch
      </button>
      <button class="dn-tab" data-tab="metrics">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Metrics
      </button>
    </div>
    <div class="dn-topbar-right">
      <div class="dn-user-chip" id="dn-user-chip">
        <span class="dn-user-dot"></span>
        <span id="dn-user-email">—</span>
      </div>
    </div>
  </div>

  <!-- ── QUEUE TAB ── -->
  <div class="dn-panel active" id="dn-panel-queue">
    <div class="dn-panel-header">
      <div class="dn-panel-title">
        Distribution Queue
        <span class="dn-poll-indicator" id="dn-poll-indicator" title="Auto-refreshing every 30s">
          <span class="dn-poll-dot"></span>LIVE
        </span>
      </div>
      <div class="dn-panel-actions">
        <button class="dn-btn-secondary" id="btn-open-batch" style="margin-right:0.5rem">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          Batch Mode
        </button>
        <div class="dn-filter-row">
          <button class="dn-filter-btn active" data-filter="all">All</button>
          <button class="dn-filter-btn" data-filter="scheduled">Scheduled</button>
          <button class="dn-filter-btn" data-filter="posted">Posted</button>
          <button class="dn-filter-btn" data-filter="failed">Failed</button>
        </div>
        <button class="dn-btn-icon" id="btn-refresh-queue" title="Refresh queue">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
      </div>
    </div>

    <!-- Platform Health Bar -->
    <div class="dn-health-bar" id="dn-health-bar"></div>

    <div class="dn-queue-empty" id="dn-queue-empty" style="display:none">
      <div class="dn-empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
      </div>
      <div class="dn-empty-title">Queue is empty</div>
      <div class="dn-empty-sub">Schedule your first post to get started</div>
      <button class="dn-btn-primary" onclick="switchTab('new')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Post
      </button>
    </div>

    <div class="dn-queue-list" id="dn-queue-list"></div>
  </div>

  <!-- ── EDIT DRAWER ── -->
  <div class="dn-edit-drawer" id="dn-edit-drawer" aria-hidden="true">
    <div class="dn-edit-drawer-backdrop" id="dn-edit-drawer-backdrop"></div>
    <div class="dn-edit-drawer-panel">
      <div class="dn-edit-drawer-header">
        <div class="dn-edit-drawer-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Edit Scheduled Post
        </div>
        <button class="dn-edit-drawer-close" id="btn-close-edit-drawer" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="dn-edit-drawer-body">
        <input type="hidden" id="edit-post-id"/>
        <input type="hidden" id="edit-post-platform"/>

        <div class="dn-edit-field">
          <label class="dn-edit-label">Caption / Description</label>
          <textarea class="dn-caption-textarea" id="edit-caption" rows="4" placeholder="Caption or description…" spellcheck="true"></textarea>
        </div>

        <div class="dn-edit-field" id="edit-title-field">
          <label class="dn-edit-label">YouTube Title</label>
          <input type="text" class="dn-input" id="edit-title" placeholder="YouTube title (max 100 chars)…" maxlength="100"/>
          <div class="dn-edit-char-hint" id="edit-title-count">0/100</div>
        </div>

        <div class="dn-edit-field">
          <label class="dn-edit-label">Scheduled Time</label>
          <input type="datetime-local" class="dn-input" id="edit-scheduled-at"/>
        </div>

        <div class="dn-edit-field">
          <label class="dn-edit-label">Video URL <span class="dn-edit-label-hint">(swap video)</span></label>
          <input type="url" class="dn-input" id="edit-video-url" placeholder="https://…"/>
        </div>

        <div class="dn-edit-actions">
          <button class="dn-btn-secondary" id="btn-cancel-edit">Cancel</button>
          <button class="dn-btn-primary" id="btn-save-edit">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            Save Changes
          </button>
        </div>
        <p class="dn-edit-note" id="dn-edit-note"></p>
      </div>
    </div>
  </div>

  <!-- ── ACCOUNTS TAB ── -->
  <div class="dn-panel" id="dn-panel-accounts">
    <div class="dn-panel-header">
      <div class="dn-panel-title">Connected Accounts</div>
      <div class="dn-panel-sub">OAuth tokens encrypted at rest · Disconnect any time</div>
    </div>

    <div class="dn-accounts-grid">

      <!-- Instagram -->
      <div class="dn-account-card" id="card-instagram">
        <div class="dn-account-header">
          <div class="dn-account-platform-icon instagram">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>
          </div>
          <div class="dn-account-info">
            <div class="dn-account-name">Instagram</div>
            <div class="dn-account-desc">Reels · Direct publish via Instagram Graph API</div>
          </div>
          <div class="dn-account-status" id="status-instagram">
            <span class="dn-status-dot disconnected"></span>
            <span class="dn-status-text">Not connected</span>
          </div>
        </div>
        <div class="dn-account-connected-row" id="connected-instagram" style="display:none">
          <img class="dn-account-avatar" id="avatar-instagram" src="" alt=""/>
          <div class="dn-account-handle" id="handle-instagram">@—</div>
          <button class="dn-btn-disconnect" data-platform="instagram">Disconnect</button>
        </div>
        <div class="dn-oauth-form" id="oauth-form-instagram">
          <div class="dn-oauth-fields">
            <input type="text"     class="dn-input dn-input-sm" id="ig-client-id"     placeholder="App ID (from Meta Developer Console)"/>
            <input type="password" class="dn-input dn-input-sm" id="ig-client-secret" placeholder="App Secret"/>
            <input type="text"     class="dn-input dn-input-sm" id="ig-redirect-uri"  placeholder="Redirect URI (must match Meta app settings)"/>
          </div>
          <div class="dn-oauth-note">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Requires a Meta Developer app with <code>instagram_basic</code> + <code>instagram_content_publish</code> permissions.
            <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener">Open Meta Console ↗</a>
          </div>
          <button class="dn-btn-connect instagram" data-platform="instagram">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            Connect Instagram
          </button>
        </div>
      </div>

      <!-- YouTube -->
      <div class="dn-account-card" id="card-youtube">
        <div class="dn-account-header">
          <div class="dn-account-platform-icon youtube">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg>
          </div>
          <div class="dn-account-info">
            <div class="dn-account-name">YouTube</div>
            <div class="dn-account-desc">Shorts · Direct upload via YouTube Data API v3</div>
          </div>
          <div class="dn-account-status" id="status-youtube">
            <span class="dn-status-dot disconnected"></span>
            <span class="dn-status-text">Not connected</span>
          </div>
        </div>
        <div class="dn-account-connected-row" id="connected-youtube" style="display:none">
          <img class="dn-account-avatar" id="avatar-youtube" src="" alt=""/>
          <div class="dn-account-handle" id="handle-youtube">—</div>
          <button class="dn-btn-disconnect" data-platform="youtube">Disconnect</button>
        </div>
        <div class="dn-oauth-form" id="oauth-form-youtube">
          <div class="dn-oauth-fields">
            <input type="text"     class="dn-input dn-input-sm" id="yt-client-id"     placeholder="Client ID (from Google Cloud Console)"/>
            <input type="password" class="dn-input dn-input-sm" id="yt-client-secret" placeholder="Client Secret"/>
            <input type="text"     class="dn-input dn-input-sm" id="yt-redirect-uri"  placeholder="Redirect URI (must match GCP OAuth settings)"/>
          </div>
          <div class="dn-oauth-note">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Requires a Google Cloud project with YouTube Data API v3 enabled and OAuth 2.0 credentials.
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Open GCP Console ↗</a>
          </div>
          <button class="dn-btn-connect youtube" data-platform="youtube">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            Connect YouTube
          </button>
        </div>
      </div>

    </div>
  </div>

  <!-- ── NEW POST TAB ── -->
  <div class="dn-panel" id="dn-panel-new">
    <div class="dn-panel-header">
      <div class="dn-panel-title">Schedule a Post</div>
      <div class="dn-panel-sub">Generate captions, choose platforms, set timing — then fire.</div>
    </div>

    <div class="dn-compose">

      <!-- Step 1: Video -->
      <div class="dn-compose-step">
        <div class="dn-step-label">
          <span class="dn-step-num">1</span>
          Video
        </div>
        <div class="dn-compose-body">

          <!-- Input mode tabs -->
          <div class="dn-video-input-tabs">
            <button class="dn-video-input-tab active" id="btn-upload-tab-url">URL</button>
            <button class="dn-video-input-tab" id="btn-upload-tab-file">Upload File</button>
          </div>

          <!-- URL panel -->
          <div id="video-input-url-panel" style="display:flex;gap:0.5rem;align-items:center">
            <input type="url" class="dn-input" id="dn-video-url" placeholder="Paste R2 / CDN video URL…" autocomplete="off" style="flex:1"/>
            <button class="dn-btn-secondary" id="btn-load-from-project">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>
              From Project
            </button>
          </div>

          <!-- File upload panel -->
          <div id="video-input-file-panel" style="display:none">
            <div class="dn-drop-zone" id="dn-drop-zone">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".45"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <p class="dn-drop-zone-label">Drop video here or click to browse</p>
              <p class="dn-drop-zone-sub">MP4, MOV, WEBM — max 500 MB</p>
            </div>
            <input type="file" id="dn-file-input" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v" style="display:none"/>
            <div class="dn-upload-progress" id="dn-upload-progress" style="display:none"></div>
            <div class="dn-video-filename" id="dn-video-filename"></div>
          </div>

          <div class="dn-video-preview" id="dn-video-preview" style="display:none">
            <video id="dn-video-player" controls muted playsinline></video>
            <button class="dn-video-clear" id="btn-clear-video">✕</button>
          </div>

          <!-- Project picker modal -->
          <div class="dn-project-picker" id="dn-project-picker" style="display:none">
            <div class="dn-project-picker-inner">
              <div class="dn-picker-header">
                <div class="dn-picker-title">Select a completed shot</div>
                <button class="dn-picker-close" id="btn-close-picker">✕</button>
              </div>
              <div class="dn-picker-list" id="dn-picker-list">
                <div class="dn-picker-loading">Loading projects…</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 2: Platforms -->
      <div class="dn-compose-step">
        <div class="dn-step-label">
          <span class="dn-step-num">2</span>
          Platforms
        </div>
        <div class="dn-compose-body">
          <div class="dn-platform-row" id="dn-platform-row">
            <button class="dn-platform-toggle" data-platform="instagram" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>
              Instagram
              <span class="dn-platform-toggle-sub">Not connected</span>
            </button>
            <button class="dn-platform-toggle" data-platform="youtube" disabled>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg>
              YouTube
              <span class="dn-platform-toggle-sub">Not connected</span>
            </button>
          </div>
          <a href="#" class="dn-connect-prompt" id="dn-connect-prompt" onclick="switchTab('accounts');return false">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            Connect accounts first →
          </a>
        </div>
      </div>

      <!-- Step 3: Caption -->
      <div class="dn-compose-step">
        <div class="dn-step-label">
          <span class="dn-step-num">3</span>
          Caption
        </div>
        <div class="dn-compose-body">
          <div class="dn-caption-gen-row">
            <input type="text" class="dn-input" id="dn-concept-input" placeholder="Describe the video concept for caption generation…"/>
            <button class="dn-btn-generate" id="btn-gen-caption" title="Generate platform-native captions with AI">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              Generate
            </button>
          </div>

          <!-- Instagram caption block with A/B -->
          <div class="dn-caption-block" id="caption-block-instagram" style="display:none">
            <div class="dn-caption-block-header">
              <div class="dn-caption-platform-label instagram">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="11" height="11"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>
                Instagram
              </div>
            </div>

            <!-- A/B tab switcher -->
            <div class="dn-ab-tabs" id="dn-ab-tabs" style="display:none">
              <button class="dn-ab-tab active" id="btn-ab-a">
                <span class="dn-ab-tag">A</span> Variant A
              </button>
              <button class="dn-ab-tab" id="btn-ab-b">
                <span class="dn-ab-tag">B</span> Variant B
              </button>
            </div>

            <!-- Variant A -->
            <div id="panel-ab-a">
              <div class="dn-caption-block-header" style="margin-top:0.5rem">
                <span style="font-size:0.7rem;opacity:.5">Variant A</span>
                <span class="dn-caption-char-count" id="ig-char-count-a">0/2200</span>
              </div>
              <textarea class="dn-caption-textarea" id="dn-ig-caption-a" rows="5" placeholder="Instagram caption variant A will appear here…" spellcheck="true"></textarea>
            </div>

            <!-- Variant B -->
            <div id="panel-ab-b" style="display:none">
              <div class="dn-caption-block-header" style="margin-top:0.5rem">
                <span style="font-size:0.7rem;opacity:.5">Variant B</span>
                <span class="dn-caption-char-count" id="ig-char-count-b">0/2200</span>
              </div>
              <textarea class="dn-caption-textarea" id="dn-ig-caption-b" rows="5" placeholder="Instagram caption variant B will appear here…" spellcheck="true"></textarea>
            </div>

            <div class="dn-hashtag-row" id="ig-hashtag-row"></div>
          </div>

          <!-- YouTube caption block -->
          <div class="dn-caption-block" id="caption-block-youtube" style="display:none">
            <div class="dn-caption-block-header">
              <div class="dn-caption-platform-label youtube">
                <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.6 2.8 12 2.8 12 2.8s-4.6 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 21.7 12 21.7 12 21.7s4.6 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg>
                YouTube
              </div>
            </div>
            <input type="text" class="dn-input" id="dn-yt-title" placeholder="YouTube title (max 100 chars)…"/>
            <textarea class="dn-caption-textarea" id="dn-yt-description" rows="4" placeholder="YouTube description…" spellcheck="true" style="margin-top:0.5rem"></textarea>
            <div class="dn-hashtag-row" id="yt-tag-row"></div>
          </div>
        </div>
      </div>

      <!-- Step 4: Schedule -->
      <div class="dn-compose-step">
        <div class="dn-step-label">
          <span class="dn-step-num">4</span>
          Timing
        </div>
        <div class="dn-compose-body">
          <div class="dn-timing-row">
            <button class="dn-timing-btn active" data-timing="now">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Post Now
            </button>
            <button class="dn-timing-btn" data-timing="schedule">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Schedule
            </button>
          </div>
          <div class="dn-schedule-picker" id="dn-schedule-picker" style="display:none">
            <input type="datetime-local" class="dn-input" id="dn-scheduled-at"/>
          </div>
          <div class="dn-smart-times" id="dn-smart-times">
            <div class="dn-smart-label">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              Optimal times (based on platform best practices)
            </div>
            <div class="dn-smart-chips" id="dn-smart-chips"></div>
          </div>
        </div>
      </div>

      <!-- Step 5: Review & Fire -->
      <div class="dn-compose-step">
        <div class="dn-step-label">
          <span class="dn-step-num">5</span>
          Review
        </div>
        <div class="dn-compose-body">
          <div class="dn-review-card" id="dn-review-card">
            <div class="dn-review-row">
              <span class="dn-review-label">Video</span>
              <span class="dn-review-val" id="rv-video">—</span>
            </div>
            <div class="dn-review-row">
              <span class="dn-review-label">Platforms</span>
              <span class="dn-review-val" id="rv-platforms">—</span>
            </div>
            <div class="dn-review-row">
              <span class="dn-review-label">Timing</span>
              <span class="dn-review-val" id="rv-timing">Post Now</span>
            </div>
          </div>
          <button class="dn-btn-fire" id="btn-fire-post">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
            <span id="btn-fire-label">Schedule Post</span>
          </button>
          <p class="dn-fire-note" id="dn-fire-note"></p>
        </div>
      </div>

    </div>
  </div>

  <!-- ── BATCH TAB ── -->
  <div class="dn-panel" id="dn-panel-batch">
    <div class="dn-panel-header">
      <div class="dn-panel-title">Batch Mode</div>
      <div class="dn-panel-sub">Schedule multiple videos with a drip cadence</div>
    </div>

    <div class="dn-batch-panel-grid">

      <!-- Left: video list -->
      <div class="dn-batch-left">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
          <span style="font-size:0.75rem;opacity:.55;letter-spacing:.06em">VIDEOS</span>
          <button class="dn-btn-secondary" id="btn-batch-add-file">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Videos
          </button>
        </div>
        <div class="dn-batch-list" id="dn-batch-list"></div>
      </div>

      <!-- Right: drip schedule -->
      <div class="dn-batch-right">
        <div style="font-size:0.75rem;opacity:.55;letter-spacing:.06em;margin-bottom:0.75rem">DRIP SCHEDULE</div>

        <!-- Template buttons -->
        <div class="dn-drip-templates">
          <button class="dn-drip-template-btn active" data-template="daily">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            3-Day Daily
          </button>
          <button class="dn-drip-template-btn" data-template="weekly">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Weekly
          </button>
          <button class="dn-drip-template-btn" data-template="launch">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
            Launch Week
          </button>
          <button class="dn-drip-template-btn" data-template="blitz">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            6h Blitz
          </button>
          <button class="dn-drip-template-btn" data-template="custom">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14"/><path d="M4.93 4.93a10 10 0 000 14.14"/></svg>
            Custom
          </button>
        </div>

        <p class="dn-drip-desc" id="dn-drip-desc">Posts every 24h — consistent daily cadence</p>

        <!-- Custom interval input -->
        <div class="dn-batch-custom-row" id="dn-batch-custom-row" style="display:none">
          <label style="font-size:0.75rem;opacity:.6">Hours between posts</label>
          <input type="number" class="dn-input dn-input-sm" id="dn-batch-drip-custom" value="24" min="1" max="720" style="width:80px"/>
        </div>

        <!-- Schedule preview -->
        <div style="font-size:0.75rem;opacity:.55;letter-spacing:.06em;margin:1rem 0 0.5rem">SCHEDULE PREVIEW</div>
        <div class="dn-batch-preview" id="dn-batch-preview"></div>

        <!-- Fire button -->
        <button class="dn-btn-batch-fire" id="btn-batch-fire">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
          Schedule Batch
        </button>
      </div>

    </div>
  </div>

  <!-- ── METRICS TAB ── -->
  <div class="dn-panel" id="dn-panel-metrics">
    <div class="dn-panel-header">
      <div class="dn-panel-title">
        Analytics &amp; Metrics
        <span class="dn-live-pulse"><span class="dn-live-dot"></span>LIVE</span>
      </div>
      <div class="dn-panel-sub">Select a post to drill into per-platform performance · Best posting times from your data</div>
    </div>

    <!-- Stat summary row -->
    <div class="dn-metrics-stats-row" id="dn-metrics-stats-row">
      <div class="dn-metrics-stat-card">
        <div class="dn-metrics-stat-val" id="metric-total-posts">—</div>
        <div class="dn-metrics-stat-label">Total Posts</div>
      </div>
      <div class="dn-metrics-stat-card">
        <div class="dn-metrics-stat-val" id="metric-total-views">—</div>
        <div class="dn-metrics-stat-label">Total Views (24h)</div>
      </div>
      <div class="dn-metrics-stat-card">
        <div class="dn-metrics-stat-val" id="metric-top-platform">—</div>
        <div class="dn-metrics-stat-label">Top Platform</div>
      </div>
      <div class="dn-metrics-stat-card">
        <div class="dn-metrics-stat-val" id="metric-avg-views">—</div>
        <div class="dn-metrics-stat-label">Avg Views/Post</div>
      </div>
    </div>

    <!-- Post picker -->
    <div class="dn-metrics-section">
      <div class="dn-metrics-section-title">Post Performance</div>
      <div class="dn-metrics-picker" id="dn-metrics-picker">
        <div class="dn-metrics-picker-empty" id="dn-metrics-picker-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <p>No posted content yet. Schedule and publish something to see metrics here.</p>
        </div>
        <div class="dn-metrics-picker-list" id="dn-metrics-picker-list"></div>
      </div>
    </div>

    <!-- Multi-metric chart + metric toggle -->
    <div class="dn-metrics-section" id="dn-metrics-chart-section" style="display:none">
      <div class="dn-metrics-section-header">
        <div class="dn-metrics-section-title" id="dn-metrics-chart-title">Post Metrics</div>
        <div class="dn-metrics-metric-toggles">
          <button class="dn-metric-toggle active" data-metric="views">Views</button>
          <button class="dn-metric-toggle" data-metric="likes">Likes</button>
          <button class="dn-metric-toggle" data-metric="comments">Comments</button>
          <button class="dn-metric-toggle" data-metric="shares">Shares</button>
          <button class="dn-metric-toggle" data-metric="saves">Saves</button>
        </div>
      </div>
      <div class="dn-live-chart-wrap">
        <canvas id="dn-live-chart"></canvas>
        <div class="dn-live-chart-empty" id="dn-live-chart-empty" style="display:none">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity=".3"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <p>Pull metrics for this post first</p>
        </div>
      </div>
    </div>

    <!-- Per-platform breakdown table -->
    <div class="dn-metrics-section" id="dn-metrics-breakdown-section" style="display:none">
      <div class="dn-metrics-section-title">Platform Breakdown</div>
      <div class="dn-metrics-breakdown-table" id="dn-metrics-breakdown-table"></div>
    </div>

    <!-- Best posting times -->
    <div class="dn-metrics-section" id="dn-best-times-section">
      <div class="dn-metrics-section-title">
        Best Posting Times
        <span class="dn-best-times-hint">Based on your actual post performance data</span>
      </div>
      <div class="dn-best-times-grid" id="dn-best-times-grid">
        <div class="dn-best-times-empty" id="dn-best-times-empty">
          <p>Post more content and pull metrics to unlock best-time recommendations.</p>
        </div>
      </div>
    </div>

  </div>

</div><!-- /dn-app -->

<!-- TOAST -->
<div class="dn-toast" id="dn-toast"></div>

<script src="/static/distribution.js"></script>
</body>
</html>`
}

/* ══════════════════════════════════════════════════════════════════
   ADMIN PAGE
══════════════════════════════════════════════════════════════════ */
function adminPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Admin — Spectra</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#060810;--surface:#0D1117;--surface2:#111827;
      --border:rgba(168,216,240,0.10);--border2:rgba(168,216,240,0.06);
      --ice:#E8F4FD;--muted:rgba(232,244,253,0.45);--muted2:rgba(232,244,253,0.25);
      --accent:#7BB8D4;--glow:#A8D8F0;
      --green:#34D399;--red:#F87171;--yellow:#FBBF24;--purple:#A78BFA;--orange:#FB923C;
    }
    body{background:var(--bg);color:var(--ice);font-family:'Space Grotesk',sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}
    /* NAV */
    nav{display:flex;align-items:center;justify-content:space-between;padding:1rem 2rem;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(6,8,16,0.95);backdrop-filter:blur(12px);z-index:100}
    .nav-logo{font-family:'Space Mono',monospace;font-size:0.82rem;letter-spacing:.28em;color:var(--glow);text-decoration:none;display:flex;align-items:center;gap:.5rem}
    .nav-mark{width:24px;height:24px;border:1px solid rgba(168,216,240,.3);border-radius:4px;display:grid;place-items:center;font-size:.68rem;font-weight:700}
    .nav-badge{font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.22em;padding:.25rem .65rem;border-radius:20px;border:1px solid rgba(251,146,60,.35);background:rgba(251,146,60,.08);color:var(--orange)}
    .nav-right{display:flex;align-items:center;gap:1rem}
    .nav-secret-wrap{display:flex;align-items:center;gap:.5rem}
    .nav-secret-input{background:var(--surface);border:1px solid var(--border);color:var(--ice);padding:.35rem .7rem;border-radius:6px;font-size:.75rem;width:220px;font-family:'Space Mono',monospace;outline:none}
    .nav-secret-input:focus{border-color:var(--accent)}
    .nav-auth-btn{background:var(--accent);color:#060810;border:none;padding:.35rem .9rem;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:opacity .2s}
    .nav-auth-btn:hover{opacity:.85}
    /* GATE */
    #adm-gate{display:flex;align-items:center;justify-content:center;min-height:80vh}
    .adm-gate-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:2.5rem;width:380px;text-align:center}
    .adm-gate-icon{font-size:2rem;margin-bottom:1rem}
    .adm-gate-title{font-size:1.2rem;font-weight:600;margin-bottom:.5rem}
    .adm-gate-sub{color:var(--muted);font-size:.82rem;margin-bottom:1.5rem}
    .adm-gate-input{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--ice);padding:.65rem 1rem;border-radius:7px;font-size:.85rem;margin-bottom:.75rem;font-family:'Space Mono',monospace;outline:none}
    .adm-gate-input:focus{border-color:var(--accent)}
    .adm-gate-btn{width:100%;background:var(--accent);color:#060810;border:none;padding:.7rem;border-radius:7px;font-size:.85rem;font-weight:700;cursor:pointer;transition:opacity .2s}
    .adm-gate-btn:hover{opacity:.85}
    .adm-gate-error{color:var(--red);font-size:.78rem;margin-top:.5rem}
    /* MAIN */
    #adm-app{display:none;padding:2rem}
    /* TABS */
    .adm-tabs{display:flex;gap:.25rem;margin-bottom:2rem;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:.3rem;width:fit-content}
    .adm-tab{padding:.45rem 1.1rem;border-radius:6px;font-size:.78rem;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--muted);transition:all .2s;letter-spacing:.03em}
    .adm-tab.active{background:var(--surface2);color:var(--ice)}
    .adm-tab:hover:not(.active){color:var(--ice)}
    .adm-panel{display:none}
    .adm-panel.active{display:block}
    /* STATS GRID */
    .adm-stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1rem;margin-bottom:2rem}
    .adm-stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.1rem 1.2rem}
    .adm-stat-val{font-size:1.8rem;font-weight:700;line-height:1;margin-bottom:.3rem}
    .adm-stat-label{font-size:.72rem;color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
    .adm-stat-sub{font-size:.72rem;color:var(--muted2);margin-top:.25rem}
    .adm-stat.green .adm-stat-val{color:var(--green)}
    .adm-stat.red   .adm-stat-val{color:var(--red)}
    .adm-stat.yellow .adm-stat-val{color:var(--yellow)}
    .adm-stat.purple .adm-stat-val{color:var(--purple)}
    .adm-stat.orange .adm-stat-val{color:var(--orange)}
    /* PANELS */
    .adm-panel-title{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:1rem;font-family:'Space Mono',monospace}
    .adm-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:2rem}
    @media(max-width:900px){.adm-grid-2{grid-template-columns:1fr}}
    /* CHARTS */
    .adm-chart-wrap{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.2rem}
    .adm-chart-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem}
    .adm-chart-title{font-size:.82rem;font-weight:600}
    .adm-svg-wrap{width:100%;overflow:hidden}
    /* TABLE */
    .adm-table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden}
    .adm-table-header{display:flex;justify-content:space-between;align-items:center;padding:1rem 1.2rem;border-bottom:1px solid var(--border)}
    .adm-table-title{font-size:.82rem;font-weight:600}
    .adm-search-row{display:flex;gap:.5rem;padding:.75rem 1.2rem;border-bottom:1px solid var(--border2);background:var(--surface2)}
    .adm-search{background:var(--bg);border:1px solid var(--border);color:var(--ice);padding:.4rem .8rem;border-radius:6px;font-size:.78rem;width:240px;outline:none}
    .adm-search:focus{border-color:var(--accent)}
    .adm-filter-select{background:var(--bg);border:1px solid var(--border);color:var(--ice);padding:.4rem .7rem;border-radius:6px;font-size:.78rem;outline:none;cursor:pointer}
    table{width:100%;border-collapse:collapse}
    th{font-size:.68rem;letter-spacing:.08em;color:var(--muted);text-transform:uppercase;padding:.65rem 1.2rem;text-align:left;font-weight:500;border-bottom:1px solid var(--border2)}
    td{padding:.7rem 1.2rem;font-size:.8rem;border-bottom:1px solid var(--border2);color:var(--ice)}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:var(--surface2)}
    .adm-tier-badge{display:inline-flex;padding:.2rem .6rem;border-radius:20px;font-size:.68rem;font-weight:600;font-family:'Space Mono',monospace}
    .adm-tier-badge.free   {background:rgba(168,216,240,.1);color:var(--accent)}
    .adm-tier-badge.creator{background:rgba(52,211,153,.12);color:var(--green)}
    .adm-tier-badge.studio {background:rgba(167,139,250,.12);color:var(--purple)}
    .adm-tier-badge.pro    {background:rgba(251,146,60,.12);color:var(--orange)}
    .adm-action-btn{padding:.3rem .7rem;border-radius:5px;font-size:.72rem;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--muted);transition:all .18s}
    .adm-action-btn:hover{border-color:var(--accent);color:var(--ice)}
    .adm-action-btn.danger:hover{border-color:var(--red);color:var(--red)}
    .adm-pagination{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1.2rem;border-top:1px solid var(--border2)}
    .adm-pagination-info{font-size:.75rem;color:var(--muted)}
    .adm-pagination-btns{display:flex;gap:.4rem}
    .adm-page-btn{padding:.3rem .65rem;border-radius:5px;font-size:.75rem;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--muted);transition:all .18s}
    .adm-page-btn:hover{border-color:var(--accent);color:var(--ice)}
    .adm-page-btn.active{background:var(--accent);color:#060810;border-color:var(--accent)}
    /* MODEL BARS */
    .adm-model-row{display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid var(--border2)}
    .adm-model-row:last-child{border-bottom:none}
    .adm-model-name{font-size:.75rem;width:140px;flex-shrink:0;font-family:'Space Mono',monospace;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .adm-model-bar-wrap{flex:1;height:6px;background:rgba(168,216,240,.06);border-radius:3px;overflow:hidden}
    .adm-model-bar{height:100%;border-radius:3px;background:var(--accent);transition:width .5s}
    .adm-model-count{font-size:.72rem;color:var(--muted);width:50px;text-align:right;flex-shrink:0}
    /* ACTIVITY FEED */
    .adm-activity-item{display:flex;align-items:center;gap:.75rem;padding:.6rem 1.2rem;border-bottom:1px solid var(--border2);font-size:.78rem}
    .adm-activity-item:last-child{border-bottom:none}
    .adm-activity-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
    .adm-activity-dot.completed{background:var(--green)}
    .adm-activity-dot.failed,.adm-activity-dot.nsfw{background:var(--red)}
    .adm-activity-dot.queued,.adm-activity-dot.in_progress{background:var(--yellow)}
    .adm-activity-email{color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .adm-activity-model{color:var(--muted2);font-family:'Space Mono',monospace;font-size:.68rem;width:90px;flex-shrink:0}
    .adm-activity-time{color:var(--muted2);font-size:.68rem;width:80px;text-align:right;flex-shrink:0}
    /* EDIT MODAL */
    .adm-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;z-index:1000}
    .adm-modal-overlay.open{display:flex}
    .adm-modal{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.75rem;width:400px}
    .adm-modal-title{font-size:1rem;font-weight:600;margin-bottom:.25rem}
    .adm-modal-sub{font-size:.78rem;color:var(--muted);margin-bottom:1.5rem}
    .adm-field{margin-bottom:1rem}
    .adm-label{font-size:.72rem;color:var(--muted);letter-spacing:.05em;margin-bottom:.35rem;display:block}
    .adm-input{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--ice);padding:.55rem .8rem;border-radius:6px;font-size:.82rem;outline:none}
    .adm-input:focus{border-color:var(--accent)}
    .adm-select{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--ice);padding:.55rem .8rem;border-radius:6px;font-size:.82rem;outline:none;cursor:pointer}
    .adm-modal-footer{display:flex;gap:.5rem;justify-content:flex-end;margin-top:1.5rem}
    .adm-btn-ghost{padding:.5rem 1.1rem;border-radius:6px;font-size:.78rem;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--muted);transition:all .18s}
    .adm-btn-ghost:hover{color:var(--ice);border-color:rgba(168,216,240,.35)}
    .adm-btn-primary{padding:.5rem 1.2rem;border-radius:6px;font-size:.78rem;font-weight:600;cursor:pointer;border:none;background:var(--accent);color:#060810;transition:opacity .2s}
    .adm-btn-primary:hover{opacity:.85}
    .adm-btn-danger{padding:.5rem 1.2rem;border-radius:6px;font-size:.78rem;font-weight:600;cursor:pointer;border:none;background:var(--red);color:#fff;transition:opacity .2s}
    .adm-btn-danger:hover{opacity:.85}
    .adm-modal-error{color:var(--red);font-size:.75rem;margin-top:.5rem}
    /* GROWTH CHART */
    .adm-growth-svg{width:100%;height:120px}
    /* TOAST */
    .adm-toast{position:fixed;bottom:1.5rem;right:1.5rem;background:var(--surface);border:1px solid var(--border);color:var(--ice);padding:.65rem 1.1rem;border-radius:8px;font-size:.78rem;opacity:0;transform:translateY(8px);transition:all .3s;pointer-events:none;z-index:2000;max-width:300px}
    .adm-toast.show{opacity:1;transform:translateY(0)}
  </style>
</head>
<body>

<nav>
  <a href="/" class="nav-logo">
    <span class="nav-mark">S</span>
    SPECTRA
  </a>
  <span class="nav-badge">ADMIN CONSOLE</span>
  <div class="nav-right">
    <div class="nav-secret-wrap">
      <input type="password" class="nav-secret-input" id="adm-secret-input" placeholder="Admin secret…" autocomplete="off"/>
      <button class="nav-auth-btn" id="adm-auth-btn">Unlock</button>
    </div>
  </div>
</nav>

<!-- GATE -->
<div id="adm-gate">
  <div class="adm-gate-card">
    <div class="adm-gate-icon">🔐</div>
    <div class="adm-gate-title">Admin Console</div>
    <div class="adm-gate-sub">Enter your admin secret to access platform controls</div>
    <input type="password" class="adm-gate-input" id="adm-gate-input" placeholder="Admin secret key…" autocomplete="off"/>
    <button class="adm-gate-btn" id="adm-gate-btn">Unlock Console</button>
    <div class="adm-gate-error" id="adm-gate-error" style="display:none"></div>
  </div>
</div>

<!-- APP -->
<div id="adm-app">

  <!-- TABS -->
  <div class="adm-tabs">
    <button class="adm-tab active" data-tab="overview">Overview</button>
    <button class="adm-tab" data-tab="users">Users</button>
    <button class="adm-tab" data-tab="activity">Activity</button>
    <button class="adm-tab" data-tab="models">Models</button>
    <button class="adm-tab" data-tab="growth">Growth</button>
  </div>

  <!-- ── OVERVIEW ── -->
  <div class="adm-panel active" id="adm-panel-overview">
    <div class="adm-panel-title">Platform Overview</div>
    <div class="adm-stats-grid" id="adm-stats-grid">
      <div class="adm-stat"><div class="adm-stat-val" id="st-total-users">—</div><div class="adm-stat-label">Total Users</div><div class="adm-stat-sub" id="st-new-7d">— new (7d)</div></div>
      <div class="adm-stat green"><div class="adm-stat-val" id="st-mrr">—</div><div class="adm-stat-label">MRR</div><div class="adm-stat-sub">paying subscribers</div></div>
      <div class="adm-stat"><div class="adm-stat-val" id="st-total-shots">—</div><div class="adm-stat-label">Total Shots</div><div class="adm-stat-sub" id="st-shots-24h">— last 24h</div></div>
      <div class="adm-stat green"><div class="adm-stat-val" id="st-completed">—</div><div class="adm-stat-label">Completed</div><div class="adm-stat-sub" id="st-success-rate">—% success</div></div>
      <div class="adm-stat red"><div class="adm-stat-val" id="st-failed">—</div><div class="adm-stat-label">Failed / NSFW</div></div>
      <div class="adm-stat yellow"><div class="adm-stat-val" id="st-active-jobs">—</div><div class="adm-stat-label">Active Jobs</div><div class="adm-stat-sub">queued + rendering</div></div>
      <div class="adm-stat"><div class="adm-stat-val" id="st-total-seconds">—</div><div class="adm-stat-label">Video Generated</div><div class="adm-stat-sub">total output seconds</div></div>
      <div class="adm-stat purple"><div class="adm-stat-val" id="st-active-sessions">—</div><div class="adm-stat-label">Active Sessions</div></div>
    </div>

    <div class="adm-grid-2">
      <div class="adm-chart-wrap">
        <div class="adm-chart-header">
          <span class="adm-chart-title">Users by Tier</span>
        </div>
        <div id="adm-tier-bars"></div>
      </div>
      <div class="adm-chart-wrap">
        <div class="adm-chart-header">
          <span class="adm-chart-title">Shot Status Breakdown</span>
        </div>
        <div id="adm-shot-status-bars"></div>
      </div>
    </div>
  </div>

  <!-- ── USERS ── -->
  <div class="adm-panel" id="adm-panel-users">
    <div class="adm-table-wrap">
      <div class="adm-table-header">
        <span class="adm-table-title">All Users</span>
        <span id="adm-user-count" style="font-size:.75rem;color:var(--muted)"></span>
      </div>
      <div class="adm-search-row">
        <input type="search" class="adm-search" id="adm-user-search" placeholder="Search email or ID…"/>
        <select class="adm-filter-select" id="adm-tier-filter">
          <option value="">All tiers</option>
          <option value="free">Free</option>
          <option value="creator">Creator</option>
          <option value="studio">Studio</option>
          <option value="pro">Pro</option>
        </select>
        <button class="adm-action-btn" id="adm-user-refresh">↻ Refresh</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Tier</th>
            <th>Credits</th>
            <th>Projects</th>
            <th>Shots</th>
            <th>Joined</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="adm-user-tbody"></tbody>
      </table>
      <div class="adm-pagination">
        <span class="adm-pagination-info" id="adm-user-pagination-info"></span>
        <div class="adm-pagination-btns" id="adm-user-pagination-btns"></div>
      </div>
    </div>
  </div>

  <!-- ── ACTIVITY ── -->
  <div class="adm-panel" id="adm-panel-activity">
    <div class="adm-table-wrap">
      <div class="adm-table-header">
        <span class="adm-table-title">Recent Shot Activity</span>
        <button class="adm-action-btn" id="adm-activity-refresh">↻ Refresh</button>
      </div>
      <div id="adm-activity-feed"></div>
    </div>
  </div>

  <!-- ── MODELS ── -->
  <div class="adm-panel" id="adm-panel-models">
    <div class="adm-grid-2">
      <div class="adm-chart-wrap">
        <div class="adm-chart-header"><span class="adm-chart-title">Shots by Model</span></div>
        <div id="adm-model-bars"></div>
      </div>
      <div class="adm-chart-wrap">
        <div class="adm-chart-header"><span class="adm-chart-title">Success Rate by Model</span></div>
        <div id="adm-model-success-bars"></div>
      </div>
    </div>
    <div class="adm-chart-wrap" style="margin-top:0">
      <div class="adm-chart-header"><span class="adm-chart-title">Avg Generation Time (seconds)</span></div>
      <div id="adm-model-speed-bars"></div>
    </div>
  </div>

  <!-- ── GROWTH ── -->
  <div class="adm-panel" id="adm-panel-growth">
    <div class="adm-grid-2">
      <div class="adm-chart-wrap">
        <div class="adm-chart-header"><span class="adm-chart-title">Daily Signups (30d)</span></div>
        <svg class="adm-growth-svg" id="adm-signup-svg" viewBox="0 0 500 120" preserveAspectRatio="none"></svg>
      </div>
      <div class="adm-chart-wrap">
        <div class="adm-chart-header"><span class="adm-chart-title">Daily Shots (30d)</span></div>
        <svg class="adm-growth-svg" id="adm-shots-svg" viewBox="0 0 500 120" preserveAspectRatio="none"></svg>
      </div>
    </div>
  </div>

</div><!-- /adm-app -->

<!-- EDIT USER MODAL -->
<div class="adm-modal-overlay" id="adm-edit-overlay">
  <div class="adm-modal">
    <div class="adm-modal-title">Edit User</div>
    <div class="adm-modal-sub" id="adm-edit-email"></div>
    <input type="hidden" id="adm-edit-user-id"/>
    <div class="adm-field">
      <label class="adm-label">Tier</label>
      <select class="adm-select" id="adm-edit-tier">
        <option value="free">Free</option>
        <option value="creator">Creator — $29/mo</option>
        <option value="studio">Studio — $79/mo</option>
        <option value="pro">Pro — $149/mo</option>
      </select>
    </div>
    <div class="adm-field">
      <label class="adm-label">Credits</label>
      <input type="number" class="adm-input" id="adm-edit-credits" min="0" max="99999"/>
    </div>
    <div class="adm-modal-error" id="adm-edit-error" style="display:none"></div>
    <div class="adm-modal-footer">
      <button class="adm-btn-ghost" id="adm-edit-cancel">Cancel</button>
      <button class="adm-btn-danger" id="adm-edit-delete">Delete User</button>
      <button class="adm-btn-primary" id="adm-edit-save">Save Changes</button>
    </div>
  </div>
</div>

<div class="adm-toast" id="adm-toast"></div>

<script>
/* ── Admin Console JS ── */
let ADM_SECRET = '';
let admUserPage = 1;
let admUserSearch = '';
let admUserTier = '';

function admApi(method, path, body) {
  const url = path + (path.includes('?') ? '&' : '?') + 'secret=' + encodeURIComponent(ADM_SECRET);
  return fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json', 'X-Admin-Secret': ADM_SECRET } : { 'X-Admin-Secret': ADM_SECRET },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function admToast(msg, isErr) {
  const t = document.getElementById('adm-toast');
  t.textContent = msg;
  t.style.borderColor = isErr ? 'var(--red)' : 'var(--border)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function fmtNum(n) {
  if (n == null || n === '') return '—';
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n/1000).toFixed(1) + 'K';
  return String(n);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'2-digit' });
}
function timeAgo(d) {
  if (!d) return '—';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60)   return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400)return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

function renderTierBadge(tier) {
  return '<span class="adm-tier-badge ' + tier + '">' + tier.toUpperCase() + '</span>';
}

// ── UNLOCK ──
async function admUnlock(secret) {
  const res  = await fetch('/api/admin/stats?secret=' + encodeURIComponent(secret));
  if (res.status === 403) return false;
  ADM_SECRET = secret;
  document.getElementById('adm-gate').style.display = 'none';
  document.getElementById('adm-app').style.display = 'block';
  loadOverview();
  return true;
}

document.getElementById('adm-gate-btn').addEventListener('click', async () => {
  const secret = document.getElementById('adm-gate-input').value.trim();
  const errEl  = document.getElementById('adm-gate-error');
  errEl.style.display = 'none';
  if (!secret) return;
  const ok = await admUnlock(secret);
  if (!ok) { errEl.textContent = 'Invalid secret. Access denied.'; errEl.style.display = 'block'; }
});
document.getElementById('adm-gate-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('adm-gate-btn').click();
});
document.getElementById('adm-auth-btn').addEventListener('click', async () => {
  const secret = document.getElementById('adm-secret-input').value.trim();
  if (!secret) return;
  const ok = await admUnlock(secret);
  if (!ok) admToast('Invalid secret', true);
});

// ── TABS ──
document.querySelectorAll('.adm-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.adm-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.adm-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panelId = 'adm-panel-' + btn.dataset.tab;
    document.getElementById(panelId).classList.add('active');
    if (btn.dataset.tab === 'users')    loadUsers();
    if (btn.dataset.tab === 'activity') loadActivity();
    if (btn.dataset.tab === 'models')   loadModels();
    if (btn.dataset.tab === 'growth')   loadGrowth();
  });
});

// ── OVERVIEW ──
async function loadOverview() {
  const res  = await admApi('GET', '/api/admin/stats');
  const data = await res.json();
  const { users, shots, projects, sessions, revenue } = data;

  document.getElementById('st-total-users').textContent    = fmtNum(users.total);
  document.getElementById('st-new-7d').textContent         = '+' + (users.new_7d||0) + ' new (7d)';
  document.getElementById('st-mrr').textContent            = '$' + fmtNum(revenue?.mrr || 0);
  document.getElementById('st-total-shots').textContent    = fmtNum(shots.total);
  document.getElementById('st-shots-24h').textContent      = (shots.last_24h||0) + ' last 24h';
  document.getElementById('st-completed').textContent      = fmtNum(shots.completed);
  const succ = shots.total > 0 ? Math.round((shots.completed/shots.total)*100) : 0;
  document.getElementById('st-success-rate').textContent   = succ + '% success';
  document.getElementById('st-failed').textContent         = fmtNum((shots.failed||0) + (shots.nsfw||0));
  document.getElementById('st-active-jobs').textContent    = fmtNum(shots.active||0);
  document.getElementById('st-total-seconds').textContent  = fmtNum(shots.total_seconds||0) + 's';
  document.getElementById('st-active-sessions').textContent= fmtNum(sessions.active||0);

  // Tier bars
  const tierData = [
    { label:'Free',    val: users.free_count||0,    color:'var(--accent)' },
    { label:'Creator', val: users.creator_count||0, color:'var(--green)' },
    { label:'Studio',  val: users.studio_count||0,  color:'var(--purple)' },
    { label:'Pro',     val: users.pro_count||0,      color:'var(--orange)' },
  ];
  const maxTier = Math.max(...tierData.map(d => d.val), 1);
  document.getElementById('adm-tier-bars').innerHTML = tierData.map(d => \`
    <div class="adm-model-row">
      <div class="adm-model-name">\${d.label}</div>
      <div class="adm-model-bar-wrap"><div class="adm-model-bar" style="width:\${Math.round(d.val/maxTier*100)}%;background:\${d.color}"></div></div>
      <div class="adm-model-count">\${d.val}</div>
    </div>\`).join('');

  // Status bars
  const statusData = [
    { label:'Completed', val: shots.completed||0,  color:'var(--green)' },
    { label:'Failed',    val: shots.failed||0,     color:'var(--red)' },
    { label:'NSFW',      val: shots.nsfw||0,       color:'var(--orange)' },
    { label:'Active',    val: shots.active||0,     color:'var(--yellow)' },
  ];
  const maxStatus = Math.max(...statusData.map(d => d.val), 1);
  document.getElementById('adm-shot-status-bars').innerHTML = statusData.map(d => \`
    <div class="adm-model-row">
      <div class="adm-model-name">\${d.label}</div>
      <div class="adm-model-bar-wrap"><div class="adm-model-bar" style="width:\${Math.round(d.val/maxStatus*100)}%;background:\${d.color}"></div></div>
      <div class="adm-model-count">\${d.val}</div>
    </div>\`).join('');
}

// ── USERS ──
async function loadUsers() {
  const res  = await admApi('GET', \`/api/admin/users?page=\${admUserPage}&search=\${encodeURIComponent(admUserSearch)}&tier=\${admUserTier}\`);
  const data = await res.json();

  document.getElementById('adm-user-count').textContent = data.total + ' users';

  const tbody = document.getElementById('adm-user-tbody');
  tbody.innerHTML = (data.users || []).map(u => \`
    <tr>
      <td style="font-family:'Space Mono',monospace;font-size:.73rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${u.email}</td>
      <td>\${renderTierBadge(u.tier)}</td>
      <td>\${u.credits}</td>
      <td>\${u.project_count||0}</td>
      <td>\${u.shot_count||0} (\${u.completed_shots||0} done)</td>
      <td>\${fmtDate(u.created_at)}</td>
      <td>
        <button class="adm-action-btn" onclick="openEditUser(\${JSON.stringify(u).replace(/"/g,'&quot;')})">Edit</button>
      </td>
    </tr>\`).join('');

  // Pagination
  const info = document.getElementById('adm-user-pagination-info');
  const btns = document.getElementById('adm-user-pagination-btns');
  info.textContent = \`Page \${data.page} of \${data.pages || 1} · \${data.total} total\`;
  btns.innerHTML = '';
  const totalPages = data.pages || 1;
  const start = Math.max(1, admUserPage - 2);
  const end   = Math.min(totalPages, admUserPage + 2);
  if (admUserPage > 1) {
    const b = document.createElement('button');
    b.className = 'adm-page-btn'; b.textContent = '←';
    b.onclick = () => { admUserPage--; loadUsers(); };
    btns.appendChild(b);
  }
  for (let p = start; p <= end; p++) {
    const b = document.createElement('button');
    b.className = 'adm-page-btn' + (p === admUserPage ? ' active' : '');
    b.textContent = p;
    b.onclick = (pp => () => { admUserPage = pp; loadUsers(); })(p);
    btns.appendChild(b);
  }
  if (admUserPage < totalPages) {
    const b = document.createElement('button');
    b.className = 'adm-page-btn'; b.textContent = '→';
    b.onclick = () => { admUserPage++; loadUsers(); };
    btns.appendChild(b);
  }
}

let _searchTimer;
document.getElementById('adm-user-search').addEventListener('input', e => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => { admUserSearch = e.target.value; admUserPage = 1; loadUsers(); }, 350);
});
document.getElementById('adm-tier-filter').addEventListener('change', e => {
  admUserTier = e.target.value; admUserPage = 1; loadUsers();
});
document.getElementById('adm-user-refresh').addEventListener('click', loadUsers);

// ── EDIT USER MODAL ──
function openEditUser(u) {
  document.getElementById('adm-edit-user-id').value  = u.id;
  document.getElementById('adm-edit-email').textContent = u.email;
  document.getElementById('adm-edit-tier').value     = u.tier;
  document.getElementById('adm-edit-credits').value  = u.credits;
  document.getElementById('adm-edit-error').style.display = 'none';
  document.getElementById('adm-edit-overlay').classList.add('open');
}
document.getElementById('adm-edit-cancel').addEventListener('click', () => {
  document.getElementById('adm-edit-overlay').classList.remove('open');
});
document.getElementById('adm-edit-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('adm-edit-overlay'))
    document.getElementById('adm-edit-overlay').classList.remove('open');
});
document.getElementById('adm-edit-save').addEventListener('click', async () => {
  const id      = document.getElementById('adm-edit-user-id').value;
  const tier    = document.getElementById('adm-edit-tier').value;
  const credits = parseInt(document.getElementById('adm-edit-credits').value);
  const errEl   = document.getElementById('adm-edit-error');
  errEl.style.display = 'none';
  const res  = await admApi('PATCH', '/api/admin/users/' + id, { tier, credits });
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error; errEl.style.display = 'block'; return; }
  document.getElementById('adm-edit-overlay').classList.remove('open');
  admToast('User updated');
  loadUsers();
});
document.getElementById('adm-edit-delete').addEventListener('click', async () => {
  const id    = document.getElementById('adm-edit-user-id').value;
  const email = document.getElementById('adm-edit-email').textContent;
  if (!confirm('Delete user ' + email + '? This is permanent and deletes all their projects, shots, and data.')) return;
  const res  = await admApi('DELETE', '/api/admin/users/' + id);
  const data = await res.json();
  if (!res.ok) { admToast(data.error, true); return; }
  document.getElementById('adm-edit-overlay').classList.remove('open');
  admToast('User deleted: ' + email);
  loadUsers();
});

// ── ACTIVITY ──
async function loadActivity() {
  const res  = await admApi('GET', '/api/admin/activity?limit=60');
  const data = await res.json();
  const feed = document.getElementById('adm-activity-feed');
  feed.innerHTML = (data.activity || []).map(a => {
    const model = (a.model || '').split('/').pop() || '';
    return \`<div class="adm-activity-item">
      <div class="adm-activity-dot \${a.status}"></div>
      <div class="adm-activity-email">\${a.email} · <span style="color:var(--muted2)">\${a.project_name}</span></div>
      <div class="adm-activity-model">\${model}</div>
      <div style="font-size:.7rem;color:var(--muted2);width:60px;flex-shrink:0">\${a.aspect_ratio||''}</div>
      <div class="adm-activity-time">\${timeAgo(a.created_at)}</div>
    </div>\`;
  }).join('') || '<div style="padding:2rem;text-align:center;color:var(--muted);font-size:.8rem">No activity yet</div>';
}
document.getElementById('adm-activity-refresh').addEventListener('click', loadActivity);

// ── MODELS ──
async function loadModels() {
  const res  = await admApi('GET', '/api/admin/model-stats');
  const data = await res.json();
  const models = data.models || [];
  const maxTotal = Math.max(...models.map(m => m.total), 1);

  document.getElementById('adm-model-bars').innerHTML = models.map(m => {
    const label = (m.model||'').split('/').pop() || m.model;
    return \`<div class="adm-model-row">
      <div class="adm-model-name" title="\${m.model}">\${label}</div>
      <div class="adm-model-bar-wrap"><div class="adm-model-bar" style="width:\${Math.round(m.total/maxTotal*100)}%"></div></div>
      <div class="adm-model-count">\${m.total}</div>
    </div>\`;
  }).join('');

  document.getElementById('adm-model-success-bars').innerHTML = models.map(m => {
    const rate = m.total > 0 ? Math.round((m.completed/m.total)*100) : 0;
    const col  = rate >= 80 ? 'var(--green)' : rate >= 50 ? 'var(--yellow)' : 'var(--red)';
    return \`<div class="adm-model-row">
      <div class="adm-model-name" title="\${m.model}">\${(m.model||'').split('/').pop()}</div>
      <div class="adm-model-bar-wrap"><div class="adm-model-bar" style="width:\${rate}%;background:\${col}"></div></div>
      <div class="adm-model-count">\${rate}%</div>
    </div>\`;
  }).join('');

  const maxSec = Math.max(...models.map(m => m.avg_sec||0), 1);
  document.getElementById('adm-model-speed-bars').innerHTML = models.map(m => {
    const sec = m.avg_sec != null ? Math.round(m.avg_sec) : null;
    return \`<div class="adm-model-row">
      <div class="adm-model-name" title="\${m.model}">\${(m.model||'').split('/').pop()}</div>
      <div class="adm-model-bar-wrap"><div class="adm-model-bar" style="width:\${sec != null ? Math.round(sec/maxSec*100) : 0}%;background:var(--purple)"></div></div>
      <div class="adm-model-count">\${sec != null ? sec + 's' : '—'}</div>
    </div>\`;
  }).join('');
}

// ── GROWTH ──
async function loadGrowth() {
  const res  = await admApi('GET', '/api/admin/growth');
  const data = await res.json();
  renderGrowthChart('adm-signup-svg', data.signups||[], 'count', 'var(--green)');
  renderGrowthChart('adm-shots-svg',  data.shots||[],   'total', 'var(--accent)');
}

function renderGrowthChart(svgId, rows, key, color) {
  const svg = document.getElementById(svgId);
  if (!svg || rows.length === 0) { if (svg) svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="rgba(232,244,253,.25)" font-size="11">No data</text>'; return; }
  const vals = rows.map(r => r[key] || 0);
  const maxV = Math.max(...vals, 1);
  const W = 500, H = 120, pad = 10;
  const step = (W - pad*2) / Math.max(vals.length - 1, 1);
  const points = vals.map((v, i) => \`\${pad + i * step},\${H - pad - (v/maxV)*(H-pad*2)}\`).join(' ');
  svg.innerHTML = \`
    <polyline points="\${points}" fill="none" stroke="\${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
    \${vals.map((v,i) => v > 0 ? \`<circle cx="\${pad + i * step}" cy="\${H - pad - (v/maxV)*(H-pad*2)}" r="2.5" fill="\${color}" opacity="0.9"/>\` : '').join('')}
    \${vals.map((v,i) => v > 0 ? \`<text x="\${pad + i * step}" y="\${H - pad - (v/maxV)*(H-pad*2) - 6}" text-anchor="middle" fill="rgba(232,244,253,.4)" font-size="9">\${v}</text>\` : '').join('')}
  \`;
}
</script>
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
