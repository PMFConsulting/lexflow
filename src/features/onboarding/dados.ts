import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { processoOnboarding } from "@/db/schema/processo";
import {
  areaInteresse,
  dadosFaturacao,
  dadosFiscais,
  dadosIdentificacao,
  declaracaoPpe,
  emailNewsletter,
  fechoProposta,
  nacionalidade,
  preferenciasContacto,
  relacaoNegocio,
  representanteLegal,
} from "@/db/schema/seccoes";
import { hashToken } from "@/lib/token";

/**
 * Carrega o processo a partir do token do link mágico.
 *
 * Devolve null em qualquer caso de falha — token errado, processo apagado,
 * link expirado — e nunca diz qual. Distinguir "não existe" de "expirou" dá a
 * quem tenta adivinhar tokens a informação de que acertou num.
 */
export async function processoPorToken(token: string) {
  if (!token || token.length < 20) return null;

  const [processo] = await db()
    .select()
    .from(processoOnboarding)
    .where(
      and(
        eq(processoOnboarding.tokenAcessoHash, hashToken(token)),
        isNull(processoOnboarding.apagadoEm),
      ),
    )
    .limit(1);

  if (!processo) return null;
  if (processo.expiraEm && processo.expiraEm < new Date()) return null;

  return processo;
}

/** Todas as secções de um processo, para preencher o formulário de volta. */
export async function seccoesDoProcesso(processoId: string) {
  const base = db();
  const um = <T>(linhas: T[]) => linhas[0] ?? null;

  const [
    identificacao,
    fiscais,
    representante,
    ppe,
    negocio,
    preferencias,
    faturacao,
    fecho,
    nacionalidades,
    emails,
    areas,
  ] = await Promise.all([
    base.select().from(dadosIdentificacao).where(eq(dadosIdentificacao.processoId, processoId)).then(um),
    base.select().from(dadosFiscais).where(eq(dadosFiscais.processoId, processoId)).then(um),
    base.select().from(representanteLegal).where(eq(representanteLegal.processoId, processoId)).then(um),
    base.select().from(declaracaoPpe).where(eq(declaracaoPpe.processoId, processoId)).then(um),
    base.select().from(relacaoNegocio).where(eq(relacaoNegocio.processoId, processoId)).then(um),
    base.select().from(preferenciasContacto).where(eq(preferenciasContacto.processoId, processoId)).then(um),
    base.select().from(dadosFaturacao).where(eq(dadosFaturacao.processoId, processoId)).then(um),
    base.select().from(fechoProposta).where(eq(fechoProposta.processoId, processoId)).then(um),
    base.select().from(nacionalidade).where(eq(nacionalidade.processoId, processoId)),
    base.select().from(emailNewsletter).where(eq(emailNewsletter.processoId, processoId)),
    base.select().from(areaInteresse).where(eq(areaInteresse.processoId, processoId)),
  ]);

  return {
    identificacao,
    fiscais,
    representante,
    ppe,
    negocio,
    preferencias,
    faturacao,
    fecho,
    nacionalidades: nacionalidades.filter((n) => n.titular === "cliente").map((n) => n.pais),
    nacionalidadesRepresentante: nacionalidades
      .filter((n) => n.titular === "representante")
      .map((n) => n.pais),
    emailsNewsletter: emails.map((e) => e.email),
    areasInteresse: areas.map((a) => a.area),
  };
}

export type Seccoes = Awaited<ReturnType<typeof seccoesDoProcesso>>;

/** Quantos passos já foram gravados — alimenta os carimbos da lombada. */
export function passosGravados(s: Seccoes): number[] {
  const feitos: number[] = [];
  if (s.identificacao) feitos.push(1);
  if (s.fiscais) feitos.push(2);
  if (s.representante) feitos.push(3);
  if (s.ppe && s.negocio) feitos.push(4);
  if (s.preferencias) feitos.push(5);
  if (s.faturacao) feitos.push(6);
  if (s.fecho?.declaracaoVeracidade) feitos.push(7);
  return feitos;
}
