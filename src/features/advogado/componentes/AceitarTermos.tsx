"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LeitorTermos, type TermosParaLer } from "@/components/leitor-termos";
import { CampoCaixa } from "@/features/onboarding/componentes/Campo";
import { aceitarTermosEmVigor } from "../acoes";

/**
 * Aceitar a versão do articulado que está em vigor, já com conta criada.
 *
 * A caixa continua trancada até o documento ser aberto — a mesma regra do
 * registo e a mesma da D30, porque uma declaração de que se leu um documento
 * que nunca foi mostrado não prova coisa nenhuma. Não se abre caminho mais
 * curto para quem já é da casa: se alguma coisa, é a essa pessoa que se pede
 * mais rigor, porque é ela que vai ver os dossiers dos clientes.
 */
export function AceitarTermos({ termos }: { termos: TermosParaLer }) {
  const router = useRouter();
  const [lido, setLido] = useState(false);
  const [aceite, setAceite] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [aGravar, transicao] = useTransition();

  const confirmar = () =>
    transicao(async () => {
      setMensagem(null);
      try {
        const r = await aceitarTermosEmVigor();
        if (!r.ok) {
          setMensagem(r.mensagem);
          return;
        }
        router.refresh();
      } catch {
        setMensagem("O servidor não respondeu. Verifique a ligação e tente de novo.");
      }
    });

  return (
    <div className="border-latao/40 bg-latao/5 flex flex-col gap-4 rounded-sm border p-4">
      <div>
        <h2 className="text-lg">Há uma versão nova dos Termos e Condições.</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A sociedade publicou a versão {termos.versao} do articulado. A sua aceitação anterior
          continua a valer para a versão que aceitou — o que fica por fazer é aceitar esta.
        </p>
      </div>

      {mensagem && (
        <p className="border-selo/40 bg-selo/5 text-selo rounded-sm border p-3 text-sm" role="alert">
          {mensagem}
        </p>
      )}

      <LeitorTermos
        termos={termos}
        lido={lido}
        aoLer={() => setLido(true)}
        hrefExterno={termos.forma === "documento" ? termos.url : "/termos-condicoes"}
      />

      <CampoCaixa
        nome="aceitaTermos"
        valorInicial={false}
        desativado={!lido}
        onChange={setAceite}
        ajudaDesativado={
          termos.forma === "documento"
            ? "Abra o documento acima para poder aceitar."
            : "Abra o documento acima e percorra-o até ao fim para poder aceitar."
        }
        etiqueta={`Aceito os Termos e Condições da sociedade, na versão ${termos.versao}.`}
      />

      <Button
        type="button"
        onClick={confirmar}
        disabled={!lido || !aceite || aGravar}
        className="self-start"
      >
        {aGravar ? "A registar…" : "Registar aceitação"}
      </Button>
    </div>
  );
}
