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
/**
 * A voz padrão do navegador costuma ser a mais robótica (Microsoft Maria no Windows, Luciana compacta no iPhone).
 * Escolhe a melhor voz pt-BR instalada: neurais/online (Edge "Francisca Online (Natural)", "Google português do Brasil")
 * e as versões Premium/Enhanced do iOS e do macOS vêm antes das compactas.
 */
export function melhorVoz(vozes: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const nota = (v: SpeechSynthesisVoice) => {
    const lang = v.lang.toLowerCase().replace('_', '-')
    const nome = v.name.toLowerCase()
    let n = lang.startsWith('pt-br') ? 100 : lang.startsWith('pt') ? 40 : -1000
    if (/natural|neural|online/.test(nome)) n += 50
    if (/premium/.test(nome)) n += 45
    if (/enhanced|aprimorad|melhorad/.test(nome)) n += 35
    if (/google/.test(nome)) n += 30
    if (/compact|espeak|maria\b/.test(nome)) n -= 20
    if (v.localService === false) n += 5
    return n
  }
  return [...vozes].sort((a, b) => nota(b) - nota(a)).find((v) => nota(v) > 0)
}

/** Fala o texto em pt-BR com a melhor voz do aparelho; sem voz, não faz nada. */
export function falar(texto: string, aoFim?: () => void) {
  if (!temVoz() || !texto.trim()) { aoFim?.(); return }
  const ss = window.speechSynthesis
  const u = new SpeechSynthesisUtterance(texto.trim())
  u.lang = 'pt-BR'
  const v = melhorVoz(ss.getVoices())
  if (v) { u.voice = v; u.lang = v.lang }
  u.onend = () => aoFim?.()
  u.onerror = () => aoFim?.()
  ss.cancel()
  ss.speak(u)
}

/** Lê o briefing em voz alta com a melhor voz do aparelho (sem custo). Segundo toque para. */
export function Ouvir({ id, fala, texto }: { id: number; fala?: string | null; texto: string }) {
  const [ok, setOk] = useState(false)
  const [lendo, setLendo] = useState(false)
  const marcado = useRef(false)

  useEffect(() => {
    setOk(temVoz())
    // O Chrome carrega a lista de vozes depois da página: pedir agora deixa a melhor pronta no toque.
    if (temVoz()) { window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices() }
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
    if (lendo) { pararVoz(); fim(); return }
    setLendo(true)
    falar(fala?.trim() || semMarkdown(texto), fim)
  }

  return <button type="button" className="chip" onClick={alternar} aria-pressed={lendo}>{lendo ? 'Parar' : 'Ouvir'}</button>
}
