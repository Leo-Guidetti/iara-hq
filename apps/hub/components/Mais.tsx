/** Conteúdo secundário (histórico, explicações, painéis da IA) fica recolhido: a tela mostra só o essencial. */
export function Mais({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <details className="mais">
      <summary>{rotulo}</summary>
      <div className="stack" style={{ marginTop: 12 }}>{children}</div>
    </details>
  )
}
