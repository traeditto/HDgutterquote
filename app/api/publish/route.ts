import { NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import type { CompanyConfig } from "@/lib/company-config"
import {
  configFingerprint,
  REQUIRED_SUCCESSFUL_ADDRESS_TESTS,
  type AddressTestRecord,
  type ApprovalSnapshot,
} from "@/lib/publish-workflow"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type PublishRequest = {
  config?: CompanyConfig
  approval?: ApprovalSnapshot | null
  addressTests?: AddressTestRecord[]
  repositoryName?: string
  repositoryPrivate?: boolean
  projectName?: string
  domain?: string
}

type GithubRepository = {
  id: number
  name: string
  full_name: string
  html_url: string
  private: boolean
  default_branch: string
}

type GithubContent = {
  sha: string
  content?: string
}

type GithubContentUpdate = {
  commit?: { sha?: string }
}

type VercelProject = {
  id: string
  name: string
  link?: { repoId?: string | number; type?: string }
}

type VercelDeployment = {
  id: string
  url: string
  readyState?: string
  inspectorUrl?: string
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

class ServiceRequestError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function normalizeSlug(value: string, maxLength = 90) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.$/, "")
}

function normalizeRepository(value: string) {
  return value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/^\//, "")
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

async function githubRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
    cache: "no-store",
  })
  const data = (await response.json().catch(() => ({}))) as T & { message?: string }
  if (!response.ok) {
    throw new ServiceRequestError(data.message || `GitHub request failed with status ${response.status}.`, response.status)
  }
  return data
}

async function findGithubRepository(fullName: string) {
  try {
    return await githubRequest<GithubRepository>(`/repos/${fullName}`)
  } catch (error) {
    if (error instanceof ServiceRequestError && error.status === 404) return null
    throw error
  }
}

async function getCompanySiteFile(fullName: string, branch: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await githubRequest<GithubContent>(`/repos/${fullName}/contents/company-site.json?ref=${encodeURIComponent(branch)}`)
    } catch (error) {
      if (!(error instanceof ServiceRequestError) || error.status !== 404 || attempt === 5) throw error
      await new Promise((resolve) => setTimeout(resolve, 700))
    }
  }
  throw new ServiceRequestError("The generated repository was not ready in time.", 502)
}

function withTeam(path: string) {
  const url = new URL(path, "https://api.vercel.com")
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID)
  return url.toString()
}

async function vercelRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(withTeam(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } }
  if (!response.ok) {
    throw new ServiceRequestError(
      data.error?.message || `Vercel request failed with status ${response.status}.`,
      response.status,
      data.error?.code,
    )
  }
  return data
}

async function findVercelProject(projectName: string) {
  try {
    return await vercelRequest<VercelProject>(`/v9/projects/${encodeURIComponent(projectName)}`)
  } catch (error) {
    if (error instanceof ServiceRequestError && error.status === 404) return null
    throw error
  }
}

async function findDomain(projectId: string, domain: string) {
  try {
    return await vercelRequest<VercelDomain>(`/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}`)
  } catch (error) {
    if (error instanceof ServiceRequestError && error.status === 404) return null
    throw error
  }
}

function productionEnvironment(tenantId: string, contractorAdminKey: string) {
  const variables: Array<{ key: string; value: string; type: "encrypted"; target: "production" }> = []
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
  variables.push(
    { key: "CONTRACTOR_TENANT_ID", value: tenantId, type: "encrypted", target: "production" },
    { key: "CONTRACTOR_ADMIN_KEY", value: contractorAdminKey, type: "encrypted", target: "production" },
  )
  return variables
}

