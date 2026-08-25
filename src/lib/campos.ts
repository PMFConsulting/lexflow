import { z } from "zod";
import {
  normalizarTelefone,
  validarCodigoPostal,
  validarTelefone,
} from "@/lib/validacao-pt";

/**
 * As peças de validação que aparecem em mais do que um percurso.
 *
 * Estavam só em `features/onboarding/schemas.ts`, que era o único sítio que
 * pedia moradas e telefones. Deixou de ser: a sociedade tem sede, cada pessoa
 * que se junta a ela tem morada e contacto, e um administrador convida por
 * email. Copiá-las era garantir que divergiriam — e a que divergisse seria
 * sempre a de um percurso interno, que é o menos percorrido e o que menos
 * depressa se descobre.
 *
 * Aqui só entra o que é mesmo genérico. `nifFaturacao` fica onde está: a sua
 * mensagem fala de faturação porque é isso que ela valida.
 */

export const obrigatorio = (campo: string) =>
  z.string().trim().min(1, `${campo} é obrigatório.`);

export const email = z
  .string()
  .trim()
  .min(1, "O email é obrigatório.")
  .email("Falta o @ ou o domínio — por exemplo nome@empresa.pt.");

/**
 * O `transform` no fim é o que separa "o que se aceita escrever" de "o que fica
 * gravado". Quem preenche escreve `+351 912 345 678` porque é assim que o
 * número está no cartão; a base de dados guarda `912345678`, porque é assim que
 * ele se compara com o do registo seguinte. Corre depois da validação — um
 * número recusado não chega a ser normalizado, e a mensagem de erro fala do que
 * foi escrito.
 */
export const telefone = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    const r = validarTelefone(v);
    if (!r.valido) ctx.addIssue({ code: "custom", message: r.mensagem });
  })
  .transform(normalizarTelefone);

export const pais = z
  .string()
  .trim()
  .length(2, "Escolha um país da lista.")
  .transform((v) => v.toUpperCase());

export const codigoPostal = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    const r = validarCodigoPostal(v);
    if (!r.valido) ctx.addIssue({ code: "custom", message: r.mensagem });
  });

/** Morada: os sete campos do formulário real (D8). */
export const morada = {
  morada: obrigatorio("A morada"),
  pais,
  localidade: obrigatorio("A localidade"),
  codigoPostal,
  freguesia: obrigatorio("A freguesia"),
  concelho: obrigatorio("O concelho"),
  distrito: obrigatorio("O distrito"),
};

/**
 * Uma data que tem de estar no futuro — validades de documentos.
 *
 * `Date.parse` antes da comparação porque um `new Date("abc")` dá `Invalid
 * Date`, e `Invalid Date > new Date()` é `false`: sem o primeiro `refine`, um
 * disparate escrito no campo saía com «está fora de validade», que manda a
 * pessoa renovar um documento que não tem problema nenhum.
 */
export const dataFutura = (campo: string, foraDeValidade: string) =>
  z
    .string()
    .trim()
    .min(1, `${campo} é obrigatória.`)
    .refine((v) => !Number.isNaN(Date.parse(v)), "Data inválida.")
    .refine((v) => new Date(v) > new Date(), foraDeValidade);

/** Uma data que não pode estar no futuro — nascimentos, inscrições, constituições. */
export const dataPassada = (campo: string, noFuturo: string) =>
  z
    .string()
    .trim()
    .min(1, `${campo} é obrigatória.`)
    .refine((v) => !Number.isNaN(Date.parse(v)), "Data inválida.")
    .refine((v) => new Date(v) <= new Date(), noFuturo);
