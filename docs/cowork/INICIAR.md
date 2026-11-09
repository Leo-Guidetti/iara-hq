# Prompt único

Abra uma tarefa nova no projeto IARA HQ do Cowork (modelo e esforço em MODELOS.md) e cole:

```
Você é o executor autônomo do IARA HQ. Leia CLAUDE.md, docs/ROADMAP.md e docs/PROGRESSO.md.

Execute o docs/PROGRESSO.md em ordem, a partir do "Próximo passo", sozinho e sem pedir
aprovação: branch → commits → PR → auto-merge com CI verde → conferir produção → atualizar o
PROGRESSO.md → próximo item. Respeite todos os guardrails do CLAUDE.md.

Só me chame nos casos de "Quando chamar o Leo". Nesses casos, junte tudo numa única mensagem
com passo a passo e links, e continue com o que não depende de mim enquanto espera.

Se a sessão estiver perto do limite, pare num ponto seguro, deixe o PROGRESSO.md com o
próximo passo exato e me diga em 3 linhas onde parou.
```

## Para continuar depois

Nova tarefa no mesmo projeto, e só:

```
Continue o IARA HQ a partir do docs/PROGRESSO.md.
```

Quando ele te pedir algo (uma chave, um secret), faça e responda na mesma tarefa, por exemplo
"secrets cadastrados, continue".
