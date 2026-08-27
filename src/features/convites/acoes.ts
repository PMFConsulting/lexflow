"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { uuidv7 } from "uuidv7";
import { db } from "@/db";
import { account, user } from "@/db/schema/auth";
import { utilizador } from "@/db/schema/organizacao";
import {
  aceitacaoTermos,
  conviteUtilizador,
  documentoOrganizacao,
  perfilUtilizador,
} from "@/db/schema/sociedade";
import { registarEvento } from "@/features/auditoria/registar";
import { termosEmVigor } from "@/lib/termos-sociedade";
import {
  acessoConvitePorToken,
  motivoDoAcessoConvite,
  type AcessoConvite,
} from "./dados";
import { SCHEMAS_CONVITE } from "./schemas";
import {
  exerceAdvocacia,
  proximoPassoConvite,
  TOTAL_PASSOS_CONVITE,
} from "./passos";

/**
 * As Server Actions do registo de uma pessoa da equipa.
 *
 * O token vem do URL e é revalidado em cada chamada: uma Server Action é um
 * endpoint público como qualquer outro. E há aqui uma coisa que os outros
 * percursos não têm — o último passo **cria uma conta com palavra-passe**, que
 * é a operação mais sensível de toda a plataforma. Tudo o que a antecede existe
 * para que ela só possa acontecer depois de a pessoa estar identificada.
 */

export type ResultadoConvite =
  | { ok: true; proximo: number | null }
  | { ok: false; erros: Record<string, string[]>; mensagem?: string };

async function contexto() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

function recusa(acesso: AcessoConvite): ResultadoConvite {
  const { titulo, descricao } = motivoDoAcessoConvite(acesso);
  return { ok: false, erros: {}, mensagem: `${titulo} ${descricao}` };
}

