// Linha do tempo do dia (determinística, sem IA): rotina com horário + o que não tem hora marcada.
export type Bloco = { hora: string | null; minutos?: number | null; texto: string; app: string; feito?: boolean }

const APP_DO_AGENT: Record<string, string> = { iara: 'hq', sabia: 'sabia', claudia: 'claudia', airton: 'airton', casa: 'casa' }
export const appDoAgent = (a: string | null | undefined) => APP_DO_AGENT[a ?? ''] ?? 'hq'

export function SeuDia({ blocos, agora }: { blocos: Bloco[]; agora: string }) {
  const comHora = blocos.filter((b) => b.hora).sort((a, b) => a.hora!.localeCompare(b.hora!))
  const semHora = blocos.filter((b) => !b.hora)
  // "agora" = o primeiro bloco que ainda não terminou
  const fim = (b: Bloco) => {
    const [h, m] = b.hora!.split(':').map(Number)
    const t = h * 60 + m + (b.minutos ?? 0)
    return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
  }
  const proximo = comHora.find((b) => fim(b) > agora)
  if (!blocos.length) return null
  return (
    <ol className="timeline" aria-label="Seu dia">
      {comHora.map((b, i) => {
        const cls = b === proximo ? 'agora' : fim(b) <= agora ? 'passou' : ''
        return (
          <li key={i} className={cls} data-app={b.app}>
            <span className="h">{b.hora}</span><span className="dot" />
            <span className="t">{b.texto}{b.minutos ? <small> · {b.minutos} min</small> : null}{b.feito && <span className="feito">✓ feito</span>}</span>
          </li>
        )
      })}
      {semHora.map((b, i) => (
        <li key={`s${i}`} data-app={b.app}>
          <span className="h">hoje</span><span className="dot" />
          <span className="t">{b.texto}{b.minutos ? <small> · {b.minutos} min</small> : null}{b.feito && <span className="feito">✓ feito</span>}</span>
        </li>
      ))}
    </ol>
  )
}
