"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull, ne } from "drizzle-orm";
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
import { exigirGestorDeUtilizadores, podeAcederSociedade } from "@/lib/sessao";
import {
  acessoConvitePorToken,
  motivoDoAcessoConvite,
  type AcessoConvite,
} from "./dados";
import { SCHEMAS_CONVITE, perfilConvidadoSchema } from "./schemas";
import {
  exerceAdvocacia,
  proximoPassoConvite,
  TOTAL_PASSOS_CONVITE,
} from "./passos";
import { notificarDonoNovoUtilizador } from "@/lib/emails/notificacoes-dono";
import { mascararEmail } from "@/lib/redigir";

/**
 * Server Actions do registo de uma pessoa da equipa.
 *
 * O token vem do URL e é revalidado em cada chamada — endpoint público como
 * outro qualquer. O último passo cria a conta com palavra-passe; os anteriores
 * existem para que isso só aconteça depois da pessoa estar identificada.
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
 * Garante que a linha do perfil existe antes de se escrever nela. O perfil
 * nasce vazio e enche-se aos poucos (colunas anuláveis); `onConflictDoUpdate`
 * sobre `convite_id` evita a leitura prévia.
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

  // `exerce` e `documentos` vêm daqui e não da carga: o primeiro sai do papel
  // do convite (não do formulário — senão dava para dispensar a cédula), o
  // segundo é a lista de anexos que o `FormData` do passo nunca soube (D56).
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
      // `exerce` não é coluna do perfil — sai antes do INSERT, senão o Drizzle
      // tenta escrever um campo que não existe. Campos vazios viram `null`
      // porque uma string vazia numa coluna `date` rebenta.
      const limpo = Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => k !== "exerce")
          .map(([k, valor]) => [k, valor === "" ? null : valor]),
      );
      await gravarPerfil(org.id, convite.id, limpo);
      break;
    }

    case 3:
      // Nada a gravar: o passo é o anexo, e já está na base.
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

      // A declaração de sigilo entra na auditoria com IP e momento —
      // `evento_auditoria` é append-only com cadeia de hash (D5/D6), e é essa
      // linha, não a coluna do perfil, que vale como prova daqui a sete anos.
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
      // A versão dos T&C é copiada, não referenciada (D3/D38): uma linha por
      // aceitação, nunca atualizada — uma versão nova produz linha nova e a
      // antiga continua a dizer o que foi aceite naquele dia.
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
      // Não se grava por aqui: criar a conta é `concluirConvite`. Chegar aqui
      // só confirma que a palavra-passe está bem formada.
      return { ok: true, proximo: null };
  }

  // `passo_atual` nunca anda para trás (D58) — sem isto, corrigir o passo 2
  // fazia recuar um registo que já ia no 5.
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
 * Três escritas numa transação (D2/D23, D63): `user` e `account` (onde o
 * Better Auth guarda a palavra-passe, `provider_id = 'credential'`) e
 * `utilizador`, que tem papel e organização — sem ela o login passa mas
 * `sessaoAtual()` não resolve. A meio não há estado aceitável: um `user` sem
 * `account` ocupa o email para sempre sem palavra-passe; um `account` sem
 * `utilizador` é um login que passa e uma sessão que não resolve.
 *
 * O hash vem de `better-auth/crypto`, não de reimplementação — garante que os
 * parâmetros do scrypt não divergem numa atualização da biblioteca.
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

  // Os passos anteriores confirmam-se aqui e não só no ecrã — é uma Server
  // Action chamável à mão, e sem isto dava para saltar direto para cá sem
  // anexos, sigilo ou T&C aceites. As mensagens dizem a que passo voltar.
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
      if (convite.papel !== "society_admin") {
        const [noutraOrg] = await tx
          .select({ id: utilizador.id, organizacaoId: utilizador.organizacaoId })
          .from(utilizador)
          .where(
            and(
              eq(utilizador.email, email),
              ne(utilizador.organizacaoId, org.id),
            ),
          )
          .limit(1);

        if (noutraOrg) {
          throw new Error(
            "Esta pessoa já tem conta noutra sociedade. Um email só pode estar associado a uma sociedade.",
          );
        }
      }

      const [contaExistente] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1);

      let authUserId: string;
      if (contaExistente) {
        if (convite.papel !== "society_admin") {
          const [noutraPorAuth] = await tx
            .select({ id: utilizador.id, organizacaoId: utilizador.organizacaoId })
            .from(utilizador)
            .where(
              and(
                eq(utilizador.authUserId, contaExistente.id),
                ne(utilizador.organizacaoId, org.id),
              ),
            )
            .limit(1);

          if (noutraPorAuth) {
            throw new Error(
              "Esta pessoa já tem conta noutra sociedade. Um email só pode estar associado a uma sociedade.",
            );
          }
        }

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
          // Dado por verificado: chegou aqui por um link enviado a este endereço.
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
            // Palavra-passe escolhida no passo anterior, nada a redefinir.
            // Explícito porque a linha pode ser anterior (conta criada por
            // administrador, depois apagada) e voltar a exigir redefinição.
            deveRedefinirPassword: false,
            // O convite é o próprio ato de admissão — explícito e não deixado
            // ao valor da coluna, porque uma linha rejeitada antes traria o
            // `null` e prenderia a pessoa em `/aguarda-aprovacao` sem explicação.
            aprovadoEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(utilizador.id, id));
      } else {
        // `id` gerado na aplicação e não pela base (D15): Postgres só tem
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
          // Ver acima: o convite é a admissão. Vale sobretudo para o primeiro
          // administrador de uma sociedade nova, que entra por aqui.
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

      // A aceitação passa a apontar também para a conta — senão o portal do
      // advogado não conseguia mostrar a própria aceitação depois do convite aceite.
      await tx
        .update(aceitacaoTermos)
        .set({ utilizadorId: id })
        .where(eq(aceitacaoTermos.conviteId, convite.id));

      return id;
    });
  } catch (e) {
    console.error("[convite] account creation failed", { email: mascararEmail(email), erro: String(e) });
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Esta pessoa já tem conta noutra sociedade")) {
      return {
        ok: false,
        mensagem:
          "Esta pessoa já tem conta noutra sociedade. Um email só pode estar associado a uma sociedade.",
      };
    }
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

  await notificarDonoNovoUtilizador({
    nome,
    email,
    sociedadeNome: org.nome,
    papel: convite.papel,
    organizacaoId: org.id,
  });

  try {
    revalidatePath(`/convite/${token}`, "layout");
    revalidatePath("/gestao/utilizadores");
  } catch {
    // Fora de um contexto de pedido, `revalidatePath` não deve falhar a criação da conta.
  }

  return { ok: true, email };
}


export type ResultadoPerfilConvidado =
  | { ok: true; campos: string[] }
  | { ok: false; erros: Record<string, string[]>; mensagem?: string };

/**
 * Preenche (ou corrige) os dados de quem foi convidado, em nome dela.
 *
 * `exigirGestorDeUtilizadores` — `super_admin` e `society_admin`, a mesma
 * fronteira de quem cria contas. A sociedade-alvo **não vem do pedido**: sai
 * do próprio convite, e `podeAcederSociedade` fecha a porta ao
 * `society_admin` que passe o id de um convite de outra casa. Sem essa
 * verificação, um id adivinhado dava para escrever na ficha de alguém de
 * outra sociedade — o isolamento que toda a plataforma assenta em comparar
 * `organizacao_id`.
 */
