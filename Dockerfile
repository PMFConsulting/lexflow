# Imagem de produção. Três estágios para o resultado final não levar nem o
# código-fonte nem as dependências de desenvolvimento.
#
# Debian slim e não Alpine, e a razão é uma só: o adaptador de armazenamento
# por servidor fala SFTP através do `curl` (src/lib/storage/servidor.ts), e o
# `curl` do Alpine é compilado sem libssh2 — não tem sftp:// na lista de
# protocolos, e a sincronização falhava com "Protocol sftp not supported" já
# em produção. O do Debian traz libssh2. A alternativa era instalar o
# openssh-client e reescrever o adaptador à volta do binário `sftp`, o que
# custava o `.netrc` (a palavra-passe passava a depender do `sshpass`) e o
# `--hostpubsha256` (o pinning da chave do host). Trocar a base custa uns
# megabytes de imagem e nenhuma linha de lógica.
FROM node:22-bookworm-slim AS base
RUN npm install -g pnpm@9.15.9
WORKDIR /app

# ---------------------------------------------------------------- dependências
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# --------------------------------------------------------------------- build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# O `next build` não precisa de base de dados nem de segredos: o env() e o db()
# são preguiçosos de propósito (decisão D11). É por isso que este estágio corre
# sem nenhuma variável de ambiente.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# --------------------------------------------------------------------- runtime
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# O curl é uma dependência de runtime da aplicação, não uma ferramenta de
# diagnóstico: é ele que leva os dossiers para o SFTP da sociedade. O `grep`
# no fim é a parte que interessa — sem sftp na lista de protocolos a imagem
# não se constrói, em vez de a falha aparecer na primeira submissão de um
# cliente, num sítio onde ninguém está a olhar.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl --version | grep -qw sftp

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --home-dir /app --shell /usr/sbin/nologin nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# As migrações e o runner que as aplica ao arrancar.
COPY --from=builder --chown=nextjs:nodejs /app/src/db/migrations ./migracoes
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrar.mjs ./scripts/migrar.mjs

# O teste do canal de email. Vai na imagem de propósito: as três causas de "o
# cliente não recebeu nada" — chave que não chega ao ambiente, domínio por
# verificar no Resend, saída para a Internet fechada — só se distinguem de
# dentro do contentor, e diagnosticá-las a criar processos a sério é caro e
# deixa lixo na base de dados.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/testar_email.mjs ./scripts/testar_email.mjs

# O remetente por omissão, que os dois scripts de email acima importam
# (`../src/email-remetente-default.mjs`). O `output: standalone` não o traz — a
# aplicação chega lá por `src/env.ts`, os scripts não passam pelo bundle — e sem
# ele o `node scripts/testar_email.mjs` morre em ERR_MODULE_NOT_FOUND dentro do
# contentor, que é precisamente o único sítio onde ele serve para alguma coisa.
COPY --from=builder --chown=nextjs:nodejs /app/src/email-remetente-default.mjs ./src/email-remetente-default.mjs

# O Resumo Diário ao dono da plataforma. A aplicação agenda-o sozinha
# (src/instrumentation.ts) — este é o caminho manual, para o correr fora de hora
# ou para o ver sem enviar (`--dry-run`), que é o que responde a "houve
# sociedades novas ontem e eu não recebi nada?" sem abrir um psql.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/resumo_diario.mjs ./scripts/resumo_diario.mjs

# O arranque de uma base de dados nova. Sem estes dois na imagem não há maneira
# nenhuma de a plataforma sair do zero: o registo público não existe (D23), o
# primeiro `super_admin` não tem quem o crie pela interface — não há ninguém
# autenticado — e uma sociedade entra por convite e não por formulário. Faltando
# aqui, a única saída era abrir um psql contra a produção e escrever à mão as
# três linhas do Better Auth com o hash certo, que é exatamente o que o
# `criar_utilizador.mjs` existe para ninguém ter de fazer.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/criar_utilizador.mjs ./scripts/criar_utilizador.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/convidar_sociedade.mjs ./scripts/convidar_sociedade.mjs

# O `output: standalone` só inclui o que a aplicação importa, e ela nunca
# importa o migrador. Estes dois pacotes vêm explicitamente para o
# scripts/migrar.mjs ter com que trabalhar.
COPY --from=deps /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps /app/node_modules/postgres ./node_modules/postgres

USER nextjs
EXPOSE 3000

# Migra e só depois arranca. Se a migração falhar, o contentor não sobe — é
# preferível a servir uma aplicação contra um schema que não é o esperado.
CMD ["sh", "-c", "node scripts/migrar.mjs && node server.js"]
