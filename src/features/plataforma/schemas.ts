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
 * Maiúsculas e dígitos, 2 a 6 caracteres: é o que cabe em `PMF-2026-0142` sem
 * a referência deixar de se ler. Sem espaços nem acentos porque isto entra em
 * nomes de pasta no servidor de arquivo (`lib/storage`) e em assuntos de email
 * — dois sítios onde um `ç` viaja mal.
 *
 * A normalização (maiúsculas, cortar espaços) é feita **antes** da validação e
 * não depois: quem escreve "pmf" está a escrever o prefixo certo em minúsculas,
 * e recusá-lo por isso seria fazer o utilizador adivinhar uma regra de
 * formatação que a plataforma podia aplicar sozinha.
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
 * `validarNipc` e não `validarNif` (D54): uma sociedade é uma pessoa coletiva,
 * e o NIF de uma pessoa singular é uma resposta errada em substância aqui — o
 * número ficava gravado como sendo o da entidade.
 */
const nipc = z
  .string()
  .transform(normalizarNumeroFiscal)
  .superRefine((valor, ctx) => {
    const r = validarNipc(valor);
    // A mensagem vem do validador e não daqui: ele sabe distinguir "começa pelo
    // dígito errado" de "o dígito de controlo teria de ser 4", e essas duas
    // mandam corrigir sítios diferentes do número (D54).
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
 * O vazio é uma resposta válida e transforma-se em `null`, não num erro: apagar
 * o campo é como se volta ao remetente global da instalação, e é a única saída
 * de quem configurou um domínio errado. Um `min(1)` aqui deixava a sociedade
 * presa a um endereço que já não serve.
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
 * A normalização faz-se antes de validar, e não é cortesia: o que uma pessoa
 * cola aqui vem quase sempre de um browser ou de um cartão — `https://`,
 * `www.`, uma barra no fim, ou o endereço inteiro por distração
 * (`geral@andradecosta.pt`). Todos esses **são** o domínio certo escrito de
 * outra maneira, e recusá-los obrigava a adivinhar uma regra de formatação que
 * a plataforma sabe aplicar sozinha.
 *
 * O que fica de fora é o que não é um domínio: sem ponto (`localhost`), com
 * espaços, com acentos. Um domínio internacionalizado tem de vir já em
 * punycode — a conversão não se faz aqui às escuras, porque o que a Resend vai
 * verificar no DNS é o punycode e o que a pessoa veria no ecrã era outra coisa.
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
 * `super_admin` **não** está nos papéis aceites, e é a decisão que mais importa
 * neste ficheiro: quem administra a plataforma não se cria pelo caminho de
 * criar contas de uma sociedade. Um `society_admin` que conseguisse escolher
 * esse valor ganhava, com um clique, a lista de todas as sociedades do sistema
 * e a possibilidade de criar contas em qualquer uma. O caminho para criar um
 * `super_admin` é outro, é só do `super_admin`, e está noutro formulário.
 *
 * **Não há campo de palavra-passe, e a ausência é a regra.** Ela é sempre
 * gerada pelo servidor e vai por email para a pessoa a quem pertence, que é
 * obrigada a trocá-la no primeiro início de sessão. Um campo opcional aqui era
 * o processo antigo à espera de voltar: bastava um formulário mandar o valor
 * para quem administra voltar a escolher — e a escolher, na décima conta
 * seguida, sempre a mesma.
 */
export const contaSchema = z.object({
  nome,
  email,
  papel: z.enum(PAPEIS_DE_SOCIEDADE, {
    error: "Escolha o papel desta conta.",
  }),
  organizacaoId: z.uuid("Escolha a sociedade a que esta conta pertence."),
});

/**
 * A conta de plataforma. Sem sociedade e sem escolha de papel — só há um.
 *
 * Separada da de cima, e não a mesma com um campo a mais: são caminhos com
 * permissões diferentes (esta só o `super_admin` pode chamar) e misturá-las era
 * ter uma só função onde a diferença entre criar um colaborador e criar um
 * segundo dono da plataforma é o valor de um campo.
 */
export const contaDePlataformaSchema = z.object({
  nome,
  email,
});

/**
 * A sociedade nova, opcionalmente já com o primeiro administrador.
 *
 * Os campos da conta são opcionais em conjunto: ou vêm os dois (nome e email),
 * ou não vem nenhum. Meio preenchido é o estado que produz uma sociedade criada
 * com um administrador por criar e ninguém a dar por isso — daí o `superRefine`
 * em vez de dois `optional()` independentes.
 */
export const sociedadeComAdminSchema = sociedadeSchema
  .extend({
    adminNome: z.string().trim().max(160).optional(),
    adminEmail: z.string().trim().optional(),
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
