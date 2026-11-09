# IARA HQ

Monorepo dos assistentes pessoais (IARA, ClaudIA, AIrton, SabIA) sobre um único projeto Supabase.

- `apps/hub`: app Next.js único (projeto "hub" na Vercel); cada assistente é um módulo de rotas (ClaudIA em `/saude`).
- `supabase/migrations`: migrações SQL (só aditivas).
- `supabase/functions/<app>-<função>`: Edge Functions.
- `packages/ui`: tokens de design e componentes compartilhados (`@iara/ui`).

Requisitos: Node 22 e pnpm 10. `pnpm install`, depois `pnpm build` / `pnpm typecheck`.
