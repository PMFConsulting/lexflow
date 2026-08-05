import { z } from "zod";
import {
  validarCodigoPostal,
  validarIban,
  validarNif,
  validarTelefone,
} from "@/lib/validacao-pt";

/**
 * Um schema por passo, partilhado entre cliente e servidor.
 *
 * A validação no cliente é conforto; a do servidor é segurança. É o mesmo
 * ficheiro nos dois sítios precisamente para não divergirem — o erro clássico
 * é apertar o formulário e deixar a Server Action aberta.
 */

/* ── peças reutilizáveis ──────────────────────────────────────────────── */

const obrigatorio = (campo: string) =>
  z.string().trim().min(1, `${campo} é obrigatório.`);

const email = z
  .string()
  .trim()
  .min(1, "O email é obrigatório.")
  .email("Falta o @ ou o domínio — por exemplo nome@empresa.pt.");

const telefone = z.string().trim().superRefine((v, ctx) => {
  const r = validarTelefone(v);
  if (!r.valido) ctx.addIssue({ code: "custom", message: r.mensagem });
});

const nif = z.string().trim().superRefine((v, ctx) => {
  const r = validarNif(v);
  if (!r.valido) ctx.addIssue({ code: "custom", message: r.mensagem });
});

const pais = z
  .string()
  .trim()
  .length(2, "Escolha um país da lista.")
  .transform((v) => v.toUpperCase());

/** Morada: os sete campos do formulário real. */
const morada = {
  morada: obrigatorio("A morada"),
  pais,
  localidade: obrigatorio("A localidade"),
  codigoPostal: z.string().trim().superRefine((v, ctx) => {
    const r = validarCodigoPostal(v);
    if (!r.valido) ctx.addIssue({ code: "custom", message: r.mensagem });
  }),
  freguesia: obrigatorio("A freguesia"),
  concelho: obrigatorio("O concelho"),
  distrito: obrigatorio("O distrito"),
};

const documentoIdentificacao = {
  docTipo: z.enum(["cartao_cidadao", "passaporte", "titulo_residencia", "outro"], {
    message: "Escolha o tipo de documento.",
  }),
  docNumero: obrigatorio("O número do documento"),
  docValidade: z
    .string()
    .trim()
    .min(1, "A data de validade é obrigatória.")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Data inválida.")
    .refine(
      (v) => new Date(v) > new Date(),
      "O documento está fora de validade. Renove-o antes de continuar.",
    ),
};

/* ── passo 1 — identificação ──────────────────────────────────────────── */

export const passo1 = z
  .object({
    tipoCliente: z.enum(["particular", "empresa"], {
      message: "Indique se é pessoa singular ou empresa.",
    }),
    nome: obrigatorio("O nome").max(200, "Máximo 200 caracteres."),
    // só particular
    profissao: z.string().trim().optional(),
    entidadePatronal: z.string().trim().optional(),
    dataNascimento: z.string().trim().optional(),
    nacionalidades: z
      .array(pais)
      .min(1, "Indique pelo menos uma nacionalidade."),
    // só empresa
    naturezaJuridica: z.string().trim().optional(),
    dataConstituicao: z.string().trim().optional(),
    // ambos
    telefone,
    email,
    ...morada,
    representadoPorProcurador: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.tipoCliente === "particular") {
      if (!v.profissao)
        ctx.addIssue({ code: "custom", path: ["profissao"], message: "A profissão é obrigatória." });
      if (!v.entidadePatronal)
        ctx.addIssue({
          code: "custom",
          path: ["entidadePatronal"],
          message: 'Obrigatório. Se não se aplicar, escreva "N/A".',
        });
      if (!v.dataNascimento)
        ctx.addIssue({
          code: "custom",
          path: ["dataNascimento"],
          message: "A data de nascimento é obrigatória.",
        });
      else if (new Date(v.dataNascimento) > new Date())
        ctx.addIssue({
          code: "custom",
          path: ["dataNascimento"],
          message: "A data de nascimento não pode estar no futuro.",
        });
    }
  });

/* ── passo 2 — fiscal ─────────────────────────────────────────────────── */

