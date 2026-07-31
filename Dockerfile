# Imagem de produção. Três estágios para o resultado final não levar nem o
# código-fonte nem as dependências de desenvolvimento.

FROM node:22-alpine AS base
RUN npm install -g pnpm@9.15.9
WORKDIR /app

# ---------------------------------------------------------------- dependências
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

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

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# As migrações e o runner que as aplica ao arrancar.
COPY --from=builder --chown=nextjs:nodejs /app/src/db/migrations ./migracoes
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrar.mjs ./scripts/migrar.mjs

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
