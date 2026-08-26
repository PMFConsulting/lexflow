"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, TriangleAlert } from "lucide-react";
import { Ref } from "@/components/ref-processo";
import type { ContaCriada } from "../contas";

/**
 * As credenciais de uma conta acabada de criar — mostradas **uma única vez**.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Porque é uma palavra-passe mostrada, e não um convite por email
 *
 * O convite por email (link de ativação, a pessoa escolhe a sua palavra-passe)
 * é a forma melhor e era a primeira escolha. Não entrou, e a razão é concreta:
 * esta instalação corre com `disableSignUp: true` (D23), que fecha o endpoint
 * de registo do Better Auth — e um link de ativação precisa exatamente disso,
 * de um caminho autenticado por token que crie a credencial sem sessão. Fazê-lo
 * a sério significa uma tabela de convites, expiração, uso único, um endpoint
 * público fora do `middleware` e um ecrã de definição de palavra-passe. É um
 * sistema de recuperação de conta, e construir metade dele é pior do que não o
 * ter: o que fica é um caminho de criação de credenciais sem sessão, que é
 * exatamente a superfície que o `disableSignUp` existe para fechar.
 *
 * O que fica no lugar é honesto sobre o que é: a plataforma gera a palavra-passe
 * (aleatória do `crypto`, alfabeto sem sósias), mostra-a uma vez a quem criou a
 * conta, e diz-lhe para a entregar por um canal seguro. Não fica gravada em
 * lado nenhum — nem em `evento_auditoria` (que dura sete anos), nem em
 * `email_log` (D34), nem em log nenhum. O que a base de dados guarda é o hash
 * scrypt, na `account`.
 *
 * O que isto **não** resolve, dito à frente: a palavra-passe passa pelas mãos
 * de quem cria a conta, e a pessoa não é obrigada a trocá-la ao entrar. As duas
 * coisas fecham-se com o convite por email, e é aí que este ecrã deve morrer.
 */
export function Credenciais({
  contas,
  titulo = "Conta criada",
}: {
  contas: ContaCriada[];
  titulo?: string;
}) {
  const [copiado, setCopiado] = useState<string | null>(null);

  if (contas.length === 0) return null;

  const copiar = async (chave: string, texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(chave);
      setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 2000);
    } catch {
      // Sem área de transferência (contexto não seguro, permissão negada): o
      // valor está no ecrã e continua a poder ser selecionado à mão. Um erro
      // aqui não é do interesse de ninguém.
    }
  };

  const tudo = contas.map((c) => `${c.email}\t${c.palavraPasse}`).join("\n");

  return (
    <div className="border-latao/40 bg-latao/5 flex flex-col gap-3 rounded-sm border p-4">
      <div className="flex items-start gap-2.5">
        <KeyRound className="text-latao mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {titulo}
            {contas.length > 1 ? ` — ${contas.length} contas` : ""}
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="text-selo mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
            <span>
              Estas palavras-passe aparecem <strong>uma única vez</strong>. Não ficam gravadas e
              não há forma de as voltar a ver — se sair desta página sem as copiar, terá de
              criar a conta de novo. Entregue-as por um canal seguro, não por email.
            </span>
          </p>
        </div>
      </div>

      <ul className="border-linha divide-linha divide-y rounded-xs border bg-papel-alto">
        {contas.map((c) => (
          <li key={c.utilizadorId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5">
            <span className="min-w-0 flex-1 truncate text-sm">{c.nome}</span>
            <Ref className="text-xs text-muted-foreground">{c.email}</Ref>
            <Ref className="bg-muted rounded-xs px-2 py-0.5 text-sm select-all">
              {c.palavraPasse}
            </Ref>
            <button
              type="button"
              onClick={() => copiar(c.utilizadorId, `${c.email}\n${c.palavraPasse}`)}
              className="border-linha hover:border-tinta inline-flex items-center gap-1.5 rounded-xs border px-2 py-1 text-xs"
            >
              {copiado === c.utilizadorId ? (
                <>
                  <Check className="size-3.5" /> Copiado
                </>
              ) : (
                <>
                  <Copy className="size-3.5" /> Copiar
                </>
              )}
            </button>
          </li>
        ))}
      </ul>

      {contas.length > 1 && (
        <button
          type="button"
          onClick={() => copiar("tudo", tudo)}
          className="border-linha hover:border-tinta self-start rounded-xs border px-2.5 py-1 text-xs"
        >
          {copiado === "tudo" ? "Lista copiada" : "Copiar a lista toda"}
        </button>
      )}
    </div>
  );
}