export const passo2 = z
  .object({
    nifPortugues: z.boolean().default(true),
    resideEmPortugal: z.boolean().default(true),
    nif: z.string().trim().min(1, "O número de contribuinte é obrigatório."),
    ...documentoIdentificacao,
    // só empresa, por validar contra imagem (A18)
    cae: z.string().trim().optional(),
    codigoCertidaoPermanente: z.string().trim().optional(),
    regimeIva: z.enum(["normal", "isento_art53", "isento_art9", "misto"]).optional(),
  })
  .superRefine((v, ctx) => {
    // O mod-11 só se aplica a NIF português. Um TIN estrangeiro tem outra forma
    // e rejeitá-lo com a regra portuguesa seria bloquear clientes legítimos.
    if (v.nifPortugues) {
      const r = validarNif(v.nif);
      if (!r.valido) ctx.addIssue({ code: "custom", path: ["nif"], message: r.mensagem });
    }
  });

/* ── passo 3 — representante (condicional) ────────────────────────────── */

export const passo3 = z
  .object({
    eRepresentante: z.boolean().default(false),
    relacao: z.string().trim().optional(),
    nome: z.string().trim().optional(),
    dataNascimento: z.string().trim().optional(),
    profissao: z.string().trim().optional(),
    telefone: z.string().trim().optional(),
    email: z.string().trim().optional(),
    morada: z.string().trim().optional(),
    pais: z.string().trim().optional(),
    localidade: z.string().trim().optional(),
    codigoPostal: z.string().trim().optional(),
    freguesia: z.string().trim().optional(),
    concelho: z.string().trim().optional(),
    distrito: z.string().trim().optional(),
    nif: z.string().trim().optional(),
    docTipo: z.enum(["cartao_cidadao", "passaporte", "titulo_residencia", "outro"]).optional(),
    docNumero: z.string().trim().optional(),
    docValidade: z.string().trim().optional(),
    codigoRcbe: z.string().trim().optional(),
    ambitoPoderes: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    // Sem interruptor ligado não há nada a validar: o passo fica vazio de
    // propósito e o cliente segue em frente.
    if (!v.eRepresentante) return;

    const exigir = (campo: keyof typeof v, msg: string) => {
      if (!v[campo]) ctx.addIssue({ code: "custom", path: [campo], message: msg });
    };

    exigir("nome", "O nome do representante é obrigatório.");
    exigir("telefone", "O contacto telefónico é obrigatório.");
    exigir("email", "O email é obrigatório.");
    exigir("nif", "O número de contribuinte é obrigatório.");
    exigir("docNumero", "O número do documento é obrigatório.");
    exigir("docValidade", "A data de validade é obrigatória.");

    if (v.email) {
      const r = z.string().email().safeParse(v.email);
      if (!r.success)
        ctx.addIssue({ code: "custom", path: ["email"], message: "Email inválido." });
    }
    if (v.telefone) {
      const r = validarTelefone(v.telefone);
      if (!r.valido) ctx.addIssue({ code: "custom", path: ["telefone"], message: r.mensagem });
    }
    if (v.nif) {
      const r = validarNif(v.nif);
      if (!r.valido) ctx.addIssue({ code: "custom", path: ["nif"], message: r.mensagem });
    }
    if (v.codigoPostal) {
      const r = validarCodigoPostal(v.codigoPostal);
      if (!r.valido)
        ctx.addIssue({ code: "custom", path: ["codigoPostal"], message: r.mensagem });
    }
  });

/* ── passo 4 — PPE e relação de negócio ───────────────────────────────── */

