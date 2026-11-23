'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'

export type Tarefa = { id: number; tipo: string; titulo: string; detalhe: string | null; data: string; minutos: number | null; status: string }

const sb = () => supabaseBrowser() as unknown as SupabaseClient
const DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function quando(data: string, hoje: string) {
  if (data < hoje) return 'atrasada'
  if (data === hoje) return 'hoje'
  const d = new Date(`${data}T12:00:00Z`), h = new Date(`${hoje}T12:00:00Z`)
  const dias = Math.round((+d - +h) / 864e5)
  return dias === 1 ? 'amanhã' : DIA[d.getUTCDay()]
}

/** Tarefas da casa da semana: marcar = feito (desmarcar volta a pendente) e "Nova tarefa". */
export function Tarefas({ itens, hoje }: { itens: Tarefa[]; hoje: string }) {
  const router = useRouter()
  const [erro, setErro] = useState<string | null>(null)
  const [fala, setFala] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nova, setNova] = useState<{ titulo: string; data: string } | null>(null)

  async function marcar(t: Tarefa, feito: boolean) {
    setErro(null)
    const { error } = await sb().rpc('hub_item_status', { p_id: t.id, p_status: feito ? 'feito' : 'pendente' })
    if (error) setErro('Não deu para salvar. Tente de novo.')
    else router.refresh()
  }
  async function criar(e: React.FormEvent) {
    e.preventDefault(); if (!nova) return
    setBusy(true); setErro(null)
    const { data, error } = await sb().rpc('hub_tarefa_criar', { p_titulo: nova.titulo, p_data: nova.data || null })
    setBusy(false)
    if (error) { setErro(error.message && /^(Escreva|A data)/.test(error.message) ? error.message : 'Não deu para salvar. Tente de novo.'); return }
    setFala(String((data as { fala?: string } | null)?.fala ?? 'Anotado.')); setNova(null); router.refresh()
  }

  return (
    <>
      <section className="card" aria-label="Tarefas">
        {itens.length ? (
          <div className="checklist">
            {itens.map((t) => {
              const feito = t.status === 'feito'
              const q = feito ? 'feito' : quando(t.data, hoje)
              return (
                <label key={t.id} className={feito ? 'feito' : undefined}>
                  <input type="checkbox" checked={feito} onChange={(e) => marcar(t, e.target.checked)} />
                  <span style={{ flex: 1 }}>{t.titulo}</span>
                  <small style={{ marginLeft: 'auto', color: q === 'atrasada' || q === 'hoje' ? 'var(--accent)' : 'var(--dim)' }}>{q === 'hoje' ? 'hoje' : q}</small>
                </label>
              )
            })}
          </div>
        ) : <p className="small muted" style={{ margin: 0 }}>Nenhuma tarefa da casa nesta semana.</p>}
      </section>
      {fala && <p className="small" role="status" style={{ margin: 0 }}>{fala}</p>}
      {erro && <p className="error" role="alert">{erro}</p>}
      {nova ? (
        <form className="card stack" style={{ gap: 8 }} onSubmit={criar}>
          <input required autoFocus placeholder="Ex.: Trocar o filtro de água" maxLength={200} value={nova.titulo} onChange={(e) => setNova({ ...nova, titulo: e.target.value })} aria-label="Tarefa" />
          <input type="date" min={hoje} value={nova.data} onChange={(e) => setNova({ ...nova, data: e.target.value })} aria-label="Quando (opcional, padrão hoje)" />
          <div className="grid2">
            <button className="btn" disabled={busy || !nova.titulo.trim()}>{busy ? 'Salvando…' : 'Adicionar'}</button>
            <button type="button" className="btn ghost" onClick={() => setNova(null)}>Cancelar</button>
          </div>
        </form>
      ) : <button className="btn ghost" onClick={() => { setNova({ titulo: '', data: '' }); setFala(null) }}>Nova tarefa</button>}
    </>
  )
}
