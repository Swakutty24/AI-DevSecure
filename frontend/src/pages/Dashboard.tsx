import { ArrowDown, ArrowRight, ArrowUp, Check, Code2, FileText, FlaskConical, Loader, Monitor, Plus, ShieldAlert, ShieldCheck, X, Info } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { formatDate, timeAgo, type Activity, type ProjectSummary } from '../api'
import { Donut, Spinner, StatCard, StatusBadge } from '../components/ui'
import { usePoll } from '../hooks'

interface DashboardData {
  stats: { total: number; completed: number; in_progress: number; failed: number; running_pipelines: number }
  recent_projects: ProjectSummary[]
  task_distribution: Record<'planner' | 'developer' | 'tester' | 'security', number>
  activity: Activity[]
}

const AGENT_COLORS = { planner: '#3b82f6', developer: '#10b981', tester: '#f59e0b', security: '#ef4444' }
const TYPE_LABEL: Record<string, string> = { web: 'Web App', service: 'API Service', desktop: 'Desktop App', library: 'Library' }

const ACTIVITY_ICON = {
  success: { icon: Check, cls: 'bg-emerald-50 text-emerald-600' },
  warning: { icon: ShieldAlert, cls: 'bg-red-50 text-red-500' },
  code: { icon: Code2, cls: 'bg-violet-50 text-violet-600' },
  info: { icon: Plus, cls: 'bg-blue-50 text-blue-600' },
  error: { icon: X, cls: 'bg-red-50 text-red-500' },
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'GOOD MORNING' : h < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING'
}