export async function POST(request: Request) {
  const templateRepository = process.env.GITHUB_TEMPLATE_REPO || process.env.VERCEL_TEMPLATE_REPO
  const requiredSettings = [
    ["GITHUB_TOKEN", process.env.GITHUB_TOKEN],
    ["GITHUB_TEMPLATE_REPO", templateRepository],
    ["VERCEL_TOKEN", process.env.VERCEL_TOKEN],
    ["GUTTERQUOTE_DEPLOY_KEY", process.env.GUTTERQUOTE_DEPLOY_KEY],
    ["GOOGLE_MAPS_API_KEY", process.env.GOOGLE_MAPS_API_KEY],
    ["PLATFORM_SESSION_SECRET", process.env.PLATFORM_SESSION_SECRET],
  ].filter(([, value]) => !value).map(([key]) => key)

  if (requiredSettings.length > 0) {
    return NextResponse.json({ error: `Publishing is not configured. Missing: ${requiredSettings.join(", ")}.` }, { status: 503 })
  }

  if (request.headers.get("x-gutterquote-deploy-key") !== process.env.GUTTERQUOTE_DEPLOY_KEY) {
    return NextResponse.json({ error: "The publishing key is incorrect." }, { status: 401 })
  }

  let body: PublishRequest
  try {
    body = (await request.json()) as PublishRequest
  } catch {
    return NextResponse.json({ error: "The publishing request was not valid JSON." }, { status: 400 })
  }

  if (!isCompanyConfig(body.config)) {
    return NextResponse.json({ error: "Complete the company configuration before publishing." }, { status: 400 })
  }

  const tests = Array.isArray(body.addressTests) ? body.addressTests : []
  const successfulTestIds = new Set(
    tests
      .filter((test) => test.successful && test.configFingerprint === body.approval?.configFingerprint)
      .map((test) => test.id),
  )
  const approvedTestCount = body.approval?.successfulTestIds.filter((id) => successfulTestIds.has(id)).length ?? 0
  if (
    !body.approval ||
    body.approval.configFingerprint !== configFingerprint(body.config) ||
    approvedTestCount < REQUIRED_SUCCESSFUL_ADDRESS_TESTS
  ) {
    return NextResponse.json({ error: "The current configuration needs three successful address tests and contractor approval before publishing." }, { status: 400 })
  }

  const configValue = JSON.stringify(body.config)
  if (Buffer.byteLength(configValue, "utf8") > 56_000) {
    return NextResponse.json({ error: "The company configuration is too large. Use a smaller logo or fewer finish colors." }, { status: 413 })
  }

  const repositoryName = normalizeSlug(body.repositoryName || `${body.config.companyName}-instant-quote`, 100)
  const projectName = normalizeSlug(body.projectName || body.config.companyName)
  const domain = body.domain ? normalizeDomain(body.domain) : ""
  if (repositoryName.length < 2 || projectName.length < 2) {
    return NextResponse.json({ error: "Enter valid GitHub repository and Vercel project names." }, { status: 400 })
  }
  if (domain && (!domain.includes(".") || domain.includes(" "))) {
    return NextResponse.json({ error: "Enter a valid custom domain, such as quote.example.com." }, { status: 400 })
  }

  const [templateOwner, templateName, ...extra] = normalizeRepository(templateRepository!).split("/")
  if (!templateOwner || !templateName || extra.length > 0) {
    return NextResponse.json({ error: "GITHUB_TEMPLATE_REPO must use the owner/repository format." }, { status: 503 })
  }
  const targetOwner = process.env.GITHUB_OWNER || templateOwner
  const targetFullName = `${targetOwner}/${repositoryName}`
  const contractorTenantId = targetFullName.toLowerCase()
  const contractorAdminKey = randomBytes(24).toString("base64url")
  let issuedContractorAdminKey: string | null = null
  let repository: GithubRepository | null = null

  try {
    repository = await findGithubRepository(targetFullName)
    if (!repository) {
      repository = await githubRequest<GithubRepository>(`/repos/${templateOwner}/${templateName}/generate`, {
        method: "POST",
        body: JSON.stringify({
          owner: targetOwner,
          name: repositoryName,
          description: `${body.config.companyName} instant gutter quote website`,
          include_all_branches: false,
          private: body.repositoryPrivate !== false,
        }),
      })
    }

    const companySiteFile = await getCompanySiteFile(repository.full_name, repository.default_branch)
    if (companySiteFile.content) {
      const existing = JSON.parse(Buffer.from(companySiteFile.content.replace(/\n/g, ""), "base64").toString("utf8")) as {
        generated?: boolean
        approval?: ApprovalSnapshot | null
      }
      if (existing.generated && existing.approval?.configFingerprint !== body.approval.configFingerprint) {
        throw new ServiceRequestError("That repository name already belongs to a different approved company site.", 409)
      }
    }

    const generatedSite = {
      generated: true,
      approval: body.approval,
      config: body.config,
    }
    const contentUpdate = await githubRequest<GithubContentUpdate>(`/repos/${repository.full_name}/contents/company-site.json`, {
      method: "PUT",
      body: JSON.stringify({
        message: `Approve ${body.config.companyName} company site`,
        content: Buffer.from(`${JSON.stringify(generatedSite, null, 2)}\n`, "utf8").toString("base64"),
        sha: companySiteFile.sha,
        branch: repository.default_branch,
      }),
    })

    let project = await findVercelProject(projectName)
    if (project?.link?.repoId && String(project.link.repoId) !== String(repository.id)) {
      throw new ServiceRequestError("That Vercel project name is already connected to another repository.", 409)
    }
    if (!project) {
      issuedContractorAdminKey = contractorAdminKey
      project = await vercelRequest<VercelProject>("/v11/projects", {
        method: "POST",
        body: JSON.stringify({
          name: projectName,
          framework: "nextjs",
          gitRepository: { type: "github", repo: repository.full_name },
          environmentVariables: productionEnvironment(contractorTenantId, contractorAdminKey),
        }),
      })
    }

    const deployment = await vercelRequest<VercelDeployment>("/v13/deployments", {
      method: "POST",
      body: JSON.stringify({
        name: projectName,
        project: project.id,
        target: "production",
        gitSource: {
          type: "github",
          repoId: repository.id,
          ref: contentUpdate.commit?.sha || repository.default_branch,
        },
        meta: {
          gutterquoteCompany: body.config.companyName,
          gutterquoteApproval: body.approval.configFingerprint,
        },
      }),
    })

    let projectDomain: VercelDomain | null = null
    if (domain) {
      projectDomain = await findDomain(project.id, domain)
      if (!projectDomain) {
        projectDomain = await vercelRequest<VercelDomain>(`/v10/projects/${encodeURIComponent(project.id)}/domains`, {
          method: "POST",
          body: JSON.stringify({ name: domain }),
        })
      }
    }

    return NextResponse.json({
      repository: {
        name: repository.name,
        fullName: repository.full_name,
        url: repository.html_url,
        private: repository.private,
      },
      project: { id: project.id, name: project.name },
      deployment: {
        id: deployment.id,
        url: `https://${deployment.url}`,
        readyState: deployment.readyState || "QUEUED",
        inspectorUrl: deployment.inspectorUrl || "",
      },
      domain: projectDomain,
      dashboardUrl: deployment.inspectorUrl || "https://vercel.com/dashboard",
      contractorAdminKey: issuedContractorAdminKey,
      contractorDashboardUrl: `https://${domain || deployment.url}/contractor`,
    })
  } catch (error) {
    const repositoryHint = repository ? ` The GitHub repository is available at ${repository.html_url}.` : ""
    const message = `${error instanceof Error ? error.message : "The approved company site could not be published."}${repositoryHint}`
    const status = error instanceof ServiceRequestError && error.status < 500 ? error.status : 502
    return NextResponse.json({ error: message }, { status })
  }
}
