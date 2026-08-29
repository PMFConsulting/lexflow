"use client";

import { useId, useState, useTransition } from "react";
import { AtSign, Check, Copy, Globe, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ref } from "@/components/ref-processo";
import { cn } from "@/lib/utils";
import {
  confirmarVerificacao,
  guardarRemetente,
  iniciarVerificacaoDominio,
  type EstadoDominio,
  type RegistoDns,
} from "../dominios";
import { Erro, ErroGeral } from "./Erro";
import { formatarData } from "@/lib/datas";

/**
 * De que endereço esta sociedade escreve aos clientes dela.
 *
 * O ecrã existe para responder a uma pergunta só, e responde-a em cima de tudo
 * o resto: **qual é o remetente efetivo**. Enquanto a sociedade não configurar
 * nada, é o global da instalação — e dizê-lo é o que evita a leitura errada de
 * um campo vazio, que é «esta sociedade não envia emails».
 *
 * O estado do domínio é o da Resend e não o nosso: `verificado` aqui significa
 * que ela viu o SPF, o MX e o DKIM na zona de DNS. A plataforma não o pode
 * afirmar por si — e um badge verde escrito por nós era a interface a garantir
 * assinaturas que não existem.
 */

const ESTADOS: Record<string, { rotulo: string; classe: string }> = {
  verified: { rotulo: "Verificado", classe: "border-arquivo/40 bg-arquivo/10 text-arquivo" },
  pending: { rotulo: "À espera do DNS", classe: "border-latao/40 bg-latao/10 text-latao" },
  not_started: { rotulo: "Por começar", classe: "border-linha text-muted-foreground" },
  temporary_failure: {
    rotulo: "Falha temporária",
    classe: "border-latao/40 bg-latao/10 text-latao",
  },
  failed: { rotulo: "Falhou", classe: "border-selo/40 bg-selo/10 text-selo" },
};

const quando = (d: Date | string) => formatarData(d, { dateStyle: "short", timeStyle: "short" });

