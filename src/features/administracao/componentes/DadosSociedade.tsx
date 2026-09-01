"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CampoEscolha,
  CampoTexto,
} from "@/features/onboarding/componentes/Campo";
import { PAISES } from "@/features/onboarding/componentes/paises";
import { atualizarDadosSociedade } from "../acoes";

export type DadosEditaveis = {
  naturezaJuridica: string | null;
  numeroOrdem: string | null;
  emailGeral: string | null;
  telefone: string | null;
  website: string | null;
  morada: string | null;
  pais: string | null;
  localidade: string | null;
  codigoPostal: string | null;
  freguesia: string | null;
  concelho: string | null;
  distrito: string | null;
};

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/**
 * Os dados da sociedade que quem a administra pode corrigir.
 *
 * Não estão aqui o nome, o NIPC nem o prefixo das referências: são os campos
 * mãe, e a página mostra-os em leitura logo acima com a razão à frente. O
 * servidor recusa-os na mesma se vierem no pedido — esconder o campo não fecha
 * a Server Action (D35).
 *
 * Os campos são os mesmos dos passos 1 e 2 do registo da sociedade, com as
 * mesmas regras: uma morada que o registo recusaria não pode entrar por aqui.
 */
export function DadosSociedade({
  inicial,
  organizacaoId,
}: {
  inicial: DadosEditaveis;
  /** Só o super_admin a envia — para o `society_admin` a sociedade é sempre a dele, decidido no servidor. */
  organizacaoId?: string;
}) {
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [gravado, setGravado] = useState(false);
  const [aGravar, transicao] = useTransition();

  const submeter = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setErros({});
    setMensagem(null);
    setGravado(false);

    transicao(async () => {
      try {
        const r = await atualizarDadosSociedade({
          ...(organizacaoId ? { organizacaoId } : {}),
          naturezaJuridica: txt(fd, "naturezaJuridica"),
          numeroOrdem: txt(fd, "numeroOrdem"),
          emailGeral: txt(fd, "emailGeral"),
          telefone: txt(fd, "telefone"),
          // `|| undefined` e não a string vazia: um opcional que receba `""`
          // recusa-o com uma mensagem sobre uma caixa que ninguém abriu.
          website: txt(fd, "website") || undefined,
          morada: txt(fd, "morada"),
          pais: txt(fd, "pais"),
          localidade: txt(fd, "localidade"),
          codigoPostal: txt(fd, "codigoPostal"),
          freguesia: txt(fd, "freguesia"),
          concelho: txt(fd, "concelho"),
          distrito: txt(fd, "distrito"),
        });

        if (!r.ok) {
          setErros(r.erros);
          setMensagem(r.mensagem ?? null);
          return;
        }
        setGravado(true);
      } catch (e) {
        // Uma Server Action que rebenta não pode deixar o botão preso em «A
        // gravar…» sem explicação (D46, deste lado).
        console.error("[admin] atualizarDadosSociedade rebentou:", e);
        setMensagem("O servidor não respondeu. Recarregue a página e tente de novo.");
      }
    });
  };

  return (
    <section className="border-linha bg-papel-alto rounded-sm border p-4">
      <h2 className="text-lg">Sede e contactos</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Estes dados podem ser corrigidos por si. O nome, o NIPC e o prefixo das referências não —
        estão acima, em leitura.
      </p>

      <form onSubmit={submeter} className="mt-4 flex flex-col gap-4">
        {mensagem && (
          <p
            className="border-selo/40 bg-selo/5 text-selo rounded-sm border p-2.5 text-sm"
            role="alert"
          >
            {mensagem}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            etiqueta="Forma jurídica"
            nome="naturezaJuridica"
            erros={erros}
            obrigatorio
            valorInicial={inicial.naturezaJuridica ?? ""}
            ajuda="Por exemplo: Sociedade de Advogados, SP, RL."
          />
          <CampoTexto
            etiqueta="N.º na Ordem dos Advogados"
            nome="numeroOrdem"
            erros={erros}
            obrigatorio
            mono
            valorInicial={inicial.numeroOrdem ?? ""}
          />
        </div>

        <CampoTexto
          etiqueta="Morada"
          nome="morada"
          erros={erros}
          obrigatorio
          valorInicial={inicial.morada ?? ""}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            etiqueta="Código postal"
            nome="codigoPostal"
            erros={erros}
            obrigatorio
            mono
            valorInicial={inicial.codigoPostal ?? ""}
          />
          <CampoTexto
            etiqueta="Localidade"
            nome="localidade"
            erros={erros}
            obrigatorio
            valorInicial={inicial.localidade ?? ""}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <CampoTexto
            etiqueta="Freguesia"
            nome="freguesia"
            erros={erros}
            obrigatorio
            valorInicial={inicial.freguesia ?? ""}
          />
          <CampoTexto
            etiqueta="Concelho"
            nome="concelho"
            erros={erros}
            obrigatorio
            valorInicial={inicial.concelho ?? ""}
          />
          <CampoTexto
            etiqueta="Distrito"
            nome="distrito"
            erros={erros}
            obrigatorio
            valorInicial={inicial.distrito ?? ""}
          />
        </div>

        <CampoEscolha
          etiqueta="País"
          nome="pais"
          erros={erros}
          obrigatorio
          opcoes={PAISES}
          valorInicial={inicial.pais ?? "PT"}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            etiqueta="Email geral"
            nome="emailGeral"
            tipo="email"
            erros={erros}
            obrigatorio
            valorInicial={inicial.emailGeral ?? ""}
          />
          <CampoTexto
            etiqueta="Telefone"
            nome="telefone"
            erros={erros}
            obrigatorio
            mono
            valorInicial={inicial.telefone ?? ""}
            ajuda="Nove dígitos, com ou sem o indicativo +351."
          />
        </div>

        <CampoTexto
          etiqueta="Website"
          nome="website"
          erros={erros}
          valorInicial={inicial.website ?? ""}
          ajuda="Opcional. Endereço completo, começado por https://."
        />

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={aGravar}>
            {aGravar ? "A gravar…" : "Gravar alterações"}
          </Button>
          {gravado && (
            <span className="text-arquivo inline-flex items-center gap-1.5 text-sm">
              <Check className="size-4" /> Gravado
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
