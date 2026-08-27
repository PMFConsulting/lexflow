"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Download, FileSpreadsheet, Power, TriangleAlert, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ref } from "@/components/ref-processo";
import { cn } from "@/lib/utils";
import { alterarEstadoDaConta, criarUtilizador, importarUtilizadores } from "../acoes";
import type { ContaCriada } from "../contas";
import { MODELO_CSV, type LinhaRecusada } from "../importacao";
import { ContasCriadas } from "./ContasCriadas";
import { Erro, ErroGeral } from "./Erro";

/**
 * As contas de uma sociedade: listar, criar à mão e importar em lote.
 *
 * O mesmo componente serve os dois portais — o `super_admin` a ver uma
 * sociedade em `/admin/sociedades/[id]`, e o `society_admin` a ver a sua em
 * `/utilizadores`. Não é economia de código: é a garantia de que os dois veem
 * as **mesmas** regras. Dois ecrãs separados divergem, e o que diverge é sempre
 * o que tem menos olhos em cima.
 *
 * A sociedade vai por parâmetro, mas quem manda é o servidor: para o
 * `society_admin` o valor é ignorado e substituído pela sociedade dele
 * (`sociedadeAlvo`, em `acoes.ts`). Sem isso, mudar um campo escondido criava
 * contas na sociedade de outra pessoa.
 */

export type LinhaDeConta = {
  id: string;
  nome: string;
  email: string;
  papel: string;
  ativo: boolean;
  ligado: string | null;
  criadoEm: Date;
  aprovadoEm?: Date | null;
  gestorId?: string | null;
  gestorNome?: string | null;
};

const ROTULOS: Record<string, string> = {
  super_admin: "Administrador da plataforma",
  society_admin: "Administrador da sociedade",
  gestor: "Gestor",
  utilizador: "Utilizador",
};

const data = new Intl.DateTimeFormat("pt-PT", { dateStyle: "short" });

