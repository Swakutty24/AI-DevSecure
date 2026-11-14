import { CircleAlert, CircleCheck, Download, Info, Loader2, ShieldCheck, ShieldX, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Finding } from '../api'
import { Badge, Empty, IconTile, Modal, PageHeader, ProjectPicker, SeverityBadge, Spinner, Tabs } from '../components/ui'
import { usePoll, useSelectedProject } from '../hooks'

interface SecurityData {
  run_id: number
  running: boolean
  counts: { total: number; Critical: number; High: number; Medium: number; Low: number }
  fixed: number
  findings: Finding[]
  dependencies: Finding[]
  logs: string[]
  gate: { passed?: boolean; reasons?: string[] }
}

const PAGE = 10

function FindingsTable({ rows, onView }: { rows: Finding[]; onView: (f: Finding) => void }) {
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const slice = rows.slice((page - 1) * PAGE, page * PAGE)
  return (
    <>
      <table className="w-full">
        <thead className="border-b border-slate-100">
          <tr>
            <th className="th">#</th>
            <th className="th">Severity</th>
            <th className="th">Tool</th>
            <th className="th">Issue</th>
            <th className="th">File</th>
            <th className="th">Line</th>
            <th className="th">Status</th>
            <th className="th text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {slice.map((f, i) => (
            <tr key={f.id} className={`hover:bg-slate-50/60 ${f.status === 'fixed' ? 'opacity-70' : ''}`}>
              <td className="td text-slate-400">{(page - 1) * PAGE + i + 1}</td>
              <td className="td">
                <SeverityBadge severity={f.severity} />
              </td>
              <td className="td">{f.tool}</td>
              <td className="td font-medium text-slate-800">{f.issue}</td>
              <td className="td font-mono text-[12.5px] text-slate-600">{f.file.replace(/^app\//, '')}</td>
              <td className="td font-mono text-[12.5px]">{f.line}</td>
              <td className={`td font-semibold ${f.status === 'open' ? 'text-red-600' : 'text-emerald-600'}`}>{f.status === 'open' ? 'Open' : 'Fixed'}</td>
              <td className="td text-right">
                <button onClick={() => onView(f)} className="text-sm font-semibold text-[#2f5bff]">
                  View
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="td py-10 text-center text-slate-500">
                No findings.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
        <span>
          Showing <b>{slice.length}</b> of <b>{rows.length}</b> vulnerabilities
        </span>
        <div className="flex items-center gap-1.5">
          <button className="btn-secondary px-3 py-1 text-xs" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i + 1)}
              className={`h-7 w-7 rounded-md text-xs font-semibold ${page === i + 1 ? 'bg-[#2f5bff] text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {i + 1}
            </button>
          ))}
          <button className="btn-secondary px-3 py-1 text-xs" disabled={page === pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      </div>
    </>
  )
}

export default function SecurityScan() {
  const { projects, projectId, select } = useSelectedProject()
  const [tab, setTab] = useState<'findings' | 'deps' | 'logs'>('findings')
  const [view, setView] = useState<Finding | null>(null)
  const [busy, setBusy] = useState(false)
  const { data, error } = usePoll<SecurityData>(projectId ? `/api/projects/${projectId}/security` : null, 2000)

  if (!projects.length && !projectId) return <Empty title="No projects yet" action={<Link to="/create" className="btn-primary">Create Project</Link>} />
  if (error && !data) return <Empty title="No scan results yet">Run the pipeline for this project first.</Empty>
  if (!data) return <Spinner />
  const c = data.counts

  const runScan = async () => {
    setBusy(true)
    try {
      await api.post(`/api/projects/${projectId}/security/run`)
    } finally {
      setTimeout(() => setBusy(false), 1500)
    }
  }
  const downloadReport = async () => {
    const r = await api.post<{ id: number }>('/api/reports', { report_type: 'security', fmt: 'pdf', project_id: projectId })
    window.location.href = `/api/reports/${r.id}/download`
  }

  const cards = [
    { label: 'Total Findings', value: c.total, tone: 'red' as const, icon: <TriangleAlert size={18} /> },
    { label: 'Critical', value: c.Critical, tone: 'red' as const, icon: <CircleAlert size={18} /> },
    { label: 'High', value: c.High, tone: 'orange' as const, icon: <CircleAlert size={18} /> },
    { label: 'Medium', value: c.Medium, tone: 'amber' as const, icon: <Info size={18} /> },
    { label: 'Low', value: c.Low, tone: 'blue' as const, icon: <CircleCheck size={18} /> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Security Scan Results"
        subtitle="Vulnerability detection using Bandit, Semgrep / AST rules, secret scanning and CVE dependency matching."
        actions={
          <>
            <ProjectPicker projects={projects} value={projectId} onChange={select} />
            <button className="btn-primary" onClick={runScan} disabled={busy || data.running}>
              {busy || data.running ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Run Security Scan
            </button>
            <button className="btn-secondary" onClick={downloadReport}>
              <Download size={15} /> Download Report
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map((k) => (
          <div key={k.label} className="card flex items-center gap-4 p-5">
            <IconTile tone={k.tone} size={44}>
              {k.icon}
            </IconTile>
            <div>
              <div className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{k.label}</div>
              <div className="text-2xl font-bold text-slate-900">{k.value}</div>
            </div>
          </div>
        ))}
      </div>

      {data.gate?.passed !== undefined && (
        <div className={`flex items-center gap-3 rounded-xl border px-5 py-3 text-sm ${data.gate.passed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {data.gate.passed ? <ShieldCheck size={18} /> : <ShieldX size={18} />}
          <span className="font-semibold">Release gate {data.gate.passed ? 'PASSED' : 'BLOCKED'}</span>
          <span>{data.gate.passed ? `${data.fixed} issue(s) auto-remediated by the Developer Agent.` : data.gate.reasons?.join('; ')}</span>
        </div>
      )}

      <div className="card overflow-hidden">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'findings', label: 'Vulnerability Findings' },
            { id: 'deps', label: <>Dependency Scan {data.dependencies.length > 0 && <Badge tone="slate" className="ml-1">{data.dependencies.length}</Badge>}</> },
            { id: 'logs', label: 'Scan Logs' },
          ]}
        />
        {tab === 'findings' && <FindingsTable rows={data.findings} onView={setView} />}
        {tab === 'deps' && <FindingsTable rows={data.dependencies} onView={setView} />}
        {tab === 'logs' && (
          <pre className="scrollbar-thin m-5 max-h-[500px] overflow-auto rounded-xl bg-[#0b1120] p-4 font-mono text-[12px] leading-5 whitespace-pre-wrap text-slate-300">
            {data.logs.join('\n') || '(no scan logs)'}
          </pre>
        )}
      </div>

      <Modal open={!!view} onClose={() => setView(null)} title={view?.issue ?? ''}>
        {view && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <SeverityBadge severity={view.severity} />
              <Badge tone="slate">{view.tool}</Badge>
              {view.rule_id && <Badge tone="slate">{view.rule_id}</Badge>}
              {view.cwe && <Badge tone="violet">{view.cwe}</Badge>}
              {view.owasp && <Badge tone="indigo">{view.owasp}</Badge>}
              <Badge tone={view.status === 'open' ? 'red' : 'green'}>{view.status === 'open' ? 'Open' : `Fixed (found in iteration ${view.iteration})`}</Badge>
            </div>
            <div className="font-mono text-xs text-slate-500">
              {view.file}:{view.line}
            </div>
            {view.snippet && <pre className="overflow-auto rounded-xl bg-[#0b1120] p-4 font-mono text-[12.5px] text-amber-200">{view.snippet}</pre>}
            {view.detail && <p className="text-slate-600">{view.detail}</p>}
            {view.file && !view.file.endsWith('.txt') && (
              <Link to={`/projects/${projectId}`} className="btn-secondary inline-flex">
                Open generated code
              </Link>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
