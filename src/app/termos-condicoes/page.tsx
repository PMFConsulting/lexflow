import { Logotipo } from "@/components/logotipo";
import { TERMOS_CONDICOES, VERSAO_TERMOS } from "@/lib/termos";

export const metadata = {
  // Sem `absolute`: o `template` do layout de raiz acrescenta "· LexFlow", e o
  // título do separador passa a ser o mesmo em toda a aplicação.
  title: "Termos e Condições",
  description: "Condições de prestação de serviços jurídicos.",
};

/**
 * O documento, em página própria.
 *
 * É para onde aponta o link "abrir o documento" do passo 7 e o link dos emails:
 * quem quiser guardar ou imprimir faz `Ctrl+P` e fica com o PDF, sem precisar
 * de estar dentro do processo. A leitura obrigatória é a do leitor no passo 7 —
 * um separador aberto à parte não se consegue medir, e prometer que se mede
 * seria pior do que não prometer nada.
 */
export default function TermosCondicoes() {
  return (
    <div className="bg-papel min-h-svh">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <header className="border-linha mb-8 border-b pb-6">
          <Logotipo className="mb-4 h-14 w-auto" />
          <h1 className="text-2xl">Termos e Condições</h1>
          <p className="text-2xs mt-1 font-mono tracking-[0.14em] text-muted-foreground uppercase">
            Condições de prestação de serviços jurídicos · Versão {VERSAO_TERMOS}
          </p>
        </header>

        <main className="text-sm leading-relaxed">
          {TERMOS_CONDICOES.map((seccao) => (
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
