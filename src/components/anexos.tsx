"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Check, Circle, Paperclip, Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { classeSelect } from "@/features/onboarding/componentes/Campo";
import { ACCEPT } from "@/features/onboarding/formatos";

export type Anexo = { id: string; nome: string; tipo: string; bytes: number };

export type ResultadoAnexo =
  | { ok: true; id: string; nome: string }
  | { ok: false; erro: string };

/**
 * Rótulos de **todos** os tipos de documento da plataforma, processo e
 * sociedade, num mapa só — o componente não sabe de que enum vem a lista que
 * recebe, e um tipo sem rótulo apareceria em cru no ecrã.
 */
const ROTULOS: Record<string, string> = {
  identificacao: "Documento de identificação",
  comprovativo_nif: "Comprovativo de NIF",
  certidao_permanente: "Certidão permanente",
  procuracao: "Procuração",
  ata_designacao: "Ata de designação",
  comprovativo_rcbe: "Comprovativo RCBE",
  proposta_comercial: "Proposta comercial",
  termos_sociedade: "Termos e Condições da sociedade",
  certidao_sociedade: "Certidão permanente da sociedade",
  cedula_profissional: "Cédula profissional",
  dossier_assinado: "Dossier assinado",
  outro: "Outro",
};

const kb = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/**
 * Anexos de um passo, sem saber a que percurso pertence. Pede-se a
 * categoria porque sem ela o painel não avisa que um documento está a
 * expirar (§6 do brief).
 *
 * As duas Server Actions entram por parâmetro, não são importadas — o mesmo
 * componente serve processo de cliente, sociedade e pessoa da equipa, cada
 * um escrevendo em tabela diferente. O resto (campo que se limpa no
 * `finally`, `data-anexos`, ids de `useId()` — D41) é comum aos três.
 */
