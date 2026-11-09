'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabase/client'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/auth/callback` },
    })
    setBusy(false)
    if (error) setError('Não foi possível enviar. Confira o e-mail: só contas liberadas entram.')
    else setSent(true)
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabaseBrowser().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setError('Código inválido ou expirado.')
    else { router.replace('/hoje'); router.refresh() }
  }

  if (!sent) {
    return (
      <form className="stack" onSubmit={send}>
        <label>E-mail<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <button className="btn" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link'}</button>
        {error && <p className="error">{error}</p>}
      </form>
    )
  }
  return (
    <form className="stack" onSubmit={verify}>
      <p className="muted">Abra o link no e-mail ou, no app instalado no iPhone, digite o código.</p>
      <label>Código<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
      <button className="btn" disabled={busy || code.trim().length < 6}>{busy ? 'Conferindo…' : 'Entrar com código'}</button>
      <button type="button" className="btn ghost" onClick={() => setSent(false)}>Trocar e-mail</button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
