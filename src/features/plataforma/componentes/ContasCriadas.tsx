"use client";

import { CircleCheck, Clock, Mail, TriangleAlert } from "lucide-react";
import { Ref } from "@/components/ref-processo";
import type { ContaCriada } from "../contas";

/**
 * A confirmação das contas acabadas de criar. Sem palavras-passe.
 *
 * Existia aqui um cartão com a palavra-passe em claro, copiável — passava
 * pelas mãos de quem cria a conta e não obrigava a trocá-la ao entrar. Agora é
 * gerada pelo servidor, enviada por email à própria pessoa, e temporária
 * (`utilizador.deve_redefinir_password`). O ecrã só responde à pergunta de
 * quem administra — o email saiu? — distinguindo, desde a `0021`, "aguarda
 * aprovação da plataforma" de falha de envio.
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
  const temPendentes = contas.some((c) => c.aprovadoEm === null);
  const todasPendentes = contas.every((c) => c.aprovadoEm === null);

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
            {todasPendentes
              ? "A conta aguarda aprovação da administração da plataforma. As credenciais de acesso temporárias serão enviadas por email assim que for aprovada."
              : temPendentes
                ? "As contas aprovadas receberam as credenciais por email. As contas pendentes aguardam aprovação da administração da plataforma."
                : "As credenciais seguiram por email para cada pessoa. A palavra-passe é temporária e gerada pela plataforma — quem administra não a define nem a vê, e quem a recebe tem de escolher outra no primeiro início de sessão."}
          </p>
        </div>
      </div>

      <ul className="border-linha divide-linha divide-y rounded-sm border bg-papel-alto">
        {contas.map((c) => (
          <li key={c.utilizadorId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5">
            <span className="min-w-0 flex-1 truncate text-sm">{c.nome}</span>
            <Ref className="text-xs text-muted-foreground">{c.email}</Ref>
            {c.aprovadoEm === null ? (
              <span className="text-2xs border-latao/40 bg-latao/10 text-latao inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5">
                <Clock className="size-3" strokeWidth={2} /> Aguarda aprovação
              </span>
            ) : c.emailEnviado === false ? (
              <span className="text-2xs border-selo/40 bg-selo/10 text-selo inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5">
                <TriangleAlert className="size-3" strokeWidth={2} /> Email não saiu
              </span>
            ) : (
              <span className="text-2xs border-linha inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-muted-foreground">
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
          {/* Motivo do fornecedor à vista: um 403 por domínio não verificado
              resolve-se ao ler; "não foi possível enviar" manda para os
              registos do servidor (D43). */}
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
