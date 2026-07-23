import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { sendCapiEvent, splitName } from "@/lib/meta-capi"
import { DEFAULT_CONFIG } from "@/lib/company-config"
import { verifyAddressToken } from "@/lib/address-verification"
import { contractorTenantId, recordQuoteActivity } from "@/lib/contractor-platform"
import {
  checkRateLimit,
  rateLimitResponse,
  sameOrigin,
} from "@/lib/request-security"

export const runtime = "nodejs"

const LEAD_RECIPIENT =
  process.env.LEAD_RECIPIENT || DEFAULT_CONFIG.email

const FROM_ADDRESS =
  process.env.LEAD_FROM || `${DEFAULT_CONFIG.companyName} Gutter Quotes <onboarding@resend.dev>`

interface LeadPayload {
  sessionId?: string
  addressToken?: string
  name?: string
  phone?: string
  email?: string
  roofAreaSqFt?: number
  squares?: number
  pitch?: string
  source?: string
  /** Shared id for deduping the Meta Pixel event with this CAPI event. */
  eventId?: string
  /** URL the lead was submitted from, for Meta event attribution. */
  eventSourceUrl?: string
}

/** Read a single cookie value from a Cookie header string. */
function readCookie(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return undefined
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "cross-site-request" },
      { status: 403 },
    )
  }

  let lead: LeadPayload
  try {
    lead = (await request.json()) as LeadPayload
  } catch {
    return NextResponse.json({ ok: false, error: "bad-request" }, { status: 400 })
  }

  const name = (lead.name ?? "").trim()
  const phone = (lead.phone ?? "").trim()
  const email = (lead.email ?? "").trim()
  const sessionId = (lead.sessionId ?? "").trim()
  const addressToken = (lead.addressToken ?? "").trim()

  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(sessionId) || addressToken.length < 20 || addressToken.length > 2_000) {
    return NextResponse.json(
      { ok: false, error: "address-verification-required" },
      { status: 400 },
    )
  }
  const verifiedAddress = verifyAddressToken(addressToken, contractorTenantId(), sessionId)
  if (!verifiedAddress) {
    return NextResponse.json(
      { ok: false, error: "address-verification-invalid" },
      { status: 400 },
    )
  }
  const rate = await checkRateLimit({
    request,
    scope: "lead-save",
    identifier: `${contractorTenantId()}:${sessionId}`,
    limit: 12,
    windowSeconds: 3600,
  })
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter)
  const address = verifiedAddress.formattedAddress

  if (!name || !phone || !email) {
    return NextResponse.json(
      { ok: false, error: "missing-fields" },
      { status: 400 },
    )
  }
  if (
    name.length > 120 ||
    email.length > 254 ||
    phone.length > 40 ||
    (lead.source?.length ?? 0) > 120 ||
    (lead.eventId?.length ?? 0) > 200 ||
    (lead.eventSourceUrl?.length ?? 0) > 2_048
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid-fields" },
      { status: 400 },
    )
  }

  await recordQuoteActivity({
    sessionId,
    address,
    state: verifiedAddress.state,
    county: verifiedAddress.county,
    stage: "lead-submitted",
    name,
    email,
    phone,
  }).catch((error) => console.log("[v0] Lead activity storage failed:", error))

  // Server-side Meta Conversions API "Lead" event. Shares eventId with the
  // browser pixel so Meta dedupes them. Fire-and-forget: never block or fail
  // the lead on tracking.
  if (lead.eventId) {
    const cookieHeader = request.headers.get("cookie") ?? ""
    const forwardedFor = request.headers.get("x-forwarded-for") ?? ""
    const ip = forwardedFor.split(",")[0]?.trim() || undefined
    const { firstName, lastName } = splitName(name)
    void sendCapiEvent({
      eventName: "Lead",
      eventId: lead.eventId,
      eventSourceUrl: lead.eventSourceUrl,
      user: {
        email,
        phone,
        firstName,
        lastName,
        state: verifiedAddress.state,
        fbp: readCookie(cookieHeader, "_fbp"),
        fbc: readCookie(cookieHeader, "_fbc"),
        ip,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
      customData: {
        content_name: `${DEFAULT_CONFIG.companyName} Instant Gutter Quote`,
        content_category: "gutter-installation",
      },
    })
  }

  const rows: [string, string][] = [
    ["Name", name],
    ["Phone", phone],
    ["Email", email],
    ["Address", address || "—"],
    ["County", verifiedAddress.county],
    ["State", verifiedAddress.state],
    [
      "Estimated gutter run",
      lead.roofAreaSqFt
        ? `${lead.roofAreaSqFt.toLocaleString()} linear ft`
        : "—",
    ],
    ["Estimated downspouts", lead.squares ? `${lead.squares}` : "—"],
    ["Measured via", lead.source || "—"],
  ]

  const text = [
    "New gutter quote lead",
    "Submitted from the instant quote tool.",
    "",
    ...rows.map(([label, val]) => `${label}: ${val}`),
    "",
    `Reply directly to this email to reach the customer at ${email}.`,
  ].join("\n")

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#333">
      <h2 style="color:${DEFAULT_CONFIG.primaryColor};margin-bottom:4px">New gutter quote lead</h2>
      <p style="margin-top:0;color:#666">Submitted from the instant quote tool.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px">
        ${rows
          .map(
            ([label, val]) =>
              `<tr>
                <td style="padding:8px 12px;background:#f5f6f7;font-weight:bold;border:1px solid #e5e7eb;width:150px">${label}</td>
                <td style="padding:8px 12px;border:1px solid #e5e7eb">${escapeHtml(val)}</td>
              </tr>`,
          )
          .join("")}
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Reply directly to this email to reach the customer at ${escapeHtml(email)}.
      </p>
    </div>
  `

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // The verified lead is still retained for the contractor dashboard.
    console.log("[v0] RESEND_API_KEY missing — verified lead retained but not emailed")
    return NextResponse.json({ ok: true, email: { sent: false, reason: "email-not-configured" } })
  }

  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [LEAD_RECIPIENT],
      replyTo: email,
      subject: `New gutter lead: ${name}${address ? ` — ${address}` : ""}`,
      html,
      text,
    })

    if (error) {
      console.log("[v0] Resend error:", error)
      return NextResponse.json(
        { ok: false, error: "send-failed" },
        { status: 502 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.log("[v0] Lead email exception:", err)
    return NextResponse.json(
      { ok: false, error: "send-failed" },
      { status: 502 },
    )
  }
}
