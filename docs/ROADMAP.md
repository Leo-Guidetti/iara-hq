# Roadmap do IARA HQ

Destino: um app só, o **hub**, que organiza a rotina do Leo. Cada agente (AIrton, ClaudIA,
SabIA, IARA) e cada fonte externa (Gmail, Google Calendar, Strava) publica cartões numa fila
comum; a IARA encaixa essa fila no dia, sobre os horários livres da agenda; a tela **Hoje**
mostra o resultado. Os apps separados viram módulos: Saúde, Finanças, Aprender e Casa.

## Fase 1 — Fechar a ClaudIA v2
1. As 9 funções `claudia-*` estão no ar; conferir que batem com o repo (`/sincronizar`).
2. Secrets `STRAVA_CLIENT_ID` e `STRAVA_CLIENT_SECRET`; URL de callback no app da Strava.
3. Testar cada tela de `/saude` no preview; uma linha por função em `claudia.v_ai_cost_month`.
4. Merge do PR #2 e virada do domínio para o projeto `hub`.
5. Uma semana estável depois: limpeza (Vercel `claudia` e `claudia-v2`, `ANTHROPIC_API_KEY`
   antiga, chave `claudia-provisoria`).

## Fase 2 — Núcleo de itens
Tabela `core.itens` + função `core.publicar_item()`. Só banco e Edge Functions.

| Campo | Exemplo |
| --- | --- |
| `origem` | airton, claudia, sabia, iara, gmail, agenda |
| `tipo` | tarefa, recomendação, alerta, leitura, lembrete |
| `quando` | data, horário ou "esta semana" |
| `prioridade`, `minutos` | alta, 15 |
| `acao` | link para o módulo, "marcar feito", "adiar" |
| `status`, `retorno` | pendente, feito, adiado, ignorado |
| `chave_origem` | id do registro de origem (idempotência) |

| Agente | Publica |
| --- | --- |
| AIrton | ações do plano semanal, alertas de mercado, notícia de alto impacto, conta a vencer |
| ClaudIA | sessão de treino do dia, pesagem, meta de proteína, check-in semanal, fotos do mês |
| SabIA | trilha do dia, com o tempo de cada item |
| IARA | briefing, casa, compras |

## Fase 3 — Tela Hoje
Linha do tempo (agenda + itens com horário), caixa com o resto, ações rápidas (feito, adiar,
abrir no módulo), um único canal de push com limite diário de interrupções, PWA no iPhone.

## Fase 4 — Fontes externas
Google Calendar (eventos e horários livres), digest do Gmail (só o que pede ação), Home
Assistant quando a casa estiver montada.

## Fase 5 — Orquestração da IARA
| Quando | O quê |
| --- | --- |
| Todo dia 07:00 | plano do dia: prioriza e encaixa nos horários livres |
| Todo dia 21:00 | revisão: o que não foi feito vai para amanhã ou é descartado |
| Domingo | plano da semana: AIrton + recap da SabIA + revisão de treino da ClaudIA |
Custo estimado: ~US$ 2/mês (2–3 chamadas Sonnet 5.5 por dia).

## Fase 6 — Módulos no hub
`/financas` (AIrton), `/aprender` (SabIA), `/casa` (IARA); migrar a IARA do Supabase antigo;
aposentar os projetos Vercel `airton`, `iara`, `shyrlai`.

## Fase 7 — Voz
Um agente de voz no hub (gpt-realtime-2.1-mini ou Gemini 3.8 Live, ~US$ 0,02/min), com as
ferramentas `ask_airton`, `ask_claudia`, `ask_iara`; o Claude responde com a chave
`<app>-voice`. Protótipo de 1 dia comparando os dois com 20 perguntas reais.
