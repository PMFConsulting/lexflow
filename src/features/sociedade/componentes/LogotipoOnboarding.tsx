"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MAX_TAMANHO_LOGOTIPO } from "@/features/administracao/logotipo-validador";

import {
  guardarLogotipoOnboarding,
  removerLogotipoOnboarding,
} from "../logotipo-onboarding";

/**
 * Logótipo da sociedade, ainda durante o registo.
 *
 * Ao contrário da versão da página de gestão, aqui não há sessão: quem preenche
 * o registo entrou pelo link mágico. O token vai nas chamadas, e as Server
 * Actions validam-no contra a base. O logótipo fica na organização — a mesma
 * coluna que a página de gestão usa — por isso, uma vez submetido o registo, o
 * portal da sociedade já o mostra.
 *
 * **Isto não é um `<form>`, e não pode ser.** Vive dentro do formulário do
 * passo 1 (`FormularioSociedade`), e um `<form>` dentro de outro é HTML
 * inválido: o parser do browser deita fora a etiqueta de dentro, o React
 * queixa-se na hidratação e — o que custa mesmo — o botão `type="submit"`
 * daqui passa a submeter o formulário **de fora**. Carregar em «Guardar
 * logótipo» gravava o passo 1 e saltava para o passo 2, sem logótipo nenhum.
 * Por isso os botões são `type="button"` e o `FormData` é montado à mão a
 * partir do campo.
 *
 * O campo também não tem `name`, pela mesma razão do `Anexos`: sendo filho do
 * formulário de fora, um `name` metia o ficheiro dentro do `new FormData(form)`
 * do passo — a subir 2 MB de imagem em cada gravação de um campo de texto.
 *
 * A pré-visualização do que está gravado é local (`blob:` do ficheiro
 * escolhido) e não vem do servidor: `/api/sociedade/logotipo` exige sessão, e
 * durante o registo ainda não existe conta nenhuma. O que se mostra do que já
 * está gravado é o nome do ficheiro, que é o que a página sabe.
 */
