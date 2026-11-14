import { ChevronDown, ChevronRight, Copy, Download, FileText, Folder, Maximize2, Minimize2, MoreVertical, Pencil, RefreshCw, Save, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import CodeViewer from '../components/CodeViewer'
import { Empty, PageHeader, Spinner, StatusBadge } from '../components/ui'
import { usePoll } from '../hooks'

interface FileList {
  root: string
  workspace: string
  files: { path: string; size: number }[]
}
interface TreeNode {
  name: string
  path: string
  children?: TreeNode[]
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] }
  for (const p of paths) {
    let node = root
    const parts = p.split('/')
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/')
      let child = node.children!.find((c) => c.name === part)
      if (!child) {
        child = { name: part, path, children: i < parts.length - 1 ? [] : undefined }
        node.children!.push(child)
      }
      node = child
    })
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.children ? 0 : 1) - (b.children ? 0 : 1) || a.name.localeCompare(b.name))
    nodes.forEach((n) => n.children && sort(n.children))
  }
  sort(root.children!)
  return root.children!
}

function langOf(path: string) {
  if (path.endsWith('.py')) return 'python'
  if (path.endsWith('.md')) return 'markdown'
  return 'text'
}

function Tree({ nodes, depth, active, onOpen, collapsed, toggle }: {
  nodes: TreeNode[]
  depth: number
  active: string
  onOpen: (p: string) => void
  collapsed: Set<string>
  toggle: (p: string) => void
}) {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.path}>
          {n.children ? (
            <>
              <button onClick={() => toggle(n.path)} className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-sm text-slate-700 hover:bg-slate-50" style={{ paddingLeft: depth * 14 + 6 }}>
                {collapsed.has(n.path) ? <ChevronRight size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                <Folder size={15} className="fill-amber-400 text-amber-400" />
                {n.name}
              </button>
              {!collapsed.has(n.path) && <Tree nodes={n.children} depth={depth + 1} active={active} onOpen={onOpen} collapsed={collapsed} toggle={toggle} />}
            </>
          ) : (
            <button
              onClick={() => onOpen(n.path)}
              className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-sm ${active === n.path ? 'bg-blue-50 font-medium text-[#2f5bff]' : 'text-slate-600 hover:bg-slate-50'}`}
              style={{ paddingLeft: depth * 14 + 26 }}
            >
              <FileText size={14} className={active === n.path ? 'text-[#2f5bff]' : 'text-slate-400'} />
              {n.name}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function ProjectCode() {
  const { id } = useParams()
  const projectId = Number(id)
  const { data: project } = usePoll<{ name: string; status: string; workspace: string }>(`/api/projects/${projectId}`, 5000)
  const { data: files, reload: reloadFiles } = usePoll<FileList>(`/api/projects/${projectId}/files`, project?.status === 'in_progress' ? 3000 : 0)
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState('')
  const [contents, setContents] = useState<Record<string, { content: string; absolute: string }>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [full, setFull] = useState(false)
  const [menu, setMenu] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const tree = useMemo(() => buildTree(files?.files.map((f) => f.path) ?? []), [files])

  const open = async (path: string, force = false) => {
    setActive(path)
    setTabs((t) => (t.includes(path) ? t : [...t, path]))
    if (contents[path] && !force) return
    const res = await api.get<{ content: string; absolute_path: string }>(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`)
    setContents((c) => ({ ...c, [path]: { content: res.content, absolute: res.absolute_path } }))
  }

  useEffect(() => {
    if (!files?.files.length || active) return
    const initial = ['app/main.py', 'app/models.py', 'app/schemas.py'].filter((p) => files.files.some((f) => f.path === p))
    ;(initial.length ? initial : [files.files[0].path]).forEach((p) => open(p))
    setActive(initial[0] ?? files.files[0].path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files])

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  const closeTab = (path: string) => {
    const next = tabs.filter((t) => t !== path)
    setTabs(next)
    if (active === path) setActive(next[next.length - 1] ?? '')
    if (editing === path) setEditing(null)
  }

  const save = async () => {
    if (!editing) return
    await api.put(`/api/projects/${projectId}/files/content`, { path: editing, content: draft })
    setContents((c) => ({ ...c, [editing]: { ...c[editing], content: draft } }))
    setEditing(null)
    flash('Saved')
  }

  const refreshAll = async () => {
    await reloadFiles()
    setContents({})
    tabs.forEach((t) => open(t, true))
  }

  const current = contents[active]
  const ideUrl = (scheme: string) => `${scheme}://file${encodeURI(current?.absolute ?? project?.workspace ?? '')}`

  if (!project) return <Spinner />

  return (
    <div className={full ? 'fixed inset-0 z-[45] flex flex-col bg-[#f4f6fb] p-6' : ''}>
      <PageHeader
        title="Generated Code"
        subtitle={`View, edit and manage the code generated by the AI Developer Agent · ${project.name}`}
        actions={
          <>
            <StatusBadge status={project.status} />
            <a href={`/api/projects/${projectId}/download`} className="btn-secondary">
              <Download size={15} /> Download Zip
            </a>
            <a href={ideUrl('vscode')} className="btn-primary">
              <Sparkles size={15} /> Open in IDE
            </a>
            <div className="relative">
              <button className="btn-secondary px-2.5" onClick={() => setMenu(!menu)} aria-label="More">
                <MoreVertical size={16} />
              </button>
              {menu && (
                <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-xl" onClick={() => setMenu(false)}>
                  <a href={ideUrl('cursor')} className="block rounded-lg px-3 py-2 hover:bg-slate-50">Open in Cursor</a>
                  <Link to={`/pipeline?project=${projectId}`} className="block rounded-lg px-3 py-2 hover:bg-slate-50">View pipeline</Link>
                  <Link to={`/tests?project=${projectId}`} className="block rounded-lg px-3 py-2 hover:bg-slate-50">View test results</Link>
                  <Link to={`/security?project=${projectId}`} className="block rounded-lg px-3 py-2 hover:bg-slate-50">View security scan</Link>
                  <button onClick={() => navigator.clipboard.writeText(project.workspace).then(() => flash('Path copied'))} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50">
                    Copy workspace path
                  </button>
                </div>
              )}
            </div>
          </>
        }
      />

      {!files?.files.length ? (
        <Empty title="No code generated yet">
          {project.status === 'in_progress' ? 'The Developer Agent is generating code. This view refreshes automatically.' : 'Run the pipeline to generate code.'}
        </Empty>
      ) : (
        <div className={`grid grid-cols-[260px_1fr] gap-0 overflow-hidden rounded-xl border border-slate-200 bg-white ${full ? 'flex-1' : 'h-[calc(100vh-210px)] min-h-[520px]'}`}>
          <div className="flex flex-col border-r border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-xs font-bold tracking-wider text-slate-700 uppercase">Project Files</span>
              <button onClick={refreshAll} className="text-slate-400 hover:text-slate-600" title="Refresh">
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="scrollbar-thin flex-1 overflow-auto p-2">
              <div className="flex items-center gap-1.5 px-1.5 py-1.5 text-sm font-semibold text-slate-800">
                <ChevronDown size={14} className="text-slate-400" />
                <Folder size={15} className="fill-amber-400 text-amber-400" />
                {project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}
              </div>
              <Tree
                nodes={tree}
                depth={1}
                active={active}
                onOpen={open}
                collapsed={collapsed}
                toggle={(p) => setCollapsed((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n })}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col bg-[#0d1424]">
            <div className="flex items-center justify-between border-b border-white/10 bg-[#0b1120]">
              <div className="scrollbar-thin flex overflow-x-auto">
                {tabs.map((t) => (
                  <div
                    key={t}
                    className={`flex cursor-pointer items-center gap-2 border-r border-white/5 px-4 py-2.5 font-mono text-xs ${t === active ? 'border-t-2 border-t-[#4f5bff] bg-[#0d1424] text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    onClick={() => setActive(t)}
                  >
                    {t.split('/').pop()}
                    {editing === t && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
                    <button onClick={(e) => { e.stopPropagation(); closeTab(t) }} className="text-slate-500 hover:text-white">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1 px-3">
                <span className="mr-2 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 capitalize">{langOf(active)}</span>
                {editing === active ? (
                  <>
                    <button onClick={save} className="rounded-md p-1.5 text-emerald-400 hover:bg-white/10" title="Save">
                      <Save size={15} />
                    </button>
                    <button onClick={() => setEditing(null)} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10" title="Discard">
                      <X size={15} />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { setEditing(active); setDraft(current?.content ?? '') }}
                    disabled={!current}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                    title="Edit"
                  >
                    <Pencil size={15} />
                  </button>
                )}
                <button onClick={() => current && navigator.clipboard.writeText(current.content).then(() => flash('Copied'))} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" title="Copy">
                  <Copy size={15} />
                </button>
                <button onClick={() => setFull(!full)} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" title="Fullscreen">
                  {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              {!current ? (
                <div className="p-6 text-sm text-slate-500">Select a file</div>
              ) : editing === active ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  className="h-full w-full resize-none bg-[#0d1424] p-4 font-mono text-[13px] leading-6 text-slate-200 outline-none"
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save() }
                  }}
                />
              ) : (
                <CodeViewer code={current.content} language={langOf(active)} />
              )}
            </div>
            <div className="flex items-center justify-between border-t border-white/10 bg-[#0b1120] px-4 py-1.5 text-[11px] text-slate-400">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> {toast ?? 'Ready'} <span className="ml-3">FastAPI Application</span>
              </span>
              <span>
                {current ? `${current.content.split('\n').length} lines` : ''} · UTF-8 · Python 3
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
