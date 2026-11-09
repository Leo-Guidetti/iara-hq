import { Nav, type NavItem } from '@iara/ui'

// Navegação do hub. Cada módulo (hoje só a ClaudIA, em /saude) entra com suas abas.
const NAV: NavItem[] = [
  { href: '/hoje', label: 'Hoje', icon: 'M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z' },
  { href: '/saude', label: 'Saúde', icon: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z', exact: true },
  { href: '/saude/peso', label: 'Peso', icon: 'M5 20h14l-2-12H7zM9 8a3 3 0 016 0' },
  { href: '/saude/corpo', label: 'Corpo', icon: 'M12 4a2 2 0 110 4 2 2 0 010-4zM8 10h8l-1 5h-2l-1 5-1-5H9z' },
  { href: '/saude/treino', label: 'Treino', icon: 'M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12' },
  { href: '/saude/dieta', label: 'Dieta', icon: 'M7 3v8a3 3 0 006 0V3M10 3v18M17 3c-2 2-2 6 0 8v10' },
  { href: '/perfil', label: 'Perfil', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="shell">{children}</main>
      <Nav items={NAV} />
    </>
  )
}