export function Anexos({
  carregar,
  remover: removerAnexo,
  tipos,
  iniciais,
  titulo,
  ajuda,
  obrigatorios = [],
  erros = {},
}: {
  /** Sobe o ficheiro. Recebe um `FormData` com `ficheiro` e `tipo`. */
  carregar: (fd: FormData) => Promise<ResultadoAnexo>;
  /** Remove (soft delete — a lei manda reter). */
  remover: (id: string) => Promise<{ ok: boolean }>;
  tipos: string[];
  iniciais: Anexo[];
  titulo: string;
  ajuda?: string;
  /**
   * Os tipos sem os quais o passo não fecha. A decisão é do servidor
   * (`ANEXOS_OBRIGATORIOS`, em `../schemas`); isto é a mesma lista, para o
   * cliente poder ver o que falta **antes** de carregar em Guardar em vez de o
   * descobrir por um erro no fim.
   */
  obrigatorios?: readonly string[];
  /** Os erros do passo, para as mensagens de `documentos` aterrarem aqui. */
  erros?: Record<string, string[]>;
}) {
  const [anexos, setAnexos] = useState<Anexo[]>(iniciais);
  const [tipo, setTipo] = useState(tipos[0] ?? "outro");
  const [erro, setErro] = useState<string | null>(null);
  const [aCarregar, transicao] = useTransition();
  const entrada = useRef<HTMLInputElement>(null);

  /**
   * Ids gerados, não `ficheiro-${titulo}` (D41). O título com acentos dava
   * `id="ficheiro-Documentação"` — válido, mas `ç`/`ã` têm duas
   * representações Unicode (NFC/NFD) que `querySelector` não trata como
   * iguais. `Campo.tsx` já usava `useId()`; este era o único que não.
   */
  const id = useId();
  const idTipo = `${id}-tipo`;
  const idFicheiro = `${id}-ficheiro`;

  const escolher = (lista: FileList | null) => {
    const f = lista?.[0];
    if (!f) return;

    // Segunda escolha a meio da primeira não pode desaparecer calada. Antes
    // o campo ficava `disabled` durante a subida — escondia o problema em
    // vez de o explicar.
    if (aCarregar) {
      setErro("Há um ficheiro a carregar. Aguarde que termine para anexar o seguinte.");
      if (entrada.current) entrada.current.value = "";
      return;
    }

    setErro(null);

    const fd = new FormData();
    fd.set("ficheiro", f);
    fd.set("tipo", tipo);

    // Verificação no cliente antes de enviar: poupa a subida de um ficheiro
    // que vai ser recusado, e dá a mensagem de imediato.
    if (f.size > 4 * 1024 * 1024) {
      setErro(`O ficheiro tem ${(f.size / 1024 / 1024).toFixed(1)} MB. O máximo são 4 MB.`);
      if (entrada.current) entrada.current.value = "";
      return;
    }

    transicao(async () => {
      try {
        const r = await carregar(fd);
        if (!r.ok) {
          // Nome do ficheiro à frente: o campo limpa-se a seguir e a
          // mensagem sozinha pareceria falar de nada.
          setErro(`${f.name} — ${r.erro}`);
          return;
        }
        setAnexos((a) => [...a, { id: r.id, nome: r.nome, tipo, bytes: f.size }]);
      } catch {
        setErro("Não foi possível carregar o ficheiro. Tente de novo.");
      } finally {
        // Limpar o campo permite reescolher o *mesmo* ficheiro depois de um
        // erro — sem isto o `change` não volta a disparar. Por isso
        // `input.files.length === 0` a seguir a um upload é o estado final
        // esperado, não sinal de falha; a confirmação é o `data-anexos`.
        if (entrada.current) entrada.current.value = "";
      }
    });
  };

  const remover = (id: string) =>
    transicao(async () => {
      const r = await removerAnexo(id);
      if (r.ok) setAnexos((a) => a.filter((x) => x.id !== id));
    });

  const temTipo = (t: string) => anexos.some((a) => a.tipo === t);
  const mensagens = erros.documentos ?? [];

  return (
    // `data-anexos` com a contagem: é o sinal que diz se um anexo entrou, sem
    // depender de ler o `files` de um campo que se limpa de propósito.
    <section
      className="flex flex-col gap-3"
      data-anexos={anexos.length}
      data-estado={aCarregar ? "a-carregar" : erro ? "erro" : "pronto"}
    >
      <div>
        <h2 className="text-lg">{titulo}</h2>
        {ajuda && <p className="mt-1 text-sm text-muted-foreground">{ajuda}</p>}
      </div>

      {/* Âncora do resumo de erros — `alvoDoErro` sobe do input escondido
          lá dentro até este `closest("div")`. */}
      <div className="flex flex-col gap-3">
        {/* Lista do que é preciso, com o que já entrou riscado — em prosa
            na linha de ajuda lia-se como uma frase, não duas coisas a fazer. */}
        {obrigatorios.length > 0 && (
          <ul className="border-linha bg-muted flex flex-col gap-1.5 rounded-sm border p-3">
            {obrigatorios.map((t) => {
              const entregue = temTipo(t);
              return (
                <li
                  key={t}
                  className={cn(
                    "flex items-center gap-2 text-xs",
                    entregue ? "text-arquivo" : "text-muted-foreground",
                  )}
                >
                  {entregue ? (
                    <Check className="size-3.5 shrink-0" strokeWidth={2.5} />
                  ) : (
                    <Circle className="size-3.5 shrink-0" />
                  )}
                  <span>
                    {ROTULOS[t] ?? t}
                    <span className="text-muted-foreground">
                      {entregue ? " · anexado" : " · obrigatório"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* `name` que o resumo de erros procura (`alvoDoErro`). Escondido
            porque o anexo não é campo do passo; sem `label` porque as
            mensagens já se nomeiam a si próprias. */}
        <input type="hidden" name="documentos" value={anexos.map((a) => a.tipo).join(",")} />

        {mensagens.length > 0 && (
          <ul
            className="border-selo/40 bg-selo/5 flex flex-col gap-1 rounded-sm border p-3"
            role="alert"
          >
            {mensagens.map((m) => (
              <li key={m} className="text-selo text-xs">
                {m}
              </li>
            ))}
          </ul>
        )}
      </div>

      {anexos.length > 0 && (
        <ul className="border-linha divide-linha divide-y rounded-sm border">
          {anexos.map((a) => (
            <li key={a.id} className="flex items-center gap-3 p-2.5">
              <Paperclip className="text-tinta-suave size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{a.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {ROTULOS[a.tipo] ?? a.tipo} · {kb(a.bytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remover(a.id)}
                disabled={aCarregar}
                className="text-muted-foreground hover:text-selo p-2 transition-colors"
                aria-label={`Remover ${a.nome}`}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-linha bg-papel-alto flex flex-col gap-3 rounded-sm border border-dashed p-4">
        {tipos.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={idTipo} className="text-tinta-suave">
              Tipo de documento
            </Label>
            <select
              id={idTipo}
              data-campo="anexo-tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className={cn(classeSelect, "sm:max-w-xs")}
            >
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {ROTULOS[t] ?? t}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-tinta-suave text-sm font-medium">
            Ficheiro
          </span>
          {/* Sem `name` de propósito: sobe pela própria Server Action
              (`carregarDocumento`) no `onChange`, não no `FormData` do
              passo. `data-campo` dá-lhe um nome estável para o endereçar. */}
          <input
            id={idFicheiro}
            data-campo="anexo-ficheiro"
            ref={entrada}
            type="file"
            accept={ACCEPT}
            onChange={(e) => escolher(e.target.files)}
            className="sr-only"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor={idFicheiro}
              className={cn(
                "bg-tinta text-papel-alto hover:bg-tinta/90 focus-within:ring-ring inline-flex cursor-pointer items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium transition-colors focus-within:ring-2 focus-within:outline-none",
                aCarregar && "pointer-events-none opacity-50",
              )}
            >
              Escolher ficheiro
            </label>
            <span className="text-xs text-muted-foreground">
              {aCarregar ? "A carregar…" : "Nenhum ficheiro escolhido"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            PDF, JPG, PNG, WEBP ou HEIC. Máximo 4 MB.
          </p>
        </div>

        {erro && (
          <p className="text-selo text-xs" role="alert">
            {erro}
          </p>
        )}
      </div>
    </section>
  );
}
