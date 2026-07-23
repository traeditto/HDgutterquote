import { NextRequest, NextResponse } from "next/server"
import {
  CONTRACTOR_COOKIE,
  createContractorSession,
} from "@/lib/contractor-auth"
import {
  contractorTenantId,
  isContractorAuthorized,
} from "@/lib/contractor-platform"
import {
  checkRateLimit,
  rateLimitResponse,
  sameOrigin,
} from "@/lib/request-security"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) {
      return NextResponse.json(
        { error: "Cross-site sign-in requests are not allowed." },
        { status: 403 },
      )
    }
    const rate = await checkRateLimit({
      request,
      scope: "contractor-login",
      limit: 10,
      windowSeconds: 900,
    })
    if (!rate.allowed) return rateLimitResponse(rate.retryAfter)

    const body = (await request.json()) as { password?: string }
    const password =
      typeof body.password === "string" ? body.password.trim() : ""
    if (
      !password ||
      password.length > 512 ||
      !isContractorAuthorized(password)
    ) {
      return NextResponse.json(
        { error: "The dashboard access key is incorrect." },
        { status: 401 },
      )
    }

    const response = NextResponse.json({ ok: true })
    response.cookies.set(
      CONTRACTOR_COOKIE,
      createContractorSession(contractorTenantId()),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      },
    )
    return response
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Contractor sign-in is unavailable.",
      },
      { status: 503 },
    )
  }
}
