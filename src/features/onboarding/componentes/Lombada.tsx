"use client";

import { Lombada as LombadaBase } from "@/components/lombada";
import { passosDoProcesso, type TipoCliente } from "../passos";

export { CHAVE_CARIMBO } from "@/components/lombada";

/**
 * A lombada do dossier do cliente.
 *
 * O componente mudou-se para `@/components/lombada` quando o registo da
 * sociedade e o de cada pessoa da equipa passaram a ter percursos próprios: o
 * desenho, o carimbo e a fita horizontal do telemóvel são os mesmos nos três, e
 * o que muda é a lista de passos e para onde apontam os links. O que fica aqui
 * é isso — e sobretudo a regra de que numa pessoa singular o percurso tem seis
 * passos e não sete, que é conhecimento deste percurso e de mais nenhum.
 */
export function Lombada({
  token,
  atual,
  gravados,
  tipoCliente,
}: {
  token: string;
  atual: number;
  gravados: number[];
  tipoCliente: TipoCliente;
}) {
  return (
    <LombadaBase
      percurso={passosDoProcesso(tipoCliente)}
      atual={atual}
      gravados={gravados}
      base={`/onboarding/${token}`}
    />
  );
}
