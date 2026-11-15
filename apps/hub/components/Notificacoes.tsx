'use client'
import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'
import { callFunction } from '@/lib/functions'

type Estado = 'carregando' | 'sem-suporte' | 'instalar' | 'bloqueado' | 'desligado' | 'ligado'

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
const ehIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
const instalado = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

async function registro() {
  await navigator.serviceWorker.register('/sw.js')
  return navigator.serviceWorker.ready
}

/** Push do hub (briefing, plano da semana, custo...). Grava a inscrição em airton.push_subscriptions, que o airton-notify usa.
 *  compacto: cartão curto na Hoje, só enquanto as notificações não estão ligadas neste aparelho. */
export function Notificacoes({ compacto = false }: { compacto?: boolean }) {
  const [estado, setEstado] = useState<Estado>('carregando')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setEstado(ehIOS() && !instalado() ? 'instalar' : 'sem-suporte'); return
      }
      if (Notification.permission === 'denied') { setEstado('bloqueado'); return }
      const reg = await registro().catch(() => null)
      const sub = await reg?.pushManager.getSubscription()
      setEstado(sub && Notification.permission === 'granted' ? 'ligado' : 'desligado')
    })()
  }, [])

  async function ligar() {
    setBusy(true); setMsg(null)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setEstado(perm === 'denied' ? 'bloqueado' : 'desligado'); return }
      const reg = await registro()
      const { publicKey } = await callFunction<{ publicKey: string }>('airton-notify', { action: 'vapid' })
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) })
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
      const label = `${ehIOS() ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Computador'} · hub`
      const { error } = await (supabaseBrowser() as unknown as SupabaseClient).schema('airton').from('push_subscriptions')
        .upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, label, failures: 0 }, { onConflict: 'endpoint' })
      if (error) throw new Error('Não deu para salvar a inscrição.')
      setEstado('ligado'); setMsg('Notificações ligadas neste aparelho.')
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  async function testar() {
    setBusy(true); setMsg(null)
    try {
      const r = await callFunction<{ sent: number }>('airton-notify', { action: 'test', kind: 'ping' })
      setMsg(r.sent ? 'Teste enviado: deve chegar em segundos.' : 'Nenhum aparelho recebeu. Desligue e ligue de novo.')
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  async function desligar() {
    setBusy(true); setMsg(null)
    try {
      const reg = await registro()
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await (supabaseBrowser() as unknown as SupabaseClient).schema('airton').from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setEstado('desligado'); setMsg('Notificações desligadas neste aparelho.')
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  if (compacto && (estado === 'ligado' || estado === 'carregando' || estado === 'sem-suporte' || estado === 'bloqueado')) return null
  const texto: Record<Estado, string> = {
    carregando: '…',
    'sem-suporte': 'Este navegador não recebe notificações.',
    instalar: 'No iPhone, as notificações só funcionam com o app instalado: toque em Compartilhar › "Adicionar à Tela de Início", abra o IARA HQ por lá e ligue aqui.',
    bloqueado: 'As notificações estão bloqueadas para este site. Libere nos ajustes do navegador (ou do iPhone › Notificações › IARA HQ).',
    desligado: 'Briefing das 07:00, plano da semana no domingo e custo de IA: receba no celular.',
    ligado: 'Ligadas neste aparelho.',
  }
  return (
    <section className={`card stack${compacto ? ' module' : ''}`} data-app={compacto ? 'hq' : undefined} style={{ gap: 8 }}>
      <div className="row between">
        <h2 style={{ margin: 0, fontSize: compacto ? '1rem' : undefined }}>Notificações</h2>
        {estado === 'ligado' && <span className="tag progress">ligadas</span>}
      </div>
      <p className="small" style={{ margin: 0 }}>{texto[estado]}</p>
      {estado === 'desligado' && <button className="btn" disabled={busy} onClick={ligar}>{busy ? 'Ligando…' : 'Ativar notificações'}</button>}
      {estado === 'ligado' && !compacto && (
        <div className="grid2">
          <button className="btn ghost" disabled={busy} onClick={testar}>Enviar teste</button>
          <button className="btn ghost" disabled={busy} onClick={desligar}>Desligar</button>
        </div>
      )}
      {msg && <p className="small muted" style={{ margin: 0 }}>{msg}</p>}
    </section>
  )
}
