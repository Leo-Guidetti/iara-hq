'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction } from '@/lib/functions'

export default function StravaCallback() {
  const router = useRouter()
  const done = useRef(false)
  const [msg, setMsg] = useState('Conectando ao Strava…')
  useEffect(() => {
    if (done.current) return
    done.current = true
    const q = new URLSearchParams(location.search)
    let expected: string | null = null
    try { expected = sessionStorage.getItem('strava_state') } catch {}
    if (q.get('error')) return setMsg('Autorização cancelada no Strava.')
    if (!q.get('code')) return setMsg('Retorno sem código do Strava.')
    if (expected && q.get('state') !== expected) return setMsg('Estado inválido: tente conectar de novo.')
    callFunction<{ imported: number }>('claudia-strava', { action: 'exchange', code: q.get('code') })
      .then((r) => { setMsg(`Conectado. ${r.imported} atividades importadas.`); setTimeout(() => router.replace('/treino'), 1200) })
      .catch((e) => setMsg((e as Error).message))
  }, [router])
  return <div className="card">{msg}</div>
}
