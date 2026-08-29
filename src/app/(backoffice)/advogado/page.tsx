import { Paperclip } from "lucide-react";
import { Ref } from "@/components/ref-processo";
import { exigirEquipaDaSociedade } from "@/lib/sessao";
import { sociedadeDe } from "@/features/administracao/consultas";
import {
  colegasDe,
  documentosDe,
  perfilDe,
} from "@/features/advogado/consultas";
import { cn } from "@/lib/utils";
import { rotuloDoPapel } from "@/components/portal-shell";
import { formatarDataCurta } from "@/lib/datas";

export const metadata = { title: "A minha conta" };
export const dynamic = "force-dynamic";

const ROTULOS_DOC: Record<string, string> = {
  identificacao: "Documento de identificação",
  cedula_profissional: "Cédula profissional",
  outro: "Outro",
};

function Linha({
  etiqueta,
  valor,
  mono = false,
}: {
  etiqueta: string;
  valor: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="border-linha flex items-baseline justify-between gap-4 border-b py-2 last:border-0">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className={cn("text-right text-sm break-all", mono && "font-mono tabular-nums")}>
        {valor || "—"}
      </dd>
    </div>
  );
}

/**
 * O portal de cada pessoa da equipa.
 *
 * Não é uma versão reduzida da administração: é outra coisa. A administração
 * responde a «quem tem acesso à sociedade»; isto responde a «o que é que a
 * sociedade tem sobre mim, e o que é que eu tenho por fazer». As duas leituras
 * têm de existir separadas — sob RGPD, uma pessoa tem direito a ver os seus
 * próprios dados sem depender de quem administra, e um portal que a obrigasse a
 * pedi-los é um direito de acesso com um intermediário pelo meio.
 *
 * Tudo aqui sai da sessão. Nenhuma consulta desta página aceita um id da barra
 * de endereço — se aceitasse, era o perfil e os documentos de identificação de
 * um colega a um parâmetro de distância.
 */
export default async function PortalAdvogado() {
  const { eu } = await exigirEquipaDaSociedade();

  const [perfil, documentos, colegas, org] = await Promise.all([
    perfilDe(eu.id),
    documentosDe(eu.id),
    colegasDe(eu.organizacaoId, eu.id),
    sociedadeDe(eu.organizacaoId),
  ]);

  const morada = [perfil?.morada, perfil?.codigoPostal, perfil?.localidade]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">{eu.nome}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rotuloDoPapel(eu.papel)}
          {perfil?.cargo ? ` · ${perfil.cargo}` : ""} em {org?.nome ?? "—"}
        </p>
      </div>

      <section className="border-linha bg-papel-alto rounded-sm border p-4">
        <h2 className="text-lg">Conta</h2>
        <dl className="mt-2">
          <Linha etiqueta="Email" valor={eu.email} />
          <Linha etiqueta="Perfil" valor={rotuloDoPapel(eu.papel)} />
          <Linha etiqueta="Conta criada em" valor={formatarDataCurta(eu.criadoEm)} mono />
        </dl>
      </section>

      {perfil ? (
        <>
          <section className="border-linha bg-papel-alto rounded-sm border p-4">
            <h2 className="text-lg">Dados profissionais</h2>
            <dl className="mt-2">
              <Linha etiqueta="Cargo" valor={perfil.cargo} />
              <Linha etiqueta="Cédula profissional" valor={perfil.cedulaProfissional} mono />
              <Linha etiqueta="Conselho regional" valor={perfil.conselhoRegional} />
              <Linha
                etiqueta="Inscrição na Ordem"
                valor={
                  perfil.dataInscricaoOa
                    ? formatarDataCurta(new Date(perfil.dataInscricaoOa))
                    : null
                }
                mono
              />
              <Linha etiqueta="Áreas de prática" valor={perfil.areasPratica} />
            </dl>
          </section>

          <section className="border-linha bg-papel-alto rounded-sm border p-4">
            <h2 className="text-lg">Dados pessoais</h2>
            <dl className="mt-2">
              <Linha etiqueta="Nome completo" valor={perfil.nomeCompleto} />
              <Linha etiqueta="NIF" valor={perfil.nif} mono />
              <Linha etiqueta="Telefone" valor={perfil.telefone} mono />
              <Linha etiqueta="Morada" valor={morada || null} />
            </dl>
            {/* Direito de retificação, dito onde ele se exerce. Um ecrã de
                leitura que não diga a quem se pede a correção é um direito
                anunciado sem porta. */}
            <p className="mt-3 text-xs text-muted-foreground">
              Para corrigir algum destes dados, fale com quem administra a conta da sociedade.
            </p>
          </section>
        </>
      ) : (
        <section className="border-linha bg-muted rounded-sm border p-4 text-sm text-muted-foreground">
          A sua conta foi criada no servidor e não pelo percurso de registo, por isso não há perfil
          associado. Os dados pessoais e profissionais aparecem aqui a partir do momento em que
          existirem.
        </section>
      )}

      {documentos.length > 0 && (
        <section className="border-linha bg-papel-alto rounded-sm border p-4">
          <h2 className="text-lg">Os meus documentos</h2>
          <ul className="divide-linha mt-2 divide-y">
            {documentos.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <Paperclip className="text-tinta-suave size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{d.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROTULOS_DOC[d.tipo] ?? d.tipo}
                  </p>
                </div>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatarDataCurta(new Date(d.criadoEm))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {colegas.length > 0 && (
        <section className="border-linha bg-papel-alto rounded-sm border p-4">
          <h2 className="text-lg">Equipa</h2>
          <ul className="divide-linha mt-2 divide-y">
            {colegas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{c.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {c.cargo ?? rotuloDoPapel(c.papel)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
