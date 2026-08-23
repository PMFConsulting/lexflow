"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Check, Circle, Paperclip, Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { classeSelect } from "./Campo";
import { carregarDocumento, removerDocumento } from "../documentos";
import { ACCEPT } from "../formatos";

type Anexo = { id: string; nome: string; tipo: string; bytes: number };

const ROTULOS: Record<string, string> = {
  identificacao: "Documento de identificação",
  comprovativo_nif: "Comprovativo de NIF",
  certidao_permanente: "Certidão permanente",
  procuracao: "Procuração",
  ata_designacao: "Ata de designação",
  comprovativo_rcbe: "Comprovativo RCBE",
  proposta_comercial: "Proposta comercial",
  termos_sociedade: "Termos e Condições da sociedade",
  dossier_assinado: "Dossier assinado",
  outro: "Outro",
};

const kb = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/**
 * Anexos de um passo.
 *
 * O formulário real tem um dropzone genérico. Aqui pede-se a categoria, porque
 * sem ela o painel não consegue avisar que um documento de identificação está
 * a expirar — e esse aviso é meio ponto do brief.
 */
export function Anexos({
  token,
  tipos,
  iniciais,
  titulo,
  ajuda,
  obrigatorios = [],
  erros = {},
}: {
  token: string;
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
   * Ids gerados, e não `ficheiro-${titulo}`.
   *
   * O título é texto português com acentos, e dele saía `id="ficheiro-Documentação"`.
   * Um id assim é válido, mas é frágil de endereçar: o `ç` e o `ã` têm duas
   * representações Unicode (NFC e NFD) que se lêem iguais no ecrã e não são a
   * mesma sequência de code points. `querySelector` compara code points, não
   * formas canónicas — um seletor que passou por uma ferramenta que normaliza
   * para NFD não encontra o campo, e quem procura fica a olhar para um elemento
   * que está lá e não aparece. Todos os outros campos do formulário já usavam
   * `useId()` (ver `Campo.tsx`); este era o único que não.
   */
  const id = useId();
  const idTipo = `${id}-tipo`;
  const idFicheiro = `${id}-ficheiro`;

  const escolher = (lista: FileList | null) => {
    const f = lista?.[0];
    if (!f) return;

    // Uma segunda escolha enquanto a primeira ainda sobe não pode desaparecer
    // sem dizer nada: as duas partilham o `erro` e o campo que se limpa no fim,
    // e a que chegasse a meio ficava sem sítio para aterrar. Antes o campo era
    // `disabled` durante a subida, o que resolvia isto escondendo-o — e deixava
    // o passo com um campo que ora aceita ora não aceita, sem explicação.
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
        const r = await carregarDocumento(token, fd);
        if (!r.ok) {
          // Com o nome do ficheiro à frente: o campo é limpo a seguir, e sem
          // isto a mensagem ficava a falar de um ficheiro que já não se vê em
          // lado nenhum — o que se leu como "carregar o ficheiro não faz nada".
          setErro(`${f.name} — ${r.erro}`);
          return;
        }
        setAnexos((a) => [...a, { id: r.id, nome: r.nome, tipo, bytes: f.size }]);
      } catch {
        // Uma Server Action que rebenta — limite de corpo, rede a cair — não
        // pode deixar o componente mudo e bloqueado. Silêncio é pior do que
        // uma falha visível.
        setErro("Não foi possível carregar o ficheiro. Tente de novo.");
      } finally {
        // Limpar o campo é o que permite voltar a escolher o *mesmo* ficheiro
        // depois de um erro: sem isto o `change` não volta a disparar, porque o
        // valor não muda.
        //
        // Consequência que já custou uma investigação inteira: a seguir a um
        // upload, `input.files.length` é 0 e `input.value` é "". Esse é o estado
        // final desejado, não sinal de que o `onChange` não correu. Quem quiser
        // confirmar que o anexo entrou olha para a lista acima — ou para o
        // `data-anexos` da secção, que traz a contagem.
        if (entrada.current) entrada.current.value = "";
      }
    });
  };

  const remover = (id: string) =>
    transicao(async () => {
      const r = await removerDocumento(token, id);
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

      {/* Este `div` é também a âncora do resumo de erros — ver o `input`
          escondido lá dentro. `alvoDoErro` sobe do campo ao `closest("div")`, e
          é a este que ele tem de chegar: a lista do que falta é o sítio certo
          para onde levar quem carregou em "Anexe o documento de identificação",
          e fica logo por cima da caixa onde se escolhe o ficheiro. */}
      <div className="flex flex-col gap-3">
        {/* A lista do que é preciso, com o que já entrou riscado da conta.
            Estava tudo dito em prosa na linha de ajuda, e em prosa "o documento
            de identificação e o comprovativo de NIF" lê-se como uma frase, não
            como uma lista de duas coisas a fazer — e ninguém contava. */}
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

        {/* O `name` que o resumo de erros procura. Escondido porque o anexo não
            é campo do passo — o `carga()` não o lê e o ficheiro nunca entra no
            `FormData` do formulário —, mas sem ele um erro em `documentos` não
            tinha para onde saltar (ver `alvoDoErro` em `Formulario.tsx`). Sem
            `label` por perto de propósito: as mensagens nomeiam-se a si próprias
            ("Anexe o documento de identificação…") e uma etiqueta à frente delas
            só acrescentaria ruído. */}
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
          <Label htmlFor={idFicheiro} className="text-tinta-suave">
            Ficheiro
          </Label>
          {/* Sem `name`, e de propósito: o anexo não é campo deste passo. Sobe
              pela sua própria Server Action (`carregarDocumento`) no `onChange`,
              e o `passo2` não pede documento nenhum. Pô-lo no `FormData` do
              formulário seria mandar o ficheiro em cada "Guardar e continuar".
              O `data-campo` é o que lhe dá um nome estável para o endereçar. */}
          <input
            id={idFicheiro}
            data-campo="anexo-ficheiro"
            ref={entrada}
            type="file"
            accept={ACCEPT}
            onChange={(e) => escolher(e.target.files)}
            className="file:bg-tinta file:text-papel-alto text-sm file:mr-3 file:rounded-sm file:border-0 file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="text-xs text-muted-foreground">
            PDF, JPG, PNG, WEBP ou HEIC. Máximo 4 MB.
          </p>
        </div>

        {aCarregar && <p className="text-xs text-muted-foreground">A carregar…</p>}
        {erro && (
          <p className="text-selo text-xs" role="alert">
            {erro}
          </p>
        )}
      </div>
    </section>
  );
}
