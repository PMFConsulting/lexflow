import Image from "next/image";
import { TERMOS_CONDICOES, VERSAO_TERMOS } from "@/lib/termos";

export const metadata = {
  // Absoluto: o `template` do layout de raiz acrescenta "· JMASSANO" ao
  // título, e este documento é para o cliente guardar ou imprimir.
  title: { absolute: "Termos e Condições — JMASSANO" },
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
          <Image
            src="/logo_jm.png"
            alt="JMASSANO — Escritório de Advogado"
            width={202}
            height={171}
            className="mb-4 h-14 w-auto"
          />
          <h1 className="text-2xl">Termos e Condições</h1>
          <p className="text-2xs mt-1 font-mono tracking-[0.14em] text-muted-foreground uppercase">
            Condições de prestação de serviços jurídicos · Versão {VERSAO_TERMOS}
          </p>
        </header>

        <main className="flex flex-col gap-6 text-sm leading-relaxed">
          {TERMOS_CONDICOES.map((seccao) => (
            <section key={seccao.titulo}>
              <h2 className="mb-2 font-medium">{seccao.titulo}</h2>
              {seccao.paragrafos.map((p, i) => (
                <p key={i} className="mb-2 text-muted-foreground">
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