async function tiposAnexados(conviteId: string): Promise<string[]> {
  const linhas = await db()
    .select({ tipo: documentoOrganizacao.tipo })
    .from(documentoOrganizacao)
    .where(
      and(
        eq(documentoOrganizacao.conviteId, conviteId),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    );
  return linhas.map((l) => l.tipo);
}

/**
 * Garante que a linha do perfil existe antes de se escrever nela.
 *
 * O perfil nasce vazio no primeiro passo e enche-se aos poucos — todas as
 * colunas são anuláveis por isso. Um `onConflictDoUpdate` sobre `convite_id`
 * faz o mesmo trabalho sem a leitura prévia, e é o que se usa a seguir.
 */
async function gravarPerfil(
  organizacaoId: string,
  conviteId: string,
  valores: Record<string, unknown>,
) {
  await db()
    .insert(perfilUtilizador)
    .values({
      organizacaoId,
      conviteId,
      ...valores,
    } as typeof perfilUtilizador.$inferInsert)
    .onConflictDoUpdate({
      target: perfilUtilizador.conviteId,
      set: valores as Partial<typeof perfilUtilizador.$inferInsert>,
    });
}

export async function guardarPassoConvite(
  bruto: string,
  n: number,
  dados: unknown,
): Promise<ResultadoConvite> {
  const acesso = await acessoConvitePorToken(bruto);
  if (acesso.estado !== "ok") return recusa(acesso);

  const { convite, org, token } = acesso;

  const schema = SCHEMAS_CONVITE[n as keyof typeof SCHEMAS_CONVITE];
  if (!schema) return { ok: false, erros: {}, mensagem: "Passo inválido." };

  const exerce = exerceAdvocacia(convite.papel);

  /*
   * `exerce` e `documentos` vêm daqui e não da carga.
   *
   * O primeiro decide se a cédula é obrigatória, e sai do **papel do convite** —
   * que é onde o administrador o escreveu. Um formulário que pudesse mandar o
   * seu próprio papel era um assistente a dispensar-se da cédula, ou a
   * promover-se a sócio, no caminho para o servidor. O segundo é a lista de
   * anexos, que o `FormData` do passo nunca soube (D56). O que a carga trouxesse
   * com estes nomes é substituído, não acreditado.
   */
  const entrada =
    typeof dados === "object" && dados !== null
      ? {
          ...(dados as Record<string, unknown>),
          ...(n === 2 || n === 3 ? { exerce } : {}),
          ...(n === 3 ? { documentos: await tiposAnexados(convite.id) } : {}),
        }
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
  const { ip, userAgent } = await contexto();
  const base = db();

  switch (n) {
    case 1: {
      await gravarPerfil(org.id, convite.id, v);
      break;
    }

    case 2: {
      // `exerce` entrou no schema para decidir se a cédula é obrigatória e não
      // é coluna do perfil: sai antes do INSERT, senão o Drizzle escreve
      // `insert into perfil_utilizador ("exerce"…)` e rebenta num campo que
      // ninguém viu. Um campo por preencher chega como string vazia, e uma data
      // vazia numa coluna `date` rebenta — por isso o vazio vira null.
      const limpo = Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => k !== "exerce")
          .map(([k, valor]) => [k, valor === "" ? null : valor]),
      );
      await gravarPerfil(org.id, convite.id, limpo);
      break;
    }

    case 3:
      // Nada a gravar: o passo é o anexo, e o anexo já está na base. O `break`
      // explícito é o que impede um passo novo de cair num `default` calado.
      break;

    case 4: {
      const { sigiloProfissional, comunicacoesInternas } = v as {
        sigiloProfissional: boolean;
        comunicacoesInternas: boolean;
      };
      const agora = new Date();
      await gravarPerfil(org.id, convite.id, {
        informacaoRgpdEm: agora,
        sigiloProfissional,
        sigiloAceiteEm: agora,
        comunicacoesInternas,
      });

      /*
       * A declaração de sigilo entra na auditoria com o IP e o momento.
       *
       * `evento_auditoria` é append-only com cadeia de hash (D5/D6), e é ele
       * que responde a "quando é que esta pessoa assumiu o sigilo?" daqui a
       * sete anos. A coluna no perfil responde à mesma pergunta e é
       * atualizável; a linha da auditoria não é, e é essa a que vale como prova.
       */
      await registarEvento({
        organizacaoId: org.id,
        acao: "utilizador.sigilo_declarado",
        entidade: "perfil_utilizador",
        entidadeId: convite.id,
        valorNovo: { email: convite.email, papel: convite.papel },
        ip,
        userAgent,
      }).catch((e) =>
        console.error("[convite] audit write failed", { passo: n, erro: String(e) }),
      );
      break;
    }

    case 5: {
      /*
       * A aceitação dos T&C da sociedade — o ponto 2 da revisão do cliente.
       *
       * A versão é **copiada** e não referenciada: é o valor que estava em vigor
       * naquele instante, e uma cópia não se pode editar a partir de outro sítio
       * (D3/D38). Uma linha por aceitação, e nunca atualizada — uma versão nova
       * do articulado produz uma linha nova e a antiga continua a dizer o que
       * aquela pessoa aceitou naquele dia.
       */
      const termos = await termosEmVigor(org.id);

      const [jaAceite] = await base
        .select({ id: aceitacaoTermos.id, versao: aceitacaoTermos.versao })
        .from(aceitacaoTermos)
        .where(
          and(
            eq(aceitacaoTermos.conviteId, convite.id),
            eq(aceitacaoTermos.versao, termos.versao),
          ),
        )
        .limit(1);

      if (!jaAceite) {
        await base.insert(aceitacaoTermos).values({
          organizacaoId: org.id,
          conviteId: convite.id,
          utilizadorId: convite.utilizadorId,
          versao: termos.versao,
          documentoRef: termos.forma === "documento" ? termos.documentoId : null,
          aceiteEm: new Date(),
          ip: ip ?? "desconhecido",
          userAgent: userAgent ?? "desconhecido",
        });

        await registarEvento({
          organizacaoId: org.id,
          acao: "utilizador.termos_aceites",
          entidade: "aceitacao_termos",
          entidadeId: convite.id,
          valorNovo: {
            email: convite.email,
            versao: termos.versao,
            forma: termos.forma,
          },
          ip,
          userAgent,
        }).catch((e) =>
          console.error("[convite] audit write failed", { passo: n, erro: String(e) }),
        );
      }
      break;
    }

    case 6:
      // O passo 6 não se grava por aqui: cria uma conta, e isso é
      // `concluirConvite`. Chegar aqui com o schema 6 validado significa que a
      // palavra-passe está bem formada — o que falta é a transação, que não
      // cabe num `switch` de gravação de campos.
      return { ok: true, proximo: null };
  }

  /*
   * `passo_atual` nunca anda para trás (mesma regra da D58).
   *
   * Gravar uma correção no passo 2 punha-o a 3, e quem fechasse o separador
   * voltava ao 3 num registo que já ia no 5.
   */
  const proximo = proximoPassoConvite(n);
  const avanco = Math.min(proximo ?? TOTAL_PASSOS_CONVITE, TOTAL_PASSOS_CONVITE);
  if (avanco > convite.passoAtual) {
    await base
      .update(conviteUtilizador)
      .set({ passoAtual: avanco })
      .where(eq(conviteUtilizador.id, convite.id));
  }

  if (n !== 4 && n !== 5) {
    await registarEvento({
      organizacaoId: org.id,
      acao: `utilizador.passo.${n}.gravado`,
      entidade: "convite_utilizador",
      entidadeId: convite.id,
      valorNovo: { passo: n, email: convite.email },
      ip,
      userAgent,
    }).catch((e) =>
      console.error("[convite] audit write failed", { passo: n, erro: String(e) }),
    );
  }

  revalidatePath(`/convite/${token}`, "layout");
  return { ok: true, proximo };
}

