'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction } from '@/lib/functions'

/** Quando a trilha do dia não saiu (cron falhou), o Leo pede à SabIA na hora. Só gera se ainda não existir. */
export function GerarTrilha() {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  async function gerar() {
    setErro(null); setMsg('A SabIA está montando a trilha… (1 a 2 min)')
    try {
      await callFunction('sabia-trilha', {})
      setTimeout(() => { setMsg(null); router.refresh() }, 90_000)
    } catch (e) { setMsg(null); setErro((e as Error).message) }
  }
  return (
    <section className="card stack" style={{ gap: 8 }}>
      <p className="small" style={{ margin: 0 }}>A trilha de hoje ainda não saiu.</p>
      <button className="btn" disabled={!!msg} onClick={gerar}>{msg ?? '✦ Gerar a trilha de hoje'}</button>
      {erro && <p className="error">{erro}</p>}
    </section>
  )
}
