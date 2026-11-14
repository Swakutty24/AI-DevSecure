import { Bot, Cpu, CreditCard, Eye, EyeOff, GitBranch, KeyRound, Link2, Loader2, Lock, MessageSquare, RotateCcw, Save, Settings2, Shield, ShieldCheck, TriangleAlert, Users, Wand2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api, type Settings as S } from '../api'
import { Badge, IconTile, Modal, PageHeader, Spinner, Toggle } from '../components/ui'

type TabId = 'general' | 'agents' | 'security' | 'integrations' | 'team' | 'billing'
const TABS: { id: TabId; label: string; icon: typeof Bot }[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'agents', label: 'AI Agent Config', icon: Bot },
  { id: 'security', label: 'Security & Rules', icon: Shield },
  { id: 'integrations', label: 'Integrations & API', icon: Link2 },
  { id: 'team', label: 'Team & Permissions', icon: Users },
  { id: 'billing', label: 'Billing & Usage', icon: CreditCard },
]
const MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini', 'claude-3-5-sonnet-latest', 'llama-3.1-70b-instruct']

type Settings = S & { integrations: S['integrations'] & { weekly_digest?: boolean } }

function Section({ icon, title, subtitle, badge, children }: { icon: ReactNode; title: string; subtitle?: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <div className="card p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconTile tone="blue" size={38}>{icon}</IconTile>
          <div>
            <h3 className="font-bold text-slate-900">{title}</h3>
            {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {badge}
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  )
}

function Row({ title, sub, children, icon }: { title: string; sub?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
      <div className="flex items-start gap-3">
        {icon && <span className="mt-0.5 text-[#2f5bff]">{icon}</span>}
        <div>
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          {sub && <div className="text-xs text-slate-500">{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  )
}

function ToolToggle({ title, sub, checked, onChange, disabled }: { title: string; sub: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
      <div>
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        <div className="text-[11px] text-slate-500">{sub}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input type={show ? 'text' : 'password'} className="input pr-10 font-mono" value={value} placeholder={placeholder} onFocus={(e) => value.includes('•') && e.target.select()} onChange={(e) => onChange(e.target.value)} />
      <button type="button" onClick={() => setShow(!show)} className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400">
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

export default function Settings() {
  const [tab, setTab] = useState<TabId>('agents')
  const [s, setS] = useState<Settings | null>(null)
  const [saved, setSaved] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [danger, setDanger] = useState<'purge' | 'delete' | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const load = () => api.get<Settings>('/api/settings').then((d) => { setS(d); setSaved(d) })
  useEffect(() => { load() }, [])

  if (!s) return <Spinner />
  const dirty = JSON.stringify(s) !== JSON.stringify(saved)
  const set = <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => setS({ ...s, [section]: { ...(s[section] as object), ...patch } })

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2500) }

  const save = async () => {
    setSaving(true)
    try {
      const { general, agents, security, integrations } = s
      const d = await api.put<Settings>('/api/settings', { general, agents, security, integrations })
      setS(d); setSaved(d)
      flash('Settings saved')
    } catch (e) {
      flash((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const reset = async () => {
    if (!confirm('Reset all settings to defaults?')) return
    const d = await api.post<Settings>('/api/settings/reset')
    setS(d); setSaved(d)
    flash('Defaults restored')
  }
  const runDanger = async () => {
    if (danger === 'purge') {
      const r = await api.post<{ purged: number }>('/api/settings/purge-cache')
      flash(`Purged ${r.purged} cache entries`)
    } else {
      await api.post('/api/settings/delete-workspace', { confirm: confirmText })
      flash('Workspace deleted')
    }
    setDanger(null)
    setConfirmText('')
  }

  const usage = s.usage ?? { agent_minutes: 0, quota: 10000, pipelines: 0 }
  const usagePct = Math.min(100, (usage.agent_minutes / usage.quota) * 100)
  const llm = s.integrations.llm_connected

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="flex items-center gap-2"><Badge tone="blue" className="tracking-wider uppercase">System Governance</Badge><span className="text-xs text-slate-400">v{s.environment?.version}</span></span>}
        title="Platform Settings"
        subtitle="Configure multi-agent coordination models, autonomous remediation thresholds, secure sandboxes, and repository integrations."
        actions={
          <>
            {msg && <span className="text-sm font-medium text-emerald-600">{msg}</span>}
            <button className="btn-secondary" onClick={reset}><RotateCcw size={15} /> Reset Defaults</button>
            <button className="btn-primary" onClick={save} disabled={!dirty || saving}>{saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Save Changes</button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-gradient-to-r from-[#1e2a78] via-[#2a2f8f] to-[#3b2a9a] px-6 py-4 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-white/10"><Cpu size={19} /></span>
          <div>
            <div className="font-semibold">Live Agent Allocation</div>
            <div className="text-sm text-indigo-200">4 specialized autonomous agents · {usage.pipelines} pipeline run(s) · {llm ? 'LLM connected' : 'offline template engine'}</div>
          </div>
        </div>
        <div className="flex gap-8 text-sm">
          <div>
            <div className="text-[11px] tracking-wider text-indigo-200 uppercase">Injection Guard</div>
            <div className="font-semibold text-emerald-300">● {s.security.prompt_injection_guard ? 'Enforced' : 'Disabled'}</div>
          </div>
          <div>
            <div className="text-[11px] tracking-wider text-indigo-200 uppercase">Agent Messaging</div>
            <div className="font-semibold">HMAC-SHA256 signed</div>
          </div>
        </div>
      </div>

      <div className="card flex flex-wrap gap-1 p-1.5">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${tab === t.id ? 'bg-[#2f5bff] text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Section icon={<Settings2 size={18} />} title="General" subtitle="Platform identity and pipeline behaviour.">
            <div>
              <label className="label">Platform name</label>
              <input className="input" value={s.general.platform_name} onChange={(e) => set('general', { platform_name: e.target.value })} />
            </div>
            <div>
              <label className="label">Max feedback iterations (Developer ↔ Tester/Security)</label>
              <input type="number" min={1} max={5} className="input" value={s.general.max_feedback_iterations} onChange={(e) => set('general', { max_feedback_iterations: Math.max(1, Math.min(5, Number(e.target.value))) })} />
            </div>
            <Row title="Demo: seed first draft with common flaws" sub="Offline template mode only. Lets you demonstrate detection and automatic remediation.">
              <Toggle checked={s.general.seed_vulnerable_draft} onChange={(v) => set('general', { seed_vulnerable_draft: v })} />
            </Row>
            <div>
              <label className="label">Presentation pacing (ms per agent step)</label>
              <input type="number" min={0} max={5000} step={100} className="input" value={s.general.pacing_ms} onChange={(e) => set('general', { pacing_ms: Math.max(0, Math.min(5000, Number(e.target.value))) })} />
              <p className="mt-1 text-xs text-slate-500">Slows the live pipeline view so each agent is visible during a demo. 0 = full speed.</p>
            </div>
          </Section>
          <Section icon={<ShieldCheck size={18} />} title="Input Protection" subtitle="Guards applied before requirements reach any agent.">
            <Row title="Prompt-injection guard" sub="Strips instruction overrides, role hijacks, fake delimiters and exfiltration attempts.">
              <Toggle checked={s.security.prompt_injection_guard} onChange={(v) => set('security', { prompt_injection_guard: v })} />
            </Row>
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              Environment: Semgrep {s.environment?.semgrep ? <Badge tone="green">installed</Badge> : <Badge tone="slate">not installed</Badge>} · Git {s.environment?.git ? <Badge tone="green">available</Badge> : <Badge tone="slate">missing</Badge>}
            </div>
          </Section>
        </div>
      )}

      {(tab === 'agents' || tab === 'security') && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_400px]">
          <div className="space-y-5">
            {tab === 'agents' && (
              <Section icon={<Bot size={18} />} title="AI Agent Execution Engine" subtitle="Orchestrate multi-agent interaction, reasoning depth, and concurrency." badge={<Badge tone="green" className="font-mono">Active Engine: {llm ? 'LLM-Router' : 'Template-v2'}</Badge>}>
                <div>
                  <label className="label">Planner Agent Model</label>
                  <select className="input" value={s.agents.planner_model} onChange={(e) => set('agents', { planner_model: e.target.value })}>
                    {MODELS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">Generates task breakdowns, data model and schema topology.</p>
                </div>
                <div>
                  <label className="label">Developer Agent Model</label>
                  <select className="input" value={s.agents.developer_model} onChange={(e) => set('agents', { developer_model: e.target.value })}>
                    {MODELS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">Responsible for implementation and refactoring based on Tester/Security feedback.</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">Max Autonomous Concurrency</div>
                      <div className="text-xs text-slate-500">Maximum parallel pipelines (applies after restart)</div>
                    </div>
                    <Badge tone="blue">{s.agents.max_concurrency} Active Pipelines</Badge>
                  </div>
                  <input type="range" min={1} max={12} value={s.agents.max_concurrency} onChange={(e) => set('agents', { max_concurrency: Number(e.target.value) })} className="mt-4 w-full accent-[#2f5bff]" />
                  <div className="flex justify-between text-[11px] text-slate-400"><span>1 (Sequential)</span><span>4 (Recommended)</span><span>12 (Cluster Tier)</span></div>
                </div>
                <Row icon={<Wand2 size={18} />} title="Auto-Fix Vulnerabilities" sub="Automatically prompts the Developer Agent to patch Critical/High/Medium issues and failing tests.">
                  <Toggle checked={s.agents.auto_fix_vulnerabilities} onChange={(v) => set('agents', { auto_fix_vulnerabilities: v })} />
                </Row>
              </Section>
            )}

            <Section icon={<Shield size={18} />} title="Security Agent Rules Engine" subtitle="Choose which analyzers the Security Agent runs.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <ToolToggle title="Bandit Python" sub="AST security linter" checked={s.security.bandit_enabled} onChange={(v) => set('security', { bandit_enabled: v })} />
                <ToolToggle title="Semgrep SAST" sub={s.environment?.semgrep ? 'Pattern rules' : 'Not installed - AST rules used'} checked={s.security.semgrep_enabled} onChange={(v) => set('security', { semgrep_enabled: v })} />
                <ToolToggle title="Secret Scanner" sub="TruffleHog-style + entropy" checked={s.security.secrets_scan_enabled} onChange={(v) => set('security', { secrets_scan_enabled: v })} />
                <ToolToggle title="Dependency CVE Scan" sub="Pinned package advisories" checked={s.security.dependency_scan_enabled} onChange={(v) => set('security', { dependency_scan_enabled: v })} />
              </div>
            </Section>

            <Section icon={<Lock size={18} />} title="Security Policy & Gates" subtitle="Enforce compliance gates before releasing or merging artifacts.">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-red-100 bg-red-50/50 p-4">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[#2f5bff]" checked={s.security.block_on_critical_high} onChange={(e) => set('security', { block_on_critical_high: e.target.checked })} />
                <span>
                  <span className="block text-sm font-semibold">Block release if Critical or High vulnerabilities are detected</span>
                  <span className="block text-xs text-slate-500">The policy gate fails and the project is marked Failed until the Security Agent reports a pass.</span>
                </span>
              </label>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Minimum Test Coverage Requirement</label>
                  <div className="relative">
                    <input type="number" min={0} max={100} className="input pr-8" value={s.security.min_test_coverage} onChange={(e) => set('security', { min_test_coverage: Math.max(0, Math.min(100, Number(e.target.value))) })} />
                    <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-slate-400">%</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Enforced via pytest-cov.</p>
                </div>
                <div>
                  <label className="label">Code Execution Sandbox</label>
                  <select className="input" value={s.security.sandbox} onChange={(e) => set('security', { sandbox: e.target.value })}>
                    <option value="subprocess">Isolated subprocess (scrubbed env + rlimits)</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500">No shell, no secrets in env, CPU/file/time limits.</p>
                </div>
              </div>
            </Section>
          </div>

          <div className="space-y-5">
            <IntegrationsCard s={s} set={set} />
            <DangerZone onPurge={() => setDanger('purge')} onDelete={() => setDanger('delete')} />
            <QuotaCard usage={usage} pct={usagePct} />
          </div>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Section icon={<Bot size={18} />} title="LLM Provider" subtitle="Any OpenAI-compatible endpoint. Leave the key empty to use the offline template engine." badge={llm ? <Badge tone="green">● Connected</Badge> : <Badge tone="slate">Offline</Badge>}>
            <div>
              <label className="label">Base URL</label>
              <input className="input font-mono" value={s.integrations.llm_base_url} onChange={(e) => set('integrations', { llm_base_url: e.target.value })} />
            </div>
            <div>
              <label className="label">API Key</label>
              <SecretInput value={s.integrations.llm_api_key} onChange={(v) => set('integrations', { llm_api_key: v })} placeholder="sk-..." />
              <p className="mt-1 text-xs text-slate-500">Stored server-side, masked in the UI and never passed to sandboxed code.</p>
            </div>
          </Section>
          <IntegrationsCard s={s} set={set} />
        </div>
      )}

      {tab === 'team' && (
        <Section icon={<Users size={18} />} title="Team & Permissions" subtitle="This deployment runs in single-administrator mode.">
          <table className="w-full">
            <thead className="border-b border-slate-100"><tr><th className="th">Member</th><th className="th">Role</th><th className="th">Access</th></tr></thead>
            <tbody>
              <tr><td className="td font-semibold">Admin</td><td className="td"><Badge tone="indigo">Administrator</Badge></td><td className="td">Full access: projects, pipelines, reports, settings</td></tr>
              {(['Planner', 'Developer', 'Tester', 'Security'] as const).map((a) => (
                <tr key={a}><td className="td">{a} Agent</td><td className="td"><Badge tone="slate">Service identity</Badge></td><td className="td text-slate-500">Own HMAC key · allow-listed message routes only</td></tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {tab === 'billing' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <QuotaCard usage={usage} pct={usagePct} />
          <Section icon={<CreditCard size={18} />} title="Plan" subtitle="Self-hosted academic edition.">
            <div className="text-sm text-slate-600">Unlimited projects · local execution · no external billing. LLM usage (if configured) is billed by your provider.</div>
          </Section>
        </div>
      )}

      <Modal open={!!danger} onClose={() => setDanger(null)} title={danger === 'purge' ? 'Purge Project Cache' : 'Delete Workspace'}>
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            {danger === 'purge'
              ? 'Removes __pycache__, coverage data and test artifacts from all project workspaces. Source code and reports are kept.'
              : 'Permanently deletes ALL projects, generated code, pipeline history, findings and reports. Type DELETE to confirm.'}
          </p>
          {danger === 'delete' && <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setDanger(null)}>Cancel</button>
            <button className="btn-danger" disabled={danger === 'delete' && confirmText !== 'DELETE'} onClick={runDanger}>{danger === 'purge' ? 'Purge Cache' : 'Delete Workspace'}</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function IntegrationsCard({ s, set }: { s: Settings; set: <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => void }) {
  return (
    <Section icon={<KeyRound size={18} />} title="API Keys & Integrations" subtitle="Manage external tokens, webhooks, and chatops alerts.">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-sm font-semibold text-slate-700">Repository Provider Token</label>
          {s.integrations.github_connected ? <Badge tone="green">● Connected</Badge> : <Badge tone="slate">Not set</Badge>}
        </div>
        <SecretInput value={s.integrations.github_token} onChange={(v) => set('integrations', { github_token: v })} placeholder="ghp_..." />
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><GitBranch size={12} /> Each workspace is a local git repo; the Developer Agent commits every iteration.</p>
      </div>
      <div>
        <label className="label">CI/CD / Alert Webhook URL</label>
        <input className="input font-mono" value={s.integrations.webhook_url} placeholder="https://hooks.slack.com/services/..." onChange={(e) => set('integrations', { webhook_url: e.target.value })} />
        <p className="mt-1 text-xs text-slate-500">Receives critical-finding alerts and the weekly digest.</p>
      </div>
      <Row icon={<MessageSquare size={18} />} title="ChatOps Critical Alerting" sub="Push immediate Slack / Discord pings on Critical security findings.">
        <Toggle checked={s.integrations.chatops_alerts} onChange={(v) => set('integrations', { chatops_alerts: v })} />
      </Row>
    </Section>
  )
}

function DangerZone({ onPurge, onDelete }: { onPurge: () => void; onDelete: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50/40 p-6">
      <div className="flex items-start gap-3">
        <TriangleAlert size={18} className="mt-0.5 text-red-500" />
        <div>
          <h3 className="font-bold text-red-700">Danger Zone</h3>
          <p className="text-sm text-red-600/80">Irreversible modifications to local workspaces and data.</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-white p-4">
          <div>
            <div className="text-sm font-semibold">Purge Project Cache</div>
            <div className="text-xs text-slate-500">Flushes bytecode caches, coverage data and test artifacts.</div>
          </div>
          <button className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100" onClick={onPurge}>Purge Cache</button>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-white p-4">
          <div>
            <div className="text-sm font-semibold text-red-700">Delete Workspace</div>
            <div className="text-xs text-slate-500">Permanently removes projects, pipelines, findings and reports.</div>
          </div>
          <button className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-100" onClick={onDelete}>Delete Workspace</button>
        </div>
      </div>
    </div>
  )
}

function QuotaCard({ usage, pct }: { usage: { agent_minutes: number; quota: number; pipelines: number }; pct: number }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-900">Agent Quota Consumption</span>
        <span className="text-sm font-semibold text-[#2f5bff]">{pct.toFixed(pct < 1 ? 2 : 0)}% Monthly</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-gradient-to-r from-[#3b6cff] to-[#6a4cff]" style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>{usage.agent_minutes.toLocaleString()} / {usage.quota.toLocaleString()} Agent Minutes used</span>
        <span>{usage.pipelines} runs</span>
      </div>
    </div>
  )
}
