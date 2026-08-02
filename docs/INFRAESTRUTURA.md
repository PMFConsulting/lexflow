# Infraestrutura — runbook

Como chegar aos servidores, o que lá corre, e como publicar. Escrito para
alguém — ou outro agente — que chegue sem contexto nenhum.

Última revisão: 2 de agosto de 2026.

---

## 1. O mapa

```
Cloudflare (DNS)  terlicalabs.com
   │   A  @        →  2.24.141.179     proxy DESLIGADO
   │   A  www      →  2.24.141.179     proxy DESLIGADO
   │   A  *        →  2.24.141.179     proxy DESLIGADO   ← wildcard
   ▼
VPS Hostinger KVM 1 · Ubuntu 24.04 · 1 vCPU · 4 GB · UE
   │
   ├─ Coolify 4.1.2      painel de deploy, porta 8000
   ├─ Traefik            encaminha por domínio, TLS Let's Encrypt
   ├─ law-project        poc.terlicalabs.com      Next.js
   ├─ PostgreSQL         sem porta publicada
   └─ terlicalabs        terlicalabs.com          Astro estático
```

**O proxy da Cloudflare tem de ficar cinzento.** Com ele laranja, o Let's
Encrypt não completa o desafio HTTP-01 e nenhum certificado é emitido.

| Recurso | Onde | Notas |
|---|---|---|
| Domínio | Cloudflare Registrar | ~10 €/ano |
| Servidor | Hostinger, `srv1870501.hstgr.cloud` | ~5–8 €/mês |
| IPv4 | `2.24.141.179` | |
| Repositórios | `umnick-01/law-project`, `umnick-01/terlicalabs` | privados |

---

## 2. Ligar ao servidor

Acesso por chave. **Password está desligada** no SSH — se a chave se perder, a
recuperação é o **Terminal** do painel da Hostinger, que usa consola e não SSH.

```bash
ssh root@2.24.141.179
```

A chave privada vive em `~/.ssh/id_ed25519` na máquina do Diogo. A pública
autorizada no servidor tem o comentário `diogo@terlicalabs`.

### Autorizar outra máquina

Na máquina nova:

```bash
ssh-keygen -t ed25519 -C "descricao-da-maquina"
cat ~/.ssh/id_ed25519.pub
```

E no Terminal da Hostinger, colando a chave pública no lugar de `CHAVE`:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "CHAVE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### Correr scripts sem problemas de quoting

Escapar aspas dentro de `ssh root@ip '...'` é fonte inesgotável de erros.
Escreve o script num ficheiro e envia-o pelo stdin:

```bash
ssh -o BatchMode=yes root@2.24.141.179 'bash -s' < ./script.sh
```

> Em PowerShell, **não** uses `Get-Content ... | ssh`: o pipe converte os fins
> de linha para CRLF e o bash rebenta com `$'\r': command not found`.

---

## 3. Estado da máquina

```bash
ssh root@2.24.141.179 'docker ps --format "table {{.Names}}\t{{.Status}}"; free -m | head -2; df -h / | tail -1'
```

Nomes dos contentores (mudam a cada deploy, o prefixo não):

| Prefixo | O que é |
|---|---|
| `c5bzal0y9k5mdu6agyhs2ywv-` | law-project |
| `xovf0uygf4qjhohrwrk653hf-` | site terlicalabs |
| `zt8qhu4noym88j011iiw3a39` | PostgreSQL |
| `coolify`, `coolify-proxy`, `coolify-db`, … | o próprio Coolify |

Apanhar o contentor certo sem decorar o sufixo:

```bash
docker ps --format '{{.Names}}' | grep '^c5bzal' | head -1
```

---

## 4. Base de dados

Nunca teve porta publicada e não deve passar a ter. Chega-se por dentro:

```bash
DB=$(docker ps --format '{{.Names}}' | grep '^zt8qhu' | head -1)
docker exec -it "$DB" psql -U lawproject -d lawproject
```

Correr SQL de um ficheiro:

```bash
docker exec -i "$DB" psql -U lawproject -d lawproject < ficheiro.sql
```

O `DATABASE_URL` está nas variáveis de ambiente da aplicação, no Coolify. É o
URL **interno** — o que usa o nome do serviço. Um URL público aqui é sintoma de
que alguém expôs a base de dados.

### Migrações

Correm sozinhas no arranque do contentor (`scripts/migrar.mjs`). Se falharem, o
contentor não sobe — é deliberado: mais vale não publicar do que servir a
aplicação contra um schema que não é o esperado.

Para validar migrações **sem servidor nenhum**, na máquina de desenvolvimento:

```bash
pnpm db:validar
```

