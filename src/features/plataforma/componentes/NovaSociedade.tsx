"use client";

import { useId, useState, useTransition } from "react";
import { Building2, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarSociedade } from "../acoes";
import type { ContaCriada } from "../contas";
import { ContasCriadas } from "./ContasCriadas";
import { Erro, ErroGeral } from "./Erro";

/**
 * Criar uma sociedade — e, opcionalmente, o primeiro administrador dela.
 *
 * **Opcional a sério**, e é a decisão de produto deste ecrã: quem abre uma
 * sociedade nem sempre sabe já quem a vai operar, e obrigar a inventar um
 * endereço para poder avançar produz contas para apagar. O preço do adiamento
 * está pago no painel, que conta as sociedades sem administrador — sem esse
 * número, adiar transforma-se em esquecer, e uma sociedade sem administrador
 * não tem por onde ser usada.
 *
 * A janela fecha-se sozinha quando não há administrador para confirmar. Havendo,
 * fica aberta — não por causa da palavra-passe, que hoje vai por email e nunca
 * chega ao ecrã, mas porque é ali que se lê se o email chegou a sair. Uma
 * mensagem que não saiu é uma sociedade com um administrador que não entra, e
 * fechar a janela sem o dizer transformava isso numa descoberta de dias depois.
 */
export function NovaSociedade() {
  const [aberta, setAberta] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [criada, setCriada] = useState<ContaCriada | null>(null);
  const [avisoAdmin, setAvisoAdmin] = useState<string | null>(null);
  const [aGravar, transicao] = useTransition();
  const base = useId();

  const submeter = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setErros({});
    setAvisoAdmin(null);

    transicao(async () => {
      try {
        const r = await criarSociedade({
          nome: String(fd.get("nome") ?? ""),
          nif: String(fd.get("nif") ?? ""),
          prefixoReferencia: String(fd.get("prefixo") ?? ""),
          adminNome: String(fd.get("adminNome") ?? "").trim() || undefined,
          adminEmail: String(fd.get("adminEmail") ?? "").trim() || undefined,
        });

        if (!r.ok) {
          setErros(r.erros);
          return;
        }

        setAvisoAdmin(r.avisoAdmin);
        if (r.admin) {
          setCriada(r.admin);
        } else if (!r.avisoAdmin) {
          setAberta(false);
        }
      } catch (e) {
        // Sem isto, um Server Action que rebente deixa o botão a sair de
        // "A criar…" e mais nada — nem sociedade, nem aviso. É o silêncio que
        // faz uma falha de servidor parecer um clique perdido.
        console.error("[plataforma] criarSociedade rebentou:", e);
        setErros({ _: "O servidor não respondeu. Recarregue a página e tente de novo." });
      }
    });
  };

  const fechar = (v: boolean) => {
    setAberta(v);
    if (!v) {
      setErros({});
      setCriada(null);
      setAvisoAdmin(null);
    }
  };

  return (
    <Dialog open={aberta} onOpenChange={fechar}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Nova sociedade
        </Button>
      </DialogTrigger>

      {/* O conteúdo só monta com a janela aberta: é o que garante que ela
          reabre limpa, sem os valores da vez anterior (D36). */}
      {aberta && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="size-4" strokeWidth={1.75} /> Nova sociedade
            </DialogTitle>
            <DialogDescription>
              A sociedade é o inquilino da plataforma: os processos, os clientes e as contas
              vivem dentro dela e não se veem de fora.
            </DialogDescription>
          </DialogHeader>

          {criada ? (
            <>
              <DialogBody className="flex flex-col gap-3">
                <p className="text-sm">Sociedade criada, com o primeiro administrador.</p>
                <ContasCriadas contas={[criada]} titulo="Administrador da sociedade" />
              </DialogBody>
              <DialogFooter>
                <Button onClick={() => fechar(false)}>Concluir</Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={submeter}>
              <DialogBody className="flex flex-col gap-4">
                <ErroGeral erros={erros} />

                {avisoAdmin && (
                  <p
                    className="border-selo/40 bg-selo/10 text-selo flex items-start gap-2 rounded-sm border p-2.5 text-sm"
                    role="alert"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>
                      A sociedade <strong>foi criada</strong>, mas a conta do administrador não:{" "}
                      {avisoAdmin} Crie-a a partir da página da sociedade.
                    </span>
                  </p>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${base}-nome`}>Nome da sociedade</Label>
                  <Input id={`${base}-nome`} name="nome" required autoComplete="off" />
                  <Erro erros={erros} campo="nome" />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${base}-nif`}>NIPC</Label>
                    <Input
                      id={`${base}-nif`}
                      name="nif"
                      inputMode="numeric"
                      className="font-mono"
                      required
                      autoComplete="off"
                    />
                    <Erro erros={erros} campo="nif" />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${base}-prefixo`}>Prefixo de referência</Label>
                    <Input
                      id={`${base}-prefixo`}
                      name="prefixo"
                      className="font-mono uppercase"
                      maxLength={6}
                      required
                      autoComplete="off"
                    />
                    {/* O prefixo é abstrato até se ver o que produz. */}
                    <p className="text-2xs text-muted-foreground">
                      Entra em todas as referências: <span className="font-mono">PMF</span> →{" "}
                      <span className="font-mono">PMF-2026-0142</span>
                    </p>
                    <Erro erros={erros} campo="prefixoReferencia" />
                  </div>
                </div>

                <div className="border-linha flex flex-col gap-4 rounded-sm border border-dashed p-3.5">
                  <div>
                    <p className="text-sm font-medium">Primeiro administrador</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Opcional. É quem vai operar a sociedade — sem ele, ninguém entra nela. Pode
                      ficar para depois, e a sociedade aparece assinalada no painel até ter um.
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${base}-admin-nome`}>Nome</Label>
                      <Input id={`${base}-admin-nome`} name="adminNome" autoComplete="off" />
                      <Erro erros={erros} campo="adminNome" />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${base}-admin-email`}>Email</Label>
                      <Input
                        id={`${base}-admin-email`}
                        name="adminEmail"
                        type="email"
                        autoComplete="off"
                      />
                      <Erro erros={erros} campo="adminEmail" />
                    </div>
                  </div>

                  <p className="text-2xs text-muted-foreground">
                    A palavra-passe é gerada pela plataforma e enviada por email para esta
                    pessoa. É temporária: ela terá de definir uma sua no primeiro início de
                    sessão.
                  </p>
                </div>
              </DialogBody>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => fechar(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={aGravar}>
                  {aGravar ? "A criar…" : "Criar sociedade"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
