'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'

export type RevItem = {
  id: string; data: string; descricao: string | null; estabelecimento: string | null; valor: number; moeda: string | null
  conta: string | null; categoria_id: string | null; categoria: string | null
  categoria_sugerida_id: string | null; categoria_sugerida: string | null; precisa_voce: boolean
}
export type RevisaoDados = {
  total: number; precisa_voce: number; sem_categoria: number; itens: RevItem[]
  categorias: { id: string; nome: string; pai_id: string | null }[]
}

const sb = () => supabaseBrowser() as unknown as SupabaseClient
const brl = (v: number) => Math.abs(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 })
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const nome = (i: RevItem) => i.estabelecimento || i.descricao || 'Lançamento'

/** Revisão de lançamentos: um toque por item. Categorizar muda dado financeiro: sempre repete o que foi feito. */
export function Revisao({ dados, erro, appAntigo }: { dados: RevisaoDados | null; erro: boolean; appAntigo: string }) {
  const router = useRouter()
  const [itens, setItens] = useState<RevItem[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [trocando, setTrocando] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [fala, setFala] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cab = <h2 style={{ margin: 0, fontSize: '1rem' }}>Para revisar</h2>
  if (erro) return <section className="card alert" id="revisao"><h2>Para revisar</h2><p className="small" style={{ margin: 0 }}>Não consegui carregar os lançamentos agora. Tente de novo em instantes.</p></section>
  if (!dados) return <section className="card" id="revisao"><p className="small muted" style={{ margin: 0 }}>Carregando lançamentos…</p></section>

  const lista = itens ?? dados.itens ?? []
  const n = total ?? Number(dados.total ?? 0)
  const cats = dados.categorias ?? []

  async function agir(it: RevItem, catId: string | null) {
    setBusy(it.id); setAviso(null); setFala(null)
    const db = sb().schema('airton')
    const alvo = catId ?? it.categoria_sugerida_id
    const r = catId ? await db.rpc('set_category', { p_ids: [it.id], p_category: catId, p_learn: true }) : await db.rpc('confirm', { p_ids: [it.id] })
    setBusy(null)
    if (r.error) { setAviso('Não deu para salvar esse lançamento. Tente de novo.'); return }
    const catNome = cats.find((c) => c.id === alvo)?.nome ?? it.categoria_sugerida ?? it.categoria ?? 'categoria'
    const parecidos = catId && Array.isArray((r.data as { similar?: unknown[] } | null)?.similar) ? (r.data as { similar: unknown[] }).similar.length : 0
    setFala(`${nome(it)} de ${brl(it.valor)} → ${catNome}${parecidos ? ` · e mais ${parecidos} parecidos` : ''}`)
    setItens(lista.filter((x) => x.id !== it.id)); setTotal(Math.max(0, n - 1)); setTrocando(null)
    router.refresh()
  }

  return (
    <section className="card stack" style={{ gap: 12, scrollMarginTop: 72 }} id="revisao">
      <div className="row between">
        {cab}
        <span className="small muted num">{n} {n === 1 ? 'lançamento' : 'lançamentos'}</span>
      </div>
      {fala && <p className="small" style={{ margin: 0, color: 'var(--progress)' }} role="status">✓ {fala}</p>}
      {aviso && <p className="small" style={{ margin: 0, color: 'var(--alert)' }} role="alert">{aviso}</p>}
      {lista.length ? (
        <div className="list small">
          {lista.map((it) => {
            const sug = it.categoria_sugerida_id ? (it.categoria_sugerida ?? it.categoria) : null
            return (
              <div key={it.id} className="stack" style={{ gap: 6, ...(it.precisa_voce ? { borderLeft: '2px solid var(--alert)', paddingLeft: 8 } : {}) }}>
                <div className="row between">
                  <span><span className="muted num">{dm(it.data)}</span> · {nome(it)}<br />
                    <span className="muted">{it.conta ?? 'sem conta'} · {sug ?? 'sem categoria'}{it.precisa_voce ? ' · precisa de você' : ''}</span></span>
                  <strong className="num">{it.valor < 0 ? '−' : ''}{brl(it.valor)}</strong>
                </div>
                {trocando === it.id ? (
                  <div className="row" style={{ gap: 8 }}>
                    <select defaultValue="" disabled={busy === it.id} aria-label="Categoria" onChange={(e) => e.target.value && agir(it, e.target.value)}>
                      <option value="" disabled>Escolha a categoria</option>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                    <button className="chip" onClick={() => setTrocando(null)}>Cancelar</button>
                  </div>
                ) : (
                  <div className="row" style={{ gap: 8 }}>
                    {it.categoria_sugerida_id && <button className="chip" disabled={busy === it.id} onClick={() => agir(it, null)}>{busy === it.id ? 'Salvando…' : 'Aceitar'}</button>}
                    <button className="chip" disabled={busy === it.id} onClick={() => setTrocando(it.id)}>Trocar</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : <p className="small muted" style={{ margin: 0 }}>{n > 0 ? 'Mostrei os primeiros; recarregue para ver os próximos.' : 'Tudo revisado. Nada pendente.'}</p>}
      {n > lista.length && lista.length > 0 && <p className="small muted" style={{ margin: 0 }}>Mostrando {lista.length} de {n}.</p>}
      <a className="small" href={appAntigo} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Detalhes e outros ajustes no AIrton completo ↗</a>
    </section>
  )
}