export const passo4 = z
  .object({
    ePpe: z.boolean({ message: "Responda sim ou não." }),
    ppeCargo: z.string().trim().optional(),
    ppePais: z.string().trim().optional(),
    ppeEntidade: z.string().trim().optional(),
    ppeInicio: z.string().trim().optional(),
    ppeFim: z.string().trim().optional(),
    eRelacionadoPpe: z.boolean({ message: "Responda sim ou não." }),
    relacaoPpe: z.string().trim().optional(),
    ppeRelacionadaNome: z.string().trim().optional(),
    ppeRelacionadaCargo: z.string().trim().optional(),
    ppeRelacionadaPais: z.string().trim().optional(),
    // A origem de fundos é obrigatória sempre. O formulário atual já está
    // assim, e é o que a Lei 83/2017 pede em diligência normal — não só
    // reforçada (divergência D5 em docs/CAMPOS.md).
    servicos: obrigatorio("Indique os serviços jurídicos pretendidos"),
    origemFundos: obrigatorio("A origem dos fundos"),
  })
  .superRefine((v, ctx) => {
    if (v.ePpe) {
      if (!v.ppeCargo)
        ctx.addIssue({ code: "custom", path: ["ppeCargo"], message: "Indique o cargo." });
      if (!v.ppePais)
        ctx.addIssue({ code: "custom", path: ["ppePais"], message: "Indique o país." });
      if (!v.ppeEntidade)
        ctx.addIssue({ code: "custom", path: ["ppeEntidade"], message: "Indique a entidade." });
      if (!v.ppeInicio)
        ctx.addIssue({
          code: "custom",
          path: ["ppeInicio"],
          message: "Indique o início do exercício.",
        });
      if (v.ppeInicio && v.ppeFim && new Date(v.ppeFim) < new Date(v.ppeInicio))
        ctx.addIssue({
          code: "custom",
          path: ["ppeFim"],
          message: "O fim não pode ser anterior ao início.",
        });
    }
    if (v.eRelacionadoPpe) {
      if (!v.relacaoPpe)
        ctx.addIssue({
          code: "custom",
          path: ["relacaoPpe"],
          message: "Indique a relação com a pessoa.",
        });
      if (!v.ppeRelacionadaNome)
        ctx.addIssue({
          code: "custom",
          path: ["ppeRelacionadaNome"],
          message: "Identifique a pessoa politicamente exposta.",
        });
    }
  });

/* ── passo 5 — faturação ──────────────────────────────────────────────── */

export const passo5 = z
  .object({
    igualAoCliente: z.boolean().default(false),
    nome: obrigatorio("A denominação de faturação"),
    nif,
    ...morada,
    email,
    acIgualAoCliente: z.boolean().default(false),
    acNome: z.string().trim().optional(),
    acEmail: z.string().trim().optional(),
    acTelefone: z.string().trim().optional(),
    // fora do âmbito da POC (D4), mas o schema aceita-os desde já
    iban: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.iban) {
      const r = validarIban(v.iban);
      if (!r.valido) ctx.addIssue({ code: "custom", path: ["iban"], message: r.mensagem });
    }
    if (v.acEmail) {
      const r = z.string().email().safeParse(v.acEmail);
      if (!r.success)
        ctx.addIssue({ code: "custom", path: ["acEmail"], message: "Email inválido." });
    }
  });

/* ── passo 6 — declaração final ───────────────────────────────────────── */

export const passo6 = z.object({
  declaracaoVeracidade: z.literal(true, {
    message: "Tem de declarar que as informações são verdadeiras para submeter.",
  }),
  tcAceitacao: z.literal(true, {
    message: "Tem de aceitar os Termos e Condições e a proposta para submeter.",
  }),
  assinatura: z
    .string()
    .trim()
    .min(1, "Assine no quadro antes de submeter.")
    .refine(
      (v) => v.startsWith("data:image/png;base64,"),
      "A assinatura não foi lida corretamente. Limpe o quadro e tente de novo.",
    )
    // ~1 MB de PNG é muito mais do que uma rubrica precisa; acima disso é
    // sinal de que algo está errado, e não vale a pena aceitar.
    .refine((v) => v.length < 1_400_000, "A assinatura ficou demasiado pesada."),
});

/* ── mapa por passo ───────────────────────────────────────────────────── */

export const SCHEMAS = {
  1: passo1,
  2: passo2,
  3: passo3,
  4: passo4,
  5: passo5,
  6: passo6,
} as const;

export type DadosPasso1 = z.infer<typeof passo1>;
export type DadosPasso2 = z.infer<typeof passo2>;
export type DadosPasso3 = z.infer<typeof passo3>;
export type DadosPasso4 = z.infer<typeof passo4>;
export type DadosPasso5 = z.infer<typeof passo5>;
export type DadosPasso6 = z.infer<typeof passo6>;
