"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  CampoEscolha,
  CampoTexto,
} from "@/features/onboarding/componentes/Campo";
import { DOCUMENTOS_ID, PAISES } from "@/features/onboarding/componentes/paises";
import { preencherPerfilConvidado } from "../acoes";
import type { PerfilAdiantado } from "../dados";

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
/** Vazio significa «não mexi neste campo» — nunca «apaga o que lá está». */
const opc = (fd: FormData, k: string) => txt(fd, k) || undefined;

/**
 * Preencher a ficha de quem foi convidado, do lado de quem administra.
 *
 * Um diálogo e não um bloco em linha, pela lição da D36: aberto em linha, o
 * formulário toma a largura de onde calhar estar e o painel que se lhe segue
 * fica onde estava o botão. O conteúdo só monta com o diálogo aberto — é o que
 * garante que ele reabre com o que está gravado e não com o que ficou escrito
 * da última vez.
 *
 * Não há aqui anexos, sigilo, T&C nem palavra-passe. Não é omissão: são atos
 * da própria pessoa, e preenchê-los por ela produzia uma declaração sem
 * declarante.
 */
export function PreencherPerfil({
  conviteId,
  nome,
  email,
  exerce,
  inicial,
}: {
  conviteId: string;
  nome: string;
  email: string;
  /** O papel do convite exerce advocacia? Decide se se pede cédula. */
  exerce: boolean;
  inicial: PerfilAdiantado | null;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <ClipboardPen className="size-3.5" />
          Preencher dados
        </Button>
      </DialogTrigger>
      {aberto && (
        <CorpoPerfil
          conviteId={conviteId}
          nome={nome}
          email={email}
          exerce={exerce}
          inicial={inicial}
          aoFechar={() => setAberto(false)}
        />
      )}
    </Dialog>
  );
}

function CorpoPerfil({
  conviteId,
  nome,
  email,
  exerce,
  inicial,
  aoFechar,
}: {
  conviteId: string;
  nome: string;
  email: string;
  exerce: boolean;
  inicial: PerfilAdiantado | null;
  aoFechar: () => void;
}) {
  const router = useRouter();
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [aGravar, transicao] = useTransition();
  const p = inicial;

  const enviar = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setErros({});
    setMensagem(null);

    transicao(async () => {
      try {
        const r = await preencherPerfilConvidado(conviteId, {
          nomeCompleto: opc(fd, "nomeCompleto"),
          dataNascimento: opc(fd, "dataNascimento"),
          nif: opc(fd, "nif"),
          telefone: opc(fd, "telefone"),
          docTipo: opc(fd, "docTipo"),
          docNumero: opc(fd, "docNumero"),
          docValidade: opc(fd, "docValidade"),
          morada: opc(fd, "morada"),
          pais: opc(fd, "pais"),
          localidade: opc(fd, "localidade"),
          codigoPostal: opc(fd, "codigoPostal"),
          freguesia: opc(fd, "freguesia"),
          concelho: opc(fd, "concelho"),
          distrito: opc(fd, "distrito"),
          cargo: opc(fd, "cargo"),
          cedulaProfissional: opc(fd, "cedulaProfissional"),
          conselhoRegional: opc(fd, "conselhoRegional"),
          dataInscricaoOa: opc(fd, "dataInscricaoOa"),
          areasPratica: opc(fd, "areasPratica"),
        });

        if (!r.ok) {
          setErros(r.erros);
          setMensagem(r.mensagem ?? null);
          return;
        }
        aoFechar();
        router.refresh();
      } catch {
        setMensagem("O servidor não respondeu. Verifique a ligação e tente de novo.");
      }
    });
  };

  return (
    <DialogContent className="max-w-2xl" aria-describedby={undefined}>
      <form onSubmit={enviar} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>Dados de {nome}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <p className="text-sm text-muted-foreground">
            O que preencher aqui aparece já escrito no registo de {email}, e continua editável por
            ela. Os documentos, a declaração de sigilo, os Termos e Condições e a palavra-passe são
            atos dela e não se preenchem por aqui.
          </p>

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
              etiqueta="Nome completo"
              nome="nomeCompleto"
              erros={erros}
              valorInicial={p?.nomeCompleto ?? nome}
            />
            <CampoTexto
              etiqueta="Data de nascimento"
              nome="dataNascimento"
              tipo="date"
              erros={erros}
              valorInicial={p?.dataNascimento ?? ""}
            />
            <CampoTexto
              etiqueta="NIF"
              nome="nif"
              erros={erros}
              mono
              valorInicial={p?.nif ?? ""}
            />
            <CampoTexto
              etiqueta="Telefone"
              nome="telefone"
              erros={erros}
              mono
              valorInicial={p?.telefone ?? ""}
              ajuda="Nove dígitos, com ou sem o indicativo +351."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <CampoEscolha
              etiqueta="Tipo de documento"
              nome="docTipo"
              erros={erros}
              opcoes={DOCUMENTOS_ID}
              valorInicial={p?.docTipo ?? ""}
            />
            <CampoTexto
              etiqueta="Número do documento"
              nome="docNumero"
              erros={erros}
              mono
              valorInicial={p?.docNumero ?? ""}
            />
            <CampoTexto
              etiqueta="Validade"
              nome="docValidade"
              tipo="date"
              erros={erros}
              valorInicial={p?.docValidade ?? ""}
            />
          </div>

          <Separator />

          <CampoTexto
            etiqueta="Morada"
            nome="morada"
            erros={erros}
            valorInicial={p?.morada ?? ""}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              etiqueta="Código postal"
              nome="codigoPostal"
              erros={erros}
              mono
              valorInicial={p?.codigoPostal ?? ""}
            />
            <CampoTexto
              etiqueta="Localidade"
              nome="localidade"
              erros={erros}
              valorInicial={p?.localidade ?? ""}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <CampoTexto
              etiqueta="Freguesia"
              nome="freguesia"
              erros={erros}
              valorInicial={p?.freguesia ?? ""}
            />
            <CampoTexto
              etiqueta="Concelho"
              nome="concelho"
              erros={erros}
              valorInicial={p?.concelho ?? ""}
            />
            <CampoTexto
              etiqueta="Distrito"
              nome="distrito"
              erros={erros}
              valorInicial={p?.distrito ?? ""}
            />
          </div>
          <CampoEscolha
            etiqueta="País"
            nome="pais"
            erros={erros}
            opcoes={PAISES}
            valorInicial={p?.pais ?? "PT"}
          />

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              etiqueta="Cargo"
              nome="cargo"
              erros={erros}
              valorInicial={p?.cargo ?? ""}
            />
            <CampoTexto
              etiqueta="Áreas de prática"
              nome="areasPratica"
              erros={erros}
              valorInicial={p?.areasPratica ?? ""}
            />
          </div>

          {exerce ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <CampoTexto
                etiqueta="Cédula profissional"
                nome="cedulaProfissional"
                erros={erros}
                mono
                valorInicial={p?.cedulaProfissional ?? ""}
              />
              <CampoTexto
                etiqueta="Conselho regional"
                nome="conselhoRegional"
                erros={erros}
                valorInicial={p?.conselhoRegional ?? ""}
              />
              <CampoTexto
                etiqueta="Data de inscrição na OA"
                nome="dataInscricaoOa"
                tipo="date"
                erros={erros}
                valorInicial={p?.dataInscricaoOa ?? ""}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              O perfil deste convite não exerce advocacia, por isso não há cédula profissional a
              preencher.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={aGravar}>
            {aGravar ? "A gravar…" : "Gravar dados"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