export type ResultadoConclusao =
  | { ok: true; email: string }
  | { ok: false; erros?: Record<string, string[]>; mensagem: string };

/** Id no formato do Better Auth: texto opaco, sem hífenes. */
const idAuth = () => randomBytes(16).toString("hex");

/**
 * O último passo: cria a conta.
 *
 * Três escritas, e as três são precisas (D2/D23): `user` e `account` — onde o
 * Better Auth guarda a palavra-passe, com `provider_id = 'credential'` — e
 * `utilizador`, que é quem tem papel e organização. Sem a terceira, o login
 * passa e a sessão não resolve, porque `sessaoAtual()` procura por
 * `auth_user_id` e devolve `null`.
 *
 * O hash vem de `better-auth/crypto` e não de uma reimplementação: é a única
 * forma de garantir que os parâmetros do scrypt não divergem numa atualização
 * da biblioteca — e uma divergência aqui dá uma conta criada em que ninguém
 * consegue entrar, sem nada no ecrã que o explique.
 *
 * **Tudo numa transação.** A meio destas três escritas não há estado
 * intermédio aceitável: um `user` sem `account` é uma conta sem palavra-passe
 * que ocupa o email para sempre; um `account` sem `utilizador` é um login que
 * passa e uma sessão que não resolve. As duas dão a mesma coisa a quem lá está
 * — um convite gasto e nenhuma maneira de entrar.
 */
