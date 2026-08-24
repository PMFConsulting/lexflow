# Infrastructure — runbook

How to reach the servers, what runs on them, and how to publish. Written for
someone — or another agent — arriving with no context at all.

Last revised: 2 August 2026.

---

## 1. The map

```
Cloudflare (DNS)  terlicalabs.com
   │   A  @        →  2.24.141.179     proxy OFF
   │   A  www      →  2.24.141.179     proxy OFF
   │   A  *        →  2.24.141.179     proxy OFF          ← wildcard
   ▼
Hostinger VPS KVM 1 · Ubuntu 24.04 · 1 vCPU · 4 GB · EU
   │
   ├─ Coolify 4.1.2      deploy panel, port 8000
   ├─ Traefik            routes by domain, Let's Encrypt TLS
   ├─ law-project        poc.terlicalabs.com      Next.js
   ├─ PostgreSQL         no published port
   └─ terlicalabs        terlicalabs.com          static Astro
```

**The Cloudflare proxy has to stay grey.** With it orange, Let's Encrypt does not
complete the HTTP-01 challenge and no certificate is issued.

| Resource | Where | Notes |
|---|---|---|
| Domain | Cloudflare Registrar | ~€10/year |
| Server | Hostinger, `srv1870501.hstgr.cloud` | ~€5–8/month |
| IPv4 | `2.24.141.179` | |
| Repositories | `umnick-01/law-project`, `umnick-01/terlicalabs` | private |

---

## 2. Connecting to the server

Key-based access. **Password auth is disabled** in SSH — if the key is lost, recovery
is the **Terminal** in the Hostinger panel, which uses a console and not SSH.

```bash
ssh root@2.24.141.179
```

The private key lives at `~/.ssh/id_ed25519` on Diogo's machine. The public key
authorised on the server carries the comment `diogo@terlicalabs`.

### Authorising another machine

On the new machine:

```bash
ssh-keygen -t ed25519 -C "machine-description"
cat ~/.ssh/id_ed25519.pub
```

And in the Hostinger Terminal, pasting the public key in place of `KEY`:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "KEY" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### Running scripts without quoting problems

Escaping quotes inside `ssh root@ip '...'` is an inexhaustible source of errors.
Write the script to a file and send it over stdin:

```bash
ssh -o BatchMode=yes root@2.24.141.179 'bash -s' < ./script.sh
```

> In PowerShell, do **not** use `Get-Content ... | ssh`: the pipe converts line
> endings to CRLF and bash blows up with `$'\r': command not found`.

---

## 3. Machine status

```bash
ssh root@2.24.141.179 'docker ps --format "table {{.Names}}\t{{.Status}}"; free -m | head -2; df -h / | tail -1'
```

Container names (they change on every deploy, the prefix does not):

| Prefix | What it is |
|---|---|
| `c5bzal0y9k5mdu6agyhs2ywv-` | law-project |
| `xovf0uygf4qjhohrwrk653hf-` | terlicalabs website |
| `zt8qhu4noym88j011iiw3a39` | PostgreSQL |
| `coolify`, `coolify-proxy`, `coolify-db`, … | Coolify itself |

Grabbing the right container without memorising the suffix:

```bash
docker ps --format '{{.Names}}' | grep '^c5bzal' | head -1
```

---

## 4. Database

It has never had a published port and it should stay that way. You get in from the inside:

```bash
DB=$(docker ps --format '{{.Names}}' | grep '^zt8qhu' | head -1)
docker exec -it "$DB" psql -U lawproject -d lawproject
```

Running SQL from a file:

```bash
docker exec -i "$DB" psql -U lawproject -d lawproject < file.sql
```

`DATABASE_URL` is in the application's environment variables, in Coolify. It is the
**internal** URL — the one using the service name. A public URL here is a symptom that
someone has exposed the database.

### Migrations

They run on their own at container start (`scripts/migrar.mjs`). If they fail, the
container does not come up — deliberately: better not to publish than to serve the
application against a schema that is not the expected one.

To validate migrations **with no server at all**, on the development machine:

```bash
pnpm db:validar
```

It applies everything to a Postgres in WASM and verifies the 27 tables, the audit
immutability rules and accent-insensitive search.

---

## 5. Publishing

**There is no manual step.** Every `git push` to `main` triggers a deploy via the
GitHub App webhook.

Following along:

```bash
# wait for the running image to become the one for the new commit
ssh root@2.24.141.179 'docker inspect $(docker ps --format "{{.Names}}" | grep "^c5bzal" | head -1) --format "{{.Config.Image}}"'
```

The image suffix is the commit SHA. While it is still the old one, the deploy has not
finished.

Application logs:

```bash
ssh root@2.24.141.179 'docker logs --tail 40 $(docker ps --format "{{.Names}}" | grep "^c5bzal" | head -1)'
```

### Coolify API

There is a token at `/root/.coolify-token` (permissions 600). It is for automating what
the panel does:

```bash
T=$(tr -d ' \r\n' < /root/.coolify-token)
curl -s -H "Authorization: Bearer $T" http://localhost:8000/api/v1/applications
curl -s -H "Authorization: Bearer $T" "http://localhost:8000/api/v1/deploy?uuid=<uuid>&force=true"
```

Useful UUIDs:

| What | UUID |
|---|---|
| Project `poc` | `ojqr1mnnivie5btou1ts2u3l` |
| Environment `production` | `hs6604rbwjky8ui7m9rbdqat` |
| Server `localhost` | `il6dlk97ietsgu9g62lw16fs` |
| App `law-project` | `c5bzal0y9k5mdu6agyhs2ywv` |
| App `terlicalabs` | `xovf0uygf4qjhohrwrk653hf` |
| PostgreSQL | `zt8qhu4noym88j011iiw3a39` |

**API traps**, learned the hard way:

- The field is called `is_buildtime`, not `is_build_time`. The latter returns 422.
- Creating environment variables with `POST /applications/{uuid}/envs` accepts only
  `key` and `value`. Extra fields are rejected.
- Instance settings (the panel's domain) are **not** in the API. Only through the UI.

---

## 6. Rules that do not get broken

**The Cloudflare proxy stays off** on the records that need a certificate. Turned on,
there is no HTTP-01 challenge and there is no TLS.

**Postgres has no published port.** And note: Docker writes rules straight into iptables
and **bypasses `ufw`**. A container with a published port is exposed even with `ufw`
saying `deny`. What protects the database is not publishing a port for it, not the
firewall.

**Secrets do not travel through chat.** They go from the screen of whoever holds them to
the file on the server. If a secret shows up in a conversation, it is to be revoked, not
used.

**No writing to Coolify's database from outside.** If Coolify stops knowing the real
configuration, it overwrites it on the next operation. Use the API or the UI.

---

## 7. Known holes

| # | What | Status |
|---|---|---|
| 1 | The audit `REVOKE` does not bite: the application user is also the owner of the tables, and the owner always bypasses it. Only the `RULE`s protect | unresolved — create an `app_user` role |
| 2 | Port 8000 open to the internet, waiting for the panel to get its own domain | unresolved |
| 3 | The signature squiggle is stored as base64 in the database, for lack of object storage | accepted POC compromise |
| 4 | No database backups | unresolved |
| 5 | The Hostinger plan renews at a higher price | put it in the calendar |

---

## 8. For an agent arriving now

Reading order:

1. This file — where things are
2. [`ARQUITETURA.md`](ARQUITETURA.md) — the design and the why
3. [`DEPLOY.md`](DEPLOY.md) — how it was all set up from scratch
4. `CLAUDE.md` at the root — decisions, commands, phase status

Before touching anything:

```bash
ssh -o BatchMode=yes root@2.24.141.179 'echo ok'          # is there access?
curl -s -o /dev/null -w '%{http_code}\n' https://poc.terlicalabs.com/
curl -s -o /dev/null -w '%{http_code}\n' https://terlicalabs.com/
```

If the first fails, the key is not authorised — see §2. The other two have to return
`200`; anything else is a problem to diagnose before publishing anything at all.
