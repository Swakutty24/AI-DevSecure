import { CircleCheck, CircleX, Download, FileText, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type TestCaseRow } from '../api'
import { Badge, Empty, Modal, PageHeader, ProjectPicker, Ring, Spinner, StatCard, StatusBadge, Tabs } from '../components/ui'
import { usePoll, useSelectedProject } from '../hooks'

interface TestData {
  run_id: number
  run_status: string
  running: boolean
  summary: { total: number; passed: number; failed: number; success_rate: number; coverage: number }
  cases: TestCaseRow[]
  coverage_files: { file: string; statements: number; missing: number; percent: number }[]
  output: string
  logs: string[]
}

export default function TestResults() {
  const { projects, projectId, select } = useSelectedProject()
  const [tab, setTab] = useState<'cases' | 'coverage' | 'logs'>('cases')
  const [detail, setDetail] = useState<TestCaseRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { data, error } = usePoll<TestData>(projectId ? `/api/projects/${projectId}/tests` : null, 2000)

  if (!projects.length && !projectId) return <Empty title="No projects yet" action={<Link to="/create" className="btn-primary">Create Project</Link>} />
  if (error && !data) return <Empty title="No test results yet">Run the pipeline for this project first.</Empty>
  if (!data) return <Spinner />
  const s = data.summary

  const rerun = async () => {
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/api/projects/${projectId}/tests/run`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setTimeout(() => setBusy(false), 1500)
    }
  }

  const downloadReport = async () => {
    const r = await api.post<{ id: number }>('/api/reports', { report_type: 'testing', fmt: 'pdf', project_id: projectId })
    window.location.href = `/api/reports/${r.id}/download`
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Test Results"
        subtitle="Automated test execution results using PyTest (sandboxed) with coverage measurement."
        actions={
          <>
            <ProjectPicker projects={projects} value={projectId} onChange={select} />
            <button className="btn-primary" onClick={rerun} disabled={busy || data.running}>
              {busy || data.running ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Run Tests Again
            </button>
            <button className="btn-secondary" onClick={downloadReport} disabled={!s.total}>
              <Download size={15} /> Download Report
            </button>
          </>
        }
      />
      {err && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{err}</div>}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Tests" value={s.total} tone="blue" icon={<FileText size={19} />} />
        <StatCard label="Passed" value={s.passed} tone="green" icon={<CircleCheck size={19} />} />
        <StatCard label="Failed" value={s.failed} tone="red" icon={<CircleX size={19} />} />
        <div className="card flex items-center justify-between p-5">
          <div>
            <div className="text-[13px] font-medium text-slate-500">Success Rate</div>
            <div className="mt-2 text-[28px] leading-none font-bold text-slate-900">{s.success_rate}%</div>
            <div className="mt-2 text-xs text-slate-500">Coverage {s.coverage}%</div>
          </div>
          <Ring value={s.success_rate} color={s.success_rate === 100 ? '#10b981' : s.success_rate >= 75 ? '#10b981' : '#f59e0b'} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'cases', label: 'Test Cases' },
            { id: 'coverage', label: 'Coverage Report' },
            { id: 'logs', label: 'Execution Logs' },
          ]}
        />
        {tab === 'cases' && (
          <table className="w-full">
            <thead className="border-b border-slate-100">
              <tr>
                <th className="th">#</th>
                <th className="th">Test Name</th>
                <th className="th">Status</th>
                <th className="th">Execution Time</th>
                <th className="th text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.cases.map((c, i) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className="td text-slate-400">{i + 1}</td>
                  <td className="td font-mono text-[13px]">{c.name}</td>
                  <td className="td">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="td text-slate-500">{c.duration.toFixed(2)}s</td>
                  <td className="td text-right">
                    <button onClick={() => setDetail(c)} className="text-sm font-semibold text-[#2f5bff]">
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {data.cases.length === 0 && (
                <tr>
                  <td colSpan={5} className="td py-10 text-center text-slate-500">
                    {data.running ? 'Tests are being generated and executed...' : 'No test cases recorded.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {tab === 'coverage' && (
          <div className="p-5">
            <div className="mb-4 flex items-center gap-3 text-sm text-slate-600">
              Total coverage <span className="text-lg font-bold text-slate-900">{s.coverage}%</span>
            </div>
            <table className="w-full">
              <thead className="border-b border-slate-100">
                <tr>
                  <th className="th">File</th>
                  <th className="th">Statements</th>
                  <th className="th">Missing</th>
                  <th className="th w-1/3">Coverage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.coverage_files.map((f) => (
                  <tr key={f.file}>
                    <td className="td font-mono text-[13px]">{f.file}</td>
                    <td className="td">{f.statements}</td>
                    <td className="td">{f.missing}</td>
                    <td className="td">
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${f.percent >= 80 ? 'bg-emerald-500' : f.percent >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${f.percent}%` }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs font-semibold">{f.percent}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'logs' && (
          <pre className="scrollbar-thin m-5 max-h-[500px] overflow-auto rounded-xl bg-[#0b1120] p-4 font-mono text-[12px] leading-5 whitespace-pre-wrap text-slate-300">
            {data.logs.join('\n')}
            {'\n\n──── pytest output ────\n'}
            {data.output || '(no output)'}
          </pre>
        )}
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ''}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex gap-3">
              <StatusBadge status={detail.status} />
              <Badge tone="slate">{detail.file}</Badge>
              <Badge tone="slate">{detail.duration.toFixed(3)}s</Badge>
            </div>
            {detail.message ? (
              <pre className="max-h-96 overflow-auto rounded-xl bg-[#0b1120] p-4 font-mono text-[12px] whitespace-pre-wrap text-red-300">{detail.message}</pre>
            ) : (
              <p className="text-slate-500">Test passed without errors.</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
