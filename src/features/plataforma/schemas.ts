import { z } from "zod";
import { normalizarNumeroFiscal, validarNipc } from "@/lib/validacao-pt";
import { PAPEIS_DE_SOCIEDADE } from "./importacao";

/**
 * O que o portal da plataforma aceita.
 *
 * Revalidado no servidor, sempre — a validação do lado do cliente é conforto
 * (regra do projeto). As mensagens são as que aparecem debaixo da caixa que as
 * causou, por isso estão em português e dizem o que fazer, não o que falhou.
 */

/**
 * O prefixo da referência.
 *
 * Maiúsculas e dígitos, 2 a 6 caracteres — o que cabe em `PMF-2026-0142` sem
 * a referência deixar de se ler. Sem espaços nem acentos: entra em nomes de
 * pasta no arquivo (`lib/storage`) e em assuntos de email.
 *
 * Normaliza (maiúsculas, corta espaços) antes de validar: "pmf" é o prefixo
 * certo escrito em minúsculas, não um erro a recusar.
 */
const prefixo = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .pipe(
    z
      .string()
      .min(2, "O prefixo tem de ter pelo menos 2 caracteres.")
      .max(6, "O prefixo não pode ter mais de 6 caracteres.")
      .regex(/^[A-Z0-9]+$/, "O prefixo só pode ter letras e números, sem espaços nem acentos."),
  );

/**
 * O NIPC da sociedade.
 *
 * `validarNipc`, não `validarNif` (D54): é uma pessoa coletiva, e o NIF de
 * pessoa singular ficava gravado como sendo o número da entidade.
 */
const nipc = z
  .string()
  .transform(normalizarNumeroFiscal)
  .superRefine((valor, ctx) => {
    const r = validarNipc(valor);
    // A mensagem vem do validador: distingue "começa pelo dígito errado" de
    // "o dígito de controlo teria de ser 4" (D54), sítios diferentes a corrigir.
    if (!r.valido) ctx.addIssue({ code: "custom", message: r.mensagem });
  });

const nome = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(2, "Indique o nome.").max(160, "O nome é demasiado longo."));

const email = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.email("Indique um endereço de email válido.").max(200));

export const sociedadeSchema = z.object({
  nome,
  nif: nipc,
  prefixoReferencia: prefixo,
});

export type DadosSociedade = z.infer<typeof sociedadeSchema>;

/* --------------------------------------------------- email próprio da sociedade */

/**
 * O remetente da sociedade — ou o pedido para deixar de haver um.
 *
 * Vazio é válido e vira `null`: é como se volta ao remetente global da
 * instalação, a única saída de quem configurou um domínio errado. Um
 * `min(1)` prendia a sociedade a um endereço que já não serve.
 */
export const remetenteSchema = z.object({
  emailRemetente: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(
      z
        .union([z.literal(""), z.email("Indique um endereço de email válido.").max(200)])
        .transform((v) => (v === "" ? null : v)),
    ),
});

/**
 * O domínio de envio.
 *
 * Normaliza antes de validar: o que se cola aqui vem de um browser ou de um
 * cartão — `https://`, `www.`, barra final, ou o endereço completo por
 * engano. Tudo isso é o domínio certo escrito de outra forma.
 *
 * Fica de fora o que não é domínio (sem ponto, com espaços ou acentos). Um
 * domínio internacionalizado tem de vir em punycode — a Resend verifica o
 * punycode no DNS, e converter aqui às escuras mostrava outra coisa no ecrã.
 */
export const dominioSchema = z.object({
  dominioEmail: z
    .string()
    .transform((v) =>
      v
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^.*@/, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "")
        .replace(/\.$/, ""),
    )
    .pipe(
      z
        .string()
        .min(4, "Indique o domínio de envio (por exemplo, andradecosta.pt).")
        .max(253, "O domínio é demasiado longo.")
        .regex(
          /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
          "Indique só o domínio, sem espaços nem acentos — por exemplo, andradecosta.pt.",
        ),
    ),
});

/**
 * A conta criada à mão, uma de cada vez.
 *
 * `super_admin` não está nos papéis aceites: um `society_admin` que
 * conseguisse escolher esse valor ganhava acesso a todas as sociedades do
 * sistema. Criar um `super_admin` é outro formulário, só do `super_admin`.
 *
 * Sem campo de palavra-passe — é sempre gerada pelo servidor, enviada por
 * email à pessoa a quem pertence, com troca obrigatória no primeiro login. Um
 * campo opcional aqui reabria o processo antigo de quem administra escolher a
 * palavra-passe.
 */
export const contaSchema = z.object({
  nome,
  email,
  papel: z.enum(PAPEIS_DE_SOCIEDADE, {
    error: "Escolha o papel desta conta.",
  }),
  organizacaoId: z.uuid("Escolha a sociedade a que esta conta pertence."),
  gestorId: z
    .union([z.literal(""), z.uuid("Gestor inválido."), z.null()])
    .optional()
    .transform((v) => (v === "" || v === undefined || v === null ? null : v)),
});

/**
 * A conta de plataforma. Sem sociedade e sem escolha de papel — só há um.
 *
 * Separada da de cima: as permissões diferem (esta só o `super_admin` pode
 * chamar), não é a mesma função com um campo a mais.
 */
export const contaDePlataformaSchema = z.object({
  nome,
  email,
});

/**
 * A sociedade nova, opcionalmente já com o primeiro administrador.
 *
 * Os campos da conta são opcionais em conjunto — os dois ou nenhum. Meio
 * preenchido cria uma sociedade com administrador por criar e ninguém a dar
 * por isso, daí o `superRefine` em vez de dois `optional()` independentes.
 */
export const sociedadeComAdminSchema = sociedadeSchema
  .extend({
    adminNome: z.string().trim().max(160).optional(),
    adminEmail: z.string().trim().optional(),
    confirmarMultiSociedade: z
      .union([z.boolean(), z.string().transform((v) => v === "true")])
      .optional(),
  })
  .superRefine((v, ctx) => {
    const temNome = Boolean(v.adminNome);
    const temEmail = Boolean(v.adminEmail);

    if (!temNome && !temEmail) return; // sociedade sem administrador, por agora

    if (!temNome) {
      ctx.addIssue({
        code: "custom",
        path: ["adminNome"],
        message: "Indique o nome do administrador.",
      });
    }
    if (!temEmail) {
      ctx.addIssue({
        code: "custom",
        path: ["adminEmail"],
        message: "Indique o email do administrador.",
      });
    } else if (!z.email().safeParse(v.adminEmail!.toLowerCase()).success) {
      ctx.addIssue({
        code: "custom",
        path: ["adminEmail"],
        message: "Indique um endereço de email válido.",
      });
    }
  });

/** Os erros de um `safeParse`, na forma que os formulários deste portal leem. */
export function erros(resultado: z.ZodSafeParseResult<unknown>) {
  const saida: Record<string, string> = {};
  if (resultado.success) return saida;

  for (const problema of resultado.error.issues) {
    const campo = problema.path.join(".") || "_";
    // O primeiro erro de cada campo. Mostrar dois debaixo da mesma caixa faz
    // com que se leia o segundo e se corrija o primeiro.
    if (!saida[campo]) saida[campo] = problema.message;
  }
  return saida;
}
