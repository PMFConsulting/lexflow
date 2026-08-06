/**
 * Confere que o hash que o `criar_utilizador.mjs` grava é o mesmo que o login
 * verifica.
 *
 * Não toca na base de dados. Existe porque o modo de falhar aqui é silencioso:
 * um hash com o formato certo mas parâmetros de scrypt diferentes grava-se sem
 * erro nenhum e só aparece quando alguém não consegue entrar — e aí não há
 * forma de distinguir "palavra-passe errada" de "hash mal gerado".
 *
 *   node scripts/verificar_hash.mjs
 *   node scripts/verificar_hash.mjs 'a minha palavra-passe'
 */
import { hashPassword, verifyPassword } from "better-auth/crypto";

const password = process.argv[2] ?? "palavra-passe-de-teste-123";

const provas = [];
const provar = (nome, ok, detalhe = "") => {
  provas.push({ nome, ok, detalhe });
  console.log(`${ok ? "✓" : "✗"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};

const hash = await hashPassword(password);
console.log(`hash: ${hash}\n`);

const [sal, digesto, ...sobras] = hash.split(":");

provar("formato salt:hash", sobras.length === 0 && Boolean(sal) && Boolean(digesto));
provar("salt em hexadecimal", /^[0-9a-f]+$/.test(sal ?? ""), `${(sal ?? "").length} carateres`);
provar(
  "digesto em hexadecimal",
  /^[0-9a-f]+$/.test(digesto ?? ""),
  `${(digesto ?? "").length} carateres`,
);

provar(
  "a palavra-passe certa passa",
  await verifyPassword({ hash, password }),
);

provar(
  "uma palavra-passe errada não passa",
  (await verifyPassword({ hash, password: `${password}x` })) === false,
);

// Sal aleatório por hash: dois hashes da mesma palavra-passe têm de ser
// diferentes, e ambos têm de verificar.
const outro = await hashPassword(password);
provar("cada hash tem sal próprio", outro !== hash);
provar("o segundo hash também verifica", await verifyPassword({ hash: outro, password }));

const falhou = provas.filter((p) => !p.ok);
console.log(
  `\n${provas.length - falhou.length}/${provas.length} verificações passaram.`,
);
if (falhou.length) process.exit(1);
