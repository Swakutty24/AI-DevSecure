import {
  Bell,
  ChevronDown,
  FileBarChart,
  FolderOpen,
  House,
  ListChecks,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { timeAgo, type Activity } from '../api'
import { usePoll } from '../hooks'
import { Logo } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: House, end: true },
  { to: '/create', label: 'Create Project', icon: Plus },
  { to: '/projects', label: 'Projects', icon: FolderOpen },
  { to: '/pipeline', label: 'Agent Pipeline', icon: Workflow },
  { to: '/tests', label: 'Test Results', icon: ListChecks },
  { to: '/security', label: 'Security Scan', icon: ShieldCheck },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function Sidebar() {
  const { data: health } = usePoll<{ version: string; llm_connected: boolean }>('/api/health', 30000)
  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-gradient-to-b from-[#0b1222] to-[#0a1020] text-slate-300">
      <div className="flex items-center gap-3 px-5 pt-6 pb-8">
        <Logo />
        <div>
          <div className="text-[15px] font-bold leading-tight text-white">AI DevSecure</div>
          <div className="text-[11px] text-slate-400">Multi-Agent Platform</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                isActive ? 'nav-active font-semibold text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <Icon size={17} strokeWidth={1.8} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="m-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
        <div className="flex items-center gap-3">
          <div className="relative grid h-9 w-9 place-items-center rounded-lg bg-indigo-500/20 text-indigo-300">
            <Sparkles size={17} />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0b1222] bg-emerald-400" />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-white">AI Agents Active</div>
            <div className="text-[11px] text-slate-400">
              {health ? `v${health.version} · ${health.llm_connected ? 'LLM' : 'Offline mode'}` : 'Plan • Build • Test • Secure'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function Topbar() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const { data: acts } = usePoll<Activity[]>('/api/activity?limit=8', 10000)
  const unread = acts?.filter((a) => Date.now() - new Date(a.created_at).getTime() < 3600_000).length ?? 0

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/70 bg-white/90 px-8 backdrop-blur">
      <form
        className="relative w-full max-w-sm"
        onSubmit={(e) => {
          e.preventDefault()
          navigate(`/projects?q=${encodeURIComponent(q)}`)
        }}
      >
        <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search projects, agents, or results..."
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-sm outline-none focus:border-indigo-300 focus:bg-white"
        />
      </form>
      <div className="flex items-center gap-5">
        <div className="relative">
          <button onClick={() => setOpen(!open)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications">
            <Bell size={19} />
            {unread > 0 && (
              <span className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {unread}
              </span>
            )}
          </button>
          {open && (
            <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              <div className="px-2 py-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">Notifications</div>
              {(acts ?? []).length === 0 && <div className="px-2 py-4 text-sm text-slate-500">No activity yet.</div>}
              {(acts ?? []).map((a) => (
                <div key={a.id} className="rounded-lg px-2 py-2 text-sm hover:bg-slate-50">
                  <div className="text-slate-700">{a.message}</div>
                  <div className="text-xs text-slate-400">{timeAgo(a.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="h-8 w-px bg-slate-200" />
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-bold text-white">A</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-800">Admin</div>
            <div className="text-xs text-slate-400">Administrator</div>
          </div>
          <ChevronDown size={16} className="text-slate-400" />
        </div>
      </div>
    </header>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full">
      <Sidebar />
      <div className="pl-60">
        <Topbar />
        <main className="mx-auto max-w-[1400px] px-8 py-7">{children}</main>
      </div>
    </div>
  )
}
