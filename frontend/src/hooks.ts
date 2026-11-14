import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type ProjectSummary } from './api'

export function usePoll<T>(url: string | null, intervalMs = 0) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const urlRef = useRef(url)
  urlRef.current = url

  const load = useCallback(async () => {
    if (!urlRef.current) {
      setLoading(false)
      return
    }
    try {
      const d = await api.get<T>(urlRef.current)
      setData(d)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    setData(null)
    load()
    if (!intervalMs || !url) return
    const t = setInterval(load, intervalMs)
    return () => clearInterval(t)
  }, [url, intervalMs, load])

  return { data, error, loading, reload: load, setData }
}

const STORAGE_KEY = 'devsecure.project'

/** Selected project shared by the pipeline, test and security pages (URL ?project= wins, then last used, then latest). */
export function useSelectedProject() {
  const [params, setParams] = useSearchParams()
  const { data: projects, reload } = usePoll<ProjectSummary[]>('/api/projects', 5000)
  const fromUrl = Number(params.get('project')) || null
  const stored = Number(localStorage.getItem(STORAGE_KEY)) || null

  let projectId: number | null = fromUrl
  if (!projectId && projects?.length) {
    projectId = projects.some((p) => p.id === stored) ? stored : projects[0].id
  }

  useEffect(() => {
    if (projectId) localStorage.setItem(STORAGE_KEY, String(projectId))
  }, [projectId])

  const select = (id: number) => {
    params.set('project', String(id))
    setParams(params, { replace: true })
  }

  return { projects: projects ?? [], projectId, project: projects?.find((p) => p.id === projectId) ?? null, select, reload }
}