function Trend({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0
  const tone = pct > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-slate-500 bg-slate-100'
  const Icon = pct > 0 ? ArrowUp : ArrowRight
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
      <Icon size={11} /> {pct}%
    </span>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { data } = usePoll<DashboardData>('/api/dashboard', 4000)
  if (!data) return <Spinner />
  const { stats, task_distribution: dist } = data
  const totalTasks = Object.values(dist).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-6">
      <section className="card relative overflow-hidden bg-gradient-to-r from-[#eef3ff] via-[#f3f6ff] to-[#eef2ff] p-8">
        <div className="relative z-10 max-w-xl">
          <div className="mb-3 text-xs font-bold tracking-wider text-[#2f5bff]">{greeting()}, ADMIN 👋</div>
          <h1 className="text-[34px] leading-tight font-extrabold text-slate-900">Build Secure Software with AI Agents</h1>
          <p className="mt-3 text-slate-500">Plan, generate, test and secure your software automatically.</p>
          <button className="btn-primary mt-6 px-5 py-2.5" onClick={() => navigate('/create')}>
            <Plus size={16} /> New Project
          </button>
        </div>
        <div className="absolute top-1/2 right-10 hidden -translate-y-1/2 items-end gap-3 lg:flex">
          {[
            { icon: FileText, label: 'DOC', color: 'text-blue-500' },
            { icon: Code2, label: 'CODE', color: 'text-violet-500' },
          ].map((t) => (
            <div key={t.label} className="flex h-24 w-20 flex-col items-center justify-center gap-2 rounded-2xl border border-white bg-white/80 shadow-lg">
              <t.icon className={t.color} size={22} />
              <span className="text-[10px] font-bold text-slate-500">{t.label}</span>
            </div>
          ))}
          <div className="relative flex h-36 w-32 flex-col items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[#3b6cff] to-[#4f2fd8] text-white shadow-2xl shadow-indigo-500/40">
            <span className="absolute -top-3 rounded-full bg-emerald-400 px-2.5 py-0.5 text-[10px] font-bold text-emerald-950">AGENT</span>
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-white/15">
              <Monitor size={24} />
            </div>
            <span className="text-[11px] font-bold">CORE AI</span>
          </div>
          {[
            { icon: FlaskConical, label: 'TEST', color: 'text-emerald-500' },
            { icon: ShieldCheck, label: 'SECURE', color: 'text-amber-500' },
          ].map((t) => (
            <div key={t.label} className="flex h-24 w-20 flex-col items-center justify-center gap-2 rounded-2xl border border-white bg-white/80 shadow-lg">
              <t.icon className={t.color} size={22} />
              <span className="text-[10px] font-bold text-slate-500">{t.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Projects" value={stats.total} tone="blue" icon={<FileText size={19} />} footer={<span>{stats.running_pipelines} pipeline(s) running</span>} />
        <StatCard label="Completed" value={stats.completed} tone="green" icon={<Check size={19} />} footer={<Trend value={stats.completed} total={stats.total} />} />
        <StatCard label="In Progress" value={stats.in_progress} tone="indigo" icon={<Loader size={19} />} footer={<Trend value={stats.in_progress} total={stats.total} />} />
        <StatCard
          label="Failed"
          value={stats.failed}
          tone="red"
          icon={<X size={19} />}
          footer={
            <span className="inline-flex items-center gap-0.5 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-600">
              <ArrowDown size={11} /> {stats.total ? Math.round((stats.failed / stats.total) * 100) : 0}%
            </span>
          }
        />
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="card xl:col-span-2">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="font-bold text-slate-900">Recent Projects</h2>
            <Link to="/projects" className="text-sm font-semibold text-[#2f5bff]">
              See all
            </Link>
          </div>
          {data.recent_projects.length === 0 ? (
            <div className="px-5 pb-10 text-center text-sm text-slate-500">
              No projects yet. <Link to="/create" className="font-semibold text-[#2f5bff]">Create your first project</Link>.
            </div>
          ) : (
            <table className="w-full">
              <thead className="border-y border-slate-100 bg-slate-50/60">
                <tr>
                  <th className="th">#</th>
                  <th className="th">Project Name</th>
                  <th className="th">Type</th>
                  <th className="th">Status</th>
                  <th className="th">Created At</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recent_projects.map((p, i) => (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="td text-slate-400">{i + 1}</td>
                    <td className="td font-semibold text-slate-800">{p.name}</td>
                    <td className="td">{TYPE_LABEL[p.project_type] ?? p.project_type}</td>
                    <td className="td">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="td text-slate-500">{formatDate(p.created_at)}</td>
                    <td className="td">
                      <Link
                        to={p.status === 'in_progress' ? `/pipeline?project=${p.id}` : `/projects/${p.id}`}
                        className="rounded-md bg-blue-50 px-3 py-1 text-xs font-semibold text-[#2f5bff] hover:bg-blue-100"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="mb-3 font-bold text-slate-900">Agent Task Distribution</h2>
            <div className="flex items-center gap-6">
              <Donut
                total={totalTasks}
                label="Total Tasks"
                segments={(Object.keys(AGENT_COLORS) as (keyof typeof AGENT_COLORS)[]).map((k) => ({ value: dist[k], color: AGENT_COLORS[k] }))}
              />
              <ul className="flex-1 space-y-2.5 text-sm">
                {(Object.keys(AGENT_COLORS) as (keyof typeof AGENT_COLORS)[]).map((k) => (
                  <li key={k} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-slate-600 capitalize">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: AGENT_COLORS[k] }} />
                      {k}
                    </span>
                    <span className="font-semibold text-slate-800">{dist[k]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Recent Activity</h2>
              <Link to="/reports" className="text-sm font-semibold text-[#2f5bff]">
                View All →
              </Link>
            </div>
            <ul className="space-y-3">
              {data.activity.length === 0 && <li className="text-sm text-slate-500">No activity yet.</li>}
              {data.activity.map((a) => {
                const meta = ACTIVITY_ICON[a.kind] ?? { icon: Info, cls: 'bg-slate-100 text-slate-500' }
                const Icon = meta.icon
                return (
                  <li key={a.id} className="flex items-center gap-3 text-sm">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${meta.cls}`}>
                      <Icon size={14} />
                    </span>
                    <span className="flex-1 truncate text-slate-700">{a.message}</span>
                    <span className="text-xs whitespace-nowrap text-slate-400">{timeAgo(a.created_at)}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </section>
    </div>
  )
}
