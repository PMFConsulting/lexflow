# LexFlow — Ambiente Único

**Data:** 2026-08-30 (noite) · **Atualizado por:** Stuart (infra-ops)

Decisão FINAL do Diogo: a LexFlow tem **UM ÚNICO ambiente** de aplicação.
O ambiente "produção" criado de manhã foi apagado — o que tem os dados reais
(trabalho do Pedro) é a aplicação principal, que passou a servir o domínio
**lexflow.terlicalabs.com**.

## Estado atual

| | Valor |
|---|---|
| Projeto Coolify | `lexflow-teste` (`ojqr1mnnivie5btou1ts2u3l`) — único |
| UUID da aplicação | `c5bzal0y9k5mdu6agyhs2ywv` |
| Repo | `umnick-01/law-project` · branch `main` · build dockerfile (`/Dockerfile`) |
| Domínio principal | **https://lexflow.terlicalabs.com** (primário) |
| Domínio antigo | https://poc.terlicalabs.com → **301 permanente** para lexflow (todos os paths) |
| Base de dados | `lawproject` (postgres container `zt8qhu4noym88j011iiw3a39`) |
| `BETTER_AUTH_URL` | `https://lexflow.terlicalabs.com` |
| `ORIGENS_ADICIONAIS` | `poc.terlicalabs.com` (aceita o host antigo durante a transição) |
| `EMAIL_REMETENTE` | `poc@terlicalabs.com` (domínio verificado no Resend — não mudar sem confirmação) |
| `EMAIL_NOTIFICACOES` | `diogoterlica@hotmail.com` |
| `TZ` | `Europe/Lisbon` |
| Montagem SFTP | `-v /root/id_ed25519:/app/id_ed25519:ro` |

## O que foi apagado (limpeza 2026-08-30, noite)

- App `dockerfile-v78a9z31bs7h35i9z4vac214` (`f12zr2reabblc144nm2tqxw2`, ex-"lexflow-prod")
- Base de dados vazia `lawproject_prod` + role `lawproject_prod` (DROP no postgres `zt8qhu4`)
- Projeto Coolify `lexflow-prod` (`l149wrz2nkkpmghv1xtdk03x`)

A DB `lawproject` **não foi tocada** (0 DELETEs): 18 organizações, 222 processos
de onboarding, 28 utilizadores — verificados depois da limpeza.

## Redirect 301 poc → lexflow

Implementado a nível do proxy (Traefik, ficheiro dinâmico na VPS):
`/data/coolify/proxy/dynamic/poc-redirect.yaml` — router `poc-redirect-301`
com middleware `redirectRegex`, `permanent: true` (301), prioridade 5000
(acima dos routers da app), TLS com letsencrypt.

- Reversível: basta apagar o ficheiro na VPS (`rm /data/coolify/proxy/dynamic/poc-redirect.yaml`)
- A API do Coolify rejeitou a sintaxe `domain redirect` no campo fqdn/domains,
  por isso o redirect vive fora da app — documentado aqui para futuro debug.
- Verificado: `https://poc.terlicalabs.com/entrar` → 301 →
  `https://lexflow.terlicalabs.com/entrar` → 200.

## Guard de origem (migragem de domínio)

O `origemPublica` (`src/lib/origem.ts`) era uma allowlist de UM host
(`BETTER_AUTH_URL`). Com a mudança de domínio, links antigos por email com
`poc.terlicalabs.com` seriam recusados. Patch: nova env `ORIGENS_ADICIONAIS`
(coma-separada) que **alarga** a allowlist sem alterar a origem dos links
(links novos saem sempre com o host de `BETTER_AUTH_URL` = lexflow).
Fail-closed mantido: qualquer outro host continua a lançar erro.
Commit `635fb3e` — "fix: aceitar dominio lexflow na validacao de origem".

Nota: tokens de onboarding ativos (30 dias) continuam válidos — o token é
o fator de autenticação; o host é validado contra a allowlist, não ao
contrário. Com `ORIGENS_ADICIONAIS=poc.terlicalabs.com`, um link antigo
clicado por email funciona e o utilizador aterra no domínio novo apenas
se o link for novo; links antigos abrem no poc → redirect 301 do proxy →
lexflow (o guard nem chega a ser acionado para o path inicial).

## Política de deploys

- Auto-deploy a cada push para `main` (webhook do GitHub App) — não há mais
  ambiente manual de produção.

## Pendências / notas

- [ ] Quando já não houver links antigos por email ativos (tokens de 30 dias,
      ou seja, a partir de ~2026-09-29), remover `poc.terlicalabs.com` de
      `ORIGENS_ADICIONAIS` e avaliar desligar o redirect 301.
- [ ] Remetente de email continua `poc@terlicalabs.com`; se um dia se mudar
      para `lexflow@terlicalabs.com`, confirmar antes no Resend.

## Histórico

- 2026-08-30 (manhã) — Criação do ambiente de produção (`lexflow-prod`), renomeação
  do projeto POC para `lexflow-teste`, criação da base de dados `lawproject_prod`.
- 2026-08-30 (noite) — **Reversão da separação**: um único ambiente. Domínio
  lexflow.terlicalabs.com na app principal, 301 do poc, limpeza total da app/DB/projeto prod.
