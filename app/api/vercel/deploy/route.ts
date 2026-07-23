import { NextResponse } from "next/server"
import type { CompanyConfig } from "@/lib/company-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DeployRequest = {
  config?: CompanyConfig
  projectName?: string
  domain?: string
}

type VercelProject = {
  id: string
  name: string
  link?: {
    repoId?: string | number
    type?: string
  }
}

type DomainVerification = {
  type?: string
  domain?: string
  value?: string
  reason?: string
}

type VercelDomain = {
  name: string
  verified: boolean
  verification?: DomainVerification[]
}

type VercelDeployment = {
  id: string
  url: string
  readyState?: string
  inspectorUrl?: string
}

type VercelErrorPayload = {
  error?: {
    code?: string
    message?: string
  }
}

class VercelRequestError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function normalizeProjectName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90)
}

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/\.$/, "")
}

function normalizeRepository(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/^\//, "")
}

function isCompanyConfig(value: unknown): value is CompanyConfig {
  if (!value || typeof value !== "object") return false
  const config = value as Partial<CompanyConfig>
  return Boolean(
    config.companyName &&
    config.phone !== undefined &&
    Array.isArray(config.counties) &&
    Array.isArray(config.gutterProducts) &&
    config.gutterProducts.length > 0 &&
    config.gutterProducts.every((product) =>
      product.id && product.name && product.pricePerFoot &&
      [1, 2, 3].every((tier) => Number.isFinite(product.pricePerFoot[tier as 1 | 2 | 3])),
    ),
  )
}

function companyEnvironment(configValue: string) {
  const variables: Array<{
    key: string
    value: string
    type: "plain" | "encrypted"
    target: "production" | ["production"]
    comment?: string
  }> = [{
    key: "NEXT_PUBLIC_COMPANY_CONFIG",
    value: configValue,
    type: "plain",
    target: "production",
    comment: "GutterQuote company configuration",
  }]

  for (const key of [
    "GOOGLE_MAPS_API_KEY",
    "PLATFORM_SESSION_SECRET",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GEMINI_IMAGE_MODEL",
    "RESEND_API_KEY",
    "LEAD_FROM",
    "META_CAPI_ACCESS_TOKEN",
    "META_TEST_EVENT_CODE",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "STRIPE_SECRET_KEY",
    "STRIPE_RENDER_CREDIT_PRICE_ID",
    "RENDER_CREDITS_PER_PACK",
    "RENDER_INITIAL_CREDITS",
    "RENDER_MAX_PER_IP_HOUR",
    "ADMIN_LEAD_RETENTION_DAYS",
  ]) {
    const value = process.env[key]
    if (value) variables.push({ key, value, type: "encrypted", target: "production" })
  }
  return variables
}

function withTeam(path: string) {
  const url = new URL(path, "https://api.vercel.com")
  const teamId = process.env.VERCEL_TEAM_ID
  if (teamId) url.searchParams.set("teamId", teamId)
  return url.toString()
}

async function vercelRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.VERCEL_TOKEN
  if (!token) throw new VercelRequestError("VERCEL_TOKEN is not configured.", 503)

  const response = await fetch(withTeam(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  })

  const data = (await response.json().catch(() => ({}))) as T & VercelErrorPayload
  if (!response.ok) {
    throw new VercelRequestError(
      data.error?.message || `Vercel request failed with status ${response.status}.`,
      response.status,
      data.error?.code,
    )
  }
  return data
}

async function findProject(projectName: string) {
  try {
    return await vercelRequest<VercelProject>(`/v9/projects/${encodeURIComponent(projectName)}`)
  } catch (error) {
    if (error instanceof VercelRequestError && error.status === 404) return null
    throw error
  }
}

async function findDomain(projectId: string, domain: string) {
  try {
    return await vercelRequest<VercelDomain>(
      `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}`,
    )
  } catch (error) {
    if (error instanceof VercelRequestError && error.status === 404) return null
    throw error
  }
}

