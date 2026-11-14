import { Activity as ActivityIcon, CalendarClock, CheckCircle2, Code2, Download, FileText, Gauge, Plus, Search, ShieldCheck, TriangleAlert, Zap } from 'lucide-react'
import { useState } from 'react'
import { api, formatBytes, formatDate, timeAgo, type Activity, type ProjectSummary, type ReportRow, type Settings } from '../api'
import { Badge, Modal, PageHeader, PillTabs, Spinner, Toggle, type Tone } from '../components/ui'
import { usePoll } from '../hooks'

interface ReportsData {
  kpis: {
    total_reports: number
    reports_this_month: number
    projects: number
    compliance_score: number
    open_critical: number
    test_pass_rate: number
    tests_total: number
    resolved_vulnerabilities: number
  }
  compliance: { name: string; score: number; left: string; right: string }[]
  reports: ReportRow[]
  exports: ReportRow[]
}

type TabId = 'all' | 'security' | 'testing' | 'pipeline' | 'audit'

const TYPE_META: Record<string, { label: string; tone: Tone; icon: typeof FileText; iconCls: string }> = {
  security: { label: 'Security Audit', tone: 'red', icon: ShieldCheck, iconCls: 'bg-red-50 text-red-500' },
  testing: { label: 'Test Coverage', tone: 'cyan', icon: FileText, iconCls: 'bg-cyan-50 text-cyan-600' },
  pipeline: { label: 'Agent Velocity', tone: 'violet', icon: ActivityIcon, iconCls: 'bg-violet-50 text-violet-600' },
  executive: { label: 'Executive', tone: 'blue', icon: Code2, iconCls: 'bg-blue-50 text-blue-600' },
}
const AGENT_AVATAR: Record<string, string> = { 'Security Agent': 'SA', 'Tester Agent': 'TA', 'System Admin': 'SA', Admin: 'AD', 'Automated Cron': 'AC' }
const BAR_COLORS = ['bg-blue-600', 'bg-indigo-500', 'bg-emerald-500', 'bg-amber-500']
const FMT_CLS: Record<string, string> = { pdf: 'bg-red-50 text-red-600', csv: 'bg-emerald-50 text-emerald-600', json: 'bg-violet-50 text-violet-600' }

