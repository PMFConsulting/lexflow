"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { notificacao } from "@/db/schema/notificacao";
import { organizacao } from "@/db/schema/organizacao";
import {
  eSuperAdmin,
  exigirSessao,
  exigirSocietyAdmin,
} from "@/lib/sessao";
import { registarEvento } from "@/features/auditoria/registar";

async function contexto() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

/**
 * `registarNotificacao` e `enfileirarNotificacaoPendente` viviam aqui e eram as
 * únicas 2 de 53 Server Actions sem `exigirSessao()` — qualquer visitante
 * anónimo podia fazer `POST` diretamente à sua referência e escrever
 * notificações in-app com `link` arbitrário (R2-01, pentest ronda 2). Não
 * precisavam de sessão própria por serem chamadas de dentro de outra ação já
 * autenticada — o que precisavam era de não ser Server Actions. Mudaram-se
 * para `./servico.ts`, um módulo sem `"use server"`, que o Next não regista
 * como endpoint nenhum.
 */

/**
 * A audiência de uma notificação, para quem não é `super_admin` — a mesma
 * regra de `consultarNotificacoes` em `./consultas.ts`, e não uma nova: as
 * duas decidem "isto é meu?" e tinham de decidir da mesma forma, ou marcar
 * como lida deixava de significar o mesmo que ver na lista.
 *
 * Sem esta segunda condição, uma notificação global (`organizacaoId IS NULL`)
 * dirigida ao `paraPapel: "super_admin"` ficava marcável por qualquer conta de
 * qualquer sociedade — bastava-lhe adivinhar ou iterar o id — e escondia
 * avisos da administração da plataforma de quem os devia ver (R2-05, pentest
 * ronda 2). Um `paraPapel` nulo ou `"sociedade"`, ou igual ao papel de quem
 * pede, continua a contar como seu: são as difusões legítimas para toda a
 * equipa.
 */
function audienciaDaOrganizacao(eu: { papel: string; organizacaoId: string }) {
  return and(
    or(
      eq(notificacao.organizacaoId, eu.organizacaoId),
      isNull(notificacao.organizacaoId),
    ),
    or(
      isNull(notificacao.paraPapel),
      eq(notificacao.paraPapel, eu.papel),
      eq(notificacao.paraPapel, "sociedade"),
    ),
  );
}

/**
 * Marca uma notificação individual como lida.
 */
export async function marcarNotificacaoComoLida(id: string): Promise<{ ok: boolean }> {
  const { eu } = await exigirSessao();
  const superAdmin = eSuperAdmin(eu.papel);

  try {
    if (superAdmin) {
      await db()
        .update(notificacao)
        .set({ lidaEm: new Date() })
        .where(and(eq(notificacao.id, id), isNull(notificacao.lidaEm)));
    } else if (eu.organizacaoId) {
      await db()
        .update(notificacao)
        .set({ lidaEm: new Date() })
        .where(
          and(
            eq(notificacao.id, id),
            isNull(notificacao.lidaEm),
            audienciaDaOrganizacao({ papel: eu.papel, organizacaoId: eu.organizacaoId }),
          ),
        );
    }

    revalidatePath("/notificacoes");
    revalidatePath("/admin/notificacoes");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    console.error("[notificacoes] erro ao marcar notificação como lida:", e);
    return { ok: false };
  }
}

/**
 * Marca todas as notificações do utilizador como lidas.
 */
export async function marcarTodasComoLidas(): Promise<{ ok: boolean }> {
  const { eu } = await exigirSessao();
  const superAdmin = eSuperAdmin(eu.papel);

  try {
    if (superAdmin) {
      await db()
        .update(notificacao)
        .set({ lidaEm: new Date() })
        .where(isNull(notificacao.lidaEm));
    } else if (eu.organizacaoId) {
      await db()
        .update(notificacao)
        .set({ lidaEm: new Date() })
        .where(
          and(
            isNull(notificacao.lidaEm),
            audienciaDaOrganizacao({ papel: eu.papel, organizacaoId: eu.organizacaoId }),
          ),
        );
    }

    revalidatePath("/notificacoes");
    revalidatePath("/admin/notificacoes");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    console.error("[notificacoes] erro ao marcar todas as notificações como lidas:", e);
    return { ok: false };
  }
}

/**
 * Altera a preferência da sociedade sobre receber email por cada processo submetido.
 * Só pode ser chamado pelo society_admin.
 */
export async function alterarPreferenciaNotificacaoSubmissoes(
  ativar: boolean,
): Promise<{ ok: boolean; valor: boolean }> {
  const { eu } = await exigirSocietyAdmin();
  const { ip, userAgent } = await contexto();

  const [orgAnterior] = await db()
    .select({ notificarSubmissoesEmail: organizacao.notificarSubmissoesEmail })
    .from(organizacao)
    .where(eq(organizacao.id, eu.organizacaoId))
    .limit(1);

  await db()
    .update(organizacao)
    .set({ notificarSubmissoesEmail: ativar })
    .where(eq(organizacao.id, eu.organizacaoId));

  await registarEvento({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "sociedade.notificacoes_email_alteradas",
    entidade: "organizacao",
    entidadeId: eu.organizacaoId,
    valorAnterior: { notificarSubmissoesEmail: orgAnterior?.notificarSubmissoesEmail ?? false },
    valorNovo: { notificarSubmissoesEmail: ativar },
    ip,
    userAgent,
  });

  revalidatePath("/configuracao");
  revalidatePath("/configuracao/emails");
  revalidatePath("/gestao/sociedade");

  return { ok: true, valor: ativar };
}
