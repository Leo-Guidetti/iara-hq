'use client'
// UX-23: ditado pelo reconhecimento de voz do navegador (Web Speech API; no iPhone/iPad, o Safari usa o reconhecimento da Apple).
// Idioma fixo pt-BR: o iPhone do Leo está em inglês e, sem isso, a transcrição sairia em inglês. Sem suporte, `suportado` = false
// e o botão de microfone não aparece. Custo zero (nada passa por IA para transcrever).
import { useCallback, useEffect, useRef, useState } from 'react'

type Alternativa = { transcript: string }
type Resultado = { isFinal: boolean; 0: Alternativa; length: number }
type Evento = { resultIndex: number; results: { length: number; [i: number]: Resultado } }
type Reconhecedor = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number
  onresult: ((e: Evento) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null
  start: () => void; stop: () => void; abort: () => void
}
type Construtor = new () => Reconhecedor

/** Para o reconhecedor sem disparar nada depois (desmontado ou trocado por outro). */
function soltar(r: Reconhecedor | null) {
  if (!r) return
  r.onresult = null; r.onerror = null; r.onend = null
  try { r.abort() } catch { /* já parado */ }
}

function construtor(): Construtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: Construtor; webkitSpeechRecognition?: Construtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const ERROS: Record<string, string> = {
  'not-allowed': 'Microfone bloqueado. Libere o microfone para este site nos ajustes do navegador.',
  'service-not-allowed': 'Microfone bloqueado. Libere o microfone para este site nos ajustes do navegador.',
  'audio-capture': 'Não achei microfone.',
  network: 'Sem conexão para reconhecer a voz.',
}

/** Ditado em pt-BR: `iniciar(aoFinal)` escuta uma frase e chama aoFinal com o texto final. */
export function useDitado() {
  const [suportado, setSuportado] = useState(false)
  const [ouvindo, setOuvindo] = useState(false)
  const [parcial, setParcial] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const rec = useRef<Reconhecedor | null>(null)

  useEffect(() => {
    setSuportado(!!construtor())
    return () => soltar(rec.current)
  }, [])

  const parar = useCallback(() => { try { rec.current?.stop() } catch { /* já parado */ } }, [])

  const iniciar = useCallback((aoFinal: (texto: string) => void) => {
    const C = construtor()
    if (!C) return
    soltar(rec.current)
    const r = new C()
    r.lang = 'pt-BR'
    r.continuous = false
    r.interimResults = true
    r.maxAlternatives = 1
    let final = ''
    r.onresult = (e) => {
      let meio = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) final += res[0].transcript
        else meio += res[0].transcript
      }
      setParcial((final + meio).trim())
    }
    r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') setErro(ERROS[e.error] ?? 'Não consegui ouvir. Tente de novo.') }
    r.onend = () => {
      if (rec.current !== r) return
      setOuvindo(false)
      setParcial('')
      rec.current = null
      if (final.trim()) aoFinal(final.trim())
    }
    rec.current = r
    setErro(null)
    setParcial('')
    setOuvindo(true)
    try { r.start() } catch { setOuvindo(false); setErro('Não consegui abrir o microfone.') }
  }, [])

  return { suportado, ouvindo, parcial, erro, iniciar, parar }
}
