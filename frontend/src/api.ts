export type AgentName = 'planner' | 'developer' | 'tester' | 'security'

export interface ProjectSummary {
  id: number
  name: string
  language: string
  project_type: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'stopped'
  created_at: string
  latest_run_id: number | null
  open_findings: number
  tests_passed: number
  tests_total: number
  coverage: number
}

export interface Step {
  agent: AgentName
  iteration: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  summary?: string
  started_at?: string | null
  finished_at?: string | null
  duration?: number | null
}

export interface Gate {
  passed?: boolean
  reasons?: string[]
  min_coverage?: number
}

export interface Run {
  id: number
  project_id: number
  status: 'running' | 'completed' | 'failed' | 'stopped'
  current_agent: AgentName | ''
  progress: number
  iteration: number
  files_created: number
  lines_of_code: number
  coverage: number
  gate: Gate
  plan: { tasks?: { id: number; title: string; agent: string }[]; fields?: { name: string; kind: string }[]; class_name?: string }
  started_at: string
  finished_at: string | null
  steps: Step[]
  history: Step[]
}

export interface LogLine {
  id: number
  agent: string
  level: string
  message: string
  created_at: string
}

export interface BusMessage {
  id: string
  sender: string
  recipient: string
  type: string
  verified: boolean
  note: string
  created_at: string
}

export interface Finding {
  id: number
  severity: 'Critical' | 'High' | 'Medium' | 'Low'
  tool: string
  rule_id: string
  issue: string
  detail: string
  cwe: string
  owasp: string
  file: string
  line: number
  snippet: string
  status: 'open' | 'fixed'
  category: string
  iteration: number
}

export interface TestCaseRow {
  id: number
  name: string
  file: string
  status: 'passed' | 'failed' | 'skipped'
  duration: number
  message: string
}

export interface ReportRow {
  id: number
  name: string
  report_type: 'security' | 'testing' | 'pipeline' | 'executive'
  fmt: 'pdf' | 'csv' | 'json'
  generated_by: string
  project: string
  project_id: number | null
  size_bytes: number
  sha256: string
  status: string
  created_at: string
}

export interface Activity {
  id: number
  kind: 'success' | 'warning' | 'code' | 'info' | 'error'
  message: string
  project_id: number | null
  created_at: string
}

export interface Settings {
  general: { platform_name: string; max_feedback_iterations: number; seed_vulnerable_draft: boolean; pacing_ms: number }
  agents: { planner_model: string; developer_model: string; max_concurrency: number; auto_fix_vulnerabilities: boolean }
  security: {
    bandit_enabled: boolean
    semgrep_enabled: boolean
    secrets_scan_enabled: boolean
    dependency_scan_enabled: boolean
    block_on_critical_high: boolean
    min_test_coverage: number
    sandbox: string
    prompt_injection_guard: boolean
  }
  integrations: {
    llm_base_url: string
    llm_api_key: string
    github_token: string
    webhook_url: string
    chatops_alerts: boolean
    llm_connected?: boolean
    github_connected?: boolean
  }
  usage?: { agent_minutes: number; quota: number; pipelines: number }
  environment?: { semgrep: boolean; git: boolean; version: string }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hour${diff >= 7200 ? 's' : ''} ago`
  return `${Math.floor(diff / 86400)} day${diff >= 172800 ? 's' : ''} ago`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
