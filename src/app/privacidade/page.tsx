import { PaginaDocumentoLegal } from "@/components/documento-legal";
import {
  POLITICA_PRIVACIDADE,
  VERSAO_POLITICA_PRIVACIDADE,
} from "@/lib/documentos-plataforma";

export const metadata = {
  // Sem `absolute`: o `template` do layout de raiz acrescenta "· LexFlow", e o
  // título do separador passa a ser o mesmo em toda a aplicação.
  title: "Política de Privacidade",
  description: "Como a LexFlow trata os dados pessoais no âmbito da plataforma.",
};

/**
 * Política de Privacidade da plataforma — o documento que o passo final do
 * registo da sociedade liga ao consentimento obrigatório. Texto-âncora com a
 * entidade responsável por preencher (ver `lib/documentos-plataforma.ts`).
 */
export default function PoliticaPrivacidade() {
  return (
    <PaginaDocumentoLegal
      titulo="Política de Privacidade"
      subtitulo="Tratamento de dados pessoais na plataforma LexFlow"
      versao={VERSAO_POLITICA_PRIVACIDADE}
      seccoes={POLITICA_PRIVACIDADE}
    />
  );
}
