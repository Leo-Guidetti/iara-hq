import { CadastroForm } from './CadastroForm'

export default function CadastroPage() {
  return (
    <main className="shell" style={{ paddingTop: '14vh' }}>
      <div className="stack">
        <div>
          <span className="tag progress">IARA HQ</span>
          <h1>Definir senha</h1>
          <p className="muted">Use o código que você guardou no secret HUB_CADASTRO_CODIGO do Supabase.</p>
        </div>
        <CadastroForm />
      </div>
    </main>
  )
}
