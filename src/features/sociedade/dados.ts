import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import { documentoOrganizacao, onboardingSociedade } from "@/db/schema/sociedade";
import { hashToken, normalizarToken } from "@/lib/token";

export type Onboarding = typeof onboardingSociedade.$inferSelect;
export type Organizacao = typeof organizacao.$inferSelect;

/**
 * O que aconteceu quando se foi buscar o onboarding de uma sociedade a partir
 * do link.
 *
 * Quatro estados, exatamente como o do cliente (D49) e pela mesma razão: um
 * `null` obriga quem o recebe a inventar o motivo, e o que cada rota inventava
 * era um 404 — a mesma frase para "o link expirou", "isto já foi submetido" e
 * "escreveu mal o endereço", que se resolvem de três maneiras diferentes.
 *
 * `concluido` não existe no percurso do cliente porque lá o processo submetido
 * continua a poder ser lido; aqui, uma sociedade que já submeteu tem um sítio
 * melhor para onde ir, que é a plataforma dela.
 */
export type AcessoSociedade =
  | { estado: "ok"; onboarding: Onboarding; org: Organizacao; token: string }
  | { estado: "concluido"; nome: string }
  | { estado: "expirado"; nome: string; expirouEm: Date }
  | { estado: "desconhecido" };

/**
 * Carrega o onboarding da sociedade a partir do token.
 *
 * Sem filtros no `where` para além do hash, e a classificação vem a seguir —
 * com os filtros lá dentro, um link submetido e um token inventado devolviam os
 * dois zero linhas e nenhum ecrã os conseguia distinguir (D49).
 */
export async function acessoSociedadePorToken(bruto: string): Promise<AcessoSociedade> {
  const token = normalizarToken(bruto ?? "");
  if (token.length < 20) return { estado: "desconhecido" };

  const [linha] = await db()
    .select({ onboarding: onboardingSociedade, org: organizacao })
    .from(onboardingSociedade)
    .innerJoin(organizacao, eq(organizacao.id, onboardingSociedade.organizacaoId))
    .where(eq(onboardingSociedade.tokenAcessoHash, hashToken(token)))
    .limit(1);

  if (!linha) return { estado: "desconhecido" };

  const { onboarding, org } = linha;
  if (onboarding.apagadoEm) return { estado: "desconhecido" };
  if (onboarding.estado !== "rascunho") {
    return { estado: "concluido", nome: org.nome };
  }
  if (onboarding.expiraEm && onboarding.expiraEm < new Date()) {
    return { estado: "expirado", nome: org.nome, expirouEm: onboarding.expiraEm };
  }

  return { estado: "ok", onboarding, org, token };
}

/** O texto que se mostra a quem chega com um link que não abre. Um sítio só. */
export function motivoDoAcessoSociedade(acesso: AcessoSociedade): {
  titulo: string;
  descricao: string;
  referencia?: string;
} {
  switch (acesso.estado) {
    case "ok":
      return { titulo: "", descricao: "" };
    case "concluido":
      return {
        titulo: "Este registo já foi submetido.",
        descricao:
          "A sociedade já está registada na plataforma. Se precisa de alterar dados, entre com a " +
          "conta de administrador e use a área de Administração.",
        referencia: acesso.nome,
      };
    case "expirado":
      return {
        titulo: "Este link expirou.",
        descricao:
          "Os links de registo são válidos durante 30 dias. Nada se perdeu — peça um link novo " +
          "ao seu contacto e o preenchimento continua de onde ficou.",
        referencia: acesso.nome,
      };
    case "desconhecido":
      return {
        titulo: "Este link não é reconhecido.",
        descricao:
          "O endereço pode ter sido cortado ao ser copiado — os links de registo são longos e " +
          "alguns programas de email partem-nos em duas linhas. Abra outra vez a mensagem que " +
          "recebeu e carregue no botão, ou peça um link novo.",
      };
  }
}

/** Os documentos vivos de uma sociedade (os que não são de ninguém em concreto). */
export async function documentosDaSociedade(organizacaoId: string) {
  return db()
    .select({
      id: documentoOrganizacao.id,
      nome: documentoOrganizacao.nomeOriginal,
      tipo: documentoOrganizacao.tipo,
      bytes: documentoOrganizacao.tamanhoBytes,
      criadoEm: documentoOrganizacao.criadoEm,
    })
    .from(documentoOrganizacao)
    .where(
      and(
        eq(documentoOrganizacao.organizacaoId, organizacaoId),
        isNull(documentoOrganizacao.conviteId),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    );
}

/**
 * Que passos já ficaram gravados — alimenta os carimbos da lombada.
 *
 * Lê-se do estado real e não de um contador: um `passo_atual` a 4 diz onde a
 * pessoa está, não o que ficou preenchido, e alguém que salte para trás para
 * corrigir o passo 1 não perdeu o 2 nem o 3.
 */
export function passosSociedadeGravados(
  org: Organizacao,
  onboarding: Onboarding,
  tiposDocumento: string[],
): number[] {
  const feitos: number[] = [];
  if (org.nif && org.naturezaJuridica) feitos.push(1);
  if (org.morada && org.codigoPostal && org.emailGeral) feitos.push(2);
  if (tiposDocumento.includes("certidao_sociedade")) feitos.push(3);
  if (org.termosDocumentoRef && org.termosVersao) feitos.push(4);
  if (onboarding.adminNome && onboarding.adminEmail) feitos.push(5);
  if (onboarding.declaracaoVinculo) feitos.push(6);
  return feitos;
}
