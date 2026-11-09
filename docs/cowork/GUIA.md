# Guia: IARA HQ no Cowork, em modo autônomo

## Como funciona
O Cowork trabalha sozinho seguindo o docs/PROGRESSO.md. Ele abre PRs e liga o auto-merge;
o GitHub só faz o merge se o CI passar, e então publica. Você não aprova PRs. Você só é chamado
para criar chaves, mexer em sites de terceiros e confirmar ações irreversíveis.

| Portão automático | O que bloqueia |
| --- | --- |
| CI: migrations | `drop`, `rename`, `truncate`, `delete` em migration |
| CI: segredos | Chave de API commitada |
| CI: build e checks | Código que não compila ou função fora do padrão |
| Proteção da main | Commit direto na main; merge com CI vermelho |
| Deploy só pelo GitHub | Publicação pelo painel ou pelo conector |

## Configuração (uma vez, ~20 min)
1. **Repositório:** clone `Leo-Guidetti/iara-hq` (GitHub Desktop) e copie para a raiz o conteúdo
   deste kit (`CLAUDE.md`, `docs/`, `.github/`). Commit e push direto na main. É a última vez.
2. **Cowork:** crie o projeto **IARA HQ**, selecione a pasta `iara-hq` e cole nas instruções do
   projeto o texto de `docs/cowork/INSTRUCOES-DO-PROJETO.md`. Confira o plugin iara-hq ativo.
3. **Conectores:** Supabase, Vercel e GitHub ligados. Se a tela do conector permitir controlar
   ferramentas, libere as de leitura e bloqueie as de publicar função e aplicar migration.
4. **Comece:** cole o prompt de `docs/cowork/INICIAR.md`.
   O próprio agente te pede, na hora certa e de uma vez só, o que falta configurar no GitHub
   (secrets, auto-merge, proteção da main).

## Depois disso
- Para retomar: nova tarefa no projeto e "Continue o IARA HQ a partir do docs/PROGRESSO.md."
- Para acompanhar: abra o docs/PROGRESSO.md, que tem o registro de tudo o que foi feito.
- Tarefas agendadas (opcional): docs/cowork/TAREFAS-AGENDADAS.md.

## Se algo não funcionar no Cowork
Se o Cowork não conseguir dar push ou abrir PR no seu ambiente, use a aba de código do mesmo app
de desktop (Claude Code) com o mesmo prompt: os arquivos do kit valem igual lá.
