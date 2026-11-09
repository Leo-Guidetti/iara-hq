import { LoginForm } from './LoginForm'

export default function LoginPage() {
  return (
    <main className="shell" style={{ paddingTop: '18vh' }}>
      <div className="stack">
        <div>
          <span className="tag progress">IARA HQ</span>
          <h1>Entrar</h1>
          <p className="muted">Acesso restrito. Entre com e-mail e senha.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  )
}
