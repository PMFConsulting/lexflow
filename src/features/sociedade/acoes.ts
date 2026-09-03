"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import {
  conviteUtilizador,
  documentoOrganizacao,
  onboardingSociedade,
} from "@/db/schema/sociedade";
import { registarEvento } from "@/features/auditoria/registar";
import { novoTokenAcesso, expiraDaquiA } from "@/lib/token";
import { origemPublica } from "@/lib/origem";
import { enviarEmail } from "@/lib/email";
import { ASSUNTO_CONVITE_UTILIZADOR, emailConviteUtilizador } from "@/lib/emails/convites";
import { urlLogotipoSociedade } from "@/lib/emails/moldura";
import { VERSAO_POLITICA_PRIVACIDADE } from "@/lib/documentos-plataforma";
import {
  acessoSociedadePorToken,
  documentosDaSociedade,
  motivoDoAcessoSociedade,
  passosSociedadeGravados,
  type AcessoSociedade,
} from "./dados";
import { SCHEMAS_SOCIEDADE } from "./schemas";
import { proximoPassoSociedade, TOTAL_PASSOS_SOCIEDADE } from "./passos";

/**
 * As Server Actions do onboarding da sociedade.
 *
 * O token vem do URL e é revalidado aqui, em cada chamada: uma Server Action é
 * um endpoint público como qualquer outro. A validação Zod corre outra vez do
 * lado do servidor pela mesma razão — a do browser é conforto.
 */

export type ResultadoSociedade =
  | { ok: true; proximo: number | null }
  | { ok: false; erros: Record<string, string[]>; mensagem?: string };

async function contexto() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

/**
 * A mesma explicação que a página dá, para a Server Action não dizer outra.
 *
 * Quem lê "o link expirou" no ecrã e "este link já não é válido" ao carregar em
 * Guardar não tem como saber que é o mesmo problema (D49).
 */
function recusa(acesso: AcessoSociedade): ResultadoSociedade {
  const { titulo, descricao } = motivoDoAcessoSociedade(acesso);
  return { ok: false, erros: {}, mensagem: `${titulo} ${descricao}` };
}

