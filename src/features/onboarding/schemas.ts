import { z } from "zod";
import {
  normalizarNif,
  normalizarNumeroFiscal,
  normalizarTelefone,
  validarCodigoPostal,
  validarIban,
  validarNif,
  validarNipc,
  validarTelefone,
} from "@/lib/validacao-pt";
import { email, morada, obrigatorio, pais, telefone } from "@/lib/campos";
import { assinaturaTemTracoReal } from "./assinatura";

/**
 * Um schema por passo, partilhado entre cliente e servidor — validação no
 * cliente é conforto, no servidor é segurança, e o mesmo ficheiro evita que
 * divirjam.
 */

/* ── peças reutilizáveis ──────────────────────────────────────────────── */

/*
 * `obrigatorio`, `email`, `telefone`, `pais` e `morada` mudaram-se para
 * `@/lib/campos` — a sociedade e cada pessoa da equipa também têm morada e
 * contactos. Ficam aqui só as peças cuja mensagem é específica deste percurso.
 */

/**
 * NIF de faturação — português *ou* estrangeiro.
 *
 * O mod-11 aqui era um beco sem saída: um cliente com número fiscal
 * estrangeiro (passo 2, `nifPortugues = false`) chegava ao passo 5 e não
 * havia número nenhum que passasse a validação portuguesa, nem sequer o
 * dele. Agora nove dígitos leva o checksum inteiro; qualquer outra forma só
 * precisa de existir.
 */
export const nifFaturacao = z
  .string()
  .trim()
  .min(1, "O NIF / NIPC de faturação é obrigatório.")
  .superRefine((v, ctx) => {
    if (!/^\d{9}$/.test(normalizarNif(v))) return;
    const r = validarNif(v);
    if (!r.valido) ctx.addIssue({ code: "custom", message: r.mensagem });
  })
  .transform(normalizarNumeroFiscal);

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
  ccDeclarado: z.boolean().default(false),
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

    // Simétrico do que já se pede a uma pessoa singular. Natureza jurídica
    // não é campo acessório: decide quem pode obrigar a entidade, que é o
    // que o passo 3 pergunta a seguir.
    if (v.tipoCliente === "empresa") {
      if (!v.naturezaJuridica)
        ctx.addIssue({
          code: "custom",
          path: ["naturezaJuridica"],
          message: "A natureza jurídica é obrigatória — por exemplo Lda., S.A. ou Unipessoal Lda.",
        });
      if (v.dataConstituicao && new Date(v.dataConstituicao) > new Date())
        ctx.addIssue({
          code: "custom",
          path: ["dataConstituicao"],
          message: "A data de constituição não pode estar no futuro.",
        });
    }
  });

/* ── passo 2 — fiscal ─────────────────────────────────────────────────── */

/**
 * Os anexos sem os quais o passo 2 não fecha, por percurso (D56).
 *
 * Eram todos opcionais — o cliente submetia e a sociedade ficava sem cópia
 * do documento de identificação, que a Lei 83/2017 obriga a conservar.
 * Certidão permanente só para pessoa coletiva, mesma razão do D28.
 */
export const ANEXOS_OBRIGATORIOS = {
  particular: ["identificacao", "comprovativo_nif"],
  empresa: ["identificacao", "comprovativo_nif", "certidao_permanente"],
} as const;

/** O que se diz ao cliente por cada anexo em falta — nomeia o documento. */
const FALTA_ANEXO: Record<string, string> = {
  identificacao: "Anexe o documento de identificação para continuar.",
  comprovativo_nif:
    "Anexe o comprovativo de NIF, obtido no portal da Autoridade Tributária, para continuar.",
  certidao_permanente: "Anexe a certidão permanente da entidade para continuar.",
};

