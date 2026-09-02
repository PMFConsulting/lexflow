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

/**
 * O comprimento mínimo de uma palavra-passe — o `minPasswordLength` do Better
 * Auth (`lib/auth.ts`).
 *
 * Vive aqui, e não no serviço de contas, porque quem precisa dele são os dois
 * lados: o servidor, que recusa, e o ecrã, que avisa antes de a pessoa
 * submeter. O serviço é `server-only` e importá-lo de um componente de cliente
 * rebenta o build — o que empurrava para escrever o `12` outra vez, e dois
 * números com o mesmo propósito divergem. O dia em que divergissem era o dia
 * em que um ecrã aceitava uma palavra-passe com que ninguém entra.
 */
export const MINIMO_PALAVRA_PASSE = 12;

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

/**
 * O sítio da sociedade — opcional, e vazio significa mesmo vazio.
 *
 * O `""` que um campo por preencher envia não é um URL, e um `z.url()`
 * optional recusa-o com «URL inválido» sobre uma caixa que ninguém abriu — a
 * forma mais irritante de «Falta corrigir um campo», e a mesma que o
 * `regimeIva` já tinha mostrado no passo 2 do cliente.
 *
 * Vive aqui desde que passou a ser pedido em dois sítios — o passo 2 do
 * registo da sociedade e a edição dos dados dela no portal de administração.
 * Duas cópias divergiriam, e a que divergisse seria a do percurso menos
 * percorrido.
 */
export const website = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine(
    (v) => v === undefined || /^https?:\/\/.+\..+/.test(v),
    "Indique o endereço completo, começado por https://.",
  );

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
