"use client";

import { CircleCheck, Mail, TriangleAlert } from "lucide-react";
import { Ref } from "@/components/ref-processo";
import type { ContaCriada } from "../contas";

/**
 * A confirmação das contas acabadas de criar. **Sem palavras-passe.**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O que aqui estava, e porque saiu
 *
 * Estava um cartão "Credenciais criadas" com o email e a palavra-passe em claro,
 * a mostrar uma vez e a copiar para a área de transferência. A justificação
 * escrita nele era honesta e continua a ser verdade — um convite por email a
 * sério custa uma tabela de convites, expiração, uso único e um ecrã de
 * definição de palavra-passe — mas o que ela não resolvia estava lá dito à
 * frente, e era o essencial: **a palavra-passe passava pelas mãos de quem cria
 * a conta, e a pessoa não era obrigada a trocá-la ao entrar.**
 *
 * As duas fecharam-se, e por isso este cartão deixou de existir. A
 * palavra-passe é gerada pelo servidor, vai por email **para a pessoa a quem
 * pertence**, e é temporária: enquanto não a trocar, ela não passa da página de
 * definição de palavra-passe (`utilizador.deve_redefinir_password`).
 *
 * O que fica no ecrã de quem administra é a única pergunta que lhe diz respeito
 * — **o email saiu?**. Uma conta criada cuja mensagem não saiu é uma pessoa que
 * não entra, e sem esta linha isso descobria-se por telefone, dias depois.
 */
export function ContasCriadas({
  contas,
  titulo = "Conta criada",
}: {
  contas: ContaCriada[];
  titulo?: string;
}) {
  if (contas.length === 0) return null;

  const falhadas = contas.filter((c) => c.emailEnviado === false);

  return (
    <div className="border-arquivo/40 bg-arquivo/5 flex flex-col gap-3 rounded-sm border p-4">
      <div className="flex items-start gap-2.5">
        <CircleCheck className="text-arquivo mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {titulo}
            {contas.length > 1 ? ` — ${contas.length} contas` : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            As credenciais seguiram por email para cada pessoa. A palavra-passe é temporária e
            gerada pela plataforma — quem administra não a define nem a vê, e quem a recebe tem de
            escolher outra no primeiro início de sessão.
          </p>
        </div>
      </div>

      <ul className="border-linha divide-linha divide-y rounded-xs border bg-papel-alto">
        {contas.map((c) => (
          <li key={c.utilizadorId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5">
            <span className="min-w-0 flex-1 truncate text-sm">{c.nome}</span>
            <Ref className="text-xs text-muted-foreground">{c.email}</Ref>
            {c.emailEnviado === false ? (
              <span className="text-2xs border-selo/40 bg-selo/10 text-selo inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5">
                <TriangleAlert className="size-3" strokeWidth={2} /> Email não saiu
              </span>
            ) : (
              <span className="text-2xs border-linha inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 text-muted-foreground">
                <Mail className="size-3" strokeWidth={2} /> Credenciais enviadas
              </span>
            )}
          </li>
        ))}
      </ul>

      {falhadas.length > 0 && (
        <div className="border-selo/40 bg-selo/10 rounded-sm border p-2.5" role="alert">
          <p className="text-selo text-sm">
            {falhadas.length === 1
              ? "Uma das mensagens não saiu — sem ela, a pessoa não tem como entrar."
              : `${falhadas.length} mensagens não saíram — sem elas, essas pessoas não têm como entrar.`}{" "}
            A conta está criada: corrija o envio e desative e reative a conta, ou crie-a de novo
            com o email certo.
          </p>
          {/* O motivo do fornecedor à frente: um 403 por domínio não verificado
              resolve-se no segundo em que se lê, e «não foi possível enviar»
              manda quem lê para os registos do servidor (D43). */}
          <ul className="mt-1.5 flex flex-col gap-1">
            {falhadas.map((c) => (
              <li key={c.utilizadorId} className="text-2xs text-muted-foreground">
                <Ref>{c.email}</Ref> — {c.erroEmail ?? "sem motivo indicado"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
