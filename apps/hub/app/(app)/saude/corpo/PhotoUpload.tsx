'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabase/client'
import { resizeImage } from '@/lib/image'
import { savePhoto } from './actions'

const POSES = [['front', 'Frente'], ['side', 'Perfil'], ['back', 'Costas']] as const
const CHECKS = [['same_spot', 'Mesmo lugar e distância'], ['lighting', 'Mesma luz'], ['fasted', 'Em jejum'], ['relaxed', 'Relaxado, sem contrair']] as const

export function PhotoUpload({ userId }: { userId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, File | undefined>>({})
  const [checks, setChecks] = useState<Record<string, boolean>>({ same_spot: true, lighting: true, fasted: true, relaxed: true })

  async function upload() {
    setError(null)
    const chosen = POSES.filter(([p]) => files[p])
    if (!chosen.length) return setError('Escolha pelo menos uma foto.')
    const sb = supabaseBrowser()
    const now = new Date()
    const day = now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    const protocol = { ...checks, hour: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }), device: navigator.userAgent.includes('iPhone') ? 'iPhone' : 'outro' }
    try {
      for (const [pose, label] of chosen) {
        setBusy(`Comprimindo ${label.toLowerCase()}…`)
        const file = files[pose]!
        const main = await resizeImage(file, 1600, 'image/webp')
        const review = await resizeImage(file, 1000, 'image/jpeg', 0.8)
        const ext = main.type === 'image/webp' ? 'webp' : main.type === 'image/png' ? 'png' : 'jpg'
        const base = `${userId}/${day}/${pose}-${crypto.randomUUID()}`
        setBusy(`Enviando ${label.toLowerCase()}…`)
        const up1 = await sb.storage.from('progress-photos').upload(`${base}.${ext}`, main, { contentType: main.type })
        if (up1.error) throw new Error(up1.error.message)
        const up2 = await sb.storage.from('progress-photos').upload(`${base}.review.jpg`, review, { contentType: 'image/jpeg' })
        if (up2.error) throw new Error(up2.error.message)
        const r = await savePhoto({ pose, storage_path: `${base}.${ext}`, taken_at: now.toISOString(), protocol })
        if (r.error) throw new Error(r.error)
      }
      setFiles({})
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card stack">
      <h2>Fotos de progresso</h2>
      <p className="small muted">Mesmo espelho, mesma luz e hora, em jejum. As fotos ficam privadas e são reduzidas antes do envio.</p>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {POSES.map(([p, label]) => (
          <label key={p} className="card" style={{ background: 'var(--surface-2)', textAlign: 'center', cursor: 'pointer' }}>
            {label}
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => setFiles((f) => ({ ...f, [p]: e.target.files?.[0] }))} />
            <span className={files[p] ? 'tag progress' : 'small muted'}>{files[p] ? '✓ escolhida' : 'escolher'}</span>
          </label>
        ))}
      </div>
      <div className="grid2">
        {CHECKS.map(([k, label]) => (
          <label key={k} className="row" style={{ color: 'var(--text)' }}>
            <input type="checkbox" checked={checks[k]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} style={{ width: 20, height: 20 }} />
            {label}
          </label>
        ))}
      </div>
      <button className="btn" onClick={upload} disabled={!!busy}>{busy ?? 'Enviar fotos'}</button>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
