import { z } from "zod";
import { MINIMO_PALAVRA_PASSE } from "@/lib/campos";

/**
 * A palavra-passe que a pessoa escolhe para si.
 *
 * O mínimo é o do Better Auth (`minPasswordLength: 12`) e vem de `lib/campos`,
 * não escrito outra vez: dois números com o mesmo propósito divergem, e o dia
 * em que divergissem era o dia em que este ecrã aceitava uma palavra-passe com
 * que ninguém consegue entrar.
 *
 * **Sem regras de composição** (uma maiúscula, um dígito, um símbolo). Doze
 * caracteres livres resistem mais do que oito com quatro regras, e o que as
 * regras produzem de facto é `Password1!` — que está em todas as listas. O que
 * aqui se recusa é a repetição da palavra-passe temporária, e isso não é
 * composição: é a única forma de a redefinição não ser um clique sem efeito.
 *
 * A confirmação existe porque a caixa não mostra o que se escreve, e uma
 * palavra-passe mal escrita duas vezes seguidas é uma conta trancada com uma
 * credencial que ninguém conhece.
 */
export const novaPalavraPasseSchema = z
  .object({
    palavraPasse: z
      .string()
      .min(
        MINIMO_PALAVRA_PASSE,
        `A palavra-passe tem de ter pelo menos ${MINIMO_PALAVRA_PASSE} caracteres.`,
      )
      .max(200, "A palavra-passe é demasiado longa."),
    confirmacao: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.palavraPasse !== v.confirmacao) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmacao"],
        message: "As duas palavras-passe não são iguais.",
      });
    }
  });
