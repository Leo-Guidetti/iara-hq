/** Aparece na hora em que se toca numa aba, enquanto o servidor busca os dados (e deixa o Next pré-carregar a casca). */
export default function Carregando() {
  return (
    <div className="stack" aria-busy="true" aria-label="Carregando">
      <div className="esqueleto" style={{ height: 34, width: '55%' }} />
      <div className="esqueleto" style={{ height: 120 }} />
      <div className="esqueleto" style={{ height: 88 }} />
      <div className="esqueleto" style={{ height: 88 }} />
    </div>
  )
}
