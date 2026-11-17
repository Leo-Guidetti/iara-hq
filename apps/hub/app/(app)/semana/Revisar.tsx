'use client'
import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'
import { falar, pararVoz, temVoz } from '@/components/Ouvir'

type Decisao = { id: string; pergunta: string; opcoes: string[]; padrao?: string | null; escolha?: string | null }
type Ouvir = { plano_id: number | null; fala: string | null; decisoes: Decisao[]; pendentes: number } | null
type Resp = { ok: boolean; motivo?: string; fala?: string; proxima?: Decisao | null; pendentes?: number; pronto_para_confirmar?: boolean }

const sb = () => supabaseBrowser() as unknown as SupabaseClient

/** "Revisar falando": uma decisão por vez, por voz do navegador (ou só texto). A confirmação final é do Plano (UX-16). */
export function Revisar({ planoId, onConfirmar, onFechar, busy }: { planoId: number; onConfirmar: () => void; onFechar: () => void; busy: boolean }) {
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [fala, setFala] = useState<string | null>(null)
  const [atual, setAtual] = useState<Decisao | null>(null)
  const [pronto, setPronto] = useState(false)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [lendo, setLendo] = useState(false)
  const voz = temVoz()

  const dizer = (t: string | null | undefined) => { if (t && voz) { setLendo(true); falar(t, () => setLendo(false)) } }

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data, error } = await sb().rpc('hub_semana_ouvir')
      if (!vivo) return
      setCarregando(false)
      const r = data as Ouvir
      if (error || !r || !r.plano_id) { setErro('Não consegui abrir a revisão agora. Tente de novo.'); return }
      const prox = r.decisoes.find((d) => d.escolha == null) ?? null
      setFala(r.fala); setAtual(prox); setPronto(!prox || r.pendentes === 0)
      dizer([r.fala, prox?.pergunta ?? 'Confirma a semana?'].filter(Boolean).join('. '))
    })()
    return () => { vivo = false; pararVoz() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function escolher(op: string) {
    if (!atual) return
    pararVoz(); setLendo(false); setEnviando(op); setErro(null)
    const { data, error } = await sb().rpc('hub_semana_responder', { p_plano: planoId, p_escolha: op, p_decisao: atual.id })
    setEnviando(null)
    const r = data as Resp | null
    if (error || !r) { setErro('Não consegui registrar. Tente de novo.'); return }
    setFala(r.fala ?? null)
    if (!r.ok) { if (r.proxima) setAtual(r.proxima); dizer(r.fala); return }
    const prox = r.proxima ?? null
    setAtual(prox); setPronto(!!r.pronto_para_confirmar || !prox)
    dizer(r.pronto_para_confirmar || !prox ? `${r.fala ?? ''} Confirma a semana?` : r.fala)
  }

  return (
    <section className="card ai stack" style={{ gap: 8 }} aria-label="Revisar falando" aria-live="polite">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Revisar falando</strong>
        <span className="row" style={{ gap: 6 }}>
          {voz && lendo && <button type="button" className="chip" onClick={() => { pararVoz(); setLendo(false) }}>Parar</button>}
          <button type="button" className="chip" onClick={() => { pararVoz(); onFechar() }}>Fechar</button>
        </span>
      </div>
      {carregando && <p className="small muted" style={{ margin: 0 }}>Preparando a revisão…</p>}
      {erro && <p className="error">{erro}</p>}
      {fala && <p style={{ margin: 0 }}>{fala}</p>}
      {!carregando && !erro && atual && !pronto && (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{atual.pergunta}</p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {atual.opcoes.map((o) => (
              <button key={o} className={`btn ${o === atual.padrao ? '' : 'ghost'}`} disabled={!!enviando} onClick={() => escolher(o)}>{enviando === o ? 'Salvando…' : o}</button>
            ))}
          </div>
        </div>
      )}
      {!carregando && !erro && pronto && (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Confirma a semana?</p>
          <button className="btn" disabled={busy} onClick={() => { pararVoz(); onConfirmar(); onFechar() }}>Sim, revisar e confirmar</button>
        </div>
      )}
      {!voz && !carregando && <p className="small muted" style={{ margin: 0 }}>Sem voz neste navegador: segue só em texto.</p>}
    </section>
  )
}
