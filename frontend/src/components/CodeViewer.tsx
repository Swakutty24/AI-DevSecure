import { Fragment, type ReactNode } from 'react'

const KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '),
)
const BUILTINS = new Set('str int float bool dict list tuple set len range print isinstance super self Optional List Any'.split(' '))

const TOKEN_RE =
  /(#.*$)|([rbfu]{0,2}"""[\s\S]*?(?:"""|$)|[rbfu]{0,2}'''[\s\S]*?(?:'''|$)|[rbfu]{0,2}"(?:\\.|[^"\\])*"|[rbfu]{0,2}'(?:\\.|[^'\\])*')|(@[\w.]+)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)/gim

function highlightLine(line: string, state: { inTriple: string | null }): ReactNode[] {
  const out: ReactNode[] = []
  let rest = line
  let key = 0

  if (state.inTriple) {
    const end = rest.indexOf(state.inTriple)
    if (end === -1) return [<span key="s" className="text-amber-300">{rest}</span>]
    out.push(<span key={key++} className="text-amber-300">{rest.slice(0, end + 3)}</span>)
    rest = rest.slice(end + 3)
    state.inTriple = null
  }

  let last = 0
  let prevWord = ''
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(rest))) {
    if (m.index > last) out.push(rest.slice(last, m.index))
    const [tok, comment, str, deco, num, word] = m
    if (comment) out.push(<span key={key++} className="text-slate-500 italic">{tok}</span>)
    else if (str) {
      const triple = str.match(/^[rbfu]{0,2}("""|''')/i)
      if (triple && (str.length < triple[0].length + 3 || !str.endsWith(triple[1]))) state.inTriple = triple[1]
      out.push(<span key={key++} className="text-amber-300">{tok}</span>)
    } else if (deco) out.push(<span key={key++} className="text-sky-300">{tok}</span>)
    else if (num) out.push(<span key={key++} className="text-orange-300">{tok}</span>)
    else if (word) {
      let cls = 'text-slate-200'
      if (KEYWORDS.has(word)) cls = 'text-pink-400'
      else if (prevWord === 'def') cls = 'text-sky-300'
      else if (prevWord === 'class') cls = 'text-emerald-300 font-semibold'
      else if (BUILTINS.has(word)) cls = 'text-cyan-300'
      else if (/^[A-Z][A-Za-z0-9]+$/.test(word)) cls = 'text-emerald-300'
      out.push(<span key={key++} className={cls}>{tok}</span>)
      prevWord = word
    }
    last = m.index + tok.length
  }
  if (last < rest.length) out.push(rest.slice(last))
  return out
}

export default function CodeViewer({ code, language }: { code: string; language: string }) {
  const lines = code.split('\n')
  const state = { inTriple: null as string | null }
  const isPython = language === 'python'
  return (
    <div className="scrollbar-thin h-full overflow-auto bg-[#0d1424] py-3 font-mono text-[13px] leading-6">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="hover:bg-white/[0.03]">
              <td className="w-12 pr-4 text-right align-top text-slate-600 select-none">{i + 1}</td>
              <td className="pr-6 whitespace-pre text-slate-200">
                {isPython ? highlightLine(line, state).map((n, j) => <Fragment key={j}>{n}</Fragment>) : line || ' '}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
