# IARA HQ — contexto para agentes

> **LEIA ANTES DE QUALQUER AÇÃO.** Você é o executor autônomo do IARA HQ. O Leo não aprova PRs nem
> acompanha cada passo: os portões são automáticos. Guardrails (valem sempre):
> 1. Toda mudança é arquivo DENTRO desta pasta, numa branch, com commit. Nunca commit direto na `main`.
> 2. Produção só muda pelo merge de um PR com o CI verde (auto-merge). Você abre o PR e liga o auto-merge;
>    o GitHub Actions publica. Você NÃO publica Edge Functions, NÃO aplica migrations e NÃO altera
>    dados pelos conectores do Supabase ou do Vercel.
> 3. Conector do Supabase = só leitura (consultas, custos, logs, conferir produção).
> 4. Migrations só aditivas (o CI bloqueia drop, rename, truncate, delete).
> 5. Chaves de API nunca em arquivo nem no Vercel (o CI procura vazamentos). Só nos secrets do Supabase.
> 6. Produção diverge do repo? Produção vence: traga para o repo e registre em docs/PROGRESSO.md.
> 7. Depois de cada merge, confira produção (deploy concluído, logs sem erro, custo) antes de seguir.
> 8. Mantenha docs/PROGRESSO.md sempre atualizado: é ele que permite continuar na próxima sessão.
> Só interrompa o Leo para o que está em "Quando chamar o Leo" no docs/PROGRESSO.md.

Ecossistema de assistentes pessoais do Leo, num app único (hub) que organiza a rotina dele.
Siga também a skill `iara-hq`. Em caso de conflito, este arquivo vale para o repositório.
Como começar: `docs/cowork/GUIA.md`. Estado e próximos passos: `docs/PROGRESSO.md`. Modelos: `docs/cowork/MODELOS.md`.

## Onde mora cada coisa

