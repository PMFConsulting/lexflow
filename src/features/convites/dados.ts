import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import {
  aceitacaoTermos,
  conviteUtilizador,
  documentoOrganizacao,
  perfilUtilizador,
} from "@/db/schema/sociedade";
import { hashToken, normalizarToken } from "@/lib/token";

export type Convite = typeof conviteUtilizador.$inferSelect;
export type Perfil = typeof perfilUtilizador.$inferSelect;
export type Organizacao = typeof organizacao.$inferSelect;

/**
 * O que aconteceu quando se foi buscar um convite a partir do link.
 *
 * Cinco estados, e a diferença entre eles é a diferença entre um ecrã que
 * resolve o problema e um 404 que o esconde (D49). `cancelado` é o único que
 * não existe nos outros percursos: um convite pode ser retirado pelo
 * administrador que o enviou, e essa pessoa merece saber que foi isso que
 * aconteceu — e não que se enganou no endereço.
 */
export type AcessoConvite =
  | {
      estado: "ok";
      convite: Convite;
      perfil: Perfil | null;
      org: Organizacao;
      token: string;
    }
  | { estado: "concluido"; nome: string }
  | { estado: "cancelado"; nome: string }
  | { estado: "expirado"; nome: string; expirouEm: Date }
  | { estado: "desconhecido" };

export async function acessoConvitePorToken(bruto: string): Promise<AcessoConvite> {
  const token = normalizarToken(bruto ?? "");
  if (token.length < 20) return { estado: "desconhecido" };

  const [linha] = await db()
    .select({ convite: conviteUtilizador, org: organizacao })
    .from(conviteUtilizador)
    .innerJoin(organizacao, eq(organizacao.id, conviteUtilizador.organizacaoId))
    .where(eq(conviteUtilizador.tokenAcessoHash, hashToken(token)))
    .limit(1);

  if (!linha) return { estado: "desconhecido" };

  const { convite, org } = linha;
  if (convite.apagadoEm) return { estado: "desconhecido" };
  if (convite.estado === "cancelado") return { estado: "cancelado", nome: org.nome };
  if (convite.estado === "aceite") return { estado: "concluido", nome: org.nome };
  if (convite.expiraEm && convite.expiraEm < new Date()) {
    return { estado: "expirado", nome: org.nome, expirouEm: convite.expiraEm };
  }

  const [perfil] = await db()
    .select()
    .from(perfilUtilizador)
    .where(eq(perfilUtilizador.conviteId, convite.id))
    .limit(1);

  return { estado: "ok", convite, perfil: perfil ?? null, org, token };
}

/** O texto que se mostra a quem chega com um link que não abre. Um sítio só. */
export function motivoDoAcessoConvite(acesso: AcessoConvite): {
  titulo: string;
  descricao: string;
  referencia?: string;
} {
  switch (acesso.estado) {
    case "ok":
      return { titulo: "", descricao: "" };
    case "concluido":
      return {
        titulo: "Este convite já foi usado.",
        descricao:
          "A conta já existe. Entre na plataforma com o email e a palavra-passe que definiu — " +
          "e, se não se lembra dela, peça a quem administra a conta da sociedade.",
        referencia: acesso.nome,
      };
    case "cancelado":
      return {
        titulo: "Este convite foi cancelado.",
        descricao:
          "Quem administra a conta da sociedade retirou este convite. Se acha que é engano, " +
          "fale com essa pessoa — um convite novo abre um link novo.",
        referencia: acesso.nome,
      };
    case "expirado":
      return {
        titulo: "Este convite expirou.",
        descricao:
          "Os convites são válidos durante 30 dias. O que preencheu não se perdeu — peça um " +
          "convite novo a quem administra a conta da sociedade e continua de onde ficou.",
        referencia: acesso.nome,
      };
    case "desconhecido":
      return {
        titulo: "Este link não é reconhecido.",
        descricao:
          "O endereço pode ter sido cortado ao ser copiado — os links de convite são longos e " +
          "alguns programas de email partem-nos em duas linhas. Abra outra vez a mensagem que " +
          "recebeu e carregue no botão.",
      };
  }
}

