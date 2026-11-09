import { SignOut } from '@/components/SignOut'

export default function SemAcesso() {
  return (
    <main className="shell" style={{ paddingTop: '18vh' }}>
      <div className="stack">
        <h1>Sem acesso</h1>
        <p className="muted">Esta conta não tem acesso a este módulo.</p>
        <SignOut />
      </div>
    </main>
  )
}
