import { createHash, createHmac, timingSafeEqual } from "node:crypto"

export type QuoteActivityStage =
  | "address-entered"
  | "measurement-started"
  | "measured"
  | "measurement-unavailable"
  | "out-of-area"
  | "lead-submitted"
  | "quote-viewed"

export type QuoteActivity = {
  sessionId: string
  address: string
  state: string
  county: string
  stage: QuoteActivityStage
  firstSeenAt: string
  updatedAt: string
  name?: string
  email?: string
  phone?: string
}

type RedisResponse<T> = { result?: T; error?: string }

const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "")
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN

export function platformStorageConfigured() {
  return Boolean(redisUrl && redisToken)
}

export function contractorTenantId() {
  return process.env.CONTRACTOR_TENANT_ID || process.env.VERCEL_PROJECT_ID || "gutterquote-template"
}

function tenantKey(kind: string, tenantId = contractorTenantId()) {
  return `gutterquote:${tenantId}:${kind}`
}

async function redis<T>(command: Array<string | number>): Promise<T> {
  if (!redisUrl || !redisToken) throw new Error("Platform storage is not configured.")
  const response = await fetch(redisUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  })
  const data = (await response.json()) as RedisResponse<T>
  if (!response.ok || data.error) throw new Error(data.error || "Platform storage request failed.")
  return data.result as T
}

async function pipeline(commands: Array<Array<string | number>>) {
  if (!redisUrl || !redisToken) throw new Error("Platform storage is not configured.")
  const response = await fetch(`${redisUrl}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  })
  if (!response.ok) throw new Error("Platform storage pipeline failed.")
  return response.json()
}

function retentionSeconds() {
  const days = Number(process.env.ADMIN_LEAD_RETENTION_DAYS || 30)
  return Math.max(1, Math.min(365, Number.isFinite(days) ? days : 30)) * 86400
}

export async function recordQuoteActivity(input: {
  sessionId: string
  address: string
  state: string
  county: string
  stage: QuoteActivityStage
  name?: string
  email?: string
  phone?: string
}) {
  if (!platformStorageConfigured()) return false
  const activityKey = tenantKey(`activity:${input.sessionId}`)
  const indexKey = tenantKey("activity-index")
  const existingRaw = await redis<string | null>(["GET", activityKey])
  let existing: QuoteActivity | null = null
  try {
    existing = existingRaw ? JSON.parse(existingRaw) as QuoteActivity : null
  } catch {
    existing = null
  }
  const now = new Date().toISOString()
  const activity: QuoteActivity = {
    ...existing,
    sessionId: input.sessionId,
    address: input.address,
    state: input.state,
    county: input.county,
    stage: input.stage,
    firstSeenAt: existing?.firstSeenAt || now,
    updatedAt: now,
    ...(input.name ? { name: input.name } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
  }
  const ttl = retentionSeconds()
  await pipeline([
    ["SET", activityKey, JSON.stringify(activity), "EX", ttl],
    ["ZADD", indexKey, Date.now(), input.sessionId],
    ["EXPIRE", indexKey, ttl],
  ])
  return true
}

export async function listQuoteActivity(limit = 100) {
  if (!platformStorageConfigured()) return [] as QuoteActivity[]
  const indexKey = tenantKey("activity-index")
  const ids = await redis<string[]>(["ZREVRANGE", indexKey, 0, Math.max(0, Math.min(249, limit - 1))])
  if (!ids?.length) return []
  const keys = ids.map((id) => tenantKey(`activity:${id}`))
  const values = await redis<Array<string | null>>(["MGET", ...keys])
  const expired: string[] = []
  const activities = values.flatMap((value, index) => {
    if (!value) {
      expired.push(ids[index])
      return []
    }
    try {
      return [JSON.parse(value) as QuoteActivity]
    } catch {
      return []
    }
  })
  if (expired.length) await redis(["ZREM", indexKey, ...expired]).catch(() => undefined)
  return activities
}

function initialCredits() {
  const value = Number(process.env.RENDER_INITIAL_CREDITS || 20)
  return Math.max(0, Number.isFinite(value) ? Math.floor(value) : 20)
}

export async function getRenderCredits() {
  if (!platformStorageConfigured()) return null
  const key = tenantKey("render-credits")
  await redis(["SET", key, initialCredits(), "NX"])
  const value = await redis<string | number | null>(["GET", key])
  return Math.max(0, Number(value) || 0)
}

export async function consumeRenderCredit() {
  if (!platformStorageConfigured()) return { allowed: true, remaining: null, metered: false }
  const script = "local c=redis.call('GET',KEYS[1]); if not c then redis.call('SET',KEYS[1],ARGV[1]); c=ARGV[1]; end; if tonumber(c)<=0 then return -1 end; return redis.call('DECR',KEYS[1])"
  const remaining = Number(await redis(["EVAL", script, 1, tenantKey("render-credits"), initialCredits()]))
  return { allowed: remaining >= 0, remaining: Math.max(0, remaining), metered: true }
}

export async function addRenderCredits(amount: number, tenantId = contractorTenantId()) {
  if (!platformStorageConfigured()) throw new Error("Platform storage is not configured.")
  const safeAmount = Math.max(1, Math.min(1_000_000, Math.floor(amount)))
  await redis(["SET", tenantKey("render-credits", tenantId), initialCredits(), "NX"])
  return Number(await redis(["INCRBY", tenantKey("render-credits", tenantId), safeAmount]))
}

export async function claimWebhookEvent(eventId: string) {
  if (!platformStorageConfigured()) return false
  const result = await redis<string | null>([
    "SET",
    `gutterquote:stripe-event:${eventId}`,
    "1",
    "NX",
    "EX",
    60 * 60 * 24 * 30,
  ])
  return result === "OK"
}

export async function releaseWebhookEvent(eventId: string) {
  if (!platformStorageConfigured()) return
  await redis(["DEL", `gutterquote:stripe-event:${eventId}`])
}

export async function allowPlatformRequest(kind: string, identity: string, maximum: number, windowSeconds: number) {
  if (!platformStorageConfigured()) return true
  const identityHash = createHash("sha256").update(identity || "unknown").digest("hex").slice(0, 24)
  const key = tenantKey(`rate:${kind}:${identityHash}`)
  const count = Number(await redis(["INCR", key]))
  if (count === 1) await redis(["EXPIRE", key, windowSeconds])
  return count <= maximum
}

export function isContractorAuthorized(value: string | null) {
  const expected = process.env.CONTRACTOR_ADMIN_KEY
  if (!expected || !value) return false
  const left = Buffer.from(value)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function verifyStripeSignature(payload: string, signatureHeader: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !signatureHeader) return false
  const parts = signatureHeader.split(",").map((part) => part.split("="))
  const timestamp = parts.find(([key]) => key === "t")?.[1]
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value)
  if (!timestamp || signatures.length === 0) return false
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")
  return signatures.some((signature) => {
    const left = Buffer.from(signature)
    const right = Buffer.from(expected)
    return left.length === right.length && timingSafeEqual(left, right)
  })
}