export function EmailsDaSociedade({
  id,
  inicial,
  remetenteGlobal,
}: {
  id: string;
  inicial: {
    emailRemetente: string | null;
    dominioEmail: string | null;
    dominioResendId: string | null;
    dominioEstado: string | null;
    dominioVerificadoEm: Date | null;
  };
  /** O `EMAIL_REMETENTE` do ambiente — o que vale enquanto a sociedade não tem o seu. */
  remetenteGlobal: string;
}) {
  const [remetente, setRemetente] = useState(inicial.emailRemetente);
  const [dominio, setDominio] = useState<EstadoDominio>({
    dominioEmail: inicial.dominioEmail,
    dominioResendId: inicial.dominioResendId,
    dominioEstado: inicial.dominioEstado,
    dominioVerificadoEm: inicial.dominioVerificadoEm,
    // Os registos de DNS não são guardados — vêm da Resend a cada consulta. Ver
    // a nota em `EstadoDominio`, em `../dominios.ts`.
    registos: [],
  });

  const [errosRemetente, setErrosRemetente] = useState<Record<string, string>>({});
  const [errosDominio, setErrosDominio] = useState<Record<string, string>>({});
  const [gravado, setGravado] = useState(false);
  const [aGravar, transicaoRemetente] = useTransition();
  const [aTratarDominio, transicaoDominio] = useTransition();
  const base = useId();

  const efetivo = remetente ?? remetenteGlobal;
  const estado = dominio.dominioEstado ? ESTADOS[dominio.dominioEstado] : null;

  /**
   * O remetente está configurado e o domínio dele não está verificado?
   *
   * É o estado que produz o 403 da Resend — e o único aviso deste ecrã que fala
   * do futuro em vez do presente. Sem ele, tudo aqui parece configurado e o
   * primeiro sinal de que não está chega no primeiro processo aberto, dias
   * depois, sob a forma de um cliente que nunca recebeu o link.
   */
  const porVerificar = remetente !== null && dominio.dominioEstado !== "verified";

  const gravarRemetente = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setErrosRemetente({});
    setGravado(false);

    transicaoRemetente(async () => {
      try {
        const r = await guardarRemetente(id, String(fd.get("emailRemetente") ?? ""));
        if (!r.ok) {
          setErrosRemetente(r.erros);
          return;
        }
        setRemetente(r.emailRemetente);
        setGravado(true);
      } catch (e) {
        console.error("[plataforma] guardarRemetente rebentou:", e);
        setErrosRemetente({ _: "O servidor não respondeu. Recarregue a página e tente de novo." });
      }
    });
  };

  const criarDominio = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setErrosDominio({});

    transicaoDominio(async () => {
      try {
        const r = await iniciarVerificacaoDominio(id, String(fd.get("dominioEmail") ?? ""));
        if (!r.ok) {
          setErrosDominio(r.erros);
          return;
        }
        setDominio(r.estado);
      } catch (e) {
        console.error("[plataforma] iniciarVerificacaoDominio rebentou:", e);
        setErrosDominio({ _: "O servidor não respondeu. Recarregue a página e tente de novo." });
      }
    });
  };

  const confirmar = () => {
    setErrosDominio({});

    transicaoDominio(async () => {
      try {
        const r = await confirmarVerificacao(id);
        if (!r.ok) {
          setErrosDominio(r.erros);
          return;
        }
        setDominio(r.estado);
      } catch (e) {
        console.error("[plataforma] confirmarVerificacao rebentou:", e);
        setErrosDominio({ _: "O servidor não respondeu. Recarregue a página e tente de novo." });
      }
    });
  };

  return (
    <section className="border-linha bg-papel-alto rounded-sm border p-4">
      <h2 className="flex items-center gap-2 text-base">
        <AtSign className="size-4" strokeWidth={1.75} /> Emails da sociedade
      </h2>

      <p className="mt-2 text-sm text-muted-foreground">
        Os emails que esta sociedade envia aos clientes dela saem deste endereço. Para que saiam
        do domínio dela — com SPF e DKIM próprios, que é o que evita a caixa de spam — o domínio
        tem de ser verificado na Resend.
      </p>

      {/* ------------------------------------------------- o remetente efetivo */}

      <div className="border-linha bg-papel mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border p-3">
        <span className="text-xs text-muted-foreground">Remetente efetivo</span>
        <Ref className="text-sm">{efetivo}</Ref>
        {remetente === null && (
          <span className="text-2xs border-linha rounded-sm border px-2 py-0.5 text-muted-foreground">
            o global da instalação
          </span>
        )}
      </div>

      {porVerificar && (
        <p
          className="border-latao/40 bg-latao/5 mt-3 flex items-start gap-2 rounded-sm border p-2.5 text-sm"
          role="alert"
        >
          <TriangleAlert className="text-latao mt-0.5 size-4 shrink-0" strokeWidth={2} />
          <span>
            O remetente está configurado mas o domínio ainda não está verificado. Enquanto assim
            for, a Resend recusa estes envios com <span className="font-mono">403</span> — e o
            cliente fica sem o link.
          </span>
        </p>
      )}

      {/* ---------------------------------------------------------- remetente */}

      <form onSubmit={gravarRemetente} className="mt-4 flex flex-col gap-4">
        <ErroGeral erros={errosRemetente} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${base}-remetente`}>Remetente desta sociedade</Label>
          <Input
            id={`${base}-remetente`}
            name="emailRemetente"
            type="email"
            defaultValue={inicial.emailRemetente ?? ""}
            placeholder={remetenteGlobal}
            className="font-mono"
            autoComplete="off"
          />
          <p className="text-2xs text-muted-foreground">
            Em branco, esta sociedade volta a enviar de{" "}
            <span className="font-mono">{remetenteGlobal}</span>. É também assim que se troca de
            domínio: apagar o remetente primeiro.
          </p>
          <Erro erros={errosRemetente} campo="emailRemetente" />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={aGravar}>
            {aGravar ? "A gravar…" : "Gravar remetente"}
          </Button>
          {gravado && (
            <span className="text-arquivo inline-flex items-center gap-1.5 text-sm">
              <Check className="size-4" /> Gravado
            </span>
          )}
        </div>
      </form>

      {/* ------------------------------------------------------------ domínio */}

      <div className="border-linha mt-5 border-t pt-4">
        <h3 className="flex items-center gap-2 text-sm">
          <Globe className="size-4" strokeWidth={1.75} /> Domínio de envio
          {estado && (
            <span className={cn("text-2xs rounded-sm border px-2 py-0.5", estado.classe)}>
              {estado.rotulo}
            </span>
          )}
          {!estado && dominio.dominioEstado && (
            <span className="text-2xs border-linha rounded-sm border px-2 py-0.5 text-muted-foreground">
              {dominio.dominioEstado}
            </span>
          )}
        </h3>

        {dominio.dominioVerificadoEm && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Verificado a <Ref>{quando(dominio.dominioVerificadoEm)}</Ref>
          </p>
        )}

        <form onSubmit={criarDominio} className="mt-3 flex flex-col gap-4">
          <ErroGeral erros={errosDominio} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${base}-dominio`}>Domínio</Label>
            <div className="flex flex-wrap items-start gap-2">
              <Input
                id={`${base}-dominio`}
                name="dominioEmail"
                defaultValue={dominio.dominioEmail ?? ""}
                placeholder="andradecosta.pt"
                className="w-full font-mono sm:w-64"
                autoComplete="off"
                required
              />
              <Button type="submit" variant="outline" disabled={aTratarDominio}>
                {aTratarDominio ? "A falar com a Resend…" : "Criar domínio na Resend"}
              </Button>
              {dominio.dominioResendId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={confirmar}
                  disabled={aTratarDominio}
                >
                  <RefreshCw className={cn("size-4", aTratarDominio && "animate-spin")} />
                  Confirmar verificação
                </Button>
              )}
            </div>
            <Erro erros={errosDominio} campo="dominioEmail" />
          </div>
        </form>

        {dominio.dominioResendId && (
          <p className="mt-3 text-xs text-muted-foreground">
            Identificador na Resend <Ref>{dominio.dominioResendId}</Ref>
          </p>
        )}

        {dominio.registos.length > 0 ? (
          <TabelaDns registos={dominio.registos} dominio={dominio.dominioEmail} />
        ) : (
          dominio.dominioResendId && (
            <p className="mt-3 text-sm text-muted-foreground">
              Carregue em <strong>Confirmar verificação</strong> para pedir os registos de DNS à
              Resend — eles não ficam guardados aqui, porque os valores de DKIM mudam quando ela
              os roda.
            </p>
          )
        )}
      </div>
    </section>
  );
}

