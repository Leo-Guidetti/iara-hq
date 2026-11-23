'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'
import { Mais } from '@/components/Mais'

import type { Tarefa } from './proximas'
export type { Tarefa } from './proximas'
export type Recorrencia = { id: number; titulo: string; freq: Freq; dias: number[]; dia_mes: number | null; intervalo: number | null; inicio: string; hora: string | null }
type Freq = 'diaria' | 'semanal' | 'mensal' | 'intervalo'
type Nova = { titulo: string; data: string; hora: string; freq: '' | Freq; dias: number[]; intervalo: string }

const sb = () => supabaseBrowser() as unknown as SupabaseClient
const DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const ISO = [[1, 'seg'], [2, 'ter'], [3, 'qua'], [4, 'qui'], [5, 'sex'], [6, 'sáb'], [7, 'dom']] as const
const SINO = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
const REPETE = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="repete"><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>

function quando(data: string, hoje: string) {
  if (data < hoje) return 'atrasada'
  if (data === hoje) return 'hoje'
  const d = new Date(`${data}T12:00:00Z`), h = new Date(`${hoje}T12:00:00Z`)
  const dias = Math.round((+d - +h) / 864e5)
  return dias === 1 ? 'amanhã' : DIA[d.getUTCDay()]
}

function regra(r: Recorrencia) {
  const base = r.freq === 'diaria' ? 'todo dia'
    : r.freq === 'semanal' ? `toda ${r.dias.length === 7 ? 'semana' : r.dias.map((d) => ISO.find(([n]) => n === d)?.[1]).join(', ')}`
    : r.freq === 'mensal' ? `todo dia ${r.dia_mes}` : `a cada ${r.intervalo} dias`
  return r.hora ? `${base} · ${r.hora}` : base
}