export async function concluirConvite(
  bruto: string,
  dados: unknown,
): Promise<ResultadoConclusao> {
  const acesso = await acessoConvitePorToken(bruto);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcessoConvite(acesso);
    return { ok: false, mensagem: `${titulo} ${descricao}` };
  }

  const { convite, perfil, org, token } = acesso;

  const r = SCHEMAS_CONVITE[6].safeParse(dados);
  if (!r.success) {
    const erros: Record<string, string[]> = {};
    for (const problema of r.error.issues) {
      const campo = problema.path.join(".") || "_";
      (erros[campo] ??= []).push(problema.message);
    }
    return { ok: false, erros, mensagem: "Corrija a palavra-passe para concluir." };
  }

  /*
   * Os passos anteriores confirmam-se aqui, e não só no ecrã.
   *
   * Esta é uma Server Action, chamável à mão: quem soubesse o token podia
   * saltar direto para cá e sair com uma conta sem ter anexado documento
   * nenhum, sem declaração de sigilo e sem ter aceitado o articulado da
   * sociedade. Cada uma destas verificações fecha um desses caminhos, e as
   * mensagens dizem a **qual passo** voltar — um "faltam dados" genérico deixa
   * quem o lê a percorrer seis ecrãs à procura.
   */
  if (!perfil?.nomeCompleto || !perfil.nif) {
    return { ok: false, mensagem: "Falta preencher os seus dados, no passo 1." };
  }
  if (!perfil.cargo) {
    return { ok: false, mensagem: "Faltam os dados profissionais, no passo 2." };
  }

  const exerce = exerceAdvocacia(convite.papel);
  if (exerce && !perfil.cedulaProfissional) {
    return { ok: false, mensagem: "Falta a cédula profissional, no passo 2." };
  }

  const tipos = await tiposAnexados(convite.id);
  if (!tipos.includes("identificacao")) {
    return { ok: false, mensagem: "Falta anexar o documento de identificação, no passo 3." };
  }
  if (exerce && !tipos.includes("cedula_profissional")) {
    return { ok: false, mensagem: "Falta anexar a cédula profissional, no passo 3." };
  }
  if (!perfil.sigiloProfissional) {
    return {
      ok: false,
      mensagem: "Falta a declaração de sigilo profissional, no passo 4.",
    };
  }

  const termos = await termosEmVigor(org.id);
  const [aceitacao] = await db()
    .select({ id: aceitacaoTermos.id })
    .from(aceitacaoTermos)
    .where(
      and(
        eq(aceitacaoTermos.conviteId, convite.id),
        eq(aceitacaoTermos.versao, termos.versao),
      ),
    )
    .limit(1);

  if (!aceitacao) {
    return {
      ok: false,
      mensagem: "Falta aceitar os Termos e Condições da sociedade, no passo 5.",
    };
  }

  const hash = await hashPassword(r.data.password);
  const base = db();
  const email = convite.email.trim().toLowerCase();
  const nome = perfil.nomeCompleto;

  let utilizadorId: string;

  try {
    utilizadorId = await base.transaction(async (tx) => {
      const [contaExistente] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1);

      let authUserId: string;
      if (contaExistente) {
        // A conta do Better Auth já existir não é anormal: a mesma pessoa pode
        // ter estado noutra organização. O que não pode é ficar com o nome
        // desatualizado nem com a palavra-passe antiga a valer.
        authUserId = contaExistente.id;
        await tx
          .update(user)
          .set({ name: nome, updatedAt: new Date() })
          .where(eq(user.id, authUserId));
      } else {
        authUserId = idAuth();
        await tx.insert(user).values({
          id: authUserId,
          name: nome,
          email,
          // O email é dado por verificado: a pessoa chegou aqui por um link
          // que só existiu dentro de uma mensagem enviada para este endereço.
          emailVerified: true,
        });
      }

      const [credencial] = await tx
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, authUserId), eq(account.providerId, "credential")))
        .limit(1);

      if (credencial) {
        await tx
          .update(account)
          .set({ password: hash, updatedAt: new Date() })
          .where(eq(account.id, credencial.id));
      } else {
        await tx.insert(account).values({
          id: idAuth(),
          accountId: authUserId,
          providerId: "credential",
          userId: authUserId,
          password: hash,
        });
      }

      const [jaNaOrg] = await tx
        .select({ id: utilizador.id })
        .from(utilizador)
        .where(
          and(eq(utilizador.organizacaoId, org.id), eq(utilizador.email, email)),
        )
        .limit(1);

      let id: string;
      if (jaNaOrg) {
        id = jaNaOrg.id;
        await tx
          .update(utilizador)
          .set({
            nome,
            papel: convite.papel,
            authUserId,
            ativo: true,
            apagadoEm: null,
            // A palavra-passe foi escolhida por esta pessoa, no passo anterior:
            // não há nada a redefinir. Explícito porque a linha pode ser
            // anterior — uma conta criada por um administrador (que nasce
            // marcada) e depois apagada volta por aqui, e sem esta linha ficava
            // a exigir a redefinição de uma palavra-passe que ela mesma acabou
            // de definir.
            deveRedefinirPassword: false,
            // Quem chega por convite não passa pela aprovação da plataforma: o
            // convite **é** o ato de admissão, e as seis etapas anteriores são a
            // identificação que a aprovação existe para exigir. Explícito, e não
            // deixado ao valor da coluna: `aprovado_em` é anulável, e uma linha
            // que volte por aqui depois de ter sido rejeitada traria o `null`
            // consigo — a pessoa acabava de escolher a palavra-passe e ficava
            // presa em `/aguarda-aprovacao`, sem nada no ecrã a dizer porquê.
            aprovadoEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(utilizador.id, id));
      } else {
        // `id` gerado na aplicação e não pela base (D15): o Postgres só tem
        // `uuidv7()` nativo na v18.
        id = uuidv7();
        await tx.insert(utilizador).values({
          id,
          organizacaoId: org.id,
          authUserId,
          nome,
          email,
          papel: convite.papel,
          ativo: true,
          // Ver acima: o convite é a admissão, e sem esta linha a conta nascia
          // pendente de uma aprovação que ninguém pediu. Vale sobretudo para o
          // primeiro administrador de uma sociedade nova, que entra por aqui —
          // uma sociedade acabada de registar ficaria sem ninguém que consegue
          // entrar nela.
          aprovadoEm: new Date(),
        });
      }

      await tx
        .update(conviteUtilizador)
        .set({
          estado: "aceite",
          aceiteEm: new Date(),
          utilizadorId: id,
          passoAtual: TOTAL_PASSOS_CONVITE,
        })
        .where(eq(conviteUtilizador.id, convite.id));

      await tx
        .update(perfilUtilizador)
        .set({ utilizadorId: id })
        .where(eq(perfilUtilizador.conviteId, convite.id));

      // A prova da aceitação passa a apontar também para a conta. Sem isto, o
      // portal do advogado não conseguia mostrar a **própria** aceitação da
      // pessoa: a linha só tinha o convite, e o convite deixa de estar à mão
      // depois de aceite.
      await tx
        .update(aceitacaoTermos)
        .set({ utilizadorId: id })
        .where(eq(aceitacaoTermos.conviteId, convite.id));

      return id;
    });
  } catch (e) {
    console.error("[convite] account creation failed", { email, erro: String(e) });
    return {
      ok: false,
      mensagem:
        "Não foi possível criar a conta. Nada ficou a meio — tente de novo, e se voltar a " +
        "acontecer fale com quem administra a conta da sociedade.",
    };
  }

  const { ip, userAgent } = await contexto();
  await registarEvento({
    organizacaoId: org.id,
    acao: "utilizador.conta_criada",
    entidade: "utilizador",
    entidadeId: utilizadorId,
    valorNovo: { email, papel: convite.papel, conviteId: convite.id },
    ip,
    userAgent,
  }).catch((e) =>
    console.error("[convite] audit write failed on completion", { erro: String(e) }),
  );

  try {
    revalidatePath(`/convite/${token}`, "layout");
    revalidatePath("/gestao/utilizadores");
  } catch {
    // Fora de um contexto de pedido, `revalidatePath` não é motivo para
    // transformar uma conta criada com sucesso numa falha.
  }

  return { ok: true, email };
}
