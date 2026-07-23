import { NextRequest, NextResponse } from "next/server"
import { CONTRACTOR_COOKIE } from "@/lib/contractor-auth"
import { sameOrigin } from "@/lib/request-security"

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-site sign-out requests are not allowed." },
      { status: 403 },
    )
  }
  const response = NextResponse.json({ ok: true })
  response.cookies.set(CONTRACTOR_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return response
}
