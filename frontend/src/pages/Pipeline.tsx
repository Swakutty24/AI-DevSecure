import { Check, Clock, Code2, FileText, FlaskConical, Loader2, Lock, Play, RotateCcw, ShieldCheck, ShieldX, Square, Workflow, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type BusMessage, type LogLine, type Run, type Step } from '../api'
import { Badge, Empty, PageHeader, ProjectPicker, Spinner, StatusBadge } from '../components/ui'
import { useSelectedProject } from '../hooks'

const AGENT_META = {
  planner: { title: 'Planner Agent', desc: 'Analyzes requirements and creates task plan', icon: Workflow },
  developer: { title: 'Developer Agent', desc: 'Generating code and implementing features', icon: Code2 },
  tester: { title: 'Tester Agent', desc: 'Running unit & integration tests', icon: FlaskConical },
  security: { title: 'Security Agent', desc: 'Scanning for vulnerabilities and security analysis', icon: ShieldCheck },
}
const CURRENT_DESC = {
  planner: 'Breaking requirements into a structured task plan...',
  developer: 'Generating source code based on the task plan...',
  tester: 'Writing and executing automated tests in the sandbox...',
  security: 'Running Bandit, AST rules, secret and dependency scans...',
}
const LEVEL_CLS: Record<string, string> = {
  INFO: 'bg-emerald-500/15 text-emerald-400',
  WARN: 'bg-amber-500/15 text-amber-400',
  ERROR: 'bg-red-500/15 text-red-400',
}

interface PipelineState {
  run: Run
  logs: LogLine[]
  messages: BusMessage[]
}

function fmtDuration(sec?: number | null) {
  if (sec == null) return ''
  if (sec < 60) return `${Math.round(sec)}s`
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
}

function StepNode({ step, index }: { step: Step; index: number }) {
  const meta = AGENT_META[step.agent]
  const Icon = meta.icon
  const ring =
    step.status === 'completed'
      ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
      : step.status === 'running'
        ? 'bg-[#2f5bff] text-white shadow-lg shadow-blue-500/40 ring-4 ring-blue-100'
        : step.status === 'failed' || step.status === 'stopped'
          ? 'bg-red-500 text-white'
          : 'border-2 border-slate-200 bg-slate-50 text-slate-400'
  return (
    <div className="relative z-10 flex flex-1 flex-col items-center text-center">
      <div className={`grid h-14 w-14 place-items-center rounded-full ${ring}`}>
        {step.status === 'completed' ? <Check size={26} strokeWidth={2.5} /> : step.status === 'failed' ? <X size={24} /> : <Icon size={22} />}
      </div>
      <div className="mt-3 font-bold text-slate-800">
        {index + 1}. {meta.title}
      </div>
      <div className="mt-1.5">
        <StatusBadge status={step.status === 'running' ? 'in_progress' : step.status} />
      </div>
      <div className="mt-2 max-w-[190px] text-xs text-slate-500">{step.summary || meta.desc}</div>
      {step.iteration > 1 && <div className="mt-1 text-[11px] font-semibold text-violet-600">Iteration {step.iteration}</div>}
      {step.duration != null && <div className="mt-1 text-xs text-slate-400">Duration: {fmtDuration(step.duration)}</div>}
    </div>
  )
}

