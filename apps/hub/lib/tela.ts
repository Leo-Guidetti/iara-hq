// UX-23: contexto da tela para a IARA. Cada item que o Leo pode citar por voz ("essa meta", "o segundo") leva
// data-iara-tipo/id/titulo/detalhe (use `marcaIara`). Ao enviar um comando, `lerTela` junta os itens na ordem da página,
// visíveis primeiro, e o iara-comando usa os ids como candidatos. Os ids são só dica: toda escrita roda como o usuário (RLS).

export type TipoTela = 'plano' | 'meta' | 'meta_financeira' | 'semana_item' | 'decisao' | 'proposta' | 'compromisso' | 'item' | 'trilha'
export type ItemTela = { tipo: TipoTela; id: string; titulo: string; detalhe?: string; visivel: boolean }
export type ContextoTela = { rota: string; itens: ItemTela[] }

const MAX_ITENS = 25

/** Atributos para marcar um elemento como item citável pela IARA. */
export function marcaIara(tipo: TipoTela, id: number | string, titulo: string, detalhe?: string | null) {
  return {
    'data-iara-tipo': tipo,
    'data-iara-id': String(id),
    'data-iara-titulo': titulo.slice(0, 80),
    ...(detalhe ? { 'data-iara-detalhe': detalhe.slice(0, 120) } : {}),
  }
}

/** Lê os itens marcados na página (ordem do DOM). Visíveis na janela vêm primeiro; no máximo 25. */
export function lerTela(): ContextoTela {
  if (typeof document === 'undefined') return { rota: '', itens: [] }
  const altura = window.innerHeight || 0
  const todos: ItemTela[] = []
  document.querySelectorAll<HTMLElement>('[data-iara-tipo][data-iara-id]').forEach((el) => {
    const r = el.getBoundingClientRect()
    const d = el.dataset
    todos.push({
      tipo: d.iaraTipo as TipoTela,
      id: d.iaraId ?? '',
      titulo: d.iaraTitulo ?? '',
      ...(d.iaraDetalhe ? { detalhe: d.iaraDetalhe } : {}),
      visivel: r.height > 0 && r.bottom > 0 && r.top < altura,
    })
  })
  const itens = [...todos.filter((i) => i.visivel), ...todos.filter((i) => !i.visivel)].slice(0, MAX_ITENS)
  return { rota: window.location.pathname, itens }
}
