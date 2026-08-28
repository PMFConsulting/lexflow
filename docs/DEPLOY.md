# Deploy — from zero to the POC being live

Complete guide to the shared infrastructure and to publishing this project.
One server, several projects, fixed cost.

## What you end up with

| Address | What it is | Repository |
|---|---|---|
| `terlicalabs.com` | Terlica Labs website, where projects are requested | another repo |
| `www.terlicalabs.com` | The same, redirected | another repo |
| `poc.terlicalabs.com` | **This POC** — PMF Consulting onboarding | `umnick-01/law-project` |
| `coolify.terlicalabs.com` | Server management panel | — |
| `cliente2.terlicalabs.com` | Next POC, when there is one | another repo |

All on the same machine. Each new project is a new subdomain, with no need to return to DNS.

**Total cost:** ~€10/year for the domain + the VPS. On Hostinger KVM 1 that lands between
**€70 and €105/year** depending on the commitment — and it does not rise with the number of
POCs inside it.

Two caveats about Hostinger: the low price requires a 12- or 24-month commitment, and the
**renewal goes up considerably** after that. Put the renewal date in your calendar, and when it
comes compare against Hetzner (~€4.5/month for 2 vCPU and 4 GB, if you have sorted out the
registration by then) or OVH (~€6–7/month).

---

## 1. Domain

