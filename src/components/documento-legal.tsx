import { Logotipo } from "@/components/logotipo";
import type { SeccaoDocumento } from "@/lib/documentos-plataforma";

/**
 * Moldura comum das páginas de documentos legais da plataforma
 * (`/privacidade` e `/termos`).
 *
 * O mesmo desenho da página `/termos-condicoes`: quem quer guardar ou
 * imprimir faz `Ctrl+P` e fica com o PDF. Recebe o documento por props para as
 * duas páginas não duplicarem a marcação — é a mesma regra que os textos
 * legais seguem (uma fonte só, para o que se mostra e o que se grava nunca
 * divergirem).
 */
export function PaginaDocumentoLegal({
  titulo,
  subtitulo,
  versao,
  seccoes,
}: {
  titulo: string;
  subtitulo: string;
  versao: string;
  seccoes: SeccaoDocumento[];
}) {
  return (
    <div className="bg-papel min-h-svh">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <header className="border-linha mb-8 border-b pb-6">
          <Logotipo className="mb-4 h-14 w-auto" />
          <h1 className="text-2xl">{titulo}</h1>
          <p className="text-2xs mt-1 font-mono tracking-[0.14em] text-muted-foreground uppercase">
            {subtitulo} · Versão {versao}
          </p>
        </header>

        <main className="text-sm leading-relaxed">
          {seccoes.map((seccao) => (
            <section
              key={seccao.titulo}
              className="border-linha mt-7 border-t pt-5 first:mt-0 first:border-none first:pt-0"
            >
              <h2 className="text-tinta mb-2 text-lg font-normal">{seccao.titulo}</h2>
              {seccao.paragrafos.map((p, i) => (
                <p key={i} className="text-tinta-suave mb-2">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
