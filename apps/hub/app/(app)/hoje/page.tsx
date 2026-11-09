import Link from 'next/link'

// Placeholder: o painel do dia do IARA HQ (briefing da IARA, finanças do AIrton, trilha da SabIA) entra depois.
export default function Hoje() {
  return (
    <div className="stack">
      <div>
        <span className="tag progress">IARA HQ</span>
        <h1>Hoje</h1>
        <p className="muted small">Em breve: o resumo do dia de todos os assistentes.</p>
      </div>
      <Link href="/saude" className="card">
        <span className="tag progress">Saúde · ClaudIA</span>
        <p style={{ margin: '6px 0 0' }}>Peso, corpo, dieta e treino.</p>
      </Link>
    </div>
  )
}