- [ ] Register **`terlicalabs.com`** at [Cloudflare Registrar](https://dash.cloudflare.com)
      (~€10/year, at cost, with no increase on renewal)
- [ ] Register directly there, so DNS is already at Cloudflare and a transfer later is avoided

## 2. Server

**Hostinger VPS KVM 1** — 1 vCPU, 4 GB RAM, 50 GB NVMe.

- [ ] **KVM 1** plan
- [ ] OS: **Ubuntu 24.04**
- [ ] Location: **Netherlands** or **France**
- [ ] SSH key added at provisioning time, not a password
- [ ] Note down the IPv4

Why Hostinger: registration does not require a VAT ID, it is available in Portuguese and accepts
local payment. And it is a **Lithuanian** company — European, outside the reach of the Cloud Act,
which in a system holding identification documents and PEP declarations is not a detail. That is
also why the datacenter stays in the EU.

**The minimum is 4 GB of RAM.** That is not headroom, it is the minimum: Coolify takes ~1–1.5 GB,
Postgres ~200 MB, and a `next build` peaks at 1.5–2 GB. With 1 vCPU the builds take a few
minutes — irrelevant for a POC.

### Swap: 2 GB of cheap insurance

With 4 GB and builds spiking, it is always worth it:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Without this, a build that blows through memory is killed by the kernel halfway, and the error in
the logs does not say "out of RAM" — it just says the process terminated.

**When to change machine:** if you start serving real traffic, or if you have three or more
projects building on the same day. At that point, move up to 2 vCPU.

## 3. Firewall

Hostinger has no network firewall like Hetzner, so it goes on the server itself:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8000/tcp   # Coolify panel, remove in step 6
ufw enable
```

**Watch out for a trap that catches a lot of people:** Docker writes rules straight into iptables
and **bypasses ufw**. A container with a published port is reachable from the internet even with
ufw saying `deny`.

In other words, what protects Postgres **is not the firewall** — it is not publishing any port for
it at all. ufw here protects the system's own services; Postgres protects itself by staying only
on Docker's internal network, as in step 8.

In step 6, once the panel has a domain: `ufw delete allow 8000/tcp`.

## 4. Coolify

```bash
ssh root@SERVER_IP
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Check the command at [coolify.io](https://coolify.io) before running it — it is a remote script
executed as root, and that deserves ten seconds of attention.

- [ ] Open `http://SERVER_IP:8000`
- [ ] **Create the administrator account immediately** — the first account created becomes admin,
      and the IP is public

## 5. DNS

At Cloudflare, under `terlicalabs.com` → **DNS → Records**:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `@` | server IP | **off** |
| A | `www` | server IP | **off** |
| A | `*` | server IP | **off** |

The `*` is what gives unlimited subdomains: it covers `poc`, `coolify`, `cliente2` and whatever
comes next, without you coming back here.

**The proxy must stay off** (grey cloud, not orange). With the proxy on, Let's Encrypt cannot
complete the HTTP-01 challenge and no certificate is issued. You can turn it on later, project by
project, once the certificates exist.

## 6. Panel on its own domain

- [ ] Coolify → **Settings → Instance Domain** → `https://coolify.terlicalabs.com`
- [ ] Confirm it opens over HTTPS
- [ ] Close the port: `ufw delete allow 8000/tcp`

## 7. Connect GitHub

Coolify → **Sources → Add → GitHub App**.

Coolify walks you through creating a GitHub App on the `umnick-01` account and installing it on the
chosen repositories. This is the piece that grants read access **and** registers the push webhook —
no SSH keys to manage, and it works with private repositories.

- [ ] Install the App on `umnick-01/law-project`
- [ ] Also install it on the website repo, once it exists

## 8. Database

Coolify → your project → **New Resource → PostgreSQL**.

- [ ] Create the instance
- [ ] Copy the **internal connection URL** (the one using the service name, not the public IP)
- [ ] Confirm it has **no** port published externally

This step replaces Supabase. With the database on the server itself, the free plan's suspension
after 7 days without use disappears — which was exactly what was going to happen to a POC shown
once a fortnight.

## 9. The application

Coolify → **New Resource → Private Repository (with GitHub App)**.

- [ ] Repository `umnick-01/law-project`, branch `main`
- [ ] Build pack: **Dockerfile** (it is at the repo root)
- [ ] Domain: `https://poc.terlicalabs.com`
- [ ] Exposed port: `3000`

## 10. Environment variables

In the resource's **Environment Variables** tab. Never in the repository.

| Variable | Value |
|---|---|
| `DATABASE_URL` | the internal URL from step 8 |
| `BETTER_AUTH_SECRET` | generate it, see below |
| `BETTER_AUTH_URL` | `https://poc.terlicalabs.com` |
| `EMAIL_REMETENTE` | `onboarding@resend.dev` |
| `RESEND_API_KEY` | optional — without it, emails go to the logs |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 11. First deploy

- [ ] **Deploy** in Coolify
- [ ] Follow the logs: the image builds, `scripts/migrar.mjs` applies the three migrations, and
      only then does the Next server start

If the migration fails, the container does not come up. That is deliberate — better not to publish
than to serve the application against a schema that is not the expected one.

## 12. Verify

- [ ] `https://poc.terlicalabs.com` opens with a valid certificate
- [ ] The dashboard shows the tiles and the visual vocabulary
- [ ] In the logs, `Migrações aplicadas a partir de ./migracoes`
- [ ] `git push` to `main` triggers a deploy on its own

## 13. From here on

Each new POC: **New Resource** in Coolify, its repository, and whichever subdomain you want.
DNS is already done.

## 14. Cron Jobs (Resumo Diário ao Dono)

Para reduzir os custos com fornecedores de email (Twilio SendGrid), as notificações internas de novas sociedades e utilizadores são agregadas num email diário único às 09:00 através do script `scripts/resumo_diario.mjs`.

Configurar um cron job no servidor ou no Coolify:

```bash
# Executa diariamente às 09:00 e envia o Resumo Terlica para EMAIL_NOTIFICACOES:
0 9 * * * cd /app && node scripts/resumo_diario.mjs >> /var/log/resumo_diario.log 2>&1
```

Em desenvolvimento ou para testes pontuais:
```bash
node scripts/resumo_diario.mjs --forcar   # Força o envio mesmo sem novos eventos
node scripts/resumo_diario.mjs --dry-run  # Simula a agregação sem disparar email
```

---

## Common problems

**The certificate is not issued.** Cloudflare's proxy is on for that record. Turn it off (grey
cloud) and try again.

**The build runs out of memory.** Server with less than 4 GB, or two builds at once. Add swap or
publish one project at a time.

**The application starts and dies immediately.** Almost always a wrong `DATABASE_URL`. The URL has
to be the **internal** one for Coolify's Postgres, not a public address.

**`CREATE RULE ... already exists` when migrating.** The `__drizzle_migrations` table was deleted.
Migrations `0001` and `0002` are deliberately not idempotent — recreating the schema from scratch
is safer than guessing what has already been applied.

**Audit trail: the `REVOKE` does not bite.** Only the `RULE`s protect while the application user is
also the owner of the tables. Creating an `app_user` role separate from the owner is the step that
closes this — migration `0002` already applies it as soon as the role exists.