export const passo2 = z
  .object({
    /**
     * O percurso deste processo. **Não vem do formulário** — injetado pelo
     * `guardarPasso` a partir da linha do processo, daí ser opcional aqui.
     * Um `tipoCliente` trazido de fora é substituído antes de chegar aqui,
     * não acreditado.
     */
    tipoCliente: z.enum(["particular", "empresa"]).optional(),
    /**
     * Tipos dos documentos já anexados, injetados pelo servidor a partir da
     * tabela `documento`. `Anexos` sobe pela sua própria Server Action e o
     * input não tem `name`, por isso a carga do passo nunca traz ficheiros.
     */
    documentos: z.array(z.string()).optional().default([]),
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
    // Mod-11 só se aplica a NIF português — um TIN estrangeiro tem outra
    // forma. Pessoa coletiva usa regra mais apertada (D54): além do
    // checksum, o primeiro dígito tem de ser 5, 6, 8 ou 9.
    if (v.nifPortugues) {
      const r = v.tipoCliente === "empresa" ? validarNipc(v.nif) : validarNif(v.nif);
      if (!r.valido) ctx.addIssue({ code: "custom", path: ["nif"], message: r.mensagem });
    }

    if (v.docTipo === "cartao_cidadao" && !v.ccDeclarado) {
      ctx.addIssue({
        code: "custom",
        path: ["ccDeclarado"],
        message: "Tem de declarar que tomou conhecimento da finalidade da recolha do Cartão de Cidadão.",
      });
    }

    // Um erro por documento em falta, não um "faltam anexos" genérico — três
    // documentos por anexar devem ler-se como três coisas a fazer.
    const anexados = new Set(v.documentos);
    for (const tipo of ANEXOS_OBRIGATORIOS[v.tipoCliente ?? "particular"]) {
      if (!anexados.has(tipo)) {
        ctx.addIssue({
          code: "custom",
          path: ["documentos"],
          message: FALTA_ANEXO[tipo] ?? `Falta anexar o documento «${tipo}».`,
        });
      }
    }
  })
  // Normalização ao nível do objeto, no fim — ao nível do campo o
  // `superRefine` acima leria um `nif` que o `transform` pode não ter
  // produzido, e `validarNif(undefined)` rebenta em vez de dar erro de
  // validação. Grava `500000000`, não `500 000 000` — é o que faz a
  // deduplicação por NIF do `/clientes` encontrar o mesmo contribuinte.
  .transform((v) => ({ ...v, nif: normalizarNumeroFiscal(v.nif) }));

/* ── passo 3 — representante legal ────────────────────────────────────── */

/**
 * Só para pessoas coletivas (D28), com o interruptor invertido (D29): "É o
 * representante legal desta entidade?" — **Sim** não repete nada (já se
 * identificou no passo 1); **Não** exige o mesmo rigor de identificação do
 * passo 1 para quem representa a entidade. Sem resposta de partida — é uma
 * declaração, e pré-respondê-la é dá-la por feita.
 */
export const passo3 = z
  .object({
    eRepresentante: z.boolean({ message: "Responda sim ou não." }),
    relacao: z.string().trim().optional(),
    nome: z.string().trim().optional(),
    dataNascimento: z.string().trim().optional(),
    nacionalidades: z.array(z.string().trim().min(1)).optional().default([]),
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
  })
  .superRefine((v, ctx) => {
    // É o "Não" que abre os campos — quem responde "Sim" já se identificou
    // no passo 1.
    if (v.eRepresentante) return;

    const falta = (campo: string, mensagem: string) =>
      ctx.addIssue({ code: "custom", path: [campo], message: mensagem });

    if (!v.relacao) falta("relacao", "Indique o cargo do representante legal.");
    if (!v.nome) falta("nome", "O nome do representante é obrigatório.");
    if (!v.profissao) falta("profissao", "A profissão é obrigatória.");

    if (!v.dataNascimento) falta("dataNascimento", "A data de nascimento é obrigatória.");
    else if (new Date(v.dataNascimento) > new Date())
      falta("dataNascimento", "A data de nascimento não pode estar no futuro.");

    if (!v.nacionalidades.length)
      falta("nacionalidades", "Indique pelo menos uma nacionalidade.");

    if (!v.telefone) falta("telefone", "O contacto telefónico é obrigatório.");
    else {
      const r = validarTelefone(v.telefone);
      if (!r.valido) falta("telefone", r.mensagem);
    }

    if (!v.email) falta("email", "O email é obrigatório.");
    else if (!z.string().email().safeParse(v.email).success)
      falta("email", "Falta o @ ou o domínio — por exemplo nome@empresa.pt.");

    if (!v.morada) falta("morada", "A morada é obrigatória.");
    if (!v.pais || v.pais.length !== 2) falta("pais", "Escolha um país da lista.");
    if (!v.localidade) falta("localidade", "A localidade é obrigatória.");
    if (!v.freguesia) falta("freguesia", "A freguesia é obrigatória.");
    if (!v.concelho) falta("concelho", "O concelho é obrigatório.");
    if (!v.distrito) falta("distrito", "O distrito é obrigatório.");

    if (!v.codigoPostal) falta("codigoPostal", "O código postal é obrigatório.");
    else {
      const r = validarCodigoPostal(v.codigoPostal);
      if (!r.valido) falta("codigoPostal", r.mensagem);
    }
  })
  // Mesma razão do passo 2: normaliza no fim, sem tocar no campo se vazio
  // (com "Sim" no interruptor não há representante a normalizar).
  .transform((v) => ({
    ...v,
    telefone: v.telefone ? normalizarTelefone(v.telefone) : v.telefone,
  }));

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
    // Origem de fundos obrigatória sempre — é o que a Lei 83/2017 pede em
    // diligência normal, não só reforçada (D5 em docs/CAMPOS.md).
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
    nif: nifFaturacao,
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

