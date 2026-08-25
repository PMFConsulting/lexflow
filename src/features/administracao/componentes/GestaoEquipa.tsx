"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, RotateCw, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CampoEscolha,
  CampoTexto,
  classeSelect,
} from "@/features/onboarding/componentes/Campo";
import { cn } from "@/lib/utils";
import {
  alterarEstadoUtilizador,
  alterarPapel,
  cancelarConvite,
  convidarUtilizador,
  reenviarConvite,
} from "../acoes";
import type { LinhaConvite, LinhaEquipa } from "../consultas";

const PAPEIS = [
  { valor: "advogado", texto: "Advogado" },
  { valor: "socio", texto: "Sócio" },
  { valor: "assistente", texto: "Assistente" },
  { valor: "admin", texto: "Administrador" },
];

const ROTULOS_PAPEL: Record<string, string> = {
  admin: "Administrador",
  socio: "Sócio",
  advogado: "Advogado",
  assistente: "Assistente",
};

const dataCurta = new Intl.DateTimeFormat("pt-PT", { dateStyle: "short" });

/**
 * O painel de gestão da equipa.
 *
 * Um componente de cliente e não seis, porque as três listas partilham o mesmo
 * estado visível — convidar alguém tem de fazer aparecer a linha na lista de
 * convites sem um recarregamento manual, e `router.refresh()` num sítio só é
 * mais previsível do que cada peça a refrescar-se por sua conta.
 */
