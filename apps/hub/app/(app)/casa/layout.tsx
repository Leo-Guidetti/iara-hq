import { Tabs } from '@/components/Tabs'

const SECOES = [
  { href: '/casa', label: 'Tarefas', exact: true },
  { href: '/casa/mercado', label: 'Mercado' },
]

export default function CasaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="stack">
      <Tabs items={SECOES} />
      {children}
    </div>
  )
}