export async function preencherPerfilConvidado(
  conviteId: string,
  dados: unknown,
): Promise<ResultadoPerfilConvidado> {
  const { eu } = await exigirGestorDeUtilizadores();

  if (typeof conviteId !== "string" || conviteId.trim() === "") {
    return { ok: false, erros: {}, mensagem: "Convite inválido." };
  }

  const base = db();

  const [convite] = await base
    .select()
    .from(conviteUtilizador)
    .where(
      and(eq(conviteUtilizador.id, conviteId), isNull(conviteUtilizador.apagadoEm)),
    )
    .limit(1);

  if (!convite) return { ok: false, erros: {}, mensagem: "Convite não encontrado." };

  if (!podeAcederSociedade(eu, convite.organizacaoId)) {
    // A mesma mensagem que um convite inexistente: dizer «existe, mas não é
    // seu» confirma a existência de um registo noutra sociedade.
    return { ok: false, erros: {}, mensagem: "Convite não encontrado." };
  }

  // Um convite aceite já tem conta do outro lado, e a pessoa passa a
  // administrar os seus próprios dados no portal dela; um cancelado não vai
  // ser percorrido por ninguém. Escrever em qualquer dos dois é escrever numa
  // ficha que já não é lida por este caminho.
  if (convite.estado !== "pendente") {
    return {
      ok: false,
      erros: {},
      mensagem:
        convite.estado === "aceite"
          ? "Este convite já foi aceite — a conta existe e é a própria pessoa que altera os seus dados."
          : "Este convite foi cancelado. Envie um convite novo antes de preencher a ficha.",
    };
  }

  const r = perfilConvidadoSchema.safeParse(dados);
  if (!r.success) {
    const erros: Record<string, string[]> = {};
    for (const problema of r.error.issues) {
      const campo = problema.path.join(".") || "_";
      (erros[campo] ??= []).push(problema.message);
    }
    return { ok: false, erros, mensagem: "Falta corrigir um campo." };
  }

  // Só os campos que vieram. Um `undefined` não pode virar `null` no UPDATE:
  // gravar a ficha com o cargo por preencher apagaria o cargo que a pessoa já
  // tinha escrito — quem preenche por outrem acrescenta, não limpa.
  const valores = Object.fromEntries(
    Object.entries(r.data).filter(([, valor]) => valor !== undefined),
  );

  if (Object.keys(valores).length === 0) {
    return {
      ok: false,
      erros: { _: ["Preencha pelo menos um campo antes de gravar."] },
      mensagem: "Preencha pelo menos um campo antes de gravar.",
    };
  }

  const [antes] = await base
    .select()
    .from(perfilUtilizador)
    .where(eq(perfilUtilizador.conviteId, convite.id))
    .limit(1);

  try {
    await base
      .insert(perfilUtilizador)
      .values({
        organizacaoId: convite.organizacaoId,
        conviteId: convite.id,
        ...valores,
      } as typeof perfilUtilizador.$inferInsert)
      .onConflictDoUpdate({
        target: perfilUtilizador.conviteId,
        set: {
          ...(valores as Partial<typeof perfilUtilizador.$inferInsert>),
          atualizadoEm: new Date(),
        },
      });
  } catch (e) {
    console.error("[admin] falhou a gravar o perfil do convidado:", e);
    return { ok: false, erros: {}, mensagem: "Não foi possível gravar. Tente de novo." };
  }

  const campos = Object.keys(valores);
  const anterior: Record<string, unknown> = {};
  if (antes) {
    for (const campo of campos) {
      anterior[campo] = (antes as Record<string, unknown>)[campo] ?? null;
    }
  }

  // Quem preencheu fica escrito. Um dado da ficha de uma pessoa que ela nunca
  // escreveu tem de ser distinguível daquilo que ela declarou — é a diferença
  // entre «declarou» e «foi-lhe atribuído», e é ela que uma revisão jurídica
  // procura sete anos depois (D60, do lado da equipa).
  const { ip, userAgent } = await contexto();
  await registarEvento({
    organizacaoId: convite.organizacaoId,
    atorId: eu.id,
    acao: "utilizador.dados_preenchidos_por_admin",
    entidade: "perfil_utilizador",
    entidadeId: convite.id,
    valorAnterior: antes ? anterior : null,
    valorNovo: { email: convite.email, papel: convite.papel, campos, ...valores },
    ip,
    userAgent,
  }).catch((e) => console.error("[admin] audit write failed", { erro: String(e) }));

  revalidatePath("/gestao/utilizadores");
  revalidatePath(`/admin/sociedades/${convite.organizacaoId}`);
  return { ok: true, campos };
}