| Peça | Onde |
| --- | --- |
| Código (tudo) | GitHub `Leo-Guidetti/iara-hq` — pnpm workspaces + turbo |
| App único (superapp) | `apps/hub` (Next.js 15) → projeto Vercel `hub` em `iara-agents-hq.vercel.app`. Barra de baixo fixa (Hoje, ClaudIA, AIrton, SabIA, Casa), cabeçalho com o app atual e Perfil; seções internas viram abas no topo do módulo. `/hoje` (briefing único do dia + órbita + missões), `/saude` (ClaudIA), `/financas` (AIrton, RPCs do schema `airton`), `/aprender` (SabIA, `public.hub_sabia()`/`hub_sabia_item()`), `/casa` (IARA House, só a casa: `public.hub_casa()`/`hub_item_status()`). Apps antigos seguem só para o que não veio (Open Finance, chat, investimentos; casa/compras no Supabase antigo) |
| Design | `packages/ui` — neutros "clinical calm" (escuro #0D1117 / claro #F5F6F8, segue o sistema ou a escolha no Perfil) com camada futurista (vidro fosco, borda luminosa, brilho na cor do app) e uma cor por app via `data-app`: HQ lilás, ClaudIA verde, AIrton azul, SabIA vermelho, IARA House dourado; violeta #8B7FF0 só IA, âmbar alertas, Barlow Semi Condensed. `/hoje` é o menu: um bloco de pendências por app |
| Banco, IA, crons, chaves | Supabase `wrtrhdrohabspbaxpbeu` — schemas `airton`, `claudia`, `sabia`, `core` (+ tabelas antigas da ClaudIA em `public`) |
| Edge Functions | `supabase/functions/<app>-<função>` — publicadas SÓ a partir do repo |
| Migrations | `supabase/migrations` — SÓ aditivas |
| Roadmap | `docs/ROADMAP.md` (cópia viva) e Claude Doc "Mapa de APIs de IA", aba Roadmap do Hub |
| Execução autônoma | `docs/PROGRESSO.md` (estado e fila de trabalho) e `docs/cowork/` (guia, prompt inicial, modelos, tarefas agendadas) |

## Regras de ouro

1. **Nada fora do Git.** Nenhum deploy pelo painel, por API ou por conector. O único caminho para produção é o merge na `main` com CI verde (`ci.yml` + `deploy-supabase.yml`). A ClaudIA antiga foi perdida exatamente por deploy fora do Git.
2. **Migrations aditivas.** Nada de drop, rename ou delete de dados sem pedido explícito do Leo.
3. **Chaves só no Supabase** (Edge Functions → Secrets). O Vercel guarda só a URL e a publishable key do Supabase. Nunca chave em `VITE_*` ou `NEXT_PUBLIC_*`.
4. **Toda chamada de IA passa pelo cliente compartilhado** (`_shared/ai.ts`): chave por funcionalidade, teto mensal, log de custo.
5. **Antes de editar uma função que já existe**, compare com a versão no ar. Se a do ar for diferente, ela vence: traga para o repo primeiro.

## Cliente de IA (padrão do AIrton)

- Chave por funcionalidade: `<APP>_<PROVEDOR>_KEY_<FEATURE>` (ex.: `AIRTON_ANTHROPIC_KEY_CHAT`, `IARA_GEMINI_KEY_TRILHA_SEARCH`). Sem ela, cai em `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`.
- Tetos: `<APP>_AI_BUDGET_USD` (geral, padrão 10) e `<APP>_AI_BUDGET_USD_<FEATURE>`.
- Log: `<schema>.ai_usage` (provider, model, tokens, cache, buscas, custo) + view `v_ai_cost_month`.
- SabIA usa o cliente do HQ com `APP = 'IARA'` (secrets começam com `IARA_`).

| Tarefa | Modelo | Configuração |
| --- | --- | --- |
| Classificar, extrair, rotear | `claude-haiku-5-5` (US$ 0,10/0,50 por MTok) | `effort: low`, saída JSON |
| Chat com ferramentas | `claude-sonnet-5-5` (US$ 2/10) | `effort: medium`, cache em system, tools e histórico; resultado de ferramenta ≤ 12 mil caracteres |
| Análise/plano semanal | `claude-sonnet-5-5` | sem busca na web; dados de APIs públicas (BCB) |
| Busca na web | Gemini 3.5 Flash-Lite + Google Search → fallback Haiku 5.5 com web search (`max_uses` 2) | buscas Gemini grátis até 5.000/mês; Anthropic US$ 10/mil + páginas como token |
| Curadoria de leitura | Feeds RSS das fontes (`sabia.fontes.rss_url`) → Haiku escolhe pelo índice; busca só se faltar | URL nunca vem do modelo |
| Visão (fotos) | `claude-sonnet-5-5` | imagem ≤ 1.000 px |

- Modelos 5.5 pensam por padrão; o pensamento é cobrado como saída. Use `effort`.
- Sem `temperature` (incompatível com thinking).
- Deduplicar antes de chamar IA (hash do contexto, janela de recência).

## Edge Functions no ar (09/11/2026)

| App | Funções |
| --- | --- |
| AIrton | `airton-ai` (chat, categorização), `airton-market` (preços, news, plano), `airton-pluggy` (Open Finance), `airton-notify` (push) |
| SabIA | `sabia-trilha` |
| IARA | `iara-briefing` |
| ClaudIA | `claudia-food-parse`, `claudia-diet`, `claudia-coach`, `claudia-coach-session`, `claudia-coach-review`, `claudia-checkin`, `claudia-photo-review`, `claudia-strava`, `claudia-ingest` |

Várias foram publicadas fora do repo antes da migração: a etapa 0 do docs/PROGRESSO.md sincroniza todas
pelo workflow `sincroniza-producao` (só leitura).

## Custos medidos (referência)

| Funcionalidade | Custo real |
| --- | --- |
| Plano semanal do AIrton (Sonnet 5.5) | US$ 0,0375 por execução |
| News do AIrton (Haiku 5.5 + 4 buscas) | US$ 0,047 por execução (~US$ 0,60/mês) |
| Trilha da SabIA (feeds + Sonnet) | US$ 0,023 por trilha de 25 min (09/11). Com pílulas e 40 min (10/11 em diante): estimado US$ 0,04–0,07/dia (~US$ 1,5–2/mês) — conferir em `core.ai_usage` |

## Crons (UTC; São Paulo = UTC−3)

| Job | Horário |
| --- | --- |
| `airton-market-plan-weekly` | dom 10:00 (07:00 SP), push "Plano da semana pronto" |
| `airton-market-news-dom-qua-sex` | dom/qua/sex 11:20 |
| `airton-market-*` refresh/close/history | dias úteis (sem IA) |
| `sabia-trilha` | diário 09:30 (06:30 SP) |
| `iara-manha` | briefing único do dia, 10:00 (07:00 SP); o `iara-noite` saiu em 09/11 |

## Pendências conhecidas

- Gemini: as chaves atuais são Vertex Express (restritas à Agent Platform API) e recebem 403 na Generative Language API. O fallback para Claude cobre. Para ativar: chaves comuns restritas à Generative Language API.
- Bucket `airton-deploy` está PÚBLICO com 8 arquivos (builds e bundles antigos de 02–03/11): pedido ao Leo para apagar.
- ClaudIA v2: as 9 funções estão no ar; faltam secrets da Strava, teste de cada tela, merge do PR #2, virada de domínio e, uma semana depois, limpeza (projetos Vercel `claudia` e `claudia-v2`, `ANTHROPIC_API_KEY` antiga, chave `claudia-provisoria`).
- Tabelas da ClaudIA de `public` para o schema `claudia`: depois da virada, numa migração própria.

## Como conferir custo

```sql
select * from airton.v_ai_cost_month  order by mes desc, custo_usd desc;
select * from claudia.v_ai_cost_month order by mes desc;
select agent, feature, papel, round(sum(cost_usd)::numeric, 4) usd
  from core.ai_usage where at > now() - interval '30 days' group by 1,2,3 order by usd desc;
```
