'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'
import { Logo } from '@/components/Logo'
import type { LogoKey } from '@/lib/apps'

export type ItemDia = { id: number; origem: string; titulo: string; minutos: number | null }

const LOGO_DA_ORIGEM: Record<string, LogoKey> = { iara: 'casa', claudia: 'claudia', airton: 'airton', sabia: 'sabia' }

/** Checklist diário: a fila de hoje (core.itens). Marcar = feito; desmarcar na hora volta para pendente.
 * `adicionar` (data de hoje): campo "Adicionar ao checklist…", só no desktop (cria uma tarefa da IARA para o dia). */
export function Checklist({ itens, adicionar }: { itens: ItemDia[]; adicionar?: string }) {
  const router = useRouter()
  const [feitos, setFeitos] = useState<Set<number>>(new Set())
  const [erro, setErro] = useState<string | null>(null)
  const [novo, setNovo] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function criar() {
    const t = novo.trim()
    if (!t || salvando || !adicionar) return
    setSalvando(true); setErro(null)
    const { error } = await (supabaseBrowser() as unknown as SupabaseClient).rpc('hub_tarefa_criar', { p_titulo: t, p_data: adicionar })
    setSalvando(false)
    if (error) { setErro('Não deu para adicionar. Tente de novo.'); return }
    setNovo(''); router.refresh()
  }
  const campo = adicionar ? (
    <form className="so-desktop" onSubmit={(e) => { e.preventDefault(); criar() }} style={{ marginTop: 8 }}>
      <input aria-label="Adicionar ao checklist" placeholder="Adicionar ao checklist…" value={novo} disabled={salvando} onChange={(e) => setNovo(e.target.value)} />
    </form>
  ) : null

  async function marcar(id: number, feito: boolean) {
    setErro(null)
    const antes = feitos
    const novo = new Set(feitos); if (feito) novo.add(id); else novo.delete(id)
    setFeitos(novo)
    const { error } = await (supabaseBrowser() as unknown as SupabaseClient).rpc('hub_item_status', { p_id: id, p_status: feito ? 'feito' : 'pendente' })
    if (error) { setFeitos(antes); setErro('Não deu para salvar. Tente de novo.') }
    else router.refresh()
  }

  if (!itens.length) return <><p className="small muted" style={{ margin: 0 }}>Nada no checklist de hoje.</p>{campo}</>
  return (
    <>
    <div className="checklist">
      {itens.map((i) => {
        const on = feitos.has(i.id)
        const logo = LOGO_DA_ORIGEM[i.origem]
        return (
          <label key={i.id} className={on ? 'feito' : undefined}>
            <input type="checkbox" checked={on} onChange={(e) => marcar(i.id, e.target.checked)} />
            <span>{i.titulo}{i.minutos ? <span className="muted"> · {i.minutos} min</span> : null}</span>
            {logo && <Logo app={logo} tamanho={18} />}
          </label>
        )
      })}
      {erro && <p className="error">{erro}</p>}
    </div>
    {campo}
    </>
  )
}
