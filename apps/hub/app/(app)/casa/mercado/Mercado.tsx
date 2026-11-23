'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'
import { callFunction } from '@/lib/functions'

type ItemM = {
  id: number; nome: string; quantidade: number; unidade: string; categoria: string; preco_unit: number | null
  preco_fonte: 'ia' | 'leo' | 'historico' | null; comprado: boolean; total: number | null; min: number | null; max: number | null
}
type Sugestao = { nome: string; unidade: string; quantidade: number; vezes: number }
export type Lista = { itens: ItemM[]; falta: number; falta_min: number; falta_max: number; carrinho: number; sem_preco: number; sugestoes: Sugestao[] }

const sb = () => supabaseBrowser() as unknown as SupabaseClient
const brl = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brl0 = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const qtd = (n: number) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const FONTE = { ia: 'estimado pela IA', historico: 'último preço', leo: 'seu preço' } as const

/** Lista de mercado: escreve do jeito que fala ("2 kg de arroz, leite, 6 ovos"), a IA separa, põe no corredor e estima
 *  quanto vai gastar (com faixa). Agrupa por corredor, soma por corredor, sugere o que você costuma comprar. */
export function Mercado({ lista }: { lista: Lista }) {
  const router = useRouter()
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const [lendo, setLendo] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [editar, setEditar] = useState<{ id: number; quantidade: string; preco: string } | null>(null)
  const pediu = useRef(false)

  // Itens sem preço ou sem corredor (ex.: os que entraram pela voz): estima uma vez por visita.
  useEffect(() => {
    if (!lista.sem_preco || pediu.current) return
    pediu.current = true
    setLendo(true)
    callFunction('iara-mercado', { action: 'estimar' }).then(() => router.refresh()).catch(() => {}).finally(() => setLendo(false))
  }, [lista.sem_preco, router])

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
    const t = texto.trim(); if (!t) return
    setLendo(true); setErro(null); setMsg(null)
    try {
      const r = await callFunction<{ ok: boolean; itens?: { nome: string; somado: boolean }[] }>('iara-mercado', { action: 'adicionar', texto: t })
      if (!r.ok || !r.itens?.length) throw new Error('sem itens')
      setMsg(r.itens.length === 1 ? `${r.itens[0].nome} ${r.itens[0].somado ? 'somado' : 'na lista'}.` : `${r.itens.length} itens na lista.`)
    } catch {
      // Sem IA: cada pedaço separado por vírgula ou linha entra como item, sem preço (a estimativa tenta de novo depois).
      for (const nome of t.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)) await sb().rpc('hub_mercado_adicionar', { p_nome: nome })
      setMsg('Pus na lista. A estimativa de preço vem em seguida.')
    }
    setTexto(''); setLendo(false); router.refresh()
  }
  async function salvarEdicao() {
    if (!editar) return
    const p: Record<string, unknown> = { quantidade: Number(editar.quantidade.replace(',', '.')) || 1 }
    if (editar.preco.trim()) p.preco_unit = Number(editar.preco.replace(',', '.'))
    if (await rpc('hub_mercado_atualizar', { p_id: editar.id, p }) !== null) setEditar(null)
  }

  const abertos = lista.itens.filter((i) => !i.comprado)
  const comprados = lista.itens.filter((i) => i.comprado)
  const corredores: [string, ItemM[]][] = []
  for (const i of abertos) {
    const c = corredores.find(([n]) => n === i.categoria)
    if (c) c[1].push(i); else corredores.push([i.categoria, [i]])
  }
  const faixa = lista.falta_max - lista.falta_min >= 1

  return (
    <>
      <div className="hello">
        <span className="small muted">{abertos.length ? `Você gastaria · ${abertos.length} ${abertos.length === 1 ? 'item' : 'itens'}` : 'Lista de mercado'}</span>
        <h1>{lista.falta ? `≈ ${brl(lista.falta)}` : abertos.length ? 'Estimando…' : 'Lista vazia'}</h1>
        {(faixa || lista.carrinho > 0 || lendo) && (
          <span className="small muted">
            {[faixa && `entre ${brl0(lista.falta_min)} e ${brl0(lista.falta_max)}`, lista.carrinho > 0 && `${brl(lista.carrinho)} no carrinho`, lendo && 'lendo e estimando…']
              .filter(Boolean).join(' · ')}
          </span>
        )}
      </div>

      <form className="card stack" onSubmit={adicionar} style={{ gap: 8 }}>
        <textarea rows={2} maxLength={600} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="O que precisa comprar"
          placeholder="Ex.: 2 kg de arroz, leite, 1 dúzia de ovos, detergente"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit() } }}
          style={{ resize: 'none' }} />
        <button className="btn" disabled={lendo || busy || !texto.trim()}>{lendo ? 'Lendo a lista…' : 'Adicionar'}</button>
        {lista.sugestoes.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="small" style={{ color: 'var(--dim)' }}>Você costuma comprar</span>
            <div className="chips">
              {lista.sugestoes.map((s) => (
                <button key={s.nome + s.unidade} type="button" className="chip" disabled={busy}
                  onClick={() => rpc('hub_mercado_adicionar', { p_nome: s.nome, p_quantidade: s.quantidade, p_unidade: s.unidade })}>+ {s.nome}</button>
              ))}
            </div>
          </div>
        )}
      </form>
      {msg && <p className="small" role="status" style={{ margin: 0 }}>{msg}</p>}
      {erro && <p className="error" role="alert">{erro}</p>}

      {corredores.map(([cat, itens]) => {
        const sub = itens.reduce((s, i) => s + (i.total ?? 0), 0)
        return (
          <section key={cat} className="card" aria-label={cat}>
            <div className="row between" style={{ marginBottom: 2 }}>
              <span className="small muted">{cat}</span>
              {sub > 0 && <span className="small" style={{ color: 'var(--dim)' }}>{brl(sub)}</span>}
            </div>
            <div className="checklist">{itens.map((i, idx) => linha(i, idx))}</div>
          </section>
        )
      })}
      {comprados.length > 0 && (
        <section className="card" aria-label="No carrinho">
          <div className="row between" style={{ marginBottom: 2 }}>
            <span className="small muted">No carrinho · {brl(lista.carrinho)}</span>
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
            {i.total != null ? `${i.preco_fonte === 'ia' ? '≈ ' : ''}${brl(i.total)}` : '—'}
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
            {i.preco_fonte === 'ia' && i.min != null && i.max != null && i.max > i.min && (
              <span className="small" style={{ color: 'var(--dim)', flexBasis: '100%' }}>A IA estima de {brl(i.min)} a {brl(i.max)} para {qtd(i.quantidade)} {i.unidade}.</span>
            )}
            <button type="button" className="chip on" disabled={busy} onClick={salvarEdicao}>Salvar</button>
            <button type="button" className="chip" disabled={busy} onClick={() => rpc('hub_mercado_arquivar', { p_id: i.id }).then(() => setEditar(null))}>Tirar da lista</button>
          </div>
        )}
      </div>
    )
  }
}