Aplica tudo a um Postgres em WASM e verifica as 27 tabelas, as regras de
imutabilidade da auditoria e a pesquisa sem acentos.

---

## 5. Publicar

**Não há passo manual.** Cada `git push` para `main` dispara um deploy pelo
webhook da GitHub App.

Acompanhar:

```bash
# esperar que a imagem em execução passe a ser a do commit novo
ssh root@2.24.141.179 'docker inspect $(docker ps --format "{{.Names}}" | grep "^c5bzal" | head -1) --format "{{.Config.Image}}"'
```

O sufixo da imagem é o SHA do commit. Enquanto for o antigo, o deploy ainda não
acabou.

Logs da aplicação:

```bash
ssh root@2.24.141.179 'docker logs --tail 40 $(docker ps --format "{{.Names}}" | grep "^c5bzal" | head -1)'
```

### API do Coolify

Existe um token em `/root/.coolify-token` (permissões 600). Serve para
automatizar o que o painel faz:

```bash
T=$(tr -d ' \r\n' < /root/.coolify-token)
curl -s -H "Authorization: Bearer $T" http://localhost:8000/api/v1/applications
curl -s -H "Authorization: Bearer $T" "http://localhost:8000/api/v1/deploy?uuid=<uuid>&force=true"
```

UUIDs úteis:

| O quê | UUID |
|---|---|
| Projeto `poc` | `ojqr1mnnivie5btou1ts2u3l` |
| Ambiente `production` | `hs6604rbwjky8ui7m9rbdqat` |
| Servidor `localhost` | `il6dlk97ietsgu9g62lw16fs` |
| App `law-project` | `c5bzal0y9k5mdu6agyhs2ywv` |
| App `terlicalabs` | `xovf0uygf4qjhohrwrk653hf` |
| PostgreSQL | `zt8qhu4noym88j011iiw3a39` |

**Armadilhas da API**, aprendidas à força:

- O campo chama-se `is_buildtime`, não `is_build_time`. O segundo devolve 422.
- Criar variáveis de ambiente com `POST /applications/{uuid}/envs` aceita só
  `key` e `value`. Campos a mais são rejeitados.
- As definições da instância (o domínio do painel) **não** estão na API. Só pela
  interface.

---

## 6. Regras que não se quebram

**O proxy da Cloudflare fica desligado** nos registos que precisam de
certificado. Ligado, não há desafio HTTP-01 e não há TLS.

**O Postgres não tem porta publicada.** E atenção: o Docker escreve regras
diretamente no iptables e **passa ao lado do `ufw`**. Um contentor com porta
publicada fica exposto mesmo com o `ufw` a dizer `deny`. O que protege a base de
dados é não lhe publicar porta, não a firewall.

**Segredos não passam por chat.** Vão do ecrã de quem os tem para o ficheiro no
servidor. Se um segredo aparecer numa conversa, é para revogar, não para usar.

**Nada de escrever na base de dados do Coolify por fora.** Se o Coolify deixar
de saber a configuração real, reescreve-a por cima na próxima operação. Usar a
API ou a interface.

---

## 7. Buracos conhecidos

| # | O quê | Estado |
|---|---|---|
| 1 | O `REVOKE` da auditoria não morde: o utilizador da aplicação é também o owner das tabelas, e o owner contorna-o sempre. Só as `RULE` protegem | por resolver — criar papel `app_user` |
| 2 | Porta 8000 aberta à internet, à espera de o painel ter domínio próprio | por resolver |
| 3 | A rubrica das assinaturas é guardada em base64 na base de dados, à falta de object storage | compromisso assumido da POC |
| 4 | Sem cópias de segurança da base de dados | por resolver |
| 5 | O plano da Hostinger renova a preço mais alto | marcar no calendário |

---

## 8. Para um agente que chegue agora

Ordem de leitura:

1. Este ficheiro — onde as coisas estão
2. [`ARQUITETURA.md`](ARQUITETURA.md) — o desenho e o porquê
3. [`DEPLOY.md`](DEPLOY.md) — como tudo foi montado de raiz
4. `CLAUDE.md` na raiz — decisões, comandos, estado das fases

Antes de mexer:

```bash
ssh -o BatchMode=yes root@2.24.141.179 'echo ok'          # há acesso?
curl -s -o /dev/null -w '%{http_code}\n' https://poc.terlicalabs.com/
curl -s -o /dev/null -w '%{http_code}\n' https://terlicalabs.com/
```

Se o primeiro falhar, a chave não está autorizada — ver §2. Os outros dois têm
de dar `200`; qualquer outra coisa é problema a diagnosticar antes de publicar
seja o que for.
