import { Tabs } from '@/components/Tabs'

const SECOES = [
  { href: '/financas', label: 'Resumo', exact: true },
  { href: '/financas/revisar', label: 'Revisar' },
  { href: '/financas/metas', label: 'Metas' },
  { href: '/financas/gastos', label: 'Gastos' },
]

export default function FinancasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="stack">
      <Tabs items={SECOES} />
      {children}
    </div>
  )
}