export default function Pipeline() {
  const { projects, projectId, project, select } = useSelectedProject()
  const [state, setState] = useState<PipelineState | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [filter, setFilter] = useState('all')
  const [notFound, setNotFound] = useState(false)
  const [now, setNow] = useState(Date.now())
  const lastLog = useRef(0)
  const runRef = useRef<number | null>(null)
  const logBox = useRef<HTMLDivElement>(null)

  useEffect(() => {
    lastLog.current = 0
    runRef.current = null
    setLogs([])
    setState(null)
    setNotFound(false)
    if (!projectId) return
    let alive = true
    const tick = async () => {
      try {
        const s = await api.get<PipelineState>(`/api/projects/${projectId}/pipeline?after_log=${lastLog.current}`)
        if (!alive) return
        if (runRef.current !== s.run.id) {
          runRef.current = s.run.id
          if (lastLog.current) {
            lastLog.current = 0
            setLogs([])
            return
          }
        }
        if (s.logs.length) {
          lastLog.current = s.logs[s.logs.length - 1].id
          setLogs((l) => [...l, ...s.logs].slice(-2000))
        }
        setState(s)
      } catch {
        if (alive) setNotFound(true)
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [projectId])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight })
  }, [logs, filter])

  if (!projects.length && !projectId) return <Empty title="No projects yet" action={<Link to="/create" className="btn-primary">Create Project</Link>} />
  if (notFound && !state) return <Empty title="No pipeline run for this project yet" />
  if (!state) return <Spinner />

  const { run, messages } = state
  const running = run.status === 'running'
  const current = run.current_agent || null
  const currentStep = run.steps.find((s) => s.agent === current)
  const elapsedFrom = currentStep?.started_at ?? run.started_at
  const elapsed = Math.max(0, Math.floor(((running ? now : new Date(run.finished_at ?? now).getTime()) - new Date(elapsedFrom).getTime()) / 1000))
  const shown = filter === 'all' ? logs : logs.filter((l) => l.agent === filter)
  const doneCount = run.steps.filter((s) => s.status === 'completed').length

  const stop = () => api.post(`/api/runs/${run.id}/stop`).catch(() => {})
  const rerun = async () => {
    await api.post(`/api/projects/${run.project_id}/run`)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Project Pipeline Execution"
        subtitle="Track the progress of each AI agent in real time."
        actions={
          <>
            <ProjectPicker projects={projects} value={projectId} onChange={select} />
            <div className="card flex items-center gap-2 px-3 py-2 text-sm font-medium">
              {project?.name}
              <Badge tone={running ? 'green' : run.status === 'completed' ? 'green' : run.status === 'failed' ? 'red' : 'amber'}>
                {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
                {running ? 'Running' : run.status.charAt(0).toUpperCase() + run.status.slice(1)}
              </Badge>
            </div>
            {running ? (
              <button className="btn-danger" onClick={stop}>
                <Square size={13} className="fill-red-500" /> Stop Execution
              </button>
            ) : (
              <button className="btn-secondary" onClick={rerun}>
                <RotateCcw size={15} /> Run Again
              </button>
            )}
          </>
        }
      />

      <div className="card px-8 py-7">
        <div className="relative flex">
          <div className="absolute top-7 right-[12.5%] left-[12.5%] h-0.5 border-t-2 border-dashed border-slate-200" />
          <div
            className="absolute top-7 left-[12.5%] h-0.5 bg-emerald-400 transition-all"
            style={{ width: `${(Math.min(doneCount, 3) / 3) * 75}%` }}
          />
          {run.steps.map((s, i) => (
            <StepNode key={s.agent} step={s} index={i} />
          ))}
        </div>
        {run.iteration > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-violet-700">
            <RotateCcw size={15} />
            {running
              ? `Feedback loop active: Security/Tester findings sent back to the Developer Agent (iteration ${run.iteration})`
              : `Feedback loop: issues found by the Tester/Security agents were fixed by the Developer Agent over ${run.iteration} iterations`}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4 text-xs font-bold tracking-wider text-slate-500 uppercase">{running ? 'Current Agent' : 'Pipeline Result'}</div>
          {running && current ? (
            <>
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-[#2f5bff]">
                  {(() => {
                    const I = AGENT_META[current].icon
                    return <I size={20} />
                  })()}
                </div>
                <div>
                  <div className="font-bold text-slate-900">{AGENT_META[current].title}</div>
                  <div className="text-sm text-slate-500">{CURRENT_DESC[current]}</div>
                </div>
              </div>
              <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-[#3b6cff] to-[#6a4cff] transition-all duration-500" style={{ width: `${run.progress}%` }} />
              </div>
              <div className="mt-1.5 text-right text-sm font-semibold text-slate-700">{run.progress}%</div>
            </>
          ) : (
            <div className="flex items-start gap-3">
              <div className={`grid h-11 w-11 place-items-center rounded-xl ${run.gate?.passed ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                {run.gate?.passed ? <ShieldCheck size={22} /> : <ShieldX size={22} />}
              </div>
              <div className="flex-1">
                <div className="font-bold text-slate-900">Policy gate {run.gate?.passed ? 'passed' : run.status === 'stopped' ? 'not evaluated' : 'blocked'}</div>
                <div className="text-sm text-slate-500">
                  {run.gate?.passed ? 'No blocking issues → reports generated and artifacts approved.' : (run.gate?.reasons ?? []).join('; ') || 'Execution stopped.'}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link to={`/projects/${run.project_id}`} className="btn-secondary py-1.5 text-xs">View code</Link>
                  <Link to={`/tests?project=${run.project_id}`} className="btn-secondary py-1.5 text-xs">Test results</Link>
                  <Link to={`/security?project=${run.project_id}`} className="btn-secondary py-1.5 text-xs">Security scan</Link>
                  <Link to="/reports" className="btn-secondary py-1.5 text-xs">Reports</Link>
                </div>
              </div>
            </div>
          )}
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[
              { icon: FileText, label: 'Files Created', value: run.files_created },
              { icon: Code2, label: 'Lines of Code', value: run.lines_of_code },
              { icon: Clock, label: running ? 'Elapsed Time' : 'Total Time', value: `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}` },
            ].map((m) => (
              <div key={m.label} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-white text-slate-500 shadow-sm">
                  <m.icon size={15} />
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">{m.label}</div>
                  <div className="font-bold text-slate-800">{m.value}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-bold tracking-wider text-slate-500 uppercase">Live Execution Logs</div>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="input w-40 py-1.5">
              <option value="all">All Agents</option>
              <option value="orchestrator">Orchestrator</option>
              <option value="planner">Planner</option>
              <option value="developer">Developer</option>
              <option value="tester">Tester</option>
              <option value="security">Security</option>
              <option value="bus">Secure Bus</option>
            </select>
          </div>
          <div ref={logBox} className="scrollbar-thin h-72 overflow-auto rounded-xl bg-[#0b1120] p-4 font-mono text-[12.5px] leading-6">
            {shown.map((l) => (
              <div key={l.id} className="flex gap-2 text-slate-300">
                <span className="shrink-0 text-slate-500">[{new Date(l.created_at).toLocaleTimeString('en-GB')}]</span>
                <span className={`h-fit shrink-0 rounded px-1.5 text-[10px] leading-5 font-bold ${LEVEL_CLS[l.level] ?? LEVEL_CLS.INFO}`}>{l.level}</span>
                <span className="shrink-0 text-slate-500">{l.agent}</span>
                <span className="break-words">{l.message}</span>
              </div>
            ))}
            {running && <span className="caret inline-block h-4 w-2 translate-y-0.5 bg-[#4f5bff]" />}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="card p-5">
          <div className="mb-3 text-xs font-bold tracking-wider text-slate-500 uppercase">Agent Execution History</div>
          {run.history.length === 0 ? (
            <div className="text-sm text-slate-500">Waiting for agents...</div>
          ) : (
            <ol className="relative space-y-3 border-l-2 border-slate-100 pl-5">
              {run.history.map((h, i) => (
                <li key={i} className="relative">
                  <span
                    className={`absolute top-1 -left-[27px] h-3 w-3 rounded-full border-2 border-white ${
                      h.status === 'completed' ? 'bg-emerald-500' : h.status === 'running' ? 'bg-blue-500' : 'bg-red-500'
                    }`}
                  />
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-slate-800">{AGENT_META[h.agent].title}</span>
                    <span className="text-xs text-slate-400">iteration {h.iteration}</span>
                    {h.status === 'running' && <Loader2 size={13} className="animate-spin text-blue-500" />}
                    {h.duration != null && <span className="ml-auto text-xs text-slate-400">{fmtDuration(h.duration)}</span>}
                  </div>
                  {h.summary && <div className="text-xs text-slate-500">{h.summary}</div>}
                </li>
              ))}
            </ol>
          )}
          {run.plan?.tasks && (
            <>
              <div className="mt-5 mb-2 text-xs font-bold tracking-wider text-slate-500 uppercase">Planner Task Breakdown</div>
              <ul className="grid gap-1.5 text-sm">
                {run.plan.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-slate-600">
                    <span className="grid h-5 w-5 place-items-center rounded bg-slate-100 text-[11px] font-bold">{t.id}</span>
                    {t.title}
                    <Badge tone="slate" className="ml-auto capitalize">{t.agent}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-1 flex items-center gap-2 text-xs font-bold tracking-wider text-slate-500 uppercase">
            <Lock size={13} /> Secure Inter-Agent Messages
          </div>
          <p className="mb-3 text-xs text-slate-500">Every message is HMAC-SHA256 signed per agent, route-checked, replay-protected and screened for prompt injection.</p>
          <div className="scrollbar-thin max-h-80 overflow-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th px-2">Route</th>
                  <th className="th px-2">Type</th>
                  <th className="th px-2">Signature</th>
                  <th className="th px-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {messages.map((m) => (
                  <tr key={m.id}>
                    <td className="px-2 py-2 text-xs text-slate-700 capitalize">
                      {m.sender} → {m.recipient}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-500">{m.type}</td>
                    <td className="px-2 py-2 font-mono text-[11px] text-slate-400">{m.note}</td>
                    <td className="px-2 py-2">{m.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="red">Rejected</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {messages.length === 0 && <div className="py-4 text-sm text-slate-500">No messages yet.</div>}
          </div>
          {!running && (
            <button className="btn-primary mt-4" onClick={rerun}>
              <Play size={14} /> Run Pipeline Again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