export function LogotipoOnboarding({
  token,
  temLogotipo,
  nomeLogotipo,
}: {
  token: string;
  temLogotipo: boolean;
  nomeLogotipo?: string | null;
}) {
  const router = useRouter();
  const campoId = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const [escolhido, setEscolhido] = useState<{ nome: string; url: string } | null>(null);
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [aGuardar, transicaoGuardar] = useTransition();
  const [aRemover, transicaoRemover] = useTransition();

  const emProcessamento = aGuardar || aRemover;

  /*
   * Um `blob:` que não se revoga fica na memória do separador até ele fechar.
   *
   * A revogação vive só aqui, e não também dentro do `setEscolhido`: com a
   * dependência em `escolhido`, o React corre esta limpeza sempre que o valor
   * muda — com o **anterior** ainda fechado no closure — e outra vez ao
   * desmontar. Revogar nos dois sítios era pôr um efeito colateral dentro de
   * uma função de atualização, que o React se reserva o direito de chamar duas
   * vezes.
   */
  useEffect(() => {
    if (!escolhido) return;
    const url = escolhido.url;
    return () => URL.revokeObjectURL(url);
  }, [escolhido]);

  /**
   * Limpa o campo depois de cada tentativa, com ou sem sucesso.
   *
   * É a lição do `Anexos` (D41): sem limpar o `value`, escolher **o mesmo**
   * ficheiro outra vez não dispara `change` — o valor não mudou — e quem
   * corrigiu a imagem e voltou a escolhê-la ficava com um botão que não fazia
   * nada.
   */
  const limparCampo = () => {
    if (entrada.current) entrada.current.value = "";
    setEscolhido(null);
  };

  const aoEscolher = () => {
    setErros({});
    setMensagem(null);
    setSucesso(null);

    const ficheiro = entrada.current?.files?.[0];
    setEscolhido(
      ficheiro ? { nome: ficheiro.name, url: URL.createObjectURL(ficheiro) } : null,
    );
  };

  const guardar = () => {
    const ficheiro = entrada.current?.files?.[0];
    setErros({});
    setMensagem(null);
    setSucesso(null);

    if (!ficheiro || ficheiro.size === 0) {
      setErros({ logotipo: ["Escolha um ficheiro de imagem para o logótipo."] });
      return;
    }

    /*
     * O tamanho é conferido aqui **e** no servidor, e não é duplicação por
     * gosto: o limite de corpo de uma Server Action são 6 MB
     * (`next.config.ts`), e um ficheiro acima disso é recusado pela Next antes
     * de o nosso código o ver — o que chega ao ecrã é uma exceção sem língua
     * nem explicação. Recusar aqui dá a mesma frase em português para 2,1 MB e
     * para 30 MB.
     */
    if (ficheiro.size > MAX_TAMANHO_LOGOTIPO) {
      const mb = (ficheiro.size / 1024 / 1024).toFixed(1);
      setErros({
        logotipo: [`O ficheiro tem ${mb} MB. O tamanho máximo permitido são 2 MB.`],
      });
      return;
    }

    const fd = new FormData();
    fd.set("logotipo", ficheiro);

    transicaoGuardar(async () => {
      try {
        const r = await guardarLogotipoOnboarding(token, fd);
        if (!r.ok) {
          setErros(r.erros);
          setMensagem(r.mensagem);
          limparCampo();
          return;
        }
        limparCampo();
        setSucesso(r.mensagem);
        router.refresh();
      } catch (erro) {
        // Um `revalidatePath` dentro da ação pode trazer um `redirect()` da
        // Next disfarçado de exceção: tem de continuar a propagar-se.
        unstable_rethrow(erro);
        setMensagem("O servidor não respondeu. Verifique a ligação e tente de novo.");
      }
    });
  };

  const remover = () => {
    setErros({});
    setMensagem(null);
    setSucesso(null);

    transicaoRemover(async () => {
      try {
        const r = await removerLogotipoOnboarding(token);
        if (!r.ok) {
          setMensagem(r.mensagem);
          return;
        }
        limparCampo();
        setSucesso(r.mensagem);
        router.refresh();
      } catch (erro) {
        unstable_rethrow(erro);
        setMensagem("O servidor não respondeu. Verifique a ligação e tente de novo.");
      }
    });
  };

  return (
    <section
      className="flex flex-col gap-3"
      // O sinal que diz se o logótipo entrou, sem interrogar um campo que se
      // limpa a si próprio a seguir a cada tentativa (mesma convenção do `Anexos`).
      data-logotipo={temLogotipo ? "1" : "0"}
      data-estado={
        emProcessamento ? "a-carregar" : mensagem || erros.logotipo?.[0] ? "erro" : "pronto"
      }
    >
      <div>
        <h3 className="text-base">Logótipo da sociedade</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          A imagem que passa a aparecer no portal da sociedade, em vez do logótipo da
          plataforma. Opcional — pode ser carregada ou trocada mais tarde na área de
          Administração.
        </p>
      </div>

      <div className="border-linha bg-papel-alto flex flex-col gap-3 rounded-sm border p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="border-linha bg-muted flex h-14 w-32 shrink-0 items-center justify-center overflow-hidden rounded-sm border p-2">
            {escolhido ? (
              /* eslint-disable-next-line @next/next/no-img-element -- pré-visualização local de um blob:, não há URL para o `next/image` otimizar. */
              <img
                src={escolhido.url}
                alt={`Pré-visualização de ${escolhido.nome}`}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <ImageIcon className="text-tinta-suave size-6" strokeWidth={1.5} />
            )}
          </div>

          <div className="min-w-0 flex-1">
            {escolhido ? (
              <p className="truncate text-sm">
                Escolhido: <span className="font-mono text-xs">{escolhido.nome}</span>
              </p>
            ) : temLogotipo ? (
              <p className="truncate text-sm">
                Guardado:{" "}
                <span className="font-mono text-xs">
                  {nomeLogotipo ?? "logótipo da sociedade"}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ainda sem logótipo — o portal usa o da plataforma.
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              PNG, JPEG, WEBP ou SVG · máximo 2 MB
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={campoId} className="text-tinta-suave">
            Ficheiro de imagem
          </Label>
          {/* O `id` vem do `useId()` e o nome estável para endereçar o campo é
              o `data-campo`, que é ASCII e não muda com o texto do ecrã (D41). */}
          <input
            ref={entrada}
            id={campoId}
            data-campo="logotipo"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={aoEscolher}
            aria-describedby={erros.logotipo?.[0] ? `${campoId}-erro` : undefined}
            className="file:bg-tinta file:text-papel-alto text-sm file:mr-3 file:rounded-sm file:border-0 file:px-3 file:py-1.5 file:text-sm"
          />
        </div>

        {erros.logotipo?.[0] && (
          <p id={`${campoId}-erro`} className="text-selo text-xs" role="alert">
            {erros.logotipo[0]}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {/*
            `type="button"` nos dois, e não é detalhe: dentro do formulário do
            passo, um `submit` daqui gravava o passo 1 e navegava para o 2.
          */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={guardar}
            disabled={emProcessamento || !escolhido}
          >
            <Upload className="size-3.5" />
            {aGuardar ? "A guardar…" : temLogotipo ? "Substituir logótipo" : "Guardar logótipo"}
          </Button>

          {temLogotipo && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={remover}
              disabled={emProcessamento}
              className="text-selo hover:bg-selo/10 hover:text-selo"
            >
              <Trash2 className="size-3.5" />
              {aRemover ? "A remover…" : "Remover logótipo"}
            </Button>
          )}
        </div>

        {sucesso && (
          <p className="text-arquivo text-xs" role="status">
            {sucesso}
          </p>
        )}
        {mensagem && (
          <p className="text-selo text-xs" role="alert">
            {mensagem}
          </p>
        )}
      </div>
    </section>
  );
}