/* ── passo 6 — preferências de contacto ───────────────────────────────── */

export const passo6 = z
  .object({
    origemContacto: z.enum(["evento_conferencia", "recomendacao", "pesquisa_online", "outro"], {
      message: "Indique como chegou até nós.",
    }),
    /** O resto da resposta: "quem?" numa recomendação, "como?" num "outro". */
    origemDetalhe: z.string().trim().optional(),
    newsletter: z.boolean().default(false),
    emailsNewsletter: z.array(email).optional().default([]),
    areasInteresse: z.array(z.string().trim().min(1)).optional().default([]),
    convitesIniciativas: z.boolean().default(false),
    convitesNome: z.string().trim().optional(),
    convitesEmail: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.origemContacto === "recomendacao" && !v.origemDetalhe)
      ctx.addIssue({
        code: "custom",
        path: ["origemDetalhe"],
        message: "Indique quem o recomendou.",
      });
    // "Outro" sem explicação não conta nada.
    if (v.origemContacto === "outro" && !v.origemDetalhe)
      ctx.addIssue({
        code: "custom",
        path: ["origemDetalhe"],
        message: "Diga-nos como chegou até nós.",
      });
    if (v.newsletter && v.emailsNewsletter.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["emailsNewsletter"],
        message: "Indique pelo menos um email para receber a newsletter.",
      });
    if (v.convitesIniciativas) {
      if (!v.convitesNome)
        ctx.addIssue({ code: "custom", path: ["convitesNome"], message: "Indique o nome." });
      if (!v.convitesEmail) {
        ctx.addIssue({ code: "custom", path: ["convitesEmail"], message: "Indique o email." });
      } else {
        const r = z.string().email().safeParse(v.convitesEmail);
        if (!r.success)
          ctx.addIssue({ code: "custom", path: ["convitesEmail"], message: "Email inválido." });
      }
    }
  });

/* ── passo 7 — declaração final ───────────────────────────────────────── */

export const passo7 = z.object({
  declaracaoVeracidade: z.literal(true, {
    message: "Tem de declarar que as informações são verdadeiras para submeter.",
  }),
  tcAceitacao: z.literal(true, {
    message: "Tem de aceitar os Termos e Condições para submeter.",
  }),
  propostaAceitacao: z.literal(true, {
    message: "Tem de aceitar a proposta de honorários para submeter.",
  }),
  assinatura: z
    .string()
    .trim()
    .min(1, "Assine no quadro antes de submeter.")
    .refine(
      (v) => v.startsWith("data:image/png;base64,"),
      "A assinatura não foi lida corretamente. Limpe o quadro e tente de novo.",
    )
    // ~1 MB de PNG é muito mais do que uma rubrica precisa.
    .refine((v) => v.length < 1_400_000, "A assinatura ficou demasiado pesada.")
    // BUG-024 (pentest ronda 2): um PNG 1x1 forjado passava nas duas
    // verificações acima. Lê o cabeçalho PNG e recusa abaixo do mínimo real.
    .refine(
      assinaturaTemTracoReal,
      "A assinatura não parece ter sido desenhada no quadro. Limpe e assine de novo.",
    ),
});

/* ── mapa por passo ───────────────────────────────────────────────────── */

export const SCHEMAS = {
  1: passo1,
  2: passo2,
  3: passo3,
  4: passo4,
  5: passo5,
  6: passo6,
  7: passo7,
} as const;

export type DadosPasso1 = z.infer<typeof passo1>;
export type DadosPasso2 = z.infer<typeof passo2>;
export type DadosPasso3 = z.infer<typeof passo3>;
export type DadosPasso4 = z.infer<typeof passo4>;
export type DadosPasso5 = z.infer<typeof passo5>;
export type DadosPasso6 = z.infer<typeof passo6>;
export type DadosPasso7 = z.infer<typeof passo7>;
