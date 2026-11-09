# IARA HQ

Monorepo dos assistentes pessoais (IARA, ClaudIA, AIrton, SabIA) sobre um único projeto Supabase.

- `apps/<app>`: um app Next.js por assistente, cada um com seu projeto na Vercel.
- `supabase/migrations`: migrações SQL (só aditivas).
- `supabase/functions/<app>-<função>`: Edge Functions.
- `packages/`: código compartilhado entre apps.

Requisitos: Node 22 e pnpm 10. `pnpm install`, depois `pnpm build` / `pnpm typecheck`.
