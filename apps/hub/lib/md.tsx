import { Fragment } from 'react'

/** Markdown mínimo do briefing: parágrafos, bullets (- ou •) e **negrito**. Sem HTML do modelo. */
function inline(t: string) {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>)
}
export function Md({ texto }: { texto: string }) {
  const blocos: React.ReactNode[] = []
  let lista: string[] = []
  const fecha = () => { if (lista.length) { blocos.push(<ul key={blocos.length}>{lista.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); lista = [] } }
  for (const linha of texto.split('\n')) {
    const l = linha.trim()
    if (!l) { fecha(); continue }
    const m = l.match(/^[-•*]\s+(.*)$/)
    if (m) lista.push(m[1])
    else { fecha(); blocos.push(<p key={blocos.length}>{inline(l.replace(/^#+\s*/, ''))}</p>) }
  }
  fecha()
  return <div className="md">{blocos}</div>
}