export function GestaoUtilizadores({
  organizacaoId,
  contas,
  podeAlterarEstado = true,
}: {
  organizacaoId: string;
  contas: LinhaDeConta[];
  podeAlterarEstado?: boolean;
}) {
  const [criadas, setCriadas] = useState<ContaCriada[]>([]);
  const [recusadas, setRecusadas] = useState<LinhaRecusada[]>([]);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroImportacao, setErroImportacao] = useState<string | null>(null);
  const [papelEscolhido, setPapelEscolhido] = useState<string>("utilizador");
  const [aGravar, transicao] = useTransition();
  const [aImportar, transicaoImportacao] = useTransition();
  const formulario = useRef<HTMLFormElement>(null);
  const ficheiro = useRef<HTMLInputElement>(null);
  const base = useId();

  const gestores = contas.filter((c) => c.papel === "gestor" && c.ativo);

  const criar = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setErros({});
    setRecusadas([]);
    setErroImportacao(null);

    transicao(async () => {
      try {
        const r = await criarUtilizador({
          nome: String(fd.get("nome") ?? ""),
          email: String(fd.get("email") ?? ""),
          papel: String(fd.get("papel") ?? ""),
          gestorId: String(fd.get("gestorId") ?? ""),
          organizacaoId,
        });

        if (!r.ok) {
          setErros(r.erros);
          return;
        }

        // As confirmações acumulam-se em vez de se substituírem: quem cria três
        // contas seguidas precisa de ver as três — e sobretudo de ver qual das
        // três ficou com o email por sair ou a aguardar aprovação.
        setCriadas((c) => [...c, r.conta]);
        formulario.current?.reset();
        setPapelEscolhido("utilizador");
      } catch (e) {
        console.error("[plataforma] criarUtilizador rebentou:", e);
        setErros({ _: "O servidor não respondeu. Recarregue a página e tente de novo." });
      }
    });
  };

  const importar = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;

    setErros({});
    setRecusadas([]);
    setErroImportacao(null);

    transicaoImportacao(async () => {
      try {
        const r = await importarUtilizadores(organizacaoId, f);

        if (!r.ok) {
          setErroImportacao(r.erro);
          return;
        }

        setCriadas((c) => [...c, ...r.criadas]);
        setRecusadas(r.recusadas);

        if (r.criadas.length === 0 && r.recusadas.length === 0) {
          setErroImportacao("O ficheiro não tinha nenhuma linha para criar.");
        }
      } catch (e) {
        console.error("[plataforma] importarUtilizadores rebentou:", e);
        setErroImportacao("O servidor não respondeu. Recarregue a página e tente de novo.");
      } finally {
        // Limpa-se o campo de propósito: sem isto, escolher **o mesmo**
        // ficheiro depois de o corrigir não dispara `change` (o valor não
        // mudou) e a segunda tentativa parecia não fazer nada.
        if (ficheiro.current) ficheiro.current.value = "";
      }
    });
  };

  const alternar = (id: string, ativo: boolean) => {
    transicao(async () => {
      const r = await alterarEstadoDaConta(id, ativo);
      if (!r.ok) setErros({ _: r.erro });
    });
  };

  const modelo = `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${MODELO_CSV}`)}`;

  return (
    <div className="flex flex-col gap-5">
      <ErroGeral erros={erros} />

      <ContasCriadas contas={criadas} titulo="Contas criadas" />

      {/* ---------------------------------------------------------- a lista */}

      <section className="border-linha bg-papel-alto rounded-sm border">
        <div className="border-linha flex flex-wrap items-baseline justify-between gap-2 border-b p-3">
          <h2 className="text-base">Contas</h2>
          <span className="text-xs text-muted-foreground">
            {contas.length === 0
              ? "nenhuma"
              : `${contas.length} ${contas.length === 1 ? "conta" : "contas"}`}
          </span>
        </div>

        {contas.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Esta sociedade ainda não tem contas. Sem pelo menos um administrador, ninguém entra
            nela.
          </p>
        ) : (
          <ul className="divide-linha divide-y">
            {contas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
                <span
                  className={cn("min-w-0 flex-1 truncate text-sm", !c.ativo && "opacity-50")}
                >
                  {c.nome}
                </span>
                <Ref className="text-xs text-muted-foreground">{c.email}</Ref>
                <span className="text-2xs border-linha rounded-xs border px-2 py-0.5">
                  {ROTULOS[c.papel] ?? c.papel}
                </span>
                {c.papel === "utilizador" && c.gestorNome && (
                  <span
                    className="text-2xs border-linha text-muted-foreground rounded-xs border px-2 py-0.5"
                    title={`Gestor: ${c.gestorNome}`}
                  >
                    Gestor: {c.gestorNome}
                  </span>
                )}
                {c.aprovadoEm === null && c.papel !== "super_admin" && (
                  <span
                    className="text-2xs border-latao/40 bg-latao/10 text-latao rounded-xs border px-2 py-0.5"
                    title="A aguardar aprovação da administração da plataforma"
                  >
                    Pendente de aprovação
                  </span>
                )}
                {!c.ativo && (
                  <span className="text-2xs border-selo/40 bg-selo/10 text-selo rounded-xs border px-2 py-0.5">
                    Desativada
                  </span>
                )}
                {/* Uma conta sem `auth_user_id` passa o login e não resolve a
                    sessão — é o defeito mais confuso deste sistema, e aparecer
                    na lista é o que o torna diagnosticável. */}
                {!c.ligado && (
                  <span
                    className="text-2xs border-latao/40 bg-latao/10 text-latao rounded-xs border px-2 py-0.5"
                    title="Sem credenciais de acesso — o início de sessão não resolve."
                  >
                    Sem acesso
                  </span>
                )}
                <Ref className="text-2xs text-muted-foreground">{data.format(c.criadoEm)}</Ref>
                {podeAlterarEstado && (
                  <button
                    type="button"
                    onClick={() => alternar(c.id, !c.ativo)}
                    disabled={aGravar}
                    className="border-linha hover:border-tinta inline-flex items-center gap-1.5 rounded-xs border px-2 py-1 text-xs disabled:opacity-50"
                  >
                    <Power className="size-3.5" />
                    {c.ativo ? "Desativar" : "Reativar"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ------------------------------------------------ criar uma a uma */}

        <section className="border-linha bg-papel-alto rounded-sm border p-4">
          <h2 className="flex items-center gap-2 text-base">
            <UserPlus className="size-4" strokeWidth={1.75} /> Criar uma conta
          </h2>

          <form ref={formulario} onSubmit={criar} className="mt-3 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${base}-nome`}>Nome</Label>
              <Input id={`${base}-nome`} name="nome" required autoComplete="off" />
              <Erro erros={erros} campo="nome" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${base}-email`}>Email</Label>
              <Input id={`${base}-email`} name="email" type="email" required autoComplete="off" />
              <Erro erros={erros} campo="email" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${base}-papel`}>Papel</Label>
              <select
                id={`${base}-papel`}
                name="papel"
                value={papelEscolhido}
                onChange={(e) => setPapelEscolhido(e.target.value)}
                className="border-input bg-papel-alto focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm focus-visible:ring-3"
              >
                <option value="utilizador">Utilizador — trabalha os processos</option>
                <option value="gestor">Gestor — coordena uma equipa de utilizadores</option>
                <option value="society_admin">
                  Administrador da sociedade — gere contas e emails
                </option>
              </select>
              <Erro erros={erros} campo="papel" />
            </div>

            {papelEscolhido === "utilizador" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${base}-gestor`}>Gestor associado (opcional)</Label>
                <select
                  id={`${base}-gestor`}
                  name="gestorId"
                  defaultValue=""
                  className="border-input bg-papel-alto focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm focus-visible:ring-3"
                >
                  <option value="">Nenhum (sem gestor)</option>
                  {gestores.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nome} ({g.email})
                    </option>
                  ))}
                </select>
                <Erro erros={erros} campo="gestorId" />
              </div>
            )}

            {/* Não há campo de palavra-passe, e o ecrã diz porquê: sem esta
                linha, a ausência lê-se como um campo que falta. */}
            <p className="text-2xs border-linha rounded-xs border border-dashed p-2.5 text-muted-foreground">
              A palavra-passe temporária é gerada pela plataforma e enviada por email. As contas
              criadas pela sociedade aguardam aprovação da administração da plataforma antes de
              receberem as credenciais.
            </p>

            <Button type="submit" disabled={aGravar} className="self-start">
              {aGravar ? "A criar…" : "Criar conta"}
            </Button>
          </form>
        </section>

        {/* ------------------------------------------------ importar em lote */}

        <section className="border-linha bg-papel-alto rounded-sm border p-4">
          <h2 className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="size-4" strokeWidth={1.75} /> Importar de um ficheiro
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            Um <span className="font-mono">.xlsx</span> ou{" "}
            <span className="font-mono">.csv</span> com três colunas —{" "}
            <span className="font-mono">nome</span>, <span className="font-mono">email</span> e{" "}
            <span className="font-mono">papel</span> — e uma linha por pessoa. O ficheiro é
            verificado todo antes de se criar seja o que for: se alguma coisa correr mal, não
            fica nenhuma conta a meio.
          </p>

          <a
            href={modelo}
            download="modelo_utilizadores.csv"
            className="border-linha hover:border-tinta mt-3 inline-flex items-center gap-1.5 rounded-xs border px-2.5 py-1 text-xs"
          >
            <Download className="size-3.5" /> Descarregar o modelo
          </a>

          <div className="mt-4 flex flex-col gap-1.5">
            <Label htmlFor={`${base}-ficheiro`}>Ficheiro</Label>
            <input
              ref={ficheiro}
              id={`${base}-ficheiro`}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={importar}
              className="file:bg-tinta file:text-papel-alto text-sm file:mr-3 file:rounded-sm file:border-0 file:px-3 file:py-1.5 file:text-sm"
            />
            {aImportar && <p className="text-xs text-muted-foreground">A ler o ficheiro…</p>}
          </div>

          {erroImportacao && (
            <p
              className="border-selo/40 bg-selo/10 text-selo mt-3 rounded-sm border p-2.5 text-sm"
              role="alert"
            >
              {erroImportacao}
            </p>
          )}

          {recusadas.length > 0 && (
            <div className="border-latao/40 bg-latao/5 mt-3 rounded-sm border p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <TriangleAlert className="text-latao size-4" strokeWidth={2} />
                {recusadas.length} {recusadas.length === 1 ? "linha ficou" : "linhas ficaram"} de
                fora
              </p>
              {/* O número da linha é o que o Excel mostra, e é assim que se
                  corrige a folha sem a ler de cima a baixo. */}
              <ul className="mt-2 flex flex-col gap-1.5">
                {recusadas.map((r) => (
                  <li key={r.numero} className="text-xs">
                    <Ref className="text-muted-foreground">linha {r.numero}</Ref>{" "}
                    <span className="text-muted-foreground">{r.bruto}</span> — {r.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