/** Os tipos de documento já anexados por esta sociedade e ainda vivos. */
async function tiposAnexados(organizacaoId: string): Promise<string[]> {
  const linhas = await db()
    .select({ tipo: documentoOrganizacao.tipo })
    .from(documentoOrganizacao)
    .where(
      and(
        eq(documentoOrganizacao.organizacaoId, organizacaoId),
        isNull(documentoOrganizacao.conviteId),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    );
  return linhas.map((l) => l.tipo);
}

export async function guardarPassoSociedade(
  bruto: string,
  n: number,
  dados: unknown,
): Promise<ResultadoSociedade> {
  const acesso = await acessoSociedadePorToken(bruto);
  if (acesso.estado !== "ok") return recusa(acesso);

  const { onboarding, org, token } = acesso;

  const schema = SCHEMAS_SOCIEDADE[n as keyof typeof SCHEMAS_SOCIEDADE];
  if (!schema) return { ok: false, erros: {}, mensagem: "Passo inválido." };

  /*
   * Os passos 3 e 4 validam-se contra os documentos realmente anexados, e essa
   * lista **não vem da carga**.
   *
   * O `Anexos` sobe por uma Server Action própria e o input nem `name` tem, por
   * isso o `new FormData(form)` nunca soube de ficheiros nenhum — a lista que o
   * browser mandasse com este nome era exatamente aquilo que a regra existe
   * para não deixar escolher. Vem daqui, e o que a carga trouxesse é
   * substituído, não acreditado. Mesma regra da D56.
   */
  const entrada =
    (n === 3 || n === 4) && typeof dados === "object" && dados !== null
      ? { ...(dados as Record<string, unknown>), documentos: await tiposAnexados(org.id) }
      : dados;

  const r = schema.safeParse(entrada);
  if (!r.success) {
    const erros: Record<string, string[]> = {};
    for (const problema of r.error.issues) {
      const campo = problema.path.join(".") || "_";
      (erros[campo] ??= []).push(problema.message);
    }
    return { ok: false, erros };
  }

  const v = r.data as Record<string, unknown>;
  const base = db();
  const { ip, userAgent } = await contexto();

  switch (n) {
    case 1: {
      const { nipc, ...resto } = v as { nipc: string } & Record<string, unknown>;
      await base
        .update(organizacao)
        .set({ nif: nipc, ...resto })
        .where(eq(organizacao.id, org.id));
      break;
    }

    case 2: {
      await base
        .update(organizacao)
        .set(v as Partial<typeof organizacao.$inferInsert>)
        .where(eq(organizacao.id, org.id));
      break;
    }

    case 3:
      // Nada a gravar: o passo é o anexo, e o anexo já está na base. O que este
      // `case` faz é deixar o `passo_atual` avançar depois de a regra ter
      // passado — e o `break` explícito é o que impede um passo novo de cair
      // num `default` silencioso.
      break;

    case 4: {
      const { termosVersao } = v as { termosVersao: string };

      /*
       * A versão tem de mudar quando o documento muda.
       *
       * É a regra da D3/D38 aplicada ao articulado da sociedade: os
       * consentimentos apontam para uma versão, e substituir o PDF mantendo a
       * versão apaga a diferença entre o que o cliente aceitou e o que passou a
       * estar escrito. Recusar aqui é o que impede o apagamento silencioso da
       * prova — e a mensagem diz qual é a versão em vigor, senão o utilizador
       * fica a adivinhar contra o quê é que está a colidir.
       */
      const [docTermos] = await base
        .select({ id: documentoOrganizacao.id })
        .from(documentoOrganizacao)
        .where(
          and(
            eq(documentoOrganizacao.organizacaoId, org.id),
            eq(documentoOrganizacao.tipo, "termos_sociedade"),
            isNull(documentoOrganizacao.apagadoEm),
          ),
        )
        .limit(1);

      if (!docTermos) {
        return {
          ok: false,
          erros: {
            documentos: [
              "Anexe o PDF dos Termos e Condições da sociedade antes de continuar.",
            ],
          },
        };
      }

      if (
        org.termosVersao === termosVersao &&
        org.termosDocumentoRef &&
        org.termosDocumentoRef !== docTermos.id
      ) {
        return {
          ok: false,
          erros: {
            termosVersao: [
              `O documento mudou mas a versão continua «${termosVersao}». Suba a versão — sem isso, ` +
                "deixa de ser possível distinguir o que um cliente aceitou do que passou a estar escrito.",
            ],
          },
        };
      }

      await base
        .update(organizacao)
        .set({
          termosDocumentoRef: docTermos.id,
          termosVersao,
          termosAtualizadoEm: new Date(),
        })
        .where(eq(organizacao.id, org.id));
      break;
    }

    case 5: {
      await base
        .update(onboardingSociedade)
        .set(v as Partial<typeof onboardingSociedade.$inferInsert>)
        .where(eq(onboardingSociedade.id, onboarding.id));
      break;
    }

    case 6: {
      // A caixa de consentimento vem `true` (o schema é `z.literal(true)`);
      // o que se grava não é o booleano — é o momento em que foi dado e a
      // versão dos documentos que a pessoa viu (mesma regra de prova da D3).
      const { consentimentoPrivacidade: _caixa, ...resto } = v as {
        consentimentoPrivacidade: boolean;
      } & Record<string, unknown>;

      // Só na primeira concessão: voltar a este passo para corrigir outro
      // campo não pode reescrever quando o consentimento foi dado, nem trocá-lo
      // por uma versão que a pessoa nunca viu.
      const consentimentoNovo =
        !onboarding.consentimentoPrivacidadeEm
          ? {
              consentimentoPrivacidadeEm: new Date(),
              consentimentoPrivacidadeVersao: VERSAO_POLITICA_PRIVACIDADE,
            }
          : {};

      await base
        .update(onboardingSociedade)
        .set({ ...resto, ...consentimentoNovo } as Partial<typeof onboardingSociedade.$inferInsert>)
        .where(eq(onboardingSociedade.id, onboarding.id));

      if (consentimentoNovo.consentimentoPrivacidadeEm) {
        await registarEvento({
          organizacaoId: org.id,
          acao: "sociedade.consentimento_privacidade",
          entidade: "onboarding_sociedade",
          entidadeId: onboarding.id,
          valorNovo: { versao: consentimentoNovo.consentimentoPrivacidadeVersao },
          ip,
          userAgent,
        }).catch((e) => {
          // A auditoria não pode interromper o resto (D46) — e aqui o passo já
          // está gravado; um evento perdido é mau, um formulário que não guarda
          // porque a auditoria falhou é pior.
          console.error("[sociedade] consentimento audit write failed", {
            erro: String(e),
          });
        });
      }
      break;
    }
  }

  /*
   * `passo_atual` nunca anda para trás.
   *
   * Mesma regra da D58: gravar uma correção no passo 2 punha-o a 3, e quem
   * fechasse o separador voltava ao 3 num registo que já ia no 6. O maior dos
   * dois é o que descreve o progresso; o menor descreve só onde a pessoa estava
   * neste instante.
   */
  const proximo = proximoPassoSociedade(n);
  const avanco = Math.min(proximo ?? TOTAL_PASSOS_SOCIEDADE, TOTAL_PASSOS_SOCIEDADE);
  if (avanco > onboarding.passoAtual) {
    await base
      .update(onboardingSociedade)
      .set({ passoAtual: avanco })
      .where(eq(onboardingSociedade.id, onboarding.id));
  }

  await registarEvento({
    organizacaoId: org.id,
    acao: `sociedade.passo.${n}.gravado`,
    entidade: "onboarding_sociedade",
    entidadeId: onboarding.id,
    valorNovo: { passo: n },
    ip,
    userAgent,
  }).catch((e) => {
    // A auditoria não pode interromper o resto (D46). Um evento perdido é mau;
    // um passo por gravar porque a auditoria falhou é pior, e apresenta-se como
    // um formulário que não guarda sem dizer porquê.
    console.error("[sociedade] audit write failed", { passo: n, erro: String(e) });
  });

  revalidatePath(`/sociedade/${token}/passo/${n}`);
  return { ok: true, proximo };
}

export type ResultadoSubmissao =
  | {
      ok: true;
      adminEmail: string;
      emailEnviado: boolean;
      erroEmail?: string;
      /**
       * O link do convite do administrador, em claro e **uma vez só**.
       *
       * Devolvido sempre, tenha o email saído ou não, e é a lição da D48
       * aplicada ao único convite que não tem como ser reenviado: este nasce
       * antes de existir conta nenhuma na sociedade, por isso não há ninguém
       * que possa entrar no portal e carregar em «Reenviar». Se o email falha e
       * o token fica só na base em SHA-256, aquela pessoa deixa de ser
       * alcançável e o registo inteiro fica num beco — a sociedade submetida,
       * o convite `pendente`, e nenhuma forma de o abrir.
       */
      linkConvite: string;
    }
  | { ok: false; mensagem: string };

/**
 * Submete o registo da sociedade.
 *
 * A partir do `UPDATE` que marca `submetido`, **cada passo corre no seu próprio
 * `try`** e a ação tem uma saída só (D46). O que aqui se aprendeu com o
 * `criarProcesso` é literalmente o mesmo: o convite ao administrador vive atrás
 * de várias chamadas que não têm nada a ver com email — a auditoria, o
 * `origemPublica()`, o `revalidatePath` — e qualquer uma delas a rebentar dava
 * o registo gravado, o convite por enviar e um ecrã a dizer que o servidor não
 * respondeu.
 */
export async function submeterSociedade(bruto: string): Promise<ResultadoSubmissao> {
  const acesso = await acessoSociedadePorToken(bruto);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcessoSociedade(acesso);
    return { ok: false, mensagem: `${titulo} ${descricao}` };
  }

  const { onboarding, org } = acesso;
  const base = db();

  const docs = await documentosDaSociedade(org.id);
  const tiposDocumento = docs.map((d) => d.tipo);
  const passosFeitos = passosSociedadeGravados(org, onboarding, tiposDocumento);
  const passosEmFalta = [1, 2, 3, 4, 5, 6].filter((p) => !passosFeitos.includes(p));

  if (passosEmFalta.length > 0) {
    const lista = passosEmFalta.map((p) => `Passo ${p}`).join(", ");
    return {
      ok: false,
      mensagem: `Falta preencher os seguintes passos antes de submeter: ${lista}.`,
    };
  }

  if (!onboarding.declaracaoVinculo) {
    return {
      ok: false,
      mensagem: "Confirme a declaração do passo 6 antes de submeter.",
    };
  }
  if (!onboarding.consentimentoPrivacidadeEm) {
    return {
      ok: false,
      mensagem:
        "Confirme a aceitação da Política de Privacidade e dos Termos de Utilização (passo 6) antes de submeter.",
    };
  }
  if (!onboarding.adminNome || !onboarding.adminEmail) {
    return {
      ok: false,
      mensagem: "Falta indicar o administrador da conta, no passo 5.",
    };
  }
  if (!org.termosDocumentoRef || !org.termosVersao) {
    return {
      ok: false,
      mensagem: "Falta anexar os Termos e Condições da sociedade, no passo 4.",
    };
  }

  const adminNome = onboarding.adminNome;
  const adminEmail = onboarding.adminEmail;

  await base
    .update(onboardingSociedade)
    .set({ estado: "submetido", submetidoEm: new Date() })
    .where(eq(onboardingSociedade.id, onboarding.id));

  /*
   * O convite do primeiro administrador nasce aqui, e é a única razão por que
   * esta submissão faz mais do que mudar um estado.
   *
   * `criadoPor` fica a `null` de propósito: neste instante não há ninguém na
   * organização que o pudesse ter enviado. É o único convite da vida da
   * sociedade em que isso é verdade.
   */
  const { token: tokenConvite, hash } = novoTokenAcesso();
  let conviteId: string | null = null;

  try {
    const [convite] = await base
      .insert(conviteUtilizador)
      .values({
        organizacaoId: org.id,
        email: adminEmail,
        nome: adminNome,
        papel: "society_admin",
        tokenAcessoHash: hash,
        expiraEm: expiraDaquiA(30),
      })
      .returning({ id: conviteUtilizador.id });
    conviteId = convite?.id ?? null;
  } catch (e) {
    console.error("[sociedade] admin invitation insert failed", {
      email: adminEmail,
      erro: String(e),
    });
    return {
      ok: false,
      mensagem:
        "O registo ficou submetido mas não foi possível criar o convite do administrador. " +
        "Fale com o seu contacto para o gerarmos manualmente.",
    };
  }

  let emailEnviado = false;
  let erroEmail: string | undefined;
  // Sem `origemPublica` não há domínio para montar o link. O caminho relativo é
  // melhor do que nada: quem administra sabe colar o domínio à frente, e a
  // alternativa era um convite inalcançável.
  let link = `/convite/${tokenConvite}`;

  try {
    link = `${await origemPublica()}/convite/${tokenConvite}`;
  } catch (e) {
    console.error("[sociedade] origemPublica failed", { erro: String(e) });
  }

  try {
    const envio = await enviarEmail({
      para: adminEmail,
      assunto: ASSUNTO_CONVITE_UTILIZADOR,
      html: emailConviteUtilizador({
        nome: adminNome,
        sociedade: org.nome,
        link,
        papel: "society_admin",
        logotipoUrl: urlLogotipoSociedade(org),
      }),
      template: "convite_utilizador",
      organizacaoId: org.id,
      // O hash e nunca o token em claro: quem tiver leitura do `email_log` não
      // fica com a chave de nenhum convite (D4/D34).
      tokenHash: hash,
    });
    emailEnviado = envio.ok;
    if (!envio.ok) erroEmail = envio.erro;
  } catch (e) {
    erroEmail = String(e);
    console.error("[sociedade] admin invitation email failed", {
      email: adminEmail,
      erro: erroEmail,
    });
  }

  try {
    const { ip, userAgent } = await contexto();
    await registarEvento({
      organizacaoId: org.id,
      acao: "sociedade.submetida",
      entidade: "onboarding_sociedade",
      entidadeId: onboarding.id,
      valorNovo: { adminEmail, conviteId, emailEnviado },
      ip,
      userAgent,
    });
  } catch (e) {
    console.error("[sociedade] audit write failed on submission", { erro: String(e) });
  }

  /*
   * **Sem `revalidatePath` aqui**, e a ausência é deliberada.
   *
   * O que estava era `revalidatePath("/")` — revalidar a raiz a partir de uma
   * ação pública, o que é largo demais e não servia nada: ninguém autenticado
   * está a olhar para uma listagem de registos de sociedades. O que fazia era
   * mandar a Next voltar a renderizar esta rota a meio da chamada — e o layout
   * dos passos, que recusa tudo o que não seja um registo em curso, tomava
   * conta do ecrã e engolia o painel que o formulário tinha acabado de montar
   * com o link do convite. O único sítio onde esse link existe em claro
   * desaparecia no instante em que era criado.
   *
   * Quem quiser ver o registo submetido navega para `/submetido`, e essa página
   * lê a base de dados por sua conta.
   */

  return { ok: true, adminEmail, emailEnviado, erroEmail, linkConvite: link };
}