export async function POST(request: Request) {
  const requiredSettings = ["VERCEL_TOKEN", "VERCEL_TEMPLATE_REPO", "GUTTERQUOTE_DEPLOY_KEY", "GOOGLE_MAPS_API_KEY", "PLATFORM_SESSION_SECRET"].filter(
    (key) => !process.env[key],
  )

  if (requiredSettings.length > 0) {
    return NextResponse.json(
      { error: `Deployment is not configured. Missing: ${requiredSettings.join(", ")}.` },
      { status: 503 },
    )
  }

  const suppliedKey = request.headers.get("x-gutterquote-deploy-key")
  if (suppliedKey !== process.env.GUTTERQUOTE_DEPLOY_KEY) {
    return NextResponse.json({ error: "The deployment key is incorrect." }, { status: 401 })
  }

  let body: DeployRequest
  try {
    body = (await request.json()) as DeployRequest
  } catch {
    return NextResponse.json({ error: "The deployment request was not valid JSON." }, { status: 400 })
  }

  if (!isCompanyConfig(body.config)) {
    return NextResponse.json({ error: "Complete the company configuration before deploying." }, { status: 400 })
  }

  const projectName = normalizeProjectName(body.projectName || body.config.companyName)
  if (projectName.length < 2) {
    return NextResponse.json({ error: "Enter a valid Vercel project name." }, { status: 400 })
  }

  const domain = body.domain ? normalizeDomain(body.domain) : ""
  if (domain && (!domain.includes(".") || domain.includes(" "))) {
    return NextResponse.json({ error: "Enter a valid custom domain, such as quote.example.com." }, { status: 400 })
  }

  const configValue = JSON.stringify(body.config)
  if (Buffer.byteLength(configValue, "utf8") > 56_000) {
    return NextResponse.json(
      { error: "The company configuration is too large to deploy. Use a smaller logo or reduce the number of finish colors and try again." },
      { status: 413 },
    )
  }

  const repository = normalizeRepository(process.env.VERCEL_TEMPLATE_REPO!)
  const branch = process.env.VERCEL_TEMPLATE_BRANCH || "main"

  try {
    let project = await findProject(projectName)
    let created = false

    if (!project) {
      project = await vercelRequest<VercelProject>("/v11/projects", {
        method: "POST",
        body: JSON.stringify({
          name: projectName,
          framework: "nextjs",
          gitRepository: {
            type: "github",
            repo: repository,
          },
          environmentVariables: companyEnvironment(configValue).map(({ comment: _comment, ...variable }) => variable),
        }),
      })
      created = true
    } else {
      for (const variable of companyEnvironment(configValue)) {
        await vercelRequest(`/v10/projects/${encodeURIComponent(project.id)}/env?upsert=true`, {
          method: "POST",
          body: JSON.stringify({ ...variable, target: ["production"] }),
        })
      }
    }

    const repoId = project.link?.repoId
    if (!repoId) {
      throw new VercelRequestError(
        "Vercel created the project but could not access the template repository. Install the Vercel GitHub integration for that repository and try again.",
        400,
      )
    }

    const deployment = await vercelRequest<VercelDeployment>("/v13/deployments", {
      method: "POST",
      body: JSON.stringify({
        name: projectName,
        project: project.id,
        target: "production",
        gitSource: {
          type: "github",
          repoId,
          ref: branch,
        },
        meta: {
          gutterquoteCompany: body.config.companyName,
        },
      }),
    })

    let projectDomain: VercelDomain | null = null
    if (domain) {
      projectDomain = await findDomain(project.id, domain)
      if (!projectDomain) {
        projectDomain = await vercelRequest<VercelDomain>(
          `/v10/projects/${encodeURIComponent(project.id)}/domains`,
          {
            method: "POST",
            body: JSON.stringify({ name: domain }),
          },
        )
      }
    }

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        created,
      },
      deployment: {
        id: deployment.id,
        url: `https://${deployment.url}`,
        readyState: deployment.readyState || "QUEUED",
        inspectorUrl: deployment.inspectorUrl || "",
      },
      domain: projectDomain,
      dashboardUrl: deployment.inspectorUrl || "https://vercel.com/dashboard",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vercel could not start the deployment."
    const status = error instanceof VercelRequestError && error.status < 500 ? error.status : 502
    return NextResponse.json({ error: message }, { status })
  }
}
