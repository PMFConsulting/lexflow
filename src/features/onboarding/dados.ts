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
import { assinatura, documento } from "@/db/schema/documentos";
import { hashToken, normalizarToken } from "@/lib/token";
import type { TipoCliente } from "./passos";

export type Processo = typeof processoOnboarding.$inferSelect;

/**
 * O que aconteceu ao ir buscar o processo de um link mágico (D49).
 *
 * Quatro estados em vez de `null`: expirado, arquivado e desconhecido têm
 * saídas distintas (pedir renovação / falar com a sociedade / link mal
 * copiado), e o `notFound()` anterior dizia as três com a mesma frase.
 * `desconhecido` não revela nada a quem anda a adivinhar tokens — os outros
 * três só são alcançáveis por quem já traz um token válido.
 */
export type AcessoOnboarding =
  /** `token` é o token **já normalizado** — o que serve para montar links. */
  | { estado: "ok"; processo: Processo; token: string }
  | { estado: "expirado"; referencia: string; expirouEm: Date }
  | { estado: "arquivado"; referencia: string }
  | { estado: "desconhecido" };

/**
 * Carrega o processo a partir do token do link mágico.
 *
 * Consulta **sem** os filtros de apagado e de validade — a classificação vem
 * a seguir. Com os filtros dentro do `where`, um processo arquivado e um
 * token inventado davam ambos zero linhas, indistinguíveis. É a única
 * consulta por token da aplicação (D48): `criarProcesso` também passa por
 * aqui para testar o link recém-gerado, em vez de duplicar a query.
 */
export async function acessoPorToken(bruto: string): Promise<AcessoOnboarding> {
  const token = normalizarToken(bruto ?? "");
  if (token.length < 20) return { estado: "desconhecido" };

  const [processo] = await db()
    .select()
    .from(processoOnboarding)
    .where(eq(processoOnboarding.tokenAcessoHash, hashToken(token)))
    .limit(1);

  if (!processo) return { estado: "desconhecido" };
  if (processo.apagadoEm) {
    return { estado: "arquivado", referencia: processo.referencia };
  }
  if (processo.expiraEm && processo.expiraEm < new Date()) {
    return { estado: "expirado", referencia: processo.referencia, expirouEm: processo.expiraEm };
  }

  return { estado: "ok", processo, token };
}

/**
 * O texto para quem chega com um link que não abre. Centralizado porque são
 * cinco os sítios que o mostram — layout, três páginas do percurso e as
 * Server Actions que revalidam o token — e as mensagens tinham de bater
 * certo entre si.
 */
export function motivoDoAcesso(acesso: AcessoOnboarding): {
  titulo: string;
  descricao: string;
  referencia?: string;
} {
  switch (acesso.estado) {
    case "ok":
      // Inalcançável pelo tipo; fica pelo `switch` exaustivo.
      return { titulo: "", descricao: "" };
    case "expirado":
      return {
        titulo: "Este link expirou.",
        descricao:
          "Os links de preenchimento são válidos durante 30 dias. O processo não se perdeu — " +
          "peça um link novo ao seu contacto na sociedade e continua de onde ficou.",
        referencia: acesso.referencia,
      };
    case "arquivado":
      return {
        titulo: "Este processo foi arquivado.",
        descricao:
          "O dossier já não está a receber preenchimento. Se acha que é engano, fale com o seu " +
          "contacto na sociedade e indique a referência em baixo.",
        referencia: acesso.referencia,
      };
    case "desconhecido":
      return {
        titulo: "Este link não é reconhecido.",
        descricao:
          "O endereço pode ter sido cortado ao ser copiado — os links de preenchimento são " +
          "longos e alguns programas de email partem-nos em duas linhas. Abra outra vez a " +
          "mensagem que recebeu e carregue no botão, ou peça um link novo ao seu contacto.",
      };
  }
}

/*
 * De propósito sem um `processoPorToken` que devolva `Processo | null` — um
 * `null` obriga quem o recebe a inventar a razão, e o que cada sítio
 * inventava era `notFound()`.
 */

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
    documentos,
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
    // Sem a coluna `dados`: os ficheiros em si não têm de atravessar o servidor
    // para desenhar a lista, e são megabytes por processo.
    base
      .select({
        id: documento.id,
        nome: documento.nomeOriginal,
        tipo: documento.tipo,
        bytes: documento.tamanhoBytes,
        criadoEm: documento.criadoEm,
      })
      .from(documento)
      .where(and(eq(documento.processoId, processoId), isNull(documento.apagadoEm))),
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
    documentos,
  };
}

export type Seccoes = Awaited<ReturnType<typeof seccoesDoProcesso>>;

/** A rubrica do último passo — prova de assinatura, para o ecrã final e o back-office. */
export async function assinaturaDoProcesso(processoId: string) {
  const [linha] = await db()
    .select({
      imagemDados: assinatura.imagemDados,
      assinadoEm: assinatura.assinadoEm,
    })
    .from(assinatura)
    .where(eq(assinatura.processoId, processoId))
    .limit(1);

  return linha ?? null;
}

/** Quantos passos já foram gravados — alimenta os carimbos da lombada. */
export function passosGravados(s: Seccoes, tipoCliente: TipoCliente): number[] {
  const feitos: number[] = [];
  if (s.identificacao) feitos.push(1);
  if (s.fiscais) feitos.push(2);
  // O passo 3 só existe para pessoas coletivas. Quando existe, a linha conta
  // como dada mesmo com "Sim" — o registo em branco é a resposta.
  if (tipoCliente === "empresa" && s.representante) feitos.push(3);
  if (s.ppe && s.negocio) feitos.push(4);
  if (s.faturacao) feitos.push(5);
  if (s.preferencias?.origemContacto) feitos.push(6);
  if (s.fecho?.declaracaoVeracidade && s.fecho?.tcAceitacao && s.fecho?.propostaAceitacao)
    feitos.push(7);
  return feitos;
}
