'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'

export type Meta = {
  id: string; name: string; kind: string | null; priority: number | null; target_amount: number; current_amount: number
  moeda: string | null; target_date: string | null; falta: number; meses: number | null; aporte_necessario: number | null
  ritmo: 'sem_prazo' | 'atrasada' | 'no_ritmo'
}
export type MetasStatus = { metas: Meta[]; aporte_total: number; poupanca_base: number; folga: number; conflito: boolean }

const sb = () => supabaseBrowser() as unknown as SupabaseClient
const TIPOS: [string, string][] = [['imovel', 'Imóvel'], ['carro', 'Carro'], ['reserva', 'Reserva'], ['viagem', 'Viagem'], ['outro', 'Outro']]
const tipoNome = (k: string | null) => TIPOS.find(([v]) => v === k)?.[1] ?? 'Meta'
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 })
const mesAno = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const RITMO: Record<Meta['ritmo'], string> = { sem_prazo: 'sem prazo', atrasada: 'atrasada', no_ritmo: 'no ritmo' }
// "120.000,50" ou "120000.5" -> número
const num = (s: string) => { const t = s.trim(); if (!t) return NaN; return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) }

type Form = { id?: string; name: string; kind: string; target: string; current: string; date: string }
const vazio: Form = { name: '', kind: 'outro', target: '', current: '', date: '' }

/** Metas financeiras do AIrton. Gravar mexe com dinheiro: sempre mostra o resumo e pede confirmação. */
export function MetasBloco({ dados, erro }: { dados: MetasStatus | null; erro: boolean }) {
  const router = useRouter()
  const [form, setForm] = useState<Form | null>(null)
  const [revisar, setRevisar] = useState(false)
  const [cancelar, setCancelar] = useState<Meta | null>(null)
  const [busy, setBusy] = useState(false)
  const [fala, setFala] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  if (erro) return <section className="card alert"><h2>Metas</h2><p className="small" style={{ margin: 0 }}>Não consegui carregar suas metas agora. Tente de novo em instantes.</p></section>
  if (!dados) return <section className="card"><p className="small muted" style={{ margin: 0 }}>Carregando metas…</p></section>

  const metas = dados.metas ?? []
  const fechar = () => { setForm(null); setRevisar(false); setCancelar(null) }

  async function gravar(p: Record<string, unknown>, ok: string) {
    setBusy(true); setAviso(null)
    const { error } = await sb().schema('airton').rpc('goal_salvar', { p })
    setBusy(false)
    if (error) { setAviso('Não deu para salvar. Confira os campos e tente de novo.'); return }
    setFala(ok); fechar(); router.refresh()
  }

  const alvo = form ? num(form.target) : NaN
  const atual = form && form.current.trim() ? num(form.current) : 0
  const valido = !!form && form.name.trim() !== '' && alvo > 0 && atual >= 0
  const resumo = form ? `Salvar meta ${form.name.trim()}: ${brl(alvo)}${form.date ? ` até ${mesAno(form.date)}` : ' sem prazo'}?` : ''

  return (
    <section className="card stack" style={{ gap: 12 }}>
      <div className="row between">
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Metas</h2>
        {!form && <button className="chip" onClick={() => { setForm(vazio); setFala(null); setAviso(null) }}>+ Meta</button>}
      </div>

      {fala && <p className="small" role="status" style={{ margin: 0 }}>{fala}</p>}
      {aviso && <p className="error" role="alert">{aviso}</p>}

      {dados.conflito && (
        <div className="card alert" role="alert">
          <p className="small" style={{ margin: 0 }}>As metas pedem {brl(dados.aporte_total)}/mês e sobra {brl(dados.poupanca_base)}: falta decidir qual cede.</p>
        </div>
      )}

      {!metas.length && !form && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="small" style={{ margin: 0 }}>Nenhuma meta ainda. Crie uma para saber quanto guardar por mês.</p>
          <button className="btn" onClick={() => setForm(vazio)}>+ Criar meta</button>
        </div>
      )}

      {metas.map((m) => (
        <div key={m.id} className="stack" style={{ gap: 4 }}>
          <div className="row between" style={{ gap: 8 }}>
            <strong>{m.name}</strong>
            <span className="row" style={{ gap: 6, flexShrink: 0 }}>
              <button className="chip" onClick={() => { setForm({ id: m.id, name: m.name, kind: m.kind ?? 'outro', target: String(m.target_amount), current: String(m.current_amount ?? 0), date: m.target_date ?? '' }); setRevisar(false); setFala(null) }} aria-label={`Editar ${m.name}`}>Editar</button>
              <button className="chip" onClick={() => { setCancelar(m); setFala(null) }} aria-label={`Cancelar ${m.name}`}>Cancelar</button>
            </span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {tipoNome(m.kind)} · faltam {brl(m.falta)} de {brl(m.target_amount)}{m.target_date ? ` · até ${mesAno(m.target_date)}` : ''} · <span style={{ color: m.ritmo === 'atrasada' ? 'var(--alert)' : undefined }}>{RITMO[m.ritmo]}</span>
          </p>
          {m.aporte_necessario != null && <p className="small" style={{ margin: 0 }}>Precisa de {brl(m.aporte_necessario)}/mês; você guarda {brl(dados.poupanca_base)}.</p>}
          {cancelar?.id === m.id && (
            <div className="stack" style={{ gap: 8 }}>
              <p className="small" role="alert" style={{ margin: 0 }}>Cancelar a meta {m.name}? Ela some da lista, mas o histórico fica guardado.</p>
              <div className="grid2">
                <button className="btn" disabled={busy} onClick={() => gravar({ id: m.id, status: 'cancelada' }, `Meta ${m.name} cancelada.`)}>{busy ? 'Cancelando…' : 'Sim, cancelar'}</button>
                <button className="btn ghost" onClick={() => setCancelar(null)}>Manter</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {form && (
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (!revisar) { if (valido) setRevisar(true); return } gravar({ ...(form.id ? { id: form.id } : {}), name: form.name.trim(), kind: form.kind, target_amount: alvo, current_amount: atual, target_date: form.date || null }, `Salvei a meta ${form.name.trim()}.`) }}>
          <input required placeholder="Nome (ex.: Apartamento)" value={form.name} maxLength={80} disabled={revisar} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Nome da meta" />
          <div className="grid2">
            <select value={form.kind} disabled={revisar} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Tipo">{TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <input type="date" value={form.date} disabled={revisar} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label="Prazo (opcional)" />
          </div>
          <div className="grid2">
            <input required inputMode="decimal" placeholder="Valor alvo (R$)" value={form.target} disabled={revisar} onChange={(e) => setForm({ ...form, target: e.target.value.replace(/[^\d.,]/g, '') })} aria-label="Valor alvo em reais" />
            <input inputMode="decimal" placeholder="Já tenho (R$)" value={form.current} disabled={revisar} onChange={(e) => setForm({ ...form, current: e.target.value.replace(/[^\d.,]/g, '') })} aria-label="Valor atual em reais" />
          </div>
          {revisar && <p className="small" role="alert" style={{ margin: 0 }}><strong>{resumo}</strong></p>}
          <div className="grid2">
            <button className="btn" disabled={busy || !valido}>{busy ? 'Salvando…' : revisar ? 'Sim, salvar' : 'Revisar'}</button>
            <button type="button" className="btn ghost" onClick={revisar ? () => setRevisar(false) : fechar}>{revisar ? 'Voltar' : 'Cancelar'}</button>
          </div>
        </form>
      )}
    </section>
  )
}