/**
 * Os registos a colar na zona de DNS do domínio.
 *
 * O valor de um DKIM é uma chave pública inteira: copiar à mão é onde o erro
 * acontece, e um caráter trocado dá um domínio que nunca verifica sem dizer
 * porquê. Daí o botão de copiar por linha, e daí o valor ir em
 * `IBM Plex Mono` com quebra — um valor cortado com reticências não se cola.
 */
function TabelaDns({ registos, dominio }: { registos: RegistoDns[]; dominio: string | null }) {
  return (
    <div className="border-linha mt-4 rounded-sm border">
      <div className="border-linha border-b p-3">
        <h4 className="text-sm">Registos de DNS</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Acrescente estes registos na zona de{" "}
          <span className="font-mono">{dominio ?? "domínio"}</span> e volte aqui para confirmar. A
          propagação pode demorar até algumas horas.
        </p>
      </div>

      <ul className="divide-linha divide-y">
        {registos.map((r, i) => (
          <li key={`${r.tipo}-${r.nome}-${i}`} className="flex flex-col gap-1.5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xs border-linha rounded-sm border px-2 py-0.5 font-mono">
                {r.tipo}
              </span>
              <Ref className="text-xs">{r.nome || "@"}</Ref>
              {r.prioridade !== null && (
                <span className="text-2xs text-muted-foreground">
                  prioridade <span className="font-mono">{r.prioridade}</span>
                </span>
              )}
              {r.ttl && (
                <span className="text-2xs text-muted-foreground">
                  TTL <span className="font-mono">{r.ttl}</span>
                </span>
              )}
              {r.estado && (
                <span
                  className={cn(
                    "text-2xs rounded-sm border px-2 py-0.5",
                    r.estado === "verified"
                      ? "border-arquivo/40 bg-arquivo/10 text-arquivo"
                      : "border-linha text-muted-foreground",
                  )}
                >
                  {r.estado === "verified" ? "verificado" : r.estado}
                </span>
              )}
            </div>
            <div className="flex items-start gap-2">
              <code className="text-2xs bg-papel border-linha min-w-0 flex-1 rounded-sm border p-2 break-all">
                {r.valor}
              </code>
              <BotaoCopiar valor={r.valor} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BotaoCopiar({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        // `navigator.clipboard` não existe fora de um contexto seguro (http sem
        // TLS). O `catch` é o que separa «não copiou» de um botão que parece
        // partido — o valor continua selecionável à mão ao lado.
        navigator.clipboard
          ?.writeText(valor)
          .then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          })
          .catch(() => setCopiado(false));
      }}
      title="Copiar o valor"
      className="border-linha hover:border-tinta inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-1.5 text-xs"
    >
      {copiado ? <Check className="text-arquivo size-3.5" /> : <Copy className="size-3.5" />}
      <span className="sr-only">Copiar o valor</span>
    </button>
  );
}
