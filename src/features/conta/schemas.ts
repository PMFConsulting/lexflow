import { z } from "zod";
import { MINIMO_PALAVRA_PASSE } from "@/lib/campos";

/**
 * A palavra-passe que a pessoa escolhe para si.
 *
 * Mínimo vindo de `lib/campos` (Better Auth `minPasswordLength: 12`), não
 * repetido aqui — dois números com o mesmo propósito podem divergir.
 *
 * Sem regras de composição: doze caracteres livres resistem mais do que oito
 * com regras, que na prática produzem `Password1!`. Só se recusa repetir a
 * palavra-passe temporária.
 *
 * Confirmação porque a caixa não mostra o que se escreve.
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
