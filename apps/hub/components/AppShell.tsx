'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Nav, type NavItem } from '@iara/ui'
import { AREAS, areaDe } from '@/lib/apps'
import { ICON } from '@/lib/icons'
import { PecaIara } from './PecaIara'

// Superapp: a barra de baixo é a mesma em todo o site (6 áreas, só ícones). O topo mostra o logo, o nome da página
// na cor do app e o agente responsável (com tooltip no logo). Desktop e iPad em paisagem: a barra vira trilho (styles.css).
const NAV: NavItem[] = AREAS.map((a) => ({ href: a.href, label: a.pagina, icon: a.icon, app: a.app, also: a.tambem }))

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const perfil = path.startsWith('/perfil')
  const area = areaDe(path) ?? AREAS[0]
  const pagina = perfil ? 'Perfil' : area.pagina
  const agente = perfil ? null : area.agente
  return (
    <div className="app" data-app={perfil ? 'hq' : area.app}>
      <header className="topbar">
        <div className="marca">
          <span className="logo tip-baixo" data-tip={agente ? `${agente} cuida desta página` : 'Seu perfil'} role="img" aria-label={agente ? `${agente} cuida desta página` : 'Perfil'} tabIndex={0} style={{ width: 36, height: 36 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={perfil ? ICON.perfil : area.icon} /></svg>
          </span>
          <span className="titulo"><strong>{pagina}</strong>{agente && <small>{agente}</small>}</span>
        </div>
        <div className="acoes">
          <Link href="/perfil" className="avatar" aria-label="Perfil" aria-current={perfil ? 'page' : undefined}><span>L</span></Link>
        </div>
      </header>
      {/* UX-23: "Peça à IARA" (texto e voz) em todas as telas; na /hoje ela fica no lugar próprio, entre os avisos. */}
      <main className="shell">{!path.startsWith('/hoje') && <div style={{ marginBottom: 14 }}><PecaIara /></div>}{children}</main>
      <Nav items={NAV} />
    </div>
  )
}
