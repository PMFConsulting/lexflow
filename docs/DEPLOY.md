# Deploy — do zero até a POC no ar

Guia completo da infraestrutura partilhada e da publicação deste projeto.
Um servidor, vários projetos, custo fixo.

## O que fica no fim

| Endereço | O que é | Repositório |
|---|---|---|
| `terlicalabs.com` | Site da Terlica Labs, onde se pedem projetos | outro repo |
| `www.terlicalabs.com` | O mesmo, redirecionado | outro repo |
| `poc.terlicalabs.com` | **Esta POC** — onboarding PMF Consulting | `umnick-01/law-project` |
| `coolify.terlicalabs.com` | Painel de gestão do servidor | — |
| `cliente2.terlicalabs.com` | POC seguinte, quando houver | outro repo |

Tudo na mesma máquina. Cada projeto novo é um subdomínio novo, sem voltar ao DNS.

**Custo total:** ~10 €/ano de domínio + ~4,5 €/mês de servidor. Cerca de **65 €/ano**,
independentemente de quantas POCs correm lá dentro.

---

## 1. Domínio

- [ ] Registar **`terlicalabs.com`** na [Cloudflare Registrar](https://dash.cloudflare.com)
      (~10 €/ano, a preço de custo, sem subida na renovação)
- [ ] Registar diretamente lá, para o DNS já ficar na Cloudflare e evitar transferência depois

## 2. Servidor

- [ ] Conta na [Hetzner Cloud](https://console.hetzner.cloud)
- [ ] Novo servidor: **CX22** (2 vCPU, 4 GB RAM, 40 GB) — ~4,5 €/mês
- [ ] Imagem: **Ubuntu 24.04**
- [ ] Localização: **Falkenstein** ou **Nuremberga** (~40 ms para Lisboa)
- [ ] **Adicionar a chave SSH no momento da criação** — evita palavra-passe por email
- [ ] Anotar o IPv4 da máquina

Não escolhas menos de 4 GB. O `next build` de duas aplicações mais o Postgres não
cabem em 2 GB, e a falha aparece a meio de uma compilação, não no arranque.

## 3. Firewall

Na consola da Hetzner, **Firewalls → Create**, aplicada ao servidor:

| Porta | Origem | Porquê |
|---|---|---|
| 22 | o teu IP, se for fixo | SSH |
| 80 | qualquer | HTTP e desafios do Let's Encrypt |
| 443 | qualquer | HTTPS |
| 8000 | o teu IP | painel do Coolify, **só até ao passo 6** |

O Postgres (5432) **nunca** aparece aqui. Fica na rede interna do Docker.

## 4. Coolify

```bash
ssh root@IP_DO_SERVIDOR
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Confirma o comando em [coolify.io](https://coolify.io) antes de o correres — é um script
remoto executado como root, e isso merece dez segundos de atenção.

- [ ] Abrir `http://IP_DO_SERVIDOR:8000`
- [ ] **Criar a conta de administrador imediatamente** — a primeira conta a ser criada fica
      admin, e o IP é público

## 5. DNS

Na Cloudflare, em `terlicalabs.com` → **DNS → Records**:

| Tipo | Nome | Conteúdo | Proxy |
|---|---|---|---|
| A | `@` | IP do servidor | **desligado** |
| A | `www` | IP do servidor | **desligado** |
| A | `*` | IP do servidor | **desligado** |

O `*` é o que dá subdomínios ilimitados: cobre `poc`, `coolify`, `cliente2` e tudo o que
vier, sem voltares aqui.

**O proxy tem de ficar desligado** (nuvem cinzenta, não laranja). Com o proxy ligado, o
Let's Encrypt não consegue completar o desafio HTTP-01 e nenhum certificado é emitido.
Podes ligá-lo mais tarde, projeto a projeto, depois de os certificados existirem.

## 6. Painel com domínio próprio

- [ ] Coolify → **Settings → Instance Domain** → `https://coolify.terlicalabs.com`
- [ ] Confirmar que abre com HTTPS
- [ ] **Fechar a porta 8000** na firewall da Hetzner

## 7. Ligar o GitHub

Coolify → **Sources → Add → GitHub App**.

O Coolify guia a criação de uma GitHub App na conta `umnick-01` e a sua instalação nos
repositórios escolhidos. É esta peça que dá acesso de leitura **e** regista o webhook de
push — sem chaves SSH para gerir, e funciona com repositórios privados.

- [ ] Instalar a App em `umnick-01/law-project`
- [ ] Instalar também no repo do site, quando existir

## 8. Base de dados

Coolify → o teu projeto → **New Resource → PostgreSQL**.

- [ ] Criar a instância
- [ ] Copiar o **URL de ligação interno** (o que usa o nome do serviço, não o IP público)
- [ ] Confirmar que **não** tem porta publicada para o exterior

Este passo substitui o Supabase. Com base de dados no próprio servidor, desaparece a
suspensão ao fim de 7 dias sem uso do plano gratuito — que era exatamente o que ia
acontecer a uma POC mostrada de duas em duas semanas.

## 9. A aplicação

Coolify → **New Resource → Private Repository (with GitHub App)**.

- [ ] Repositório `umnick-01/law-project`, branch `main`
- [ ] Build pack: **Dockerfile** (está na raiz do repo)
- [ ] Domínio: `https://poc.terlicalabs.com`
- [ ] Porta exposta: `3000`

## 10. Variáveis de ambiente

Na aba **Environment Variables** do recurso. Nunca no repositório.

| Variável | Valor |
|---|---|
| `DATABASE_URL` | o URL interno do passo 8 |
| `BETTER_AUTH_SECRET` | gerar, ver abaixo |
| `BETTER_AUTH_URL` | `https://poc.terlicalabs.com` |
| `EMAIL_REMETENTE` | `onboarding@resend.dev` |
| `RESEND_API_KEY` | opcional — sem ela, os emails vão para os logs |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 11. Primeiro deploy

- [ ] **Deploy** no Coolify
- [ ] Acompanhar os logs: a imagem compila, o `scripts/migrar.mjs` aplica as três migrações
      e só depois o servidor Next arranca

Se a migração falhar, o contentor não sobe. É deliberado — mais vale não publicar do que
servir a aplicação contra um schema que não é o esperado.

## 12. Verificar

- [ ] `https://poc.terlicalabs.com` abre com certificado válido
- [ ] O painel mostra os tiles e o vocabulário visual
- [ ] Nos logs, `Migrações aplicadas a partir de ./migracoes`
- [ ] `git push` para `main` dispara um deploy sozinho

## 13. A partir daqui

Cada POC nova: **New Resource** no Coolify, o repositório dela, e o subdomínio que quiseres.
O DNS já está feito.

---

## Problemas comuns

**O certificado não é emitido.** O proxy da Cloudflare está ligado nesse registo. Desliga
(nuvem cinzenta) e volta a tentar.

**A compilação fica sem memória.** Servidor com menos de 4 GB, ou duas compilações em
simultâneo. Adiciona swap ou publica um projeto de cada vez.

**A aplicação arranca e morre logo.** Quase sempre `DATABASE_URL` errado. O URL tem de ser
o **interno** do Postgres do Coolify, não um endereço público.

**`CREATE RULE ... already exists` ao migrar.** A tabela `__drizzle_migrations` foi
apagada. As migrações `0001` e `0002` não são idempotentes de propósito — recriar o schema
de raiz é mais seguro do que adivinhar o que já foi aplicado.

**Auditoria: o `REVOKE` não morde.** Só as `RULE` protegem enquanto o utilizador da
aplicação for também o owner das tabelas. Criar um papel `app_user` separado do owner é o
passo que fecha isto — a migração `0002` já o aplica assim que o papel existir.
