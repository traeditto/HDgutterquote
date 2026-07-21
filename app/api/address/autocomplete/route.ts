import { NextResponse } from "next/server"
import { autocompleteGoogleAddresses } from "@/lib/google-places"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type AutocompleteBody = { input?: string; sessionToken?: string }

export async function POST(request: Request) {
  try {
    const body = await request.json() as AutocompleteBody
    const input = body.input?.trim() || ""
    const sessionToken = body.sessionToken?.trim() || ""
    if (input.length < 3) return NextResponse.json({ suggestions: [] })
    if (input.length > 180 || !/^[a-zA-Z0-9_-]{8,100}$/.test(sessionToken)) {
      return NextResponse.json({ error: "Enter a valid property address." }, { status: 400 })
    }

    return NextResponse.json({ suggestions: await autocompleteGoogleAddresses(input, sessionToken) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Address suggestions are temporarily unavailable."
    return NextResponse.json({ error: message }, { status: message.includes("not configured") ? 503 : 502 })
  }
}