/** Os documentos vivos que esta pessoa anexou no seu registo. */
export async function documentosDoConvite(conviteId: string) {
  return db()
    .select({
      id: documentoOrganizacao.id,
      nome: documentoOrganizacao.nomeOriginal,
      tipo: documentoOrganizacao.tipo,
      bytes: documentoOrganizacao.tamanhoBytes,
    })
    .from(documentoOrganizacao)
    .where(
      and(
        eq(documentoOrganizacao.conviteId, conviteId),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    );
}

/** A aceitação de T&C deste convite, se já a deu. */
export async function aceitacaoDoConvite(conviteId: string) {
  const [linha] = await db()
    .select()
    .from(aceitacaoTermos)
    .where(eq(aceitacaoTermos.conviteId, conviteId))
    .limit(1);
  return linha ?? null;
}

/**
 * Que passos já ficaram gravados.
 *
 * Do estado real e não de um contador: um `passo_atual` a 4 diz onde a pessoa
 * está, não o que ficou preenchido, e quem salte para trás para corrigir o
 * passo 1 não perdeu o 2 nem o 3 (mesma razão da D58).
 */
export function passosConviteGravados(
  perfil: Perfil | null,
  tiposDocumento: string[],
  temAceitacao: boolean,
  exerce: boolean,
): number[] {
  const feitos: number[] = [];
  if (!perfil) return feitos;

  if (perfil.nomeCompleto && perfil.nif && perfil.telefone && perfil.codigoPostal) feitos.push(1);
  if (perfil.cargo && (!exerce || perfil.cedulaProfissional)) feitos.push(2);
  if (
    tiposDocumento.includes("identificacao") &&
    (!exerce || tiposDocumento.includes("cedula_profissional"))
  ) {
    feitos.push(3);
  }
  if (perfil.informacaoRgpdEm && perfil.sigiloProfissional) feitos.push(4);
  if (temAceitacao) feitos.push(5);
  // O passo 6 é a criação da conta; quando está feito, o convite já está
  // `aceite` e este percurso não se volta a abrir.
  return feitos;
}

/**
 * O que já está preenchido na ficha de cada convite de uma sociedade, por
 * `conviteId`.
 *
 * Uma consulta e não uma por linha: a lista de convites por aceitar mostra o
 * botão de preencher em todas, e o diálogo abre com o que lá está — sem isto,
 * quem corrigisse um campo apagava por omissão os outros que já estavam
 * escritos, que é o pior modo de falhar de um formulário pré-preenchido.
 *
 * Só as colunas dos passos 1 e 2 — as que um administrador pode preencher por
 * outrem. As dos passos 4 e 5 (sigilo, RGPD, T&C) não entram aqui de
 * propósito: não há ecrã de administração que as escreva.
 */
export type PerfilAdiantado = {
  nomeCompleto: string | null;
  dataNascimento: string | null;
  nif: string | null;
  telefone: string | null;
  docTipo: string | null;
  docNumero: string | null;
  docValidade: string | null;
  morada: string | null;
  pais: string | null;
  localidade: string | null;
  codigoPostal: string | null;
  freguesia: string | null;
  concelho: string | null;
  distrito: string | null;
  cargo: string | null;
  cedulaProfissional: string | null;
  conselhoRegional: string | null;
  dataInscricaoOa: string | null;
  areasPratica: string | null;
};

export async function perfisDosConvites(
  organizacaoId: string,
): Promise<Record<string, PerfilAdiantado>> {
  const linhas = await db()
    .select({
      conviteId: perfilUtilizador.conviteId,
      nomeCompleto: perfilUtilizador.nomeCompleto,
      dataNascimento: perfilUtilizador.dataNascimento,
      nif: perfilUtilizador.nif,
      telefone: perfilUtilizador.telefone,
      docTipo: perfilUtilizador.docTipo,
      docNumero: perfilUtilizador.docNumero,
      docValidade: perfilUtilizador.docValidade,
      morada: perfilUtilizador.morada,
      pais: perfilUtilizador.pais,
      localidade: perfilUtilizador.localidade,
      codigoPostal: perfilUtilizador.codigoPostal,
      freguesia: perfilUtilizador.freguesia,
      concelho: perfilUtilizador.concelho,
      distrito: perfilUtilizador.distrito,
      cargo: perfilUtilizador.cargo,
      cedulaProfissional: perfilUtilizador.cedulaProfissional,
      conselhoRegional: perfilUtilizador.conselhoRegional,
      dataInscricaoOa: perfilUtilizador.dataInscricaoOa,
      areasPratica: perfilUtilizador.areasPratica,
    })
    .from(perfilUtilizador)
    .where(eq(perfilUtilizador.organizacaoId, organizacaoId));

  const saida: Record<string, PerfilAdiantado> = {};
  for (const { conviteId, ...resto } of linhas) saida[conviteId] = resto;
  return saida;
}
