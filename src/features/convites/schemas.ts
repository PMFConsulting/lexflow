import { z } from "zod";
import {
  dataFutura,
  dataPassada,
  morada,
  obrigatorio,
  telefone,
} from "@/lib/campos";
import { normalizarNif, validarNif } from "@/lib/validacao-pt";

/**
 * Um schema por passo do registo de uma pessoa da equipa, partilhado entre
 * cliente e servidor.
 *
 * O papel de quem preenche vem do convite, não da carga — senão o formulário
 * dava para se autopromover a sócio a caminho do servidor.
 */

/** O NIF de uma pessoa singular — nove dígitos com o mod-11. */
const nifPessoal = z
  .string()
  .trim()
  .min(1, "O NIF é obrigatório.")
  .superRefine((v, ctx) => {
    const r = validarNif(v);
    if (!r.valido) ctx.addIssue({ code: "custom", message: r.mensagem });
  })
  .transform(normalizarNif);

/* ── passo 1 — dados pessoais ─────────────────────────────────────────── */

export const passoConvite1 = z.object({
  nomeCompleto: obrigatorio("O nome completo").max(200, "Máximo 200 caracteres."),
  dataNascimento: dataPassada(
    "A data de nascimento",
    "A data de nascimento não pode estar no futuro.",
  ),
  nif: nifPessoal,
  telefone,
  docTipo: z.enum(["cartao_cidadao", "passaporte", "titulo_residencia", "outro"], {
    message: "Escolha o tipo de documento.",
  }),
  docNumero: obrigatorio("O número do documento"),
  docValidade: dataFutura(
    "A data de validade",
    "O documento está fora de validade. Renove-o antes de continuar.",
  ),
  ...morada,
});

/* ── passo 2 — dados profissionais ────────────────────────────────────── */

/**
 * A cédula é obrigatória para quem exerce advocacia. `exerce` vem do servidor
 * (papel do convite), não da carga — sem a distinção, um assistente sem
 * cédula nunca conseguia fechar o passo (mesma classe de bug que a D28).
 */
export const passoConvite2 = z
  .object({
    exerce: z.boolean().default(false),
    cargo: obrigatorio("O cargo").max(120, "Máximo 120 caracteres."),
    cedulaProfissional: z.string().trim().optional(),
    conselhoRegional: z.string().trim().optional(),
    dataInscricaoOa: z.string().trim().optional(),
    areasPratica: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.exerce) return;

    if (!v.cedulaProfissional) {
      ctx.addIssue({
        code: "custom",
        path: ["cedulaProfissional"],
        message: "A cédula profissional é obrigatória para advogados e sócios.",
      });
    }
    if (!v.conselhoRegional) {
      ctx.addIssue({
        code: "custom",
        path: ["conselhoRegional"],
        message: "Indique o conselho regional em que está inscrito.",
      });
    }
    if (v.dataInscricaoOa) {
      if (Number.isNaN(Date.parse(v.dataInscricaoOa))) {
        ctx.addIssue({ code: "custom", path: ["dataInscricaoOa"], message: "Data inválida." });
      } else if (new Date(v.dataInscricaoOa) > new Date()) {
        ctx.addIssue({
          code: "custom",
          path: ["dataInscricaoOa"],
          message: "A data de inscrição não pode estar no futuro.",
        });
      }
    }
  });

/* ── passo 3 — documentos ─────────────────────────────────────────────── */

export const passoConvite3 = z
  .object({
    exerce: z.boolean().default(false),
    documentos: z.array(z.string()).optional().default([]),
  })
  .superRefine((v, ctx) => {
    // Um erro por documento em falta, e não um "faltam anexos": dois documentos
    // a anexar têm de se ler como duas coisas a fazer (D56).
    if (!v.documentos.includes("identificacao")) {
      ctx.addIssue({
        code: "custom",
        path: ["documentos"],
        message: "Anexe o seu documento de identificação para continuar.",
      });
    }
    if (v.exerce && !v.documentos.includes("cedula_profissional")) {
      ctx.addIssue({
        code: "custom",
        path: ["documentos"],
        message: "Anexe a sua cédula profissional para continuar.",
      });
    }
  });

/* ── passo 4 — RGPD e sigilo profissional ─────────────────────────────── */

/**
 * As três respostas não são do mesmo tipo (D61): `informacaoRgpd` é tomada de
 * conhecimento e não consentimento (a base legal é o contrato/obrigação
 * legal — pedir consentimento aqui seria inválido e sugeriria que dá para
 * retirar); `sigiloProfissional` é declaração obrigatória; `comunicacoesInternas`
 * é o único consentimento real, e por isso o único que pode ficar a `false`.
 */
export const passoConvite4 = z.object({
  informacaoRgpd: z.literal(true, {
    message:
      "Confirme que leu a informação sobre o tratamento dos seus dados. É um dever de informação da sociedade, não um consentimento — não há aqui nada a autorizar.",
  }),
  sigiloProfissional: z.literal(true, {
    message:
      "A declaração de sigilo profissional é obrigatória. Sem ela não podemos dar-lhe acesso a processos de clientes.",
  }),
  comunicacoesInternas: z.boolean().default(false),
});

/* ── passo 5 — Termos e Condições da sociedade ────────────────────────── */

export const passoConvite5 = z.object({
  aceitaTermos: z.literal(true, {
    message:
      "Tem de aceitar os Termos e Condições da sociedade para concluir o registo.",
  }),
});

/* ── passo 6 — palavra-passe ──────────────────────────────────────────── */

/**
 * Doze caracteres — o mínimo que o Better Auth aceita no login
 * (`minPasswordLength: 12`, em `lib/auth.ts`). Mesmo número nos dois sítios:
 * divergir deixaria uma conta criada em que a pessoa não consegue entrar.
 */
export const passoConvite6 = z
  .object({
    password: z
      .string()
      .min(12, "A palavra-passe tem de ter pelo menos 12 caracteres.")
      .max(200, "Máximo 200 caracteres."),
    confirmacao: z.string(),
  })
  .refine((v) => v.password === v.confirmacao, {
    path: ["confirmacao"],
    message: "As duas palavras-passe não coincidem.",
  });

export const SCHEMAS_CONVITE = {
  1: passoConvite1,
  2: passoConvite2,
  3: passoConvite3,
  4: passoConvite4,
  5: passoConvite5,
  6: passoConvite6,
} as const;
