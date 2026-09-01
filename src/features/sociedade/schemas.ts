import { z } from "zod";
import { email, morada, obrigatorio, telefone, website } from "@/lib/campos";
import { normalizarNumeroFiscal, validarNipc } from "@/lib/validacao-pt";

/**
 * Um schema por passo do onboarding da sociedade, partilhado entre cliente e
 * servidor — pela mesma razão de sempre: a validação no browser é conforto, a
 * do servidor é segurança, e o erro clássico é apertar o formulário e deixar a
 * Server Action aberta.
 */

/**
 * O NIPC da sociedade.
 *
 * `validarNipc` e não `validarNif` (D54): uma sociedade de advogados é uma
 * pessoa coletiva, e o número dela começa por 5, 6, 8 ou 9. Aceitar o NIF de
 * uma pessoa singular aqui gravaria, no campo que identifica a entidade, o
 * número de alguém — que é exatamente o erro que a distinção existe para
 * apanhar, e o mais difícil de descobrir depois porque o checksum bate certo.
 */
const nipc = z
  .string()
  .trim()
  .min(1, "O NIPC é obrigatório.")
  .superRefine((v, ctx) => {
    const r = validarNipc(v);
    if (!r.valido) ctx.addIssue({ code: "custom", message: r.mensagem });
  })
  .transform(normalizarNumeroFiscal);

/* ── passo 1 — identificação da sociedade ─────────────────────────────── */

export const passoSociedade1 = z.object({
  nome: obrigatorio("O nome da sociedade").max(200, "Máximo 200 caracteres."),
  nipc,
  naturezaJuridica: obrigatorio("A forma jurídica"),
  numeroOrdem: obrigatorio("O número de inscrição na Ordem dos Advogados"),
  /**
   * O prefixo das referências de processo: `JM` → `JM-2026-0142`.
   *
   * Maiúsculas e só letras, entre duas e seis. Não é preciosismo tipográfico —
   * a referência é o identificador por que o dossier é procurado, entra em
   * nomes de pasta no servidor da sociedade (`nomeSeguro`, D25) e vai em
   * assuntos de email. Um prefixo com espaço ou barra dava um caminho partido
   * ao meio, que é a mesma classe de defeito que o SFTP já mostrou.
   */
  prefixoReferencia: z
    .string()
    .trim()
    .min(2, "O prefixo tem de ter pelo menos 2 letras.")
    .max(6, "O prefixo tem no máximo 6 letras.")
    .regex(/^[A-Za-z]+$/, "Use apenas letras, sem espaços nem sinais.")
    .transform((v) => v.toUpperCase()),
});

/* ── passo 2 — morada e contactos ─────────────────────────────────────── */

export const passoSociedade2 = z.object({
  ...morada,
  emailGeral: email,
  telefone,
  /** Opcional, e vazio significa mesmo vazio — a definição está em `lib/campos.ts`, partilhada com a edição dos dados da sociedade. */
  website,
});

/* ── passo 3 — documentos ─────────────────────────────────────────────── */

/**
 * O passo 3 não tem campos.
 *
 * A certidão é anexada por uma Server Action própria (`carregarDocumentoSociedade`)
 * e o input do ficheiro não tem `name` — não entra no `FormData` do passo, tal
 * como no percurso do cliente (D56). O que o schema valida é a lista de tipos
 * já anexados, que o servidor lê da base de dados e injeta: perguntá-la ao
 * formulário seria aceitar como prova de anexo aquilo que o browser diga.
 */
export const passoSociedade3 = z
  .object({ documentos: z.array(z.string()).optional().default([]) })
  .superRefine((v, ctx) => {
    if (!v.documentos.includes("certidao_sociedade")) {
      ctx.addIssue({
        code: "custom",
        path: ["documentos"],
        message:
          "Anexe a certidão permanente da sociedade para continuar. É por ela que confirmamos o NIPC e a forma jurídica.",
      });
    }
  });

/* ── passo 4 — Termos e Condições ─────────────────────────────────────── */

/**
 * A versão do articulado, e é o campo que mais importa desta página inteira.
 *
 * Os consentimentos apontam para uma **versão** (D3), e é por chave *e* versão
 * que `textoEmVigor` procura (D38). Substituir o documento sem subir a versão
 * apaga a diferença entre o que o cliente aceitou e o que passou a estar
 * escrito — que é precisamente a prova que esta parte do sistema existe para
 * guardar. Daí ser obrigatório, e daí o servidor recusar uma versão igual à que
 * já está em vigor.
 */
export const passoSociedade4 = z
  .object({
    termosVersao: obrigatorio("A versão do articulado")
      .max(40, "Máximo 40 caracteres.")
      .regex(
        /^[A-Za-z0-9._-]+$/,
        "Use letras, números, pontos, traços ou underscores — por exemplo 2026.08.1.",
      ),
    documentos: z.array(z.string()).optional().default([]),
  })
  .superRefine((v, ctx) => {
    if (!v.documentos.includes("termos_sociedade")) {
      ctx.addIssue({
        code: "custom",
        path: ["documentos"],
        message:
          "Anexe o PDF dos Termos e Condições da sociedade. É este documento que os vossos clientes vão ler e aceitar.",
      });
    }
  });

/* ── passo 5 — administrador da conta ─────────────────────────────────── */

export const passoSociedade5 = z.object({
  adminNome: obrigatorio("O nome do administrador").max(200, "Máximo 200 caracteres."),
  adminEmail: email,
  adminTelefone: telefone,
});

/* ── passo 6 — fecho ──────────────────────────────────────────────────── */

export const passoSociedade6 = z.object({
  declaracaoNome: obrigatorio("O seu nome"),
  declaracaoCargo: obrigatorio("O seu cargo na sociedade"),
  /**
   * Quem submete declara que tem poderes para vincular a sociedade.
   *
   * `z.literal(true)` e não `z.boolean()`: uma caixa por marcar chega como
   * `false`, e um `boolean` aceitava-a — a declaração ficava gravada a dizer
   * "não" e o registo seguia na mesma, que é o pior dos dois mundos.
   */
  declaracaoVinculo: z.literal(true, {
    message:
      "Confirme que tem poderes para vincular a sociedade. Sem essa declaração não podemos aceitar o registo.",
  }),
});

export const SCHEMAS_SOCIEDADE = {
  1: passoSociedade1,
  2: passoSociedade2,
  3: passoSociedade3,
  4: passoSociedade4,
  5: passoSociedade5,
  6: passoSociedade6,
} as const;
