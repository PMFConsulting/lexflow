import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { estadoProcesso } from "@/db/schema/enums";

type Estado = (typeof estadoProcesso.enumValues)[number];

export type LinhaCliente = {
  nif: string;
  nome: string | null;
  tipoCliente: "particular" | "empresa";
  email: string | null;
  telefone: string | null;
  nacionalidades: string | null;
  totalProcessos: number;
  ultimoProcessoId: string;
  ultimaReferencia: string;
  ultimoEstado: Estado;
  ultimoCriadoEm: Date;
};

type LinhaBruta = {
  nif: string;
  nome: string | null;
  tipo_cliente: "particular" | "empresa";
  email: string | null;
  telefone: string | null;
  nacionalidades: string | null;
  total_processos: number | string;
  processo_id: string;
  referencia: string;
  estado: Estado;
  criado_em: Date;
};

/**
 * Um cliente é uma pessoa ou empresa distinta, deduplicada por NIF/NIPC — o
 * mesmo NIF pode passar por vários processos ao longo do tempo. A ficha usa
 * sempre os dados do processo mais recente desse NIF; um processo ainda sem
 * NIF (passo 2 por preencher) ainda não conta como cliente.
 */
export async function listarClientes(q?: string) {
  const termo = q?.trim() ?? "";
  const like = `%${termo}%`;

  const linhas = await db().execute<LinhaBruta>(sql`
    with processos_nif as (
      select
        df.nif as nif,
        po.id as processo_id,
        po.referencia as referencia,
        po.tipo_cliente as tipo_cliente,
        po.estado as estado,
        po.criado_em as criado_em,
        di.nome as nome,
        di.email as email,
        di.telefone as telefone,
        row_number() over (partition by df.nif order by po.criado_em desc) as rn,
        count(*) over (partition by df.nif) as total_processos
      from processo_onboarding po
      inner join dados_fiscais df on df.processo_id = po.id
      left join dados_identificacao di on di.processo_id = po.id
      where po.apagado_em is null
    )
    select
      pn.nif,
      pn.nome,
      pn.tipo_cliente,
      pn.email,
      pn.telefone,
      pn.total_processos,
      pn.processo_id,
      pn.referencia,
      pn.estado,
      pn.criado_em,
      (
        select string_agg(distinct n.pais, ', ')
        from nacionalidade n
        where n.processo_id = pn.processo_id and n.titular = 'cliente'
      ) as nacionalidades
    from processos_nif pn
    where pn.rn = 1
      and (
        ${termo} = ''
        or pn.nif ilike ${like}
        or unaccent(coalesce(pn.nome, '')) ilike unaccent(${like})
        or coalesce(pn.email, '') ilike ${like}
      )
    order by pn.criado_em desc
  `);

  return linhas.map(
    (l): LinhaCliente => ({
      nif: l.nif,
      nome: l.nome,
      tipoCliente: l.tipo_cliente,
      email: l.email,
      telefone: l.telefone,
      nacionalidades: l.nacionalidades,
      totalProcessos: Number(l.total_processos),
      ultimoProcessoId: l.processo_id,
      ultimaReferencia: l.referencia,
      ultimoEstado: l.estado,
      ultimoCriadoEm: l.criado_em,
    }),
  );
}
