import type { CompanyConfig } from "@/lib/company-config"

export const PUBLISH_WORKFLOW_STORAGE_KEY = "gutterquote-publish-workflow-v1"
export const REQUIRED_SUCCESSFUL_ADDRESS_TESTS = 3

export type AddressTestStatus = "automatic" | "manual" | "out-of-area" | "unavailable"

export type AddressTestRecord = {
  id: string
  address: string
  status: AddressTestStatus
  successful: boolean
  measurementSource?: string
  gutterLength?: number
  configFingerprint: string
  testedAt: string
}

export type ApprovalSnapshot = {
  approvedAt: string
  companyName: string
  configFingerprint: string
  successfulTestIds: string[]
}

export type PublishWorkflowState = {
  addressTests: AddressTestRecord[]
  approval: ApprovalSnapshot | null
}

export const EMPTY_PUBLISH_WORKFLOW: PublishWorkflowState = {
  addressTests: [],
  approval: null,
}

export function configFingerprint(config: CompanyConfig) {
  const input = JSON.stringify(config)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `cfg-${(hash >>> 0).toString(16).padStart(8, "0")}`
}

export function loadPublishWorkflow(): PublishWorkflowState {
  if (typeof window === "undefined") return EMPTY_PUBLISH_WORKFLOW
  try {
    const saved = window.localStorage.getItem(PUBLISH_WORKFLOW_STORAGE_KEY)
    if (!saved) return EMPTY_PUBLISH_WORKFLOW
    const parsed = JSON.parse(saved) as Partial<PublishWorkflowState>
    return {
      addressTests: Array.isArray(parsed.addressTests) ? parsed.addressTests.slice(0, 12) : [],
      approval: parsed.approval ?? null,
    }
  } catch {
    return EMPTY_PUBLISH_WORKFLOW
  }
}

export function savePublishWorkflow(state: PublishWorkflowState) {
  window.localStorage.setItem(PUBLISH_WORKFLOW_STORAGE_KEY, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent("gutterquote-workflow-updated"))
}

export function recordAddressTest(record: Omit<AddressTestRecord, "id" | "testedAt">) {
  if (typeof window === "undefined") return
  const current = loadPublishWorkflow()
  const normalizedAddress = record.address.trim().toLowerCase()
  const nextRecord: AddressTestRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    testedAt: new Date().toISOString(),
  }
  const addressTests = [
    nextRecord,
    ...current.addressTests.filter((item) => item.address.trim().toLowerCase() !== normalizedAddress),
  ].slice(0, 12)
  savePublishWorkflow({ addressTests, approval: current.approval })
}

export function successfulAddressTests(state: PublishWorkflowState, fingerprint?: string) {
  return state.addressTests.filter((test) => test.successful && (!fingerprint || test.configFingerprint === fingerprint))
}

export function isApprovalCurrent(state: PublishWorkflowState, config: CompanyConfig) {
  return state.approval?.configFingerprint === configFingerprint(config)
}