export function GestaoEquipa({
  equipa,
  convites,
  versaoTermos,
  euId,
}: {
  equipa: LinhaEquipa[];
  convites: LinhaConvite[];
  /** A versão do articulado em vigor — para dizer quem ainda não a aceitou. */
  versaoTermos: string | null;
  /** Quem está a ver, para o ecrã não lhe oferecer desativar-se a si próprio. */
  euId: string;
}) {
  const router = useRouter();
  const [aviso, setAviso] = useState<string | null>(null);
  const [linkNovo, setLinkNovo] = useState<{ email: string; link: string; enviado: boolean } | null>(
    null,
  );
  const [aTratar, transicao] = useTransition();

  const pendentes = convites.filter((c) => c.estado === "pendente");
  const historico = convites.filter((c) => c.estado !== "pendente");

  const correr = (accao: () => Promise<{ ok: boolean; mensagem?: string }>) =>
    transicao(async () => {
      setAviso(null);
      const r = await accao();
      if (!r.ok) setAviso(r.mensagem ?? "Não foi possível concluir a operação.");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      {aviso && (
        <p className="border-selo/40 bg-selo/5 text-selo rounded-sm border p-3 text-sm" role="alert">
          {aviso}
        </p>
      )}

      {/* O link fica no ecrã, tenha o email saído ou não. Um convite que só
          existe dentro de uma mensagem que pode nunca chegar é um convite que
          ninguém consegue destrancar — e quem o enviou não tem como o saber. */}
      {linkNovo && (
        <div className="border-arquivo/40 bg-arquivo/5 flex flex-col gap-2 rounded-sm border p-4">
          <p className="text-sm font-medium">
            {linkNovo.enviado
              ? `Convite enviado para ${linkNovo.email}.`
              : `Convite criado, mas o email não saiu.`}
          </p>
          <p className="text-sm text-muted-foreground">
            {linkNovo.enviado
              ? "Guarde o link abaixo por segurança — é a única vez que ele aparece."
              : "Copie o link e faça-o chegar por outra via. É a única vez que ele aparece."}
          </p>
          <div className="flex items-center gap-2">
            <code className="border-linha bg-papel-alto min-w-0 flex-1 truncate rounded-sm border px-2 py-1.5 font-mono text-xs">
              {linkNovo.link}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard?.writeText(linkNovo.link)}
            >
              <Copy className="size-3.5" />
              Copiar
            </Button>
          </div>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg">Equipa</h2>
          <DialogoConvite
            aoConvidar={(r) => {
              setLinkNovo({ email: r.email, link: r.link, enviado: r.emailEnviado });
              router.refresh();
            }}
          />
        </div>

        {equipa.length === 0 ? (
          <p className="border-linha bg-muted rounded-sm border p-4 text-sm text-muted-foreground">
            Ainda não há ninguém com acesso além de si.
          </p>
        ) : (
          <ul className="border-linha divide-linha divide-y rounded-sm border">
            {equipa.map((p) => {
              const aceitouAtual =
                versaoTermos !== null && p.termosVersao === versaoTermos;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm", !p.ativo && "text-muted-foreground line-through")}>
                      {p.nome}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.email}
                      {p.cargo ? ` · ${p.cargo}` : ""}
                      {p.cedulaProfissional ? ` · céd. ${p.cedulaProfissional}` : ""}
                    </p>
                    <p className="mt-0.5 text-2xs">
                      {p.termosVersao ? (
                        aceitouAtual ? (
                          <span className="text-arquivo">
                            T&amp;C {p.termosVersao} aceites
                            {p.termosAceiteEm ? ` em ${dataCurta.format(new Date(p.termosAceiteEm))}` : ""}
                          </span>
                        ) : (
                          <span className="text-latao">
                            Aceitou a versão {p.termosVersao} — a atual é {versaoTermos}
                          </span>
                        )
                      ) : (
                        <span className="text-latao">Sem aceitação de T&amp;C registada</span>
                      )}
                    </p>
                  </div>

                  <select
                    value={p.papel}
                    disabled={aTratar}
                    onChange={(e) =>
                      correr(() =>
                        alterarPapel({ utilizadorId: p.id, papel: e.target.value }),
                      )
                    }
                    className={cn(classeSelect, "w-auto min-w-36")}
                    aria-label={`Perfil de ${p.nome}`}
                  >
                    {PAPEIS.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.texto}
                      </option>
                    ))}
                  </select>

                  {p.id !== euId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={aTratar}
                      onClick={() => correr(() => alterarEstadoUtilizador(p.id, !p.ativo))}
                    >
                      {p.ativo ? "Desativar" : "Reativar"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">Convites por aceitar</h2>
        {pendentes.length === 0 ? (
          <p className="border-linha bg-muted rounded-sm border p-4 text-sm text-muted-foreground">
            Não há convites por aceitar.
          </p>
        ) : (
          <ul className="border-linha divide-linha divide-y rounded-sm border">
            {pendentes.map((c) => {
              const expirado = c.expiraEm ? new Date(c.expiraEm) < new Date() : false;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{c.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.email} · {ROTULOS_PAPEL[c.papel]} · passo {c.passoAtual} de 6
                    </p>
                    <p className="text-2xs mt-0.5 text-muted-foreground">
                      {expirado ? (
                        <span className="text-selo">
                          Expirou em {c.expiraEm ? dataCurta.format(new Date(c.expiraEm)) : "—"}
                        </span>
                      ) : (
                        <>
                          Válido até{" "}
                          {c.expiraEm ? dataCurta.format(new Date(c.expiraEm)) : "sem prazo"}
                        </>
                      )}
                      {c.criadoPor ? ` · convidado por ${c.criadoPor}` : ""}
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={aTratar}
                    onClick={() =>
                      transicao(async () => {
                        setAviso(null);
                        const r = await reenviarConvite(c.id);
                        if (!r.ok) {
                          setAviso(r.mensagem);
                          return;
                        }
                        setLinkNovo({ email: c.email, link: r.link, enviado: r.emailEnviado });
                        router.refresh();
                      })
                    }
                  >
                    <RotateCw className="size-3.5" />
                    Reenviar
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={aTratar}
                    onClick={() => correr(() => cancelarConvite(c.id))}
                  >
                    <X className="size-3.5" />
                    Cancelar
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {historico.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg">Histórico de convites</h2>
          <ul className="border-linha divide-linha divide-y rounded-sm border">
            {historico.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate">{c.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                </div>
                <span
                  className={cn(
                    "text-2xs font-mono tracking-wider uppercase",
                    c.estado === "aceite" ? "text-arquivo" : "text-muted-foreground",
                  )}
                >
                  {c.estado === "aceite"
                    ? `Aceite ${c.aceiteEm ? dataCurta.format(new Date(c.aceiteEm)) : ""}`
                    : "Cancelado"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * O diálogo de convite.
 *
 * Um diálogo e não um bloco em linha, pela lição da D36: aberto em linha, o
 * formulário tomava a largura e o alinhamento de onde calhasse estar, e o painel
 * que se lhe seguia ficava onde estava o botão — o que tornava impossível
 * convidar uma segunda pessoa sem recarregar a página. O conteúdo só monta com o
 * diálogo aberto, que é o que garante que ele reabre limpo.
 */
function DialogoConvite({
  aoConvidar,
}: {
  aoConvidar: (r: { email: string; link: string; emailEnviado: boolean }) => void;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button type="button">
          <UserPlus className="size-4" />
          Convidar
        </Button>
      </DialogTrigger>
      {aberto && (
        <CorpoConvite
          aoFechar={() => setAberto(false)}
          aoConvidar={(r) => {
            setAberto(false);
            aoConvidar(r);
          }}
        />
      )}
    </Dialog>
  );
}

function CorpoConvite({
  aoFechar,
  aoConvidar,
}: {
  aoFechar: () => void;
  aoConvidar: (r: { email: string; link: string; emailEnviado: boolean }) => void;
}) {
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [aEnviar, transicao] = useTransition();

  const enviar = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setMensagem(null);

    transicao(async () => {
      try {
        const r = await convidarUtilizador({
          nome: String(fd.get("nome") ?? "").trim(),
          email: String(fd.get("email") ?? "").trim(),
          papel: String(fd.get("papel") ?? ""),
        });
        if (!r.ok) {
          setErros(r.erros);
          setMensagem(r.mensagem ?? null);
          return;
        }
        aoConvidar({ email: r.email, link: r.link, emailEnviado: r.emailEnviado });
      } catch {
        // Uma Server Action que rebenta não pode deixar o botão preso em «A
        // convidar…» sem explicação. Silêncio é pior do que uma falha visível.
        setMensagem("O servidor não respondeu. Verifique a ligação e tente de novo.");
      }
    });
  };

  return (
    <DialogContent className="max-w-md" aria-describedby={undefined}>
      <form onSubmit={enviar} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>Convidar para a sociedade</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-5 py-4">
          <p className="text-sm text-muted-foreground">
            A pessoa recebe um link para concluir o registo dela — dados pessoais, dados
            profissionais, documentos, sigilo profissional e os Termos e Condições da sociedade. A
            conta só existe no fim.
          </p>

          {mensagem && (
            <p className="border-selo/40 bg-selo/5 text-selo rounded-sm border p-2.5 text-sm" role="alert">
              {mensagem}
            </p>
          )}

          <CampoTexto etiqueta="Nome" nome="nome" erros={erros} obrigatorio />
          <CampoTexto etiqueta="Email" nome="email" tipo="email" erros={erros} obrigatorio />
          <CampoEscolha
            etiqueta="Perfil"
            nome="papel"
            erros={erros}
            obrigatorio
            opcoes={PAPEIS}
            valorInicial="advogado"
          />
          <p className="text-xs text-muted-foreground">
            Advogados e sócios têm de indicar e anexar a cédula profissional; assistentes não.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={aEnviar}>
            {aEnviar ? "A convidar…" : "Enviar convite"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
