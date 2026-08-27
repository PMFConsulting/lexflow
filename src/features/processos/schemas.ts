import { z } from "zod";
import { normalizarNif, validarNipc } from "@/lib/validacao-pt";

/**
 * O que se pede na janela "Novo processo", validado no mesmo ficheiro dos dois
 * lados — como os passos do onboarding (`features/onboarding/schemas.ts`).
 *
 * Os dois percursos não perguntam o mesmo, e não podiam: a uma pessoa coletiva
 * pede-se o NIPC e a denominação social, e são obrigatórios porque é por eles
 * que a sociedade identifica a entidade antes de o cliente tocar no formulário.
 * A uma pessoa singular pede-se o nome, opcional — quem cria o processo pode
 * ter à frente só um email, e obrigar a um nome que ainda não se sabe era
 * trocar uma comodidade por um bloqueio.
 */

/** Uma caixa em branco é uma pergunta não respondida, não uma resposta vazia. */
const vazioComoAusente = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const emailOpcional = z.preprocess(
  vazioComoAusente,
  z
    .string()
    .trim()
    .email("Falta o @ ou o domínio — por exemplo nome@empresa.pt.")
    .optional(),
);

const nomeOpcional = z.preprocess(
  vazioComoAusente,
  z.string().trim().max(200, "O nome não pode passar dos 200 caracteres.").optional(),
);

/**
 * NIPC com o mod-11 inteiro **e** o primeiro dígito de pessoa coletiva, ao
 * contrário do NIF de faturação do passo 5, que aceita números estrangeiros.
 * Aqui a entidade está a ser aberta por quem tem a certidão à frente: um dígito
 * trocado é erro de cópia, e é exatamente isso que o checksum apanha.
 *
 * O `validarNipc` acrescenta ao `validarNif` a única coisa que ele não podia
 * saber deste sítio: que o número é de uma **entidade**. Um NIF de pessoa
 * singular — 1, 2 ou 3 no primeiro dígito — passa o mod-11 com distinção e está
 * na mesma errado aqui, e era um erro que ficava gravado sem nada o assinalar.
 */
const nipc = z
  .string()
  .trim()
  .min(1, "O NIPC é obrigatório.")
  .superRefine((v, ctx) => {
    const r = validarNipc(v);
    if (!r.valido) ctx.addIssue({ code: "custom", message: r.mensagem });
  })
  .transform(normalizarNif);

export const novoProcesso = z.discriminatedUnion("tipoCliente", [
  z.object({
    tipoCliente: z.literal("particular"),
    nome: nomeOpcional,
    email: emailOpcional,
  }),
  z.object({
    tipoCliente: z.literal("empresa"),
    nome: z
      .string()
      .trim()
      .min(2, "Indique a denominação social da entidade.")
      .max(200, "A denominação social não pode passar dos 200 caracteres."),
    nif: nipc,
    email: emailOpcional,
  }),
]);

/**
 * O contrato de entrada, escrito à mão e não inferido: o `z.input` de um
 * `preprocess` é `unknown`, e um contrato que aceita tudo não avisa de nada em
 * quem chama. Aqui vê-se de um relance o que muda entre os dois percursos.
 */
export type NovoProcesso =
  | { tipoCliente: "particular"; nome?: string; email?: string }
  | { tipoCliente: "empresa"; nome: string; nif: string; email?: string };

export const reaberturaProcessoSchema = z.object({
  processoId: z.string().min(1, "Identificador do processo obrigatório."),
  motivo: z
    .string()
    .trim()
    .min(1, "Indique o motivo da reabertura.")
    .min(10, "O motivo deve ter pelo menos 10 caracteres."),
});

export type ReaberturaProcesso = z.infer<typeof reaberturaProcessoSchema>;

