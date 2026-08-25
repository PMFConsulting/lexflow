"use client";

import { useCallback } from "react";
import { Anexos as AnexosBase, type Anexo } from "@/components/anexos";
import { carregarDocumento, removerDocumento } from "../documentos";

/**
 * Os anexos do percurso do cliente.
 *
 * O componente em si é `@/components/anexos` e não sabe de tokens nem de
 * tabelas — foi lá parar quando a sociedade e as pessoas da equipa passaram a
 * anexar ficheiros pelo mesmo mecanismo. O que fica aqui é a ligação às Server
 * Actions deste percurso, que é a única coisa que os distingue.
 */
export function Anexos({
  token,
  tipos,
  iniciais,
  titulo,
  ajuda,
  obrigatorios = [],
  erros = {},
}: {
  token: string;
  tipos: string[];
  iniciais: Anexo[];
  titulo: string;
  ajuda?: string;
  /**
   * Os tipos sem os quais o passo não fecha. A decisão é do servidor
   * (`ANEXOS_OBRIGATORIOS`, em `../schemas`); isto é a mesma lista, para o
   * cliente poder ver o que falta **antes** de carregar em Guardar em vez de o
   * descobrir por um erro no fim.
   */
  obrigatorios?: readonly string[];
  /** Os erros do passo, para as mensagens de `documentos` aterrarem aqui. */
  erros?: Record<string, string[]>;
}) {
  // `useCallback` para o componente de baixo não ver uma função nova a cada
  // render — sem isso, qualquer memoização lá dentro deixaria de valer.
  const carregar = useCallback((fd: FormData) => carregarDocumento(token, fd), [token]);
  const remover = useCallback((id: string) => removerDocumento(token, id), [token]);

  return (
    <AnexosBase
      carregar={carregar}
      remover={remover}
      tipos={tipos}
      iniciais={iniciais}
      titulo={titulo}
      ajuda={ajuda}
      obrigatorios={obrigatorios}
      erros={erros}
    />
  );
}
