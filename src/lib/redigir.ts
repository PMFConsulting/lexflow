/**
 * Minimização de dados pessoais antes de escrever no registo de auditoria e
 * nos logs de consola.
 *
 * O registo de auditoria é imutável, encadeado por hash e guardado sete anos
 * (D5, D6). É essa a razão pela qual ele não pode ser o sítio onde o NIF, a
 * morada e a data de nascimento do cliente ficam gravados em claro: o que lá
 * entra não sai — nem por pedido de apagamento do titular (RGPD, artigo 17.º),
 * porque a lei obriga a manter o registo, e a única forma de conciliar as duas
 * obrigações é o registo nunca ter recebido o dado.
 *
 * O que o registo tem de provar é **que ação houve, quem a fez e sobre que
 * entidade** — não o conteúdo do campo. O `entidadeId` e o `processoId`
 * continuam lá e é por eles que se chega aos dados, nas tabelas onde eles
 * legitimamente vivem e de onde podem ser apagados.
 *
 * Nada aqui toca na base de dados nem na rede: é uma função pura, e é isso que
 * permite testá-la sem infraestrutura.
 */

/**
 * As chaves cujo valor não entra no registo. Comparadas em forma normalizada
 * (minúsculas, sem `_`), para que `doc_numero` e `docNumero` sejam a mesma
 * coisa — os dois convivem no código, um vem do schema Drizzle e o outro dos
 * payloads dos formulários.
 *
 * A lista é de **chaves** e não de padrões no valor: um NIF é nove dígitos e
 * nove dígitos também são um número de telefone, um número de documento e o
 * início de um IBAN. Adivinhar pelo valor erra nos dois sentidos; pela chave,
 * quem acrescenta um campo novo ao payload vê aqui o que tem de decidir.
 */
const CHAVES_SENSIVEIS = new Set([
  // identificação fiscal
  "nif",
  "nifcliente",
  "nifrepresentante",
  "nipc",
  "contribuinte",
  // documento de identificação
  "docnumero",
  "numerodocumento",
  "docvalidade",
  // datas pessoais
  "datanascimento",
  "dataemissao",
  // contactos
  "telefone",
  "telemovel",
  "admintelefone",
  "contacto",
  // morada (os sete campos do bloco, D8)
  "morada",
  "codigopostal",
  "localidade",
  "freguesia",
  "concelho",
  "distrito",
  // profissionais
  "cedulaprofissional",
  "profissao",
  "entidadepatronal",
  // bancários
  "iban",
  // nomes — de pessoas e dos ficheiros/pastas que os carregam. Uma pasta de
  // arquivo chama-se «Maria Silva (249886344)» (D25): o nome do ficheiro é o
  // dado pessoal, não a embalagem dele.
  "nome",
  "nomecompleto",
  "nomecliente",
  "adminnome",
  "nomeficheiro",
  "nomepasta",
  "declaracaonome",
]);

/**
 * Chaves de email. Tratadas à parte das restantes: em vez de desaparecerem,
 * ficam mascaradas. Um endereço mascarado já não identifica ninguém e continua
 * a permitir correlacionar o evento com a linha de `email_log` e com a queixa
 * do cliente que diz não ter recebido nada — que é metade do valor prático
 * deste registo. Aparecem à mesma em `_redigidos`, porque foram minimizadas.
 */
const CHAVES_EMAIL = new Set([
  "email",
  "emailcliente",
  "adminemail",
  "para",
  "destinatario",
  "enviadopara",
  "emailremetente",
  "remetente",
]);

/**
 * Chaves cujo valor é um identificador técnico e passa intacto, sem sequer
 * levar com a limpeza de texto livre. Sem esta lista, um SHA-256 ou um UUID
 * corria o risco de ser mutilado por um padrão que nunca lá quis chegar — e um
 * hash alterado é um hash que deixa de servir para o que existe.
 */
const CHAVES_TECNICAS = new Set([
  "id",
  "hash",
  "hashdocumento",
  "token",
  "tokenhash",
  "mensagemid",
  "chave",
  "chavestorage",
  "referencia",
  "versao",
  "conviteid",
  "processoid",
  "organizacaoid",
  "utilizadorid",
  "gestorid",
  "atorid",
  "entidadeid",
]);

/** Profundidade máxima da travessia — trava payloads cíclicos ou absurdos. */
const PROFUNDIDADE_MAXIMA = 8;

function normalizar(chave: string): string {
  return chave.toLowerCase().replace(/[_\s-]/g, "");
}

/**
 * `maria.silva@exemplo.pt` → `m***@exemplo.pt`.
 *
 * O domínio fica: é ele que responde à pergunta operacional («o email foi para
 * o domínio certo?») e não identifica o titular. A primeira letra fica pela
 * mesma razão que os últimos dígitos de um cartão ficam num recibo — permite
 * reconhecer, não permite reconstruir.
 *
 * Um valor que não seja um endereço não é devolvido em claro por precaução:
 * quem chama isto está a dizer que aquele campo é um email, e se o conteúdo o
 * desmente é mais provável ser lixo com dados lá dentro do que ser inofensivo.
 */
