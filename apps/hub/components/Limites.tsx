'use client'
import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'

export type AvisosCfg = { max_dia: number; silencio_inicio: string; silencio_fim: string; enviados_hoje: number }

/** Limites dos avisos da IARA: teto por dia (0–10) e horário de silêncio. */
export function Limites({ cfg }: { cfg: AvisosCfg | null }) {
  const [max, setMax] = useState(String(cfg?.max_dia ?? 3))
  const [ini, setIni] = useState(cfg?.silencio_inicio ?? '23:00')
  const [fim, setFim] = useState(cfg?.silencio_fim ?? '07:00')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ t: string; erro: boolean } | null>(null)
  const [atual, setAtual] = useState(cfg?.max_dia ?? 3)

  if (!cfg) return <section className="card stack" style={{ gap: 8 }}><h2 style={{ margin: 0 }}>Limites</h2><p className="small muted" style={{ margin: 0 }}>Não consegui carregar os limites agora.</p></section>

  async function salvar() {
    const n = Number(max)
    if (!Number.isInteger(n) || n < 0 || n > 10) { setMsg({ t: 'O máximo por dia fica entre 0 e 10.', erro: true }); return }
    setBusy(true); setMsg(null)
    const { data, error } = await (supabaseBrowser() as unknown as SupabaseClient).rpc('hub_interrupcoes_salvar', { p: { max_dia: n, silencio_inicio: ini, silencio_fim: fim } })
    setBusy(false)
    const r = data as { ok?: boolean; fala?: string; interrupcoes?: { max_dia: number } } | null
    if (error || !r?.ok) { setMsg({ t: 'Não consegui salvar. Confira os valores e tente de novo.', erro: true }); return }
    setAtual(r.interrupcoes?.max_dia ?? n)
    setMsg({ t: r.fala || 'Salvo.', erro: false })
  }

  return (
    <section className="card stack" style={{ gap: 8 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>Limites</h2>
        <span className="small muted">enviados hoje: {cfg.enviados_hoje} de {atual}</span>
      </div>
      <label className="small">Máximo de avisos por dia (0 a 10)
        <input type="number" inputMode="numeric" min={0} max={10} value={max} onChange={(e) => setMax(e.target.value)} />
      </label>
      <div className="grid2">
        <label className="small">Silêncio: início
          <input type="time" value={ini} onChange={(e) => setIni(e.target.value)} />
        </label>
        <label className="small">Silêncio: fim
          <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} />
        </label>
      </div>
      <button className="btn" disabled={busy || !ini || !fim} onClick={salvar}>{busy ? 'Salvando…' : 'Salvar limites'}</button>
      {msg && <p className={msg.erro ? 'error small' : 'small muted'} style={{ margin: 0 }} aria-live="polite">{msg.t}</p>}
    </section>
  )
}
