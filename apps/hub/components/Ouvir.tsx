'use client'
import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'

const sb = () => supabaseBrowser() as unknown as SupabaseClient

const semMarkdown = (t: string) => t
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/https?:\/\/\S+/g, '')
  .replace(/^\s{0,3}#{1,6}\s*/gm, '')
  .replace(/[*_`#>]/g, '')
  .replace(/\n{2,}/g, '. ')
  .trim()

export const temVoz = () => typeof window !== 'undefined' && 'speechSynthesis' in window
export function pararVoz() { try { window.speechSynthesis?.cancel() } catch { /* sem voz */ } }
/** iOS Safari só fala depois de um toque: chame no gesto (clique do microfone) para liberar a fala que vem depois da rede. */
export function destravarVoz() {
  if (!temVoz()) return
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u) } catch { /* sem voz */ }
}
/** Fala o texto em pt-BR com a voz do navegador; sem voz, não faz nada. */
export function falar(texto: string, aoFim?: () => void) {
  if (!temVoz() || !texto.trim()) { aoFim?.(); return }
  const ss = window.speechSynthesis
  const u = new SpeechSynthesisUtterance(texto.trim())
  u.lang = 'pt-BR'
  const v = ss.getVoices().find((x) => x.lang.toLowerCase().startsWith('pt-br')) ?? ss.getVoices().find((x) => x.lang.toLowerCase().startsWith('pt'))
  if (v) u.voice = v
  u.onend = () => aoFim?.()
  u.onerror = () => aoFim?.()
  ss.cancel()
  ss.speak(u)
}

/** Lê o briefing em voz alta com a voz do navegador (sem custo). Segundo toque para. */
export function Ouvir({ id, fala, texto }: { id: number; fala?: string | null; texto: string }) {
  const [ok, setOk] = useState(false)
  const [lendo, setLendo] = useState(false)
  const marcado = useRef(false)

  useEffect(() => {
    setOk(typeof window !== 'undefined' && 'speechSynthesis' in window)
    return () => { try { window.speechSynthesis?.cancel() } catch { /* sem voz */ } }
  }, [])

  if (!ok) return null

  const fim = () => {
    setLendo(false)
    if (marcado.current) return
    marcado.current = true
    Promise.resolve(sb().rpc('hub_briefing_lido', { p_id: id })).catch(() => {})
  }

  const alternar = () => {
    const ss = window.speechSynthesis
    if (lendo) { ss.cancel(); fim(); return }
    const u = new SpeechSynthesisUtterance(fala?.trim() || semMarkdown(texto))
    u.lang = 'pt-BR'
    const v = ss.getVoices().find((x) => x.lang.toLowerCase().startsWith('pt-br')) ?? ss.getVoices().find((x) => x.lang.toLowerCase().startsWith('pt'))
    if (v) u.voice = v
    u.onend = fim
    u.onerror = () => setLendo(false)
    ss.cancel()
    setLendo(true)
    ss.speak(u)
  }

  return <button type="button" className="chip" onClick={alternar} aria-pressed={lendo}>{lendo ? 'Parar' : 'Ouvir'}</button>
}
