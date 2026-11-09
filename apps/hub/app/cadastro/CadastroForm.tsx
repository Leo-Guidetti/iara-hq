'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FUNCTIONS_URL, SUPABASE_KEY } from '@/lib/env'
import { supabaseBrowser } from '@/lib/supabase/client'

export function CadastroForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [codigo, setCodigo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (senha !== confirma) { setError('As senhas não batem.'); return }
    if (senha.length < 10) { setError('Use pelo menos 10 caracteres.'); return }
    setBusy(true); setError(null)
    const mail = email.trim().toLowerCase()
    const res = await fetch(`${FUNCTIONS_URL}/hub-senha`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: mail, senha, codigo: codigo.trim() }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setBusy(false); setError(json.error ?? `Erro ${res.status}`); return }
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: mail, password: senha })
    setBusy(false)
    if (error) setError('Senha salva, mas o login falhou. Tente entrar pela tela de login.')
    else { router.replace('/hoje'); router.refresh() }
  }

  return (
    <form className="stack" onSubmit={salvar}>
      <label>E-mail<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Nova senha<input type="password" autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
      <label>Repita a senha<input type="password" autoComplete="new-password" required value={confirma} onChange={(e) => setConfirma(e.target.value)} /></label>
      <label>Código<input type="password" autoComplete="off" required value={codigo} onChange={(e) => setCodigo(e.target.value)} /></label>
      <button className="btn" disabled={busy}>{busy ? 'Salvando…' : 'Salvar senha e entrar'}</button>
      {error && <p className="error">{error}</p>}
      <a className="muted" href="/login">Voltar para o login</a>
    </form>
  )
}
