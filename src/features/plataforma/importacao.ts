import { lerFolhaDeCalculo, type LinhaDaFolha } from "./folha";

/**
 * Importação de contas em lote — leitura e validação, sem tocar na base de
 * dados.
 *
 * Função pura, separada do Server Action: do ficheiro para uma lista de
 * linhas boas e más, o que permite mostrar a pré-visualização antes de criar
 * seja o que for — e a torna testável sem harness nenhum.
 */

/** Os papéis que uma sociedade pode ter. `super_admin` não é de sociedade. */
export const PAPEIS_DE_SOCIEDADE = ["society_admin", "gestor", "utilizador"] as const;

export type PapelDeSociedade = (typeof PAPEIS_DE_SOCIEDADE)[number];

export type LinhaValida = {
  /** A linha no ficheiro, contando o cabeçalho — é o número que o Excel mostra. */
  numero: number;
  nome: string;
  email: string;
  papel: PapelDeSociedade;
};

export type LinhaRecusada = {
  numero: number;
  /** O que lá estava, para quem lê saber de que linha se fala. */
  bruto: string;
  motivo: string;
};

export type Prevista = {
  validas: LinhaValida[];
  recusadas: LinhaRecusada[];
};

/**
 * Os nomes de coluna aceites, por campo.
 *
 * Mais do que um por campo porque o ficheiro vem de fora — "e-mail" ou
 * "email", "função" ou "papel". Comparação sem acentos e sem maiúsculas.
 */
const COLUNAS: Record<"nome" | "email" | "papel", string[]> = {
  nome: ["nome", "name", "nome completo"],
  email: ["email", "e-mail", "endereco", "endereco de email", "mail"],
  papel: ["papel", "perfil", "funcao", "cargo", "role", "nivel"],
};

/**
 * Os valores aceites na coluna do papel.
 *
 * Inclui nomes antigos (`advogado`, `assistente`, `socio`) a apontar para
 * `utilizador` — são os nomes que a sociedade usa a falar, e vão continuar a
 * aparecer nos ficheiros.
 */
const PAPEIS_ESCRITOS: Record<string, PapelDeSociedade> = {
  society_admin: "society_admin",
  admin: "society_admin",
  administrador: "society_admin",
  "administrador da sociedade": "society_admin",
  gestor: "gestor",
  gestora: "gestor",
  gerente: "gestor",
  utilizador: "utilizador",
  user: "utilizador",
  advogado: "utilizador",
  advogada: "utilizador",
  socio: "utilizador",
  socia: "utilizador",
  assistente: "utilizador",
  colaborador: "utilizador",
  colaboradora: "utilizador",
};

/** Sem acentos, sem maiúsculas, sem espaços a mais. Para comparar cabeçalhos. */
function achatar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Um email suficientemente válido.
 *
 * Sem a expressão completa do RFC 5322, que aceita coisas que nenhum servidor
 * entrega. O que interessa apanhar são os erros reais de uma folha: nome em
 * vez de endereço, espaço a meio, arroba a faltar.
 */
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

/**
 * Onde está cada coluna, a partir do cabeçalho.
 *
 * Devolve `null` quando o cabeçalho não é reconhecível — e nesse caso diz-se
 * o que faltou, não "ficheiro inválido".
 */
function localizarColunas(cabecalho: LinhaDaFolha) {
  const achatado = cabecalho.map(achatar);
  const posicao = (campo: keyof typeof COLUNAS) =>
    achatado.findIndex((c) => COLUNAS[campo].includes(c));

  return { nome: posicao("nome"), email: posicao("email"), papel: posicao("papel") };
}

export type ResultadoDaLeitura =
  | { ok: true; previsao: Prevista }
  | { ok: false; erro: string };

/**
 * Lê o ficheiro e classifica cada linha.
 *
 * `jaExistentes` são os emails que a sociedade já tem, passados de fora — não
 * consultados aqui, para a função continuar pura. Evita a importação tropeçar
 * no índice único a meio do lote.
 */
export function prepararImportacao(
  bytes: Buffer,
  jaExistentes: Iterable<string> = [],
  noutrasSociedades: Iterable<string> = [],
): ResultadoDaLeitura {
  let linhas: LinhaDaFolha[];
  try {
    linhas = lerFolhaDeCalculo(bytes);
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }

  if (linhas.length === 0) return { ok: false, erro: "O ficheiro não tem nenhuma linha." };

  const colunas = localizarColunas(linhas[0]);
  const emFalta = (["nome", "email", "papel"] as const).filter((c) => colunas[c] < 0);

  if (emFalta.length > 0) {
    return {
      ok: false,
      erro:
        `Faltam colunas no cabeçalho: ${emFalta.join(", ")}. ` +
        "A primeira linha do ficheiro tem de ter os títulos das colunas — nome, email e papel.",
    };
  }

  const validas: LinhaValida[] = [];
  const recusadas: LinhaRecusada[] = [];

  // Três conjuntos separados:
  // 1) repetido dentro do ficheiro
  // 2) já existe nesta sociedade
  // 3) já existe noutra sociedade (colisão global authUserId/email)
  const existentes = new Set([...jaExistentes].map((e) => e.trim().toLowerCase()));
  const noutras = new Set([...noutrasSociedades].map((e) => e.trim().toLowerCase()));
  const noFicheiro = new Set<string>();

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    const numero = i + 1;
    const bruto = linha.filter((c) => c.trim() !== "").join(" · ");

    const nome = (linha[colunas.nome] ?? "").trim();
    const email = (linha[colunas.email] ?? "").trim().toLowerCase();
    const papelEscrito = (linha[colunas.papel] ?? "").trim();

    const recusar = (motivo: string) => recusadas.push({ numero, bruto, motivo });

    if (!nome) {
      recusar("Falta o nome.");
      continue;
    }
    if (!email) {
      recusar("Falta o email.");
      continue;
    }
    if (!EMAIL.test(email)) {
      recusar(`"${email}" não é um endereço de email válido.`);
      continue;
    }

    const papel = PAPEIS_ESCRITOS[achatar(papelEscrito)];
    if (!papel) {
      recusar(
        papelEscrito
          ? `Papel desconhecido: "${papelEscrito}". Use "society_admin" ou "utilizador".`
          : 'Falta o papel. Use "society_admin" ou "utilizador".',
      );
      continue;
    }

    if (noFicheiro.has(email)) {
      recusar(`O email ${email} aparece mais do que uma vez neste ficheiro.`);
      continue;
    }
    if (existentes.has(email)) {
      recusar("Já existe uma conta com este email.");
      continue;
    }
    if (noutras.has(email) && papel !== "society_admin") {
      recusar("Já existe uma conta com este email.");
      continue;
    }

    noFicheiro.add(email);
    validas.push({ numero, nome, email, papel });
  }

  return { ok: true, previsao: { validas, recusadas } };
}

/** O modelo que a interface oferece para descarregar. */
export const MODELO_CSV = [
  "nome;email;papel",
  "Maria Silva;maria.silva@exemplo.pt;society_admin",
  "João Antunes;joao.antunes@exemplo.pt;utilizador",
].join("\r\n");
