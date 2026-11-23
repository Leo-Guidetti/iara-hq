'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'
import { callFunction } from '@/lib/functions'

type ItemM = { id: number; nome: string; quantidade: number; unidade: string; preco_unit: number | null; preco_fonte: 'ia' | 'leo' | 'historico' | null; comprado: boolean; total: number | null }
export type Lista = { itens: ItemM[]; falta: number; carrinho: number; sem_preco: number }

const sb = () => supabaseBrowser() as unknown as SupabaseClient
const UNIDADES = ['un', 'kg', 'g', 'L', 'ml', 'pct', 'cx', 'dz']
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const qtd = (n: number) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const FONTE = { ia: 'estimado pela IA', historico: 'último preço', leo: 'seu preço' } as const

/** Lista de mercado única: adicionar (soma se repetir), marcar no carrinho, corrigir preço (vira o preço das próximas vezes). */
export function Mercado({ lista }: { lista: Lista }) {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [q, setQ] = useState('1')
  const [un, setUn] = useState('un')
  const [busy, setBusy] = useState(false)
  const [estimando, setEstimando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [editar, setEditar] = useState<{ id: number; quantidade: string; preco: string } | null>(null)
  const pediu = useRef(false)

  // Itens sem preço (incluindo os que entraram pela voz): pede a estimativa uma vez por visita.
  useEffect(() => {
    if (!lista.sem_preco || pediu.current) return
    pediu.current = true
    estimar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista.sem_preco])

  async function estimar() {
    setEstimando(true)
    try { await callFunction('iara-mercado', { action: 'estimar' }); router.refresh() } catch { /* fica sem preço; dá para digitar */ }
    setEstimando(false)
  }
  async function rpc(fn: string, args: Record<string, unknown>) {
    setBusy(true); setErro(null)
    const { data, error } = await sb().rpc(fn, args)
    setBusy(false)
    if (error) { setErro(/^(Escreva|Quantidade)/.test(error.message) ? error.message : 'Não deu para salvar. Tente de novo.'); return null }
    router.refresh()
    return data
  }
  async function adicionar(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(q.replace(',', '.'))
    const r = await rpc('hub_mercado_adicionar', { p_nome: nome, p_quantidade: n > 0 ? n : 1, p_unidade: un }) as { estimar?: boolean } | null
    if (!r) return
    setNome(''); setQ('1'); setUn('un')
    if (r.estimar) estimar()
  }
  async function salvarEdicao() {
    if (!editar) return
    const p: Record<string, unknown> = { quantidade: Number(editar.quantidade.replace(',', '.')) || 1 }
    if (editar.preco.trim()) p.preco_unit = Number(editar.preco.replace(',', '.'))
    if (await rpc('hub_mercado_atualizar', { p_id: editar.id, p }) !== null) setEditar(null)
  }

  const abertos = lista.itens.filter((i) => !i.comprado)
  const comprados = lista.itens.filter((i) => i.comprado)

  return (
    <>
      <div className="hello">
        <span className="small muted">{abertos.length ? `${abertos.length} ${abertos.length === 1 ? 'item' : 'itens'} para comprar` : 'Lista de mercado'}</span>
        <h1>{lista.falta ? `≈ ${brl(Number(lista.falta))}` : abertos.length ? 'Sem estimativa ainda' : 'Lista vazia'}</h1>
        {(lista.carrinho > 0 || lista.sem_preco > 0 || estimando) && (
          <span className="small muted">
            {lista.carrinho > 0 && `${brl(Number(lista.carrinho))} no carrinho`}
            {lista.carrinho > 0 && (lista.sem_preco > 0 || estimando) && ' · '}
            {estimando ? 'estimando preços…' : lista.sem_preco > 0 ? `${lista.sem_preco} sem preço` : ''}
          </span>
        )}
      </div>

      <form className="card" onSubmit={adicionar} style={{ display: 'grid', gridTemplateColumns: '64px 80px 1fr', gap: 8 }}>
        <input required placeholder="Ex.: Leite integral" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Item" style={{ gridColumn: '1 / -1' }} />
        <input inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Quantidade" />
        <select value={un} onChange={(e) => setUn(e.target.value)} aria-label="Unidade">{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select>
        <button className="btn" disabled={busy || !nome.trim()}>Adicionar</button>
      </form>
      {erro && <p className="error" role="alert">{erro}</p>}

      {abertos.length > 0 && (
        <section className="card" aria-label="Para comprar">
          <div className="checklist">{abertos.map((i, idx) => linha(i, idx))}</div>
        </section>
      )}
      {comprados.length > 0 && (
        <section className="card" aria-label="No carrinho">
          <div className="row between" style={{ marginBottom: 4 }}>
            <span className="small muted">No carrinho</span>
            <button type="button" className="chip" disabled={busy} onClick={() => rpc('hub_mercado_arquivar', { p_id: null })}>Limpar comprados</button>
          </div>
          <div className="checklist">{comprados.map((i, idx) => linha(i, idx))}</div>
        </section>
      )}
      <p className="small" style={{ color: 'var(--dim)', margin: 0 }}>Preço com ≈ é estimativa da IA para supermercado em São Paulo. Toque no preço para corrigir: o seu valor passa a valer nas próximas vezes. Pela voz: “põe leite na lista do mercado”.</p>
    </>
  )

  function linha(i: ItemM, idx: number) {
    const ed = editar?.id === i.id
    return (
      <div key={i.id} style={idx ? { borderTop: '1px solid var(--line)' } : undefined}>
        <label className={i.comprado ? 'feito' : undefined}>
          <input type="checkbox" checked={i.comprado} disabled={busy} onChange={(e) => rpc('hub_mercado_atualizar', { p_id: i.id, p: { comprado: e.target.checked } })} />
          <span style={{ flex: 1 }}>{i.nome}<small style={{ color: 'var(--dim)' }}> · {qtd(i.quantidade)} {i.unidade}</small></span>
          <button type="button" className="chip" style={{ padding: '4px 8px', minHeight: 0 }} title={i.preco_fonte ? FONTE[i.preco_fonte] : 'sem preço'}
            onClick={(e) => { e.preventDefault(); setEditar(ed ? null : { id: i.id, quantidade: String(i.quantidade).replace('.', ','), preco: i.preco_unit != null ? String(i.preco_unit).replace('.', ',') : '' }) }}>
            {i.total != null ? `${i.preco_fonte === 'ia' ? '≈ ' : ''}${brl(Number(i.total))}` : '—'}
          </button>
        </label>
        {ed && editar && (
          <div className="row" style={{ gap: 8, padding: '0 0 12px 32px', flexWrap: 'wrap' }}>
            <span className="small muted row" style={{ gap: 6 }}>Qtd
              <input inputMode="decimal" aria-label="Quantidade" value={editar.quantidade} onChange={(e) => setEditar({ ...editar, quantidade: e.target.value })} style={{ width: 72, padding: '8px 10px' }} />
            </span>
            <span className="small muted row" style={{ gap: 6 }}>R$ por {i.unidade}
              <input inputMode="decimal" aria-label={`Preço por ${i.unidade}`} placeholder="0,00" value={editar.preco} onChange={(e) => setEditar({ ...editar, preco: e.target.value })} style={{ width: 90, padding: '8px 10px' }} />
            </span>
            <button type="button" className="chip on" disabled={busy} onClick={salvarEdicao}>Salvar</button>
            <button type="button" className="chip" disabled={busy} onClick={() => rpc('hub_mercado_arquivar', { p_id: i.id }).then(() => setEditar(null))}>Tirar da lista</button>
          </div>
        )}
      </div>
    )
  }
}
