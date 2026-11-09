/** Tudo que vem da IA usa este cartão: borda e selo violeta, referências e o aviso fixo. */
export function AiCard({ title, children, refs, meta }: {
  title: string
  children: React.ReactNode
  refs?: string[]
  meta?: string
}) {
  return (
    <section className="card ai">
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="tag ai">✦ {title}</span>
        {meta && <span className="small muted">{meta}</span>}
      </div>
      {children}
      {refs && refs.length > 0 && (
        <details className="small" style={{ marginTop: 10 }}>
          <summary className="muted">Referências</summary>
          <ul style={{ paddingLeft: 18, margin: '6px 0 0' }}>{refs.map((r) => <li key={r}>{r}</li>)}</ul>
        </details>
      )}
      <p className="disclaimer">
        Organiza o processo com base em referências acadêmicas. Não é aconselhamento médico: decisões sobre dieta, treino
        e medicação são com seu médico e nutricionista.
      </p>
    </section>
  )
}