export function mascararEmail(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  const limpo = valor.trim();
  if (limpo === "") return "";

  const arroba = limpo.lastIndexOf("@");
  if (arroba <= 0 || arroba === limpo.length - 1) return "***";

  const local = limpo.slice(0, arroba);
  const dominio = limpo.slice(arroba + 1);
  return `${local[0]}***@${dominio}`;
}

/**
 * Limpa dados pessoais reconhecíveis dentro de uma cadeia de texto livre —
 * mensagens de erro, motivos de rejeição, assuntos de email. São campos onde
 * ninguém pôs um NIF de propósito e onde ele aparece a toda a hora, colado de
 * outro sítio.
 *
 * Os padrões são deliberadamente conservadores: um falso positivo aqui apaga
 * informação de diagnóstico, um falso negativo grava um dado pessoal para sete
 * anos. Perante a dúvida, redige.
 */
export function redigirTextoLivre(texto: string): string {
  return (
    texto
      // Emails primeiro: o domínio de um endereço pode conter dígitos que os
      // padrões seguintes leriam como outra coisa.
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (e) => mascararEmail(e))
      // IBAN português: PT50 e mais 21 dígitos, com ou sem espaços.
      .replace(/\bPT50[\s]?(?:\d[\s]?){21}/gi, "[IBAN redigido]")
      // Código postal: 4 dígitos, traço, 3 dígitos.
      .replace(/\b\d{4}-\d{3}\b/g, "[CP redigido]")
      // Nove dígitos seguidos: NIF, NIPC ou telefone. Os três são exatamente
      // isto e nenhum identificador técnico da plataforma tem esta forma.
      .replace(/\b\d{9}\b/g, "[nº redigido]")
  );
}

/**
 * Percorre o payload e devolve-o sem os dados pessoais, com a lista do que
 * tirou em `_redigidos`.
 *
 * `_redigidos` não é decoração: sem ela, um payload minimizado é
 * indistinguível de um payload que nunca teve nada — e uma revisão jurídica
 * que pergunte «a morada foi recolhida neste passo?» fica sem resposta. O
 * caminho vai pontuado (`perfil.telefone`) para que a resposta seja precisa
 * quando o campo está aninhado.
 *
 * Quando não há nada a redigir, o objeto sai **igual ao que entrou** — sem
 * `_redigidos` vazio a mais. É o que garante que esta mudança não altera o
 * hash de nenhum evento que não carregava dados pessoais.
 */
export function minimizarPii(
  valor: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (valor === null || valor === undefined) return null;

  const redigidos: string[] = [];
  const limpo = percorrerObjeto(valor, "", redigidos, 0);

  if (redigidos.length === 0) return limpo;
  return { ...limpo, _redigidos: redigidos.sort() };
}

function percorrerObjeto(
  objeto: Record<string, unknown>,
  prefixo: string,
  redigidos: string[],
  profundidade: number,
): Record<string, unknown> {
  const saida: Record<string, unknown> = {};

  for (const [chave, v] of Object.entries(objeto)) {
    const caminho = prefixo ? `${prefixo}.${chave}` : chave;
    const n = normalizar(chave);

    if (CHAVES_EMAIL.has(n)) {
      // Mascarado em vez de removido — ver a nota em CHAVES_EMAIL. Um valor
      // que não seja uma cadeia não tem máscara possível: desaparece.
      redigidos.push(caminho);
      if (typeof v === "string") saida[chave] = mascararEmail(v);
      continue;
    }

    if (CHAVES_SENSIVEIS.has(n)) {
      // `null` e `undefined` não são dado nenhum: redigir uma ausência
      // registaria uma recolha que não houve.
      if (v !== null && v !== undefined) redigidos.push(caminho);
      continue;
    }

    saida[chave] = percorrerValor(v, caminho, redigidos, profundidade, CHAVES_TECNICAS.has(n));
  }

  return saida;
}

function percorrerValor(
  v: unknown,
  caminho: string,
  redigidos: string[],
  profundidade: number,
  tecnica: boolean,
): unknown {
  if (profundidade >= PROFUNDIDADE_MAXIMA) return v;

  if (typeof v === "string") return tecnica ? v : redigirTextoLivre(v);

  if (Array.isArray(v)) {
    return v.map((item, i) =>
      percorrerValor(item, `${caminho}[${i}]`, redigidos, profundidade + 1, tecnica),
    );
  }

  if (v !== null && typeof v === "object" && !(v instanceof Date)) {
    return percorrerObjeto(
      v as Record<string, unknown>,
      caminho,
      redigidos,
      profundidade + 1,
    );
  }

  return v;
}
