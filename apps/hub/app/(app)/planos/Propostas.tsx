'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabase/client'
import { ddmm } from '../semana/tipos'

export type Proposta = {
  id: number; plano_id: number; plano: string; meta_id: number; meta: string
  campo: 'prazo' | 'demanda' | 'medida' | 'status'
  atual: unknown; valor: unknown; motivo: string; status: string; origem: string; created_at: string
}

const STATUS: Record<string, string> = { pausada: 'pausada', concluida: 'concluída', cancelada: 'cancelada', ativa: 'ativa' }
const num = (v: number) => v.toLocaleString('pt-BR')
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function fmt(campo: Proposta['campo'], v: unknown): string {
  if (v == null || v === '') return 'sem valor'
  const o = (typeof v === 'object' ? v : {}) as Record<string, unknown>
  if (campo === 'prazo') return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? `${ddmm(String(v).slice(0, 10))}/${String(v).slice(0, 4)}` : String(v)
  if (campo === 'status') return STATUS[String(v)] ?? String(v)
  if (campo === 'medida') return o.alvo != null ? `alvo ${String(o.alvo)}` : 'sem valor'
  const p = [o.reais_mes != null ? `${brl(Number(o.reais_mes))}/mês` : null, o.minutos_semana != null ? `${num(Number(o.minutos_semana))} min/semana` : null].filter(Boolean)
  return p.length ? p.join(' · ') : 'sem valor'
}
const ROTULO = { prazo: 'o prazo', demanda: 'a demanda', medida: 'a medida', status: 'o status' } as const

function Cartao({ p }: { p: Proposta }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [conf, setConf] = useState(false)
  const [feito, setFeito] = useState<string | null>(null)
  const de = fmt(p.campo, p.atual), para = fmt(p.campo, p.valor)

  async function decidir(aceitar: boolean) {
    setBusy(true); setErro(null)
    const { data, error } = await supabaseBrowser().rpc('hub_proposta_decidir', { p_id: p.id, p_aceitar: aceitar })
    setBusy(false)
    if (error) {
      setErro(error.message.includes('não encontrada') ? 'Proposta não encontrada.' : 'Não consegui registrar agora. Tente de novo.')
      setConf(false); return
    }
    const r = data as { status?: string; ja_decidida?: boolean } | null
    setFeito(r?.ja_decidida ? `Esta proposta já estava ${r.status === 'aceita' ? 'aceita' : 'recusada'}.` : aceitar ? 'Ajuste aplicado.' : 'Proposta recusada.')
    setConf(false)
    router.refresh()
  }

  return (
    <section className="card stack" style={{ gap: 8 }}>
      <span className="tag ai">{p.plano} › {p.meta}</span>
      <p style={{ margin: 0 }}><strong>De {de} para {para}</strong> <span className="small muted">({ROTULO[p.campo] ?? p.campo})</span></p>
      <p className="small" style={{ margin: 0 }}>{p.motivo}</p>
      {feito ? <p className="small" style={{ margin: 0 }}>{feito}</p> : conf ? (
        <div className="stack" style={{ gap: 6 }}>
          <p style={{ margin: 0 }}><strong>Mudar {ROTULO[p.campo] ?? p.campo} de {p.meta} de {de} para {para}?</strong></p>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => decidir(true)}>{busy ? 'Aplicando…' : 'Sim'}</button>
            <button className="btn ghost" disabled={busy} onClick={() => setConf(false)}>Voltar</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => setConf(true)}>Aceitar</button>
          <button className="btn ghost" disabled={busy} onClick={() => decidir(false)}>{busy ? 'Registrando…' : 'Recusar'}</button>
        </div>
      )}
      {erro && <p className="error">{erro}</p>}
    </section>
  )
}

export function Propostas({ itens }: { itens: Proposta[] }) {
  if (!itens.length) return null
  return (
    <div id="propostas" className="stack">
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Propostas da IARA</h2>
      {itens.map((p) => <Cartao key={p.id} p={p} />)}
    </div>
  )
}
