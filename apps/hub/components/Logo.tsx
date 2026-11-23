import { LOGO, type LogoKey } from '@/lib/apps'

/** Logo do app na cor dele, sem o nome. O agente aparece no toque/hover (tooltip) e para leitores de tela. */
export function Logo({ app, tamanho = 22, dica, className }: { app: LogoKey; tamanho?: number; dica?: string; className?: string }) {
  const l = LOGO[app] ?? LOGO.iara
  const texto = dica ?? l.dica
  return (
    <span className={`logo${className ? ` ${className}` : ''}`} data-app={l.app} data-tip={texto} role="img" aria-label={texto} tabIndex={0}
      style={{ width: tamanho, height: tamanho }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={l.icon} /></svg>
    </span>
  )
}