/** Tarefas da casa: marcar = feito; sino = lembrete com hora; "Nova tarefa" com data, lembrete e repetição. */
export function Tarefas({ itens, recs, hoje }: { itens: Tarefa[]; recs: Recorrencia[]; hoje: string }) {
  const router = useRouter()
  const [erro, setErro] = useState<string | null>(null)
  const [fala, setFala] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nova, setNova] = useState<Nova | null>(null)
  const [sino, setSino] = useState<{ id: number; hora: string } | null>(null)

  async function rodar(fn: string, args: Record<string, unknown>, ok?: (d: unknown) => void) {
    setBusy(true); setErro(null)
    const { data, error } = await sb().rpc(fn, args)
    setBusy(false)
    if (error) { setErro(error.message && /^(Escreva|A data|Escolha|Hora)/.test(error.message) ? error.message : 'Não deu para salvar. Tente de novo.'); return }
    ok?.(data); router.refresh()
  }
  const marcar = (t: Tarefa, feito: boolean) => rodar('hub_item_status', { p_id: t.id, p_status: feito ? 'feito' : 'pendente' })
  const lembrete = (id: number, hora: string | null) => rodar('hub_tarefa_lembrete', { p_id: id, p_hora: hora }, () => {
    setSino(null); setFala(hora ? `Eu te lembro às ${hora}.` : 'Tirei o lembrete.')
  })
  function criar(e: React.FormEvent) {
    e.preventDefault(); if (!nova) return
    const repetir = nova.freq ? { freq: nova.freq, dias: nova.dias, intervalo: nova.freq === 'intervalo' ? Number(nova.intervalo) || 2 : undefined } : null
    rodar('hub_tarefa_salvar', { p: { titulo: nova.titulo, data: nova.data || null, hora: nova.hora || null, repetir } }, (d) => {
      setFala(String((d as { fala?: string } | null)?.fala ?? 'Anotado.')); setNova(null)
    })
  }
  const dow = (iso: string) => { const d = new Date(`${iso || hoje}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d }

  return (
    <>
      <section className="card" aria-label="Tarefas">
        {itens.length ? (
          <div className="checklist">
            {itens.map((t, idx) => {
              const feito = t.status === 'feito'
              const q = feito ? 'feito' : quando(t.data, hoje)
              return (
                <div key={t.id} style={idx ? { borderTop: '1px solid var(--line)' } : undefined}>
                  <label className={feito ? 'feito' : undefined}>
                    <input type="checkbox" checked={feito} disabled={busy} onChange={(e) => marcar(t, e.target.checked)} />
                    <span style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{t.titulo}{t.rec != null && <span style={{ color: 'var(--dim)', display: 'inline-flex' }}>{REPETE}</span>}</span>
                    {!feito && (
                      <button type="button" className="chip" aria-label={t.hora ? `Lembrete às ${t.hora}` : 'Adicionar lembrete'}
                        style={{ padding: '4px 8px', minHeight: 0, display: 'inline-flex', gap: 4, alignItems: 'center', color: t.hora ? 'var(--accent)' : 'var(--dim)' }}
                        onClick={(e) => { e.preventDefault(); setSino(sino?.id === t.id ? null : { id: t.id, hora: t.hora ?? '' }) }}>
                        {SINO}{t.hora && <small>{t.hora}</small>}
                      </button>
                    )}
                    <small style={{ minWidth: 52, textAlign: 'right', color: q === 'atrasada' || q === 'hoje' ? 'var(--accent)' : 'var(--dim)' }}>{q}</small>
                  </label>
                  {sino?.id === t.id && (
                    <div className="row" style={{ gap: 8, padding: '0 0 12px 32px' }}>
                      <input type="time" step={900} value={sino.hora} onChange={(e) => setSino({ ...sino, hora: e.target.value })} aria-label="Hora do lembrete" style={{ width: 132, flex: 'none', padding: '8px 10px' }} />
                      <button type="button" className="chip on" disabled={busy || !sino.hora} onClick={() => lembrete(t.id, sino.hora)}>Lembrar</button>
                      {t.hora && <button type="button" className="chip" disabled={busy} onClick={() => lembrete(t.id, null)}>Tirar</button>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : <p className="small muted" style={{ margin: 0 }}>Nenhuma tarefa da casa nesta semana.</p>}
      </section>
      {fala && <p className="small" role="status" style={{ margin: 0 }}>{fala}</p>}
      {erro && <p className="error" role="alert">{erro}</p>}
      {nova ? (
        <form className="card stack" style={{ gap: 10 }} onSubmit={criar}>
          <input required autoFocus placeholder="Ex.: Trocar o filtro de água" maxLength={200} value={nova.titulo} onChange={(e) => setNova({ ...nova, titulo: e.target.value })} aria-label="Tarefa" />
          <div className="grid2">
            <label className="small muted stack" style={{ gap: 4 }}>{nova.freq ? 'Começa em' : 'Quando'}
              <input type="date" min={hoje} value={nova.data} onChange={(e) => setNova({ ...nova, data: e.target.value })} />
            </label>
            <label className="small muted stack" style={{ gap: 4 }}>Lembrar às (opcional)
              <input type="time" step={900} value={nova.hora} onChange={(e) => setNova({ ...nova, hora: e.target.value })} />
            </label>
          </div>
          <label className="small muted stack" style={{ gap: 4 }}>Repetir
            <select value={nova.freq} onChange={(e) => {
              const freq = e.target.value as Nova['freq']
              setNova({ ...nova, freq, dias: freq === 'semanal' && !nova.dias.length ? [dow(nova.data)] : nova.dias })
            }}>
              <option value="">Não repete</option>
              <option value="diaria">Todo dia</option>
              <option value="semanal">Toda semana</option>
              <option value="mensal">Todo mês (mesmo dia)</option>
              <option value="intervalo">A cada alguns dias</option>
            </select>
          </label>
          {nova.freq === 'semanal' && (
            <div className="chips" role="group" aria-label="Dias da semana">
              {ISO.map(([n, nome]) => {
                const on = nova.dias.includes(n)
                return <button key={n} type="button" className={on ? 'chip on' : 'chip'} aria-pressed={on}
                  onClick={() => setNova({ ...nova, dias: on ? nova.dias.filter((d) => d !== n) : [...nova.dias, n] })}>{nome}</button>
              })}
            </div>
          )}
          {nova.freq === 'intervalo' && (
            <label className="small muted row" style={{ gap: 8 }}>A cada
              <input type="number" min={2} max={365} inputMode="numeric" value={nova.intervalo} onChange={(e) => setNova({ ...nova, intervalo: e.target.value })} style={{ maxWidth: 90 }} />
              dias
            </label>
          )}
          <div className="grid2">
            <button className="btn" disabled={busy || !nova.titulo.trim() || (nova.freq === 'semanal' && !nova.dias.length)}>{busy ? 'Salvando…' : 'Adicionar'}</button>
            <button type="button" className="btn ghost" onClick={() => setNova(null)}>Cancelar</button>
          </div>
        </form>
      ) : <button className="btn ghost" onClick={() => { setNova({ titulo: '', data: '', hora: '', freq: '', dias: [], intervalo: '7' }); setFala(null) }}>Nova tarefa</button>}
      {recs.length > 0 && (
        <Mais rotulo={`Repetem (${recs.length})`}>
          <div className="checklist">
            {recs.map((r) => (
              <div key={r.id} className="row between" style={{ padding: '10px 0', borderTop: '1px solid var(--line)', gap: 8 }}>
                <span><span>{r.titulo}</span><br /><small style={{ color: 'var(--dim)' }}>{regra(r)}</small></span>
                <button type="button" className="chip" disabled={busy} onClick={() => rodar('hub_recorrencia_parar', { p_id: r.id }, () => setFala(`Parei de repetir: ${r.titulo}.`))}>Parar</button>
              </div>
            ))}
          </div>
        </Mais>
      )}
      <p className="small" style={{ color: 'var(--dim)', margin: 0 }}>Lembretes chegam por notificação no horário (com até 15 min de folga) e saem mesmo fora do limite diário de avisos.</p>
    </>
  )
}
