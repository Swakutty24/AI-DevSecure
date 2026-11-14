import { Code2, Play, Plus, Trash2, Workflow } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, formatDate, type ProjectSummary } from '../api'
import { Badge, Empty, PageHeader, Spinner, StatusBadge } from '../components/ui'
import { usePoll } from '../hooks'

export default function Projects() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').toLowerCase()
  const { data, reload } = usePoll<ProjectSummary[]>('/api/projects', 4000)
  if (!data) return <Spinner />
  const rows = data.filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))

  const rerun = async (id: number) => {
    await api.post(`/api/projects/${id}/run`)
    navigate(`/pipeline?project=${id}`)
  }
  const remove = async (p: ProjectSummary) => {
    if (!confirm(`Delete "${p.name}" and its workspace?`)) return
    await api.del(`/api/projects/${p.id}`)
    reload()
  }

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={q ? `Search results for "${q}"` : 'All projects built by the AI agent pipeline.'}
        actions={
          <Link to="/create" className="btn-primary">
            <Plus size={16} /> New Project
          </Link>
        }
      />
      {rows.length === 0 ? (
        <Empty title="No projects found" action={<Link to="/create" className="btn-primary">Create Project</Link>}>
          Create a project and the agents will plan, code, test and secure it.
        </Empty>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                <th className="th">#</th>
                <th className="th">Project</th>
                <th className="th">Status</th>
                <th className="th">Tests</th>
                <th className="th">Coverage</th>
                <th className="th">Open Findings</th>
                <th className="th">Created</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p, i) => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="td text-slate-400">{i + 1}</td>
                  <td className="td">
                    <Link to={`/projects/${p.id}`} className="font-semibold text-slate-800 hover:text-[#2f5bff]">
                      {p.name}
                    </Link>
                    <div className="max-w-md truncate text-xs text-slate-500">{p.description}</div>
                  </td>
                  <td className="td">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="td">{p.tests_total ? `${p.tests_passed}/${p.tests_total}` : '-'}</td>
                  <td className="td">{p.coverage ? `${p.coverage}%` : '-'}</td>
                  <td className="td">{p.open_findings ? <Badge tone="red">{p.open_findings}</Badge> : <Badge tone="green">0</Badge>}</td>
                  <td className="td text-slate-500">{formatDate(p.created_at)}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1.5">
                      <Link to={`/projects/${p.id}`} title="Generated code" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#2f5bff]">
                        <Code2 size={16} />
                      </Link>
                      <Link to={`/pipeline?project=${p.id}`} title="Pipeline" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#2f5bff]">
                        <Workflow size={16} />
                      </Link>
                      <button
                        title="Run pipeline again"
                        disabled={p.status === 'in_progress'}
                        onClick={() => rerun(p.id)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-emerald-600 disabled:opacity-30"
                      >
                        <Play size={16} />
                      </button>
                      <button
                        title="Delete"
                        disabled={p.status === 'in_progress'}
                        onClick={() => remove(p)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
