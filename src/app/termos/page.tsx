import { PaginaDocumentoLegal } from "@/components/documento-legal";
import {
  TERMOS_UTILIZACAO,
  VERSAO_TERMOS_UTILIZACAO,
} from "@/lib/documentos-plataforma";

export const metadata = {
  // Sem `absolute`: o `template` do layout de raiz acrescenta "· LexFlow", e o
  // título do separador passa a ser o mesmo em toda a aplicação.
  title: "Termos de Utilização",
  description: "Condições de utilização da plataforma LexFlow.",
};

/**
 * Termos de Utilização da plataforma — complementam a Política de Privacidade
 * e são referidos no consentimento do registo da sociedade.
 *
 * Não confundir com `/termos-condicoes`: esse é o articulado de prestação de
 * serviços jurídicos da sociedade para com os seus clientes.
 */
export default function TermosUtilizacao() {
  return (
    <PaginaDocumentoLegal
      titulo="Termos de Utilização"
      subtitulo="Utilização da plataforma LexFlow"
      versao={VERSAO_TERMOS_UTILIZACAO}
      seccoes={TERMOS_UTILIZACAO}
    />
  );
}
