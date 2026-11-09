# Prompts prontos — IARA HQ no Cowork

## Abrir sessão
```
Leia o CLAUDE.md e o docs/ROADMAP.md. Confirme em 3 linhas: os guardrails, onde paramos e o
próximo passo. Hoje vamos trabalhar em: <tema>. Crie a branch <tipo>/<tema> e mostre o plano
antes de mexer em qualquer arquivo.
```

## Sincronizar tudo (primeira sessão, obrigatório)
```
Sincronize o repositório com produção, SEM publicar nada.
1. Pelo conector do Supabase (só leitura), liste as Edge Functions no ar e baixe o código de
   cada uma: airton-ai, airton-market, airton-pluggy, airton-notify, sabia-trilha,
   iara-briefing e as 9 claudia-*.
2. Compare com supabase/functions. Função que falta no repo: traga a do ar. Função
   divergente: me mostre a diferença e pergunte qual vale.
3. Compare o schema do banco com supabase/migrations. Se faltar migration para algo que já
   existe, crie uma migration de baseline que não altera nada (só documenta).
4. Branch chore/sincroniza-producao, commit e PR. Não faça merge.
```

## Sincronizar uma função
```
Compare a Edge Function <nome> no ar (conector do Supabase, só leitura) com
supabase/functions/<nome>. Se igual, diga "sincronizada". Se divergir, mostre o diff e
pergunte qual vale. Não publique nada.
```

## Revisar o workflow de deploy
```
Revise .github/workflows/deploy-supabase.yml: ele deve, em push na main, aplicar migrations
(supabase db push) e publicar só as Edge Functions alteradas, todas com --no-verify-jwt.
Confira contra a estrutura real de supabase/ (pastas _shared, config.toml) e ajuste.
Adicione também .github/workflows/ci.yml com typecheck, build do apps/hub e check das
funções em todo PR. Branch chore/ci-deploy, PR. Me diga quais checks marcar como
obrigatórios na proteção da main.
```

## Fase N do roadmap
```
Fase <N> do docs/ROADMAP.md. Leia o CLAUDE.md, o ROADMAP e o estado do código e do banco
(conector só leitura). Mostre o plano: entregas, migrations (só aditivas), funções, telas,
o que eu preciso fazer fora daqui (chaves, consoles) e o custo de IA estimado por mês.
PARE e espere meu ok. Depois: branch feat/fase-<N>-<tema>, PRs pequenos, um por entrega.
```

## Nova Edge Function
```
Crie a Edge Function <app>-<função>: <o que faz>.
Padrão do CLAUDE.md: _shared do app, autenticação (membro ou pg_cron), verify_jwt false,
IA pelo cliente compartilhado com feature = <função> (chave <APP>_ANTHROPIC_KEY_<FUNÇÃO>,
teto, log em <schema>.ai_usage), modelo pela tabela do CLAUDE.md com justificativa.
Me diga o nome exato do secret e da chave a criar no Console. Branch e PR; a publicação
acontece no merge.
```

## Custo de IA
```
Pelo conector do Supabase (só leitura), some airton.ai_usage, claudia.ai_usage e
core.ai_usage por app, funcionalidade e modelo: chamadas, tokens, cache, buscas e US$, no mês
atual e nos últimos 7 dias, comparando com o período anterior. Mostre quanto falta para
cada teto e até 3 recomendações. Não altere nada.
```

## Fechar sessão
```
Feche a sessão: liste o que mudou (PRs, funções, migrations, nomes de secrets novos, crons,
custos). Atualize CLAUDE.md (estado, funções no ar, crons, pendências) e docs/ROADMAP.md
(o que foi concluído), só com fatos. Commit na branch atual. Me dê o resumo em até 5 linhas
e o próximo passo concreto.
```

## Checagem de guardrails (quando desconfiar)
```
Auditoria, sem alterar nada: (1) alguma Edge Function no ar está diferente do repo?
(2) algum commit direto na main nos últimos 7 dias? (3) alguma migration não aditiva?
(4) alguma chave de API em arquivo do repo ou variável do Vercel além da URL e da
publishable key do Supabase? Responda com uma tabela.
```