export default function Reports() {
  const [tab, setTab] = useState<TabId>('all')
  const [days, setDays] = useState(30)
  const [projectFilter, setProjectFilter] = useState('')
  const [fmtFilter, setFmtFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<'custom' | 'schedule' | null>(null)
  const [custom, setCustom] = useState({ report_type: 'executive', fmt: 'pdf', project_id: '' })
  const [busy, setBusy] = useState(false)

  const qs = new URLSearchParams({ days: String(days), report_type: tab === 'audit' ? 'all' : tab, fmt: fmtFilter, ...(projectFilter ? { project_id: projectFilter } : {}) })
  const { data, reload } = usePoll<ReportsData>(`/api/reports?${qs}`, 5000)
  const { data: projects } = usePoll<ProjectSummary[]>('/api/projects')
  const { data: activity } = usePoll<Activity[]>(tab === 'audit' ? '/api/activity?limit=100' : null)
  const { data: settings, reload: reloadSettings } = usePoll<Settings & { integrations: { weekly_digest?: boolean } }>('/api/settings')

  if (!data) return <Spinner />
  const k = data.kpis
  const rows = data.reports.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()))
  const PAGE = 8
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const slice = rows.slice((page - 1) * PAGE, page * PAGE)

  const generate = async (body: { report_type: string; fmt: string; project_id?: number | null }) => {
    setBusy(true)
    try {
      const r = await api.post<ReportRow>('/api/reports', body)
      reload()
      return r
    } finally {
      setBusy(false)
    }
  }

  const exportPdf = async () => {
    const r = await generate({ report_type: 'executive', fmt: 'pdf' })
    window.location.href = `/api/reports/${r.id}/download`
  }

  const toggleDigest = async (v: boolean) => {
    await api.put('/api/settings', { integrations: { weekly_digest: v } })
    reloadSettings()
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2 text-xs font-bold tracking-wider text-[#2f5bff]">
            <span className="h-2 w-2 rounded-full bg-[#2f5bff]" /> CONTINUOUS SECURITY & COMPLIANCE HUB
          </span>
        }
        title="Reports & Analytics"
        subtitle="Comprehensive audit reports, test execution summaries, security compliance, and autonomous agent performance logs."
        actions={
          <>
            <button className="btn-secondary" onClick={exportPdf} disabled={busy}>
              <Download size={15} /> Export PDF
            </button>
            <button className="btn-secondary" onClick={() => setModal('schedule')}>
              <CalendarClock size={15} /> Schedule Report
            </button>
            <button className="btn-primary" onClick={() => setModal('custom')}>
              <Plus size={15} /> Generate Custom Report
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-5">
          <div className="flex justify-between">
            <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Total Reports</span>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-600"><FileText size={17} /></span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-3xl font-bold">{k.total_reports}</span>
            <Badge tone="green">↑ +{k.reports_this_month} this month</Badge>
          </div>
          <div className="mt-2 text-xs text-slate-500">Archived across {k.projects} project(s)</div>
        </div>
        <div className="card p-5">
          <div className="flex justify-between">
            <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Compliance Score</span>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><ShieldCheck size={17} /></span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-3xl font-bold">{k.compliance_score}%</span>
            <Badge tone={k.compliance_score >= 90 ? 'green' : 'amber'}>OWASP / CWE mapped</Badge>
          </div>
          <div className="mt-2 text-xs text-slate-500">{k.open_critical === 0 ? 'Zero critical CVEs outstanding' : `${k.open_critical} critical issue(s) open`}</div>
        </div>
        <div className="card p-5">
          <div className="flex justify-between">
            <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Avg Test Pass Rate</span>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><Zap size={17} /></span>
          </div>
          <div className="mt-2 text-3xl font-bold">{k.test_pass_rate}%</div>
          <div className="mt-2 text-xs text-slate-500">{k.tests_total} automated tests in latest runs</div>
        </div>
        <div className="card p-5">
          <div className="flex justify-between">
            <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Resolved Vulnerabilities</span>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-50 text-amber-600"><TriangleAlert size={17} /></span>
          </div>
          <div className="mt-2 text-3xl font-bold">{k.resolved_vulnerabilities}</div>
          <div className="mt-2 text-xs text-slate-500">Autonomous self-heal patches applied</div>
        </div>
      </div>

      <PillTabs
        value={tab}
        onChange={(t) => { setTab(t); setPage(1) }}
        tabs={[
          { id: 'all', label: 'Executive Summary' },
          { id: 'security', label: 'Security Audits' },
          { id: 'testing', label: 'Test & Quality Reports' },
          { id: 'pipeline', label: 'Agent Performance' },
          { id: 'audit', label: 'Audit Logs' },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <div className="card overflow-hidden">
          {tab === 'audit' ? (
            <div className="p-5">
              <h3 className="mb-3 font-bold">Platform Audit Trail</h3>
              <table className="w-full">
                <thead className="border-b border-slate-100">
                  <tr>
                    <th className="th">Event</th>
                    <th className="th">Type</th>
                    <th className="th">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(activity ?? []).map((a) => (
                    <tr key={a.id}>
                      <td className="td">{a.message}</td>
                      <td className="td"><Badge tone={a.kind === 'success' ? 'green' : a.kind === 'warning' || a.kind === 'error' ? 'red' : 'blue'}>{a.kind}</Badge></td>
                      <td className="td text-slate-500">{timeAgo(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
                <div className="relative">
                  <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
                  <input className="input w-48 pl-9" placeholder="Search reports" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <select className="input w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  <option value={1}>Last 24 Hours</option>
                  <option value={7}>Last 7 Days</option>
                  <option value={30}>Last 30 Days</option>
                  <option value={365}>Last Year</option>
                </select>
                <select className="input w-52" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                  <option value="">All Projects</option>
                  {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="input w-36" value={fmtFilter} onChange={(e) => setFmtFilter(e.target.value)}>
                  <option value="all">All Formats</option>
                  <option value="pdf">PDF</option>
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-100 bg-slate-50/60">
                  <tr>
                    <th className="th min-w-[220px]">Report Name</th>
                    <th className="th">Type</th>
                    <th className="th">Project</th>
                    <th className="th hidden 2xl:table-cell">Generated By</th>
                    <th className="th">Date</th>
                    <th className="th">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {slice.map((r) => {
                    const meta = TYPE_META[r.report_type]
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/60">
                        <td className="td">
                          <div className="flex items-start gap-3">
                            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${meta.iconCls}`}><meta.icon size={16} /></span>
                            <div>
                              <div className="font-semibold text-slate-800" title={r.name}>{r.name.replace(` - ${r.project}`, '')}</div>
                              <div className="text-xs text-slate-400">
                                {r.fmt.toUpperCase()} • {formatBytes(r.size_bytes)} • <span title={r.sha256}>SHA-256 {r.sha256.slice(0, 8)}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="td"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                        <td className="td">{r.project}</td>
                        <td className="td hidden 2xl:table-cell">
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            <span className="grid h-6 w-6 place-items-center rounded-full bg-[#1e3a8a] text-[9px] font-bold text-white">{AGENT_AVATAR[r.generated_by] ?? 'AG'}</span>
                            {r.generated_by}
                          </span>
                        </td>
                        <td className="td whitespace-nowrap text-slate-500">{formatDate(r.created_at)}</td>
                        <td className="td">
                          <a href={`/api/reports/${r.id}/download`} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ready <Download size={12} />
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                  {slice.length === 0 && (
                    <tr><td colSpan={6} className="td py-10 text-center text-slate-500">No reports in this view yet. Reports are generated automatically at the end of each pipeline.</td></tr>
                  )}
                </tbody>
              </table>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
                <span>Showing <b>{slice.length ? (page - 1) * PAGE + 1 : 0}</b> to <b>{(page - 1) * PAGE + slice.length}</b> of <b>{rows.length}</b> reports</span>
                <div className="flex items-center gap-1.5">
                  <button className="btn-secondary px-3 py-1 text-xs" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
                  {Array.from({ length: Math.min(pages, 5) }, (_, i) => (
                    <button key={i} onClick={() => setPage(i + 1)} className={`h-7 w-7 rounded-md text-xs font-semibold ${page === i + 1 ? 'bg-[#2f5bff] text-white' : 'hover:bg-slate-100'}`}>{i + 1}</button>
                  ))}
                  <button className="btn-secondary px-3 py-1 text-xs" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="space-y-5">
          <div className="card p-5">
            <div className="flex items-start justify-between">
              <h3 className="font-bold text-slate-900">Compliance Standards Overview</h3>
              <Badge tone={k.compliance_score >= 90 ? 'green' : 'amber'}>{k.compliance_score >= 90 ? 'AUDIT PASS' : 'REVIEW'}</Badge>
            </div>
            <p className="mt-1 mb-4 text-xs text-slate-500">Aggregated readiness across the latest pipeline run of every project.</p>
            <div className="space-y-4">
              {data.compliance.map((c, i) => (
                <div key={c.name}>
                  <div className="flex justify-between text-sm font-semibold"><span>{c.name}</span><span>{c.score}%</span></div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${BAR_COLORS[i % 4]}`} style={{ width: `${c.score}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-slate-400"><span>{c.left}</span><span>{c.right}</span></div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
              <span className="flex items-center gap-1.5 text-slate-500"><CheckCircle2 size={14} className="text-emerald-500" /> Re-evaluated on every pipeline run</span>
              <button onClick={() => setTab('audit')} className="font-semibold text-[#2f5bff]">Audit Logs →</button>
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-bold text-slate-900">Recent Export History</h3>
            <p className="mt-1 mb-3 text-xs text-slate-500">Download links stay available until the workspace is deleted.</p>
            <ul className="space-y-2">
              {data.exports.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-slate-50">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[10px] font-bold ${FMT_CLS[r.fmt]}`}>{r.fmt.toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-700">{r.name}</div>
                    <div className="text-[11px] text-slate-400">{timeAgo(r.created_at)} • by {r.generated_by}</div>
                  </div>
                  <a href={`/api/reports/${r.id}/download`} className="text-slate-400 hover:text-[#2f5bff]"><Download size={15} /></a>
                </li>
              ))}
              {data.exports.length === 0 && <li className="text-sm text-slate-500">No exports yet.</li>}
            </ul>
          </div>

          <div className="rounded-xl bg-gradient-to-br from-[#0b1222] to-[#111b36] p-5 text-white">
            <Badge tone="blue" className="border-blue-400/30 bg-blue-500/20 text-blue-200">{settings?.integrations.weekly_digest ? 'Agent Dispatch Active' : 'Digest Disabled'}</Badge>
            <h3 className="mt-3 text-lg font-bold">Automated Weekly Digest</h3>
            <p className="mt-2 text-sm text-slate-300">Every Monday at 08:00 UTC the orchestrator produces a consolidated executive summary and dispatches it to the configured webhook.</p>
            <button className="btn-primary mt-4" onClick={() => setModal('schedule')}>Configure Webhooks</button>
          </div>
        </div>
      </div>

      <Modal open={modal === 'custom'} onClose={() => setModal(null)} title="Generate Custom Report">
        <div className="space-y-4">
          <div>
            <label className="label">Report type</label>
            <select className="input" value={custom.report_type} onChange={(e) => setCustom({ ...custom, report_type: e.target.value })}>
              <option value="executive">Executive Summary</option>
              <option value="security">Security Audit</option>
              <option value="testing">Test Coverage</option>
              <option value="pipeline">Agent Performance</option>
            </select>
          </div>
          <div>
            <label className="label">Scope</label>
            <select className="input" value={custom.project_id} onChange={(e) => setCustom({ ...custom, project_id: e.target.value })}>
              <option value="">All Projects</option>
              {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Format</label>
            <div className="flex gap-2">
              {['pdf', 'csv', 'json'].map((f) => (
                <button key={f} onClick={() => setCustom({ ...custom, fmt: f })} className={`rounded-lg border px-4 py-2 text-sm font-semibold uppercase ${custom.fmt === f ? 'border-[#2f5bff] bg-blue-50 text-[#2f5bff]' : 'border-slate-200 text-slate-600'}`}>{f}</button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={async () => {
                const r = await generate({ report_type: custom.report_type, fmt: custom.fmt, project_id: custom.project_id ? Number(custom.project_id) : null })
                setModal(null)
                window.location.href = `/api/reports/${r.id}/download`
              }}
            >
              <Gauge size={15} /> Generate
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'schedule'} onClose={() => setModal(null)} title="Schedule Weekly Digest">
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
            <div>
              <div className="font-semibold">Weekly executive digest</div>
              <div className="text-xs text-slate-500">Mondays 08:00 UTC · PDF executive summary of all projects</div>
            </div>
            <Toggle checked={!!settings?.integrations.weekly_digest} onChange={toggleDigest} />
          </div>
          <p className="text-slate-500">
            Webhook target: <span className="font-mono">{settings?.integrations.webhook_url || 'not configured'}</span>. Configure the URL in Settings → Integrations & API.
          </p>
          <button
            className="btn-secondary"
            onClick={async () => {
              await api.post('/api/reports/digest/run')
              reload()
              setModal(null)
            }}
          >
            Send digest now
          </button>
        </div>
      </Modal>
    </div>
  )
}
