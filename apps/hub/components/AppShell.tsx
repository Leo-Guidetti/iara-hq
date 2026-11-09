'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Nav, type NavItem } from '@iara/ui'
import { ICON } from '@/lib/icons'

// Superapp: a barra de baixo é a mesma em todo o site (nunca troca ao entrar num app).
// Cada app mantém a sua cor; as seções internas viram abas no topo do módulo.
export const APPS = [
  { href: '/hoje', label: 'Hoje', nome: 'IARA HQ', icon: ICON.hoje, app: 'hq' },
  { href: '/saude', label: 'ClaudIA', nome: 'ClaudIA · Saúde', icon: ICON.saude, app: 'claudia' },
  { href: '/financas', label: 'AIrton', nome: 'AIrton · Finanças', icon: ICON.financas, app: 'airton' },
  { href: '/aprender', label: 'SabIA', nome: 'SabIA · Aprender', icon: ICON.aprender, app: 'sabia' },
  { href: '/casa', label: 'Casa', nome: 'IARA House · Casa', icon: ICON.casa, app: 'casa' },
] as const
const NAV: NavItem[] = APPS.map((a) => ({ href: a.href, label: a.label, icon: a.icon, app: a.app }))

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const atual = APPS.find((a) => a.href !== '/hoje' && path.startsWith(a.href)) ?? APPS[0]
  const perfil = path.startsWith('/perfil')
  return (
    <div className="app" data-app={atual.app}>
      <header className="topbar">
        <Link href="/hoje" className="marca"><i />{perfil ? 'Perfil' : atual.nome.split(' · ')[0]}{!perfil && atual.nome.includes(' · ') && <small>{atual.nome.split(' · ')[1]}</small>}</Link>
        <Link href="/perfil" className="avatar" aria-label="Perfil" aria-current={perfil ? 'page' : undefined}>L</Link>
      </header>
      <main className="shell">{children}</main>
      <Nav items={NAV} />
    </div>
  )
}
