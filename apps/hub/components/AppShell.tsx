'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Nav, type NavItem } from '@iara/ui'
import { AREAS, areaDe } from '@/lib/apps'
import { ICON } from '@/lib/icons'
import { Falar } from './Falar'
import { ModoTela } from './ModoTela'

// Superapp: a barra de baixo é a mesma em todo o site (6 áreas, só ícones). O topo mostra o logo, o nome da página
// na cor do app e o agente responsável (com tooltip no logo). Desktop e iPad em paisagem: a barra vira trilho (styles.css).
const NAV: NavItem[] = AREAS.map((a) => ({ href: a.href, label: a.pagina, icon: a.icon, app: a.app, also: a.tambem, sub: a.agente }))

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
          <ModoTela atual="gestao" />
          <Falar comando />
          <Link href="/perfil" className="avatar" aria-label="Perfil" aria-current={perfil ? 'page' : undefined}><span>L</span></Link>
        </div>
      </header>
      {/* "Peça à IARA" saiu do alto das telas (review do protótipo): agora é o botão de falar no topo. */}
      <main className="shell">{children}</main>
      <Nav items={NAV}
        topo={<><span className="nav-marca" aria-hidden="true" /><span>IARA HQ</span></>}
        rodape={<Link href="/perfil" aria-current={perfil ? 'page' : undefined}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d={ICON.perfil} /></svg>
          Ajustes e conexões</Link>} />
    </div>
  )
}
