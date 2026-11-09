# hub

App único do IARA HQ (Next.js 15, App Router). Login, layout, navegação e tokens ficam aqui e em
`packages/ui`; cada assistente é um módulo de rotas:

- `/hoje`: painel do dia (placeholder).
- `/saude/...`: ClaudIA (peso, corpo, dieta, treino). Acesso restrito a `claudia.members`.
- `/perfil`: dados pessoais, tokens do Atalho do iPhone e custo de IA.

IA e integrações rodam nas Edge Functions `supabase/functions/<app>-*`; o app só usa
`NEXT_PUBLIC_SUPABASE_URL` e a publishable key.
