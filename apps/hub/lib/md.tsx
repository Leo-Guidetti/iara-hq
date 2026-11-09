import { Fragment } from 'react'

/** Markdown mínimo (briefing, pílulas da SabIA): parágrafos, bullets, **negrito** e [links](https://…).
 *  Sem HTML do modelo; link só com https. */
function negrito(t: string, k: string) {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') && p.endsWith('**') ? <strong key={`${k}${i}`}>{p.slice(2, -2)}</strong> : <Fragment key={`${k}${i}`}>{p}</Fragment>)
}
function inline(t: string) {
  return t.split(/(\[[^\]]+\]\(https:\/\/[^)\s]+\))/g).map((p, i) => {
    const m = p.match(/^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/)
    return m ? <a key={i} href={m[2]} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{m[1]}</a> : <Fragment key={i}>{negrito(p, `${i}-`)}</Fragment>
  })
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
