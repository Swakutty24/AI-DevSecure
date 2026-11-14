import { ArrowLeft, ArrowRight, Check, CircleX, Globe, Lightbulb, Loader2, Monitor, Package, Rocket, ShieldAlert, Zap } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Settings } from '../api'
import { Badge, PageHeader, Toggle } from '../components/ui'
import { usePoll } from '../hooks'

interface Example {
  key: string
  label: string
  name: string
  requirements: string
}

const STEPS = ['Project Details', 'Requirements', 'Configuration', 'Review', 'Start']

const TYPES = [
  { id: 'web', label: 'Web Application', sub: 'API, Web app, Dashboard', icon: Globe, tone: 'bg-blue-500' },
  { id: 'service', label: 'Service', sub: 'Backend service', icon: null, tone: 'bg-violet-500' },
  { id: 'desktop', label: 'Desktop Application', sub: 'Standalone app', icon: Monitor, tone: 'bg-blue-600' },
  { id: 'library', label: 'Library / Package', sub: 'Reusable module', icon: Package, tone: 'bg-sky-500' },
]

const TIPS = ['Be clear and specific in your requirements', 'Mention validations and business rules', 'Include expected features', 'Specify technology preferences']

function Stepper({ step }: { step: number }) {
  return (
    <div className="card flex items-center gap-3 px-6 py-4">
      {STEPS.map((s, i) => (
        <div key={s} className="flex flex-1 items-center gap-3 last:flex-none">
          <div className="flex items-center gap-2">
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${
                i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-[#2f5bff] text-white' : 'border border-slate-300 text-slate-500'
              }`}
            >
              {i < step ? <Check size={13} /> : i + 1}
            </span>
            <span className={`text-sm whitespace-nowrap ${i === step ? 'font-semibold text-[#2f5bff]' : 'text-slate-600'}`}>{s}</span>
          </div>
          {i < STEPS.length - 1 && <div className="h-px flex-1 bg-slate-200" />}
        </div>
      ))}
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="label">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

export default function CreateProject() {
  const navigate = useNavigate()
  const { data: examples } = usePoll<Example[]>('/api/examples')
  const { data: settings } = usePoll<Settings>('/api/settings')
  const [step, setStep] = useState(0)
  const [exampleKey, setExampleKey] = useState('student')
  const [name, setName] = useState('')
  const [language, setLanguage] = useState('python-fastapi')
  const [type, setType] = useState('web')
  const [description, setDescription] = useState('')
  const [requirements, setRequirements] = useState('')
  const [guard, setGuard] = useState<{ safe: boolean; detections: string[] } | null>(null)
  const [cfg, setCfg] = useState<{ iterations: number; autoFix: boolean; seed: boolean; coverage: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (settings && !cfg)
      setCfg({
        iterations: settings.general.max_feedback_iterations,
        autoFix: settings.agents.auto_fix_vulnerabilities,
        seed: settings.general.seed_vulnerable_draft,
        coverage: settings.security.min_test_coverage,
      })
  }, [settings, cfg])

  useEffect(() => {
    const text = `${description}\n${requirements}`.trim()
    if (!text) return setGuard(null)
    const t = setTimeout(() => api.post<{ safe: boolean; detections: string[] }>('/api/guard/check', { text }).then(setGuard).catch(() => {}), 400)
    return () => clearTimeout(t)
  }, [description, requirements])

  const example = examples?.find((e) => e.key === exampleKey)

  const useExample = () => {
    if (!example) return
    setName(example.name)
    setDescription(example.requirements.replace(/:\n- /, ': ').replace(/\n- /g, ', ').replace(/\n/g, '. ').slice(0, 500))
    setRequirements(example.requirements)
  }

  const canNext = [name.trim().length >= 2 && description.trim().length > 0, (requirements || description).trim().length > 10, true, true][step] ?? true

  const submit = async () => {
    if (!cfg) return
    setSubmitting(true)
    setError(null)
    try {
      await api.put('/api/settings', {
        general: { max_feedback_iterations: cfg.iterations, seed_vulnerable_draft: cfg.seed },
        agents: { auto_fix_vulnerabilities: cfg.autoFix },
        security: { min_test_coverage: cfg.coverage },
      })
      const p = await api.post<{ id: number }>('/api/projects', {
        name,
        language,
        project_type: type,
        description,
        requirements: requirements || description,
      })
      navigate(`/pipeline?project=${p.id}`)
    } catch (e) {
      setError((e as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Create New Project" subtitle="Enter your requirements and let AI agents build, test and secure your software." />
      <Stepper step={step} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
        <div className="card p-6">
          {step === 0 && (
            <div className="space-y-5">
              <h2 className="border-b border-slate-100 pb-3 font-bold text-slate-900">Project Details</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Project Name" required>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Student Registration API" maxLength={120} />
                </Field>
                <Field label="Programming Language">
                  <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                    <option value="python-fastapi">🐍 Python (FastAPI)</option>
                    <option disabled>Python (Flask) - coming soon</option>
                    <option disabled>Node.js (Express) - coming soon</option>
                  </select>
                </Field>
              </div>
              <Field label="Project Type">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {TYPES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setType(t.id)}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                        type === t.id ? 'border-[#2f5bff] bg-blue-50/50 ring-2 ring-[#2f5bff]/15' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span className={`grid h-9 w-9 place-items-center rounded-lg text-white ${t.tone}`}>
                        {t.icon ? <t.icon size={18} /> : <span className="text-[11px] font-bold">API</span>}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-slate-800">{t.label}</span>
                        <span className="block text-xs text-slate-500">{t.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Short Description" required>
                <textarea
                  className="input min-h-28 resize-y"
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 500))}
                  placeholder="Describe what you want the agents to build..."
                />
                <div className="mt-1 text-right text-xs text-slate-400">{description.length}/500</div>
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="border-b border-slate-100 pb-3 font-bold text-slate-900">Requirements</h2>
              <p className="text-sm text-slate-500">
                List the fields as bullet points (<code>- Field name</code>) and state business rules such as <em>"prevent duplicate register numbers"</em>.
                The Planner Agent turns this into a data model and task plan.
              </p>
              <textarea
                className="input min-h-72 resize-y font-mono text-[13px]"
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder={'Create a REST API to register students with the following fields:\n- Student name\n- Register number\n- Email\nValidate inputs and prevent duplicate register numbers.'}
              />
            </div>
          )}

          {step === 2 && cfg && (
            <div className="space-y-5">
              <h2 className="border-b border-slate-100 pb-3 font-bold text-slate-900">Configuration</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Max feedback iterations">
                  <input type="number" min={1} max={5} className="input" value={cfg.iterations} onChange={(e) => setCfg({ ...cfg, iterations: Math.max(1, Math.min(5, Number(e.target.value))) })} />
                </Field>
                <Field label="Minimum test coverage (%)">
                  <input type="number" min={0} max={100} className="input" value={cfg.coverage} onChange={(e) => setCfg({ ...cfg, coverage: Math.max(0, Math.min(100, Number(e.target.value))) })} />
                </Field>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                <div>
                  <div className="text-sm font-semibold text-slate-800">Auto-fix vulnerabilities</div>
                  <div className="text-xs text-slate-500">Send Tester/Security findings back to the Developer Agent until resolved.</div>
                </div>
                <Toggle checked={cfg.autoFix} onChange={(v) => setCfg({ ...cfg, autoFix: v })} />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <div>
                  <div className="text-sm font-semibold text-slate-800">Demo: seed first draft with common flaws</div>
                  <div className="text-xs text-slate-500">
                    Offline template mode only. The first draft contains typical vulnerabilities so you can watch the agents detect and fix them.
                  </div>
                </div>
                <Toggle checked={cfg.seed} onChange={(v) => setCfg({ ...cfg, seed: v })} />
              </div>
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                LLM: {settings?.integrations.llm_connected ? <Badge tone="green">Connected</Badge> : <Badge tone="slate">Offline template mode</Badge>}{' '}
                <span className="text-xs">(configure in Settings → Integrations & API)</span>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="border-b border-slate-100 pb-3 font-bold text-slate-900">Review</h2>
              <dl className="grid grid-cols-[160px_1fr] gap-y-3 text-sm">
                <dt className="text-slate-500">Project name</dt>
                <dd className="font-semibold">{name}</dd>
                <dt className="text-slate-500">Language</dt>
                <dd>Python (FastAPI)</dd>
                <dt className="text-slate-500">Type</dt>
                <dd>{TYPES.find((t) => t.id === type)?.label}</dd>
                <dt className="text-slate-500">Feedback iterations</dt>
                <dd>{cfg?.iterations}</dd>
                <dt className="text-slate-500">Min coverage</dt>
                <dd>{cfg?.coverage}%</dd>
              </dl>
              <pre className="max-h-64 overflow-auto rounded-xl bg-slate-50 p-4 text-[13px] whitespace-pre-wrap text-slate-700">{requirements || description}</pre>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-lg">
                <Rocket size={28} />
              </div>
              <h2 className="text-xl font-bold">Ready to launch the agent pipeline</h2>
              <p className="max-w-md text-sm text-slate-500">Planner → Developer → Tester → Security, with an automatic feedback loop until the policy gate passes.</p>
              {error && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
              <button className="btn-primary px-6 py-3" onClick={submit} disabled={submitting}>
                {submitting ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />} Start Pipeline
              </button>
            </div>
          )}

          {guard && !guard.safe && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              Prompt-injection guard: suspicious content detected ({guard.detections.join(', ')}). Those lines will be removed before reaching the agents.
            </div>
          )}

          <div className="mt-6 flex justify-between border-t border-slate-100 pt-5">
            {step === 0 ? (
              <button className="btn-secondary" onClick={() => navigate('/')}>
                <CircleX size={15} /> Cancel
              </button>
            ) : (
              <button className="btn-secondary" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={15} /> Back
              </button>
            )}
            {step < 4 && (
              <button className="btn-primary bg-[#4338ca] hover:bg-[#3730a3]" disabled={!canNext} onClick={() => setStep(step + 1)}>
                Next <ArrowRight size={15} />
              </button>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="card p-5">
            <h3 className="mb-3 flex items-center gap-2 font-bold text-slate-900">
              <Lightbulb size={17} className="text-amber-500" /> Example Requirements
            </h3>
            <div className="mb-3 flex flex-wrap gap-2">
              {(examples ?? []).slice(0, 3).map((e) => (
                <button
                  key={e.key}
                  onClick={() => setExampleKey(e.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    exampleKey === e.key ? 'bg-[#4338ca] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] whitespace-pre-line text-slate-600">{example?.requirements}</div>
            <button className="btn-primary mt-3 w-full justify-center bg-[#4f46e5] hover:bg-[#4338ca]" onClick={useExample}>
              <Zap size={15} /> Use This Example
            </button>
          </div>
          <div className="card p-5">
            <h3 className="mb-3 flex items-center gap-2 font-bold text-slate-900">
              <Lightbulb size={17} className="text-amber-500" /> Tips
            </h3>
            <ul className="space-y-2.5">
              {TIPS.map((t) => (
                <li key={t} className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white">
                    <Check size={10} strokeWidth={3} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
