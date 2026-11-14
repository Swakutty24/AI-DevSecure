import { Loader2, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ProjectSummary } from '../api'

export function Logo({ size = 38 }: { size?: number }) {
  return (
    <div
      className="grid place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-lg shadow-indigo-900/40"
      style={{ width: size, height: size }}
    >
      <ShieldCheck size={size * 0.52} strokeWidth={2} />
    </div>
  )
}

export function PageHeader({ title, subtitle, eyebrow, actions }: { title: string; subtitle?: string; eyebrow?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-1">{eyebrow}</div>}
        <h1 className="text-[26px] font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  )
}

const TONES = {
  green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  red: 'bg-red-50 text-red-600 border-red-100',
  amber: 'bg-amber-50 text-amber-600 border-amber-100',
  orange: 'bg-orange-50 text-orange-600 border-orange-100',
  blue: 'bg-blue-50 text-blue-600 border-blue-100',
  indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
  violet: 'bg-violet-50 text-violet-600 border-violet-100',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-100',
}
export type Tone = keyof typeof TONES

export function Badge({ tone = 'slate', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONES[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function IconTile({ tone = 'blue', children, size = 40 }: { tone?: Tone; children: ReactNode; size?: number }) {
  return (
    <div className={`grid shrink-0 place-items-center rounded-xl border ${TONES[tone]}`} style={{ width: size, height: size }}>
      {children}
    </div>
  )
}

export function StatCard({ label, value, icon, tone = 'blue', footer }: { label: string; value: ReactNode; icon?: ReactNode; tone?: Tone; footer?: ReactNode }) {
  return (
    <div className="card flex flex-col justify-between p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium text-slate-500">{label}</div>
          <div className="mt-2 text-[28px] leading-none font-bold text-slate-900">{value}</div>
        </div>
        {icon && <IconTile tone={tone}>{icon}</IconTile>}
      </div>
      {footer && <div className="mt-3 text-xs text-slate-500">{footer}</div>}
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-6 border-b border-slate-200 px-5">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 py-3.5 text-sm font-medium transition ${
            value === t.id ? 'border-[#2f5bff] text-[#2f5bff]' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function PillTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="card flex flex-wrap gap-1 p-1.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            value === t.id ? 'bg-[#2f5bff] text-white shadow' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export const STATUS_TONE: Record<string, Tone> = {
  completed: 'green',
  passed: 'green',
  in_progress: 'blue',
  running: 'blue',
  failed: 'red',
  stopped: 'amber',
  pending: 'slate',
  open: 'red',
  fixed: 'green',
  skipped: 'slate',
}

export const STATUS_LABEL: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In Progress',
  running: 'Running',
  failed: 'Failed',
  stopped: 'Stopped',
  pending: 'Pending',
  passed: 'Passed',
  open: 'Open',
  fixed: 'Fixed',
  skipped: 'Skipped',
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'slate'}>{STATUS_LABEL[status] ?? status}</Badge>
}

export const SEVERITY_TONE: Record<string, Tone> = { Critical: 'red', High: 'orange', Medium: 'amber', Low: 'blue' }

export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge tone={SEVERITY_TONE[severity] ?? 'slate'}>{severity}</Badge>
}

export function ProjectPicker({ projects, value, onChange }: { projects: ProjectSummary[]; value: number | null; onChange: (id: number) => void }) {
  if (!projects.length) return null
  return (
    <select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className="input w-64 cursor-pointer font-medium">
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Loader2 className="animate-spin" size={18} /> {label ?? 'Loading...'}
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="text-base font-semibold text-slate-800">{title}</div>
      {children && <div className="max-w-md text-sm text-slate-500">{children}</div>}
      {action}
    </div>
  )
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-[#2f5bff]' : 'bg-slate-300'} disabled:opacity-50`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card max-h-[85vh] w-full max-w-2xl overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Donut({ segments, total, label }: { segments: { value: number; color: string }[]; total: number; label: string }) {
  const r = 42
  const c = 2 * Math.PI * r
  const sum = segments.reduce((a, s) => a + s.value, 0)
  let offset = 0
  return (
    <svg viewBox="0 0 120 120" className="h-36 w-36">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#eef2f7" strokeWidth="14" />
      {sum > 0 &&
        segments.map((s, i) => {
          const len = (s.value / sum) * c
          const el = (
            <circle
              key={i}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="14"
              strokeDasharray={`${Math.max(len - 2, 0)} ${c}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          )
          offset += len
          return el
        })}
      <text x="60" y="58" textAnchor="middle" className="fill-slate-900 text-[22px] font-bold">
        {total}
      </text>
      <text x="60" y="74" textAnchor="middle" className="fill-slate-400 text-[8px] font-semibold tracking-wider uppercase">
        {label}
      </text>
    </svg>
  )
}

export function Ring({ value, size = 56, color = '#10b981' }: { value: number; size?: number; color?: string }) {
  const r = 22
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 56 56" style={{ width: size, height: size }}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="#e2e8f0" strokeWidth="5" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(Math.min(value, 100) / 100) * c} ${c}`}
        transform="rotate(-90 28 28)"
      />
    </svg>
  )
}
