import { ICON } from './icons'

// As 6 áreas do hub. Cada página mostra o nome dela na cor do app e o agente responsável (decisão do Leo, 23/11).
// Nas referências a um app dentro das telas aparece só o logo; o nome do agente fica no tooltip.
export const AREAS = [
  { id: 'hoje', href: '/hoje', pagina: 'Hoje', agente: 'IARA', app: 'hq', icon: ICON.hoje, tambem: ['/semana'] },
  { id: 'planos', href: '/planos', pagina: 'Planos', agente: 'IARA', app: 'hq', icon: ICON.planos, tambem: [] },
  { id: 'saude', href: '/saude', pagina: 'Saúde', agente: 'ClaudIA', app: 'claudia', icon: ICON.saude, tambem: [] },
  { id: 'financas', href: '/financas', pagina: 'Finanças', agente: 'AIrton', app: 'airton', icon: ICON.financas, tambem: [] },
  { id: 'conhecimento', href: '/aprender', pagina: 'Conhecimento', agente: 'SabIA', app: 'sabia', icon: ICON.aprender, tambem: [] },
  { id: 'casa', href: '/casa', pagina: 'Casa', agente: 'IARA', app: 'casa', icon: ICON.casa, tambem: [] },
] as const
export type Area = (typeof AREAS)[number]

export function areaDe(path: string): Area | null {
  return AREAS.find((a) => path === a.href || path.startsWith(`${a.href}/`) || a.tambem.some((t) => path === t || path.startsWith(`${t}/`))) ?? null
}

/** Logo de um app pela chave usada no banco/telas (claudia, airton, sabia, casa, hq/iara, planos). */
export const LOGO = {
  iara: { app: 'hq', icon: ICON.hoje, dica: 'IARA' },
  hq: { app: 'hq', icon: ICON.hoje, dica: 'IARA' },
  planos: { app: 'hq', icon: ICON.planos, dica: 'IARA · planos' },
  claudia: { app: 'claudia', icon: ICON.saude, dica: 'ClaudIA · saúde' },
  airton: { app: 'airton', icon: ICON.financas, dica: 'AIrton · finanças' },
  sabia: { app: 'sabia', icon: ICON.aprender, dica: 'SabIA · conhecimento' },
  casa: { app: 'casa', icon: ICON.casa, dica: 'IARA · casa' },
} as const
export type LogoKey = keyof typeof LOGO
