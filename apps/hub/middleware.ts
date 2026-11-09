import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'
import { SUPABASE_KEY, SUPABASE_URL } from '@/lib/env'

const PUBLIC = ['/login', '/cadastro', '/auth/callback', '/sem-acesso']
// Pedido do Leo (09/11): o hub inteiro é só dele.
const PERMITIDO = 'leonardoguidettic@gmail.com'

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })
  const sb = createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value))
        res = NextResponse.next({ request: req })
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
      },
    },
  })

  const { data } = await sb.auth.getUser()
  const path = req.nextUrl.pathname
  const isPublic = PUBLIC.some((p) => path.startsWith(p))

  if (!data.user) {
    if (isPublic) return res
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // qualquer outra conta logada vai para /sem-acesso (lá só há o botão de sair)
  if (data.user.email?.toLowerCase() !== PERMITIDO && !path.startsWith('/sem-acesso')) {
    const url = req.nextUrl.clone()
    url.pathname = '/sem-acesso'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // módulo Saúde (ClaudIA): só membros de claudia.members
  if (path.startsWith('/saude')) {
    const { data: ok } = await sb.rpc('claudia_is_member')
    if (!ok) {
      const url = req.nextUrl.clone()
      url.pathname = '/sem-acesso'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:png|svg|jpg|webp)$).*)'],
}
