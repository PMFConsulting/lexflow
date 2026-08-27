import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import {
  A4,
  COLUNA_CHAVE,
  LATAO,
  LINHA,
  MARGEM,
  RODAPE,
  SUAVE,
  TINTA,
  dataHoraPt,
  dataPt,
  kb,
  paraWinAnsi,
  quebrar,
} from "@/lib/storage/pdf";
import type { Seccoes } from "@/features/onboarding/dados";
import type { TipoCliente } from "@/features/onboarding/passos";

export type DadosDossierPdf = {
  processo: {
    id: string;
    referencia: string;
    tipoCliente: TipoCliente;
    nomeCliente: string | null;
    nifCliente: string | null;
    emailCliente: string | null;
    estado: string;
    responsavel: string | null;
    submetidoEm: Date | null;
    atualizadoEm: Date | null;
    criadoEm?: Date | null;
  };
  seccoes: Seccoes;
  documentos: Array<{
    nome: string;
    tipo: string;
    bytes: number;
  }>;
  assinatura: {
    assinadoEm: Date | null;
    imagemDados?: string | null;
  } | null;
  proposta: {
    nome: string;
    bytes: number;
  } | null;
  geradoEm?: Date;
};

const ESTADOS_PT: Record<string, string> = {
  rascunho: "Rascunho",
  pendente_cliente: "Pendente do cliente",
  submetido: "Submetido",
  em_revisao: "Em revisão",
  aguardar_aprovacao: "A aguardar aprovação",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  arquivado: "Arquivado",
};

const TIPO_DOC_PT: Record<string, string> = {
  identificacao: "Documento de Identificação",
  comprovativo_nif: "Comprovativo de NIF",
  certidao_permanente: "Certidão Permanente",
  procuracao: "Procuração",
  ata_designacao: "Ata de Designação",
  comprovativo_rcbe: "Comprovativo de RCBE",
  dossier_assinado: "Dossier Assinado",
  proposta_comercial: "Proposta Comercial",
  outro: "Outro Documento",
};

export async function gerarDossierPdf(d: DadosDossierPdf): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const geradoEm = d.geradoEm ?? new Date();

  pdf.setTitle(`Dossier do Processo · ${d.processo.referencia}`);
  pdf.setProducer("LexFlow");
  pdf.setCreationDate(geradoEm);
  pdf.setModificationDate(geradoEm);

  const corpo = await pdf.embedFont(StandardFonts.Helvetica);
  const forte = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serifa = await pdf.embedFont(StandardFonts.TimesRoman);

  let pagina: PDFPage = pdf.addPage([A4.largura, A4.altura]);
  let y = A4.altura - MARGEM.topo;

  const escrever = (
    texto: string,
    x: number,
    yy: number,
    fonte: PDFFont,
    tamanho: number,
    cor = TINTA,
    espacamento = 0,
  ) => {
    const limpo = paraWinAnsi(texto);
    if (espacamento > 0) {
      let cursor = x;
      for (const c of limpo) {
        pagina.drawText(c, { x: cursor, y: yy, font: fonte, size: tamanho, color: cor });
        cursor += fonte.widthOfTextAtSize(c, tamanho) + espacamento;
      }
      return;
    }
    pagina.drawText(limpo, { x, y: yy, font: fonte, size: tamanho, color: cor });
  };

  const espaco = (preciso: number) => {
    if (y - preciso >= MARGEM.fundo) return;
    pagina = pdf.addPage([A4.largura, A4.altura]);
    y = A4.altura - MARGEM.topo;
  };

  const seccao = (titulo: string) => {
    espaco(46);
    y -= 10;
    escrever(titulo.toUpperCase(), MARGEM.x, y, forte, 8.5, LATAO, 1.5);
    y -= 8;
    pagina.drawLine({
      start: { x: MARGEM.x, y },
      end: { x: A4.largura - MARGEM.x, y },
      thickness: 1,
      color: TINTA,
    });
    y -= 14;
  };

  const linha = (chave: string, valor: string | null | undefined) => {
    if (valor === null || valor === undefined || valor === "") return;

    const larguraValor = A4.largura - MARGEM.x * 2 - COLUNA_CHAVE;
    const linhas = quebrar(paraWinAnsi(valor), corpo, 9.5, larguraValor);

    espaco(linhas.length * 13 + 6);
    escrever(chave, MARGEM.x, y, corpo, 9.5, SUAVE);

    for (const [i, texto] of linhas.entries()) {
      escrever(texto, MARGEM.x + COLUNA_CHAVE, y - i * 12, corpo, 9.5);
    }

    y -= (linhas.length - 1) * 12 + 7;
    pagina.drawLine({
      start: { x: MARGEM.x, y },
      end: { x: A4.largura - MARGEM.x, y },
      thickness: 0.5,
      color: LINHA,
    });
    y -= 11;
  };

  /* ---------------------------------------------------------------- Header */
  escrever("LEXFLOW · DOSSIER DO PROCESSO", MARGEM.x, y, corpo, 8, LATAO, 2.0);
  y -= 22;

  const nomePrincipal =
    d.seccoes.identificacao?.nome ?? d.processo.nomeCliente ?? "Processo de Onboarding";
  escrever(nomePrincipal, MARGEM.x, y, serifa, 20);
  y -= 15;

  escrever(
    `${d.processo.tipoCliente === "empresa" ? "Pessoa Coletiva" : "Pessoa Singular"} · Ref. ${d.processo.referencia} · Estado: ${ESTADOS_PT[d.processo.estado] ?? d.processo.estado}`,
    MARGEM.x,
    y,
    corpo,
    9.5,
    SUAVE,
  );
  y -= 24;

  /* -------------------------------------------------------- 1. Processo */
  seccao("1. Dados do Processo");
  linha("Referência", d.processo.referencia);
  linha("Tipo de Cliente", d.processo.tipoCliente === "empresa" ? "Empresa / Coletivo" : "Particular / Singular");
  linha("Estado", ESTADOS_PT[d.processo.estado] ?? d.processo.estado);
  linha("Submetido em", dataHoraPt(d.processo.submetidoEm));
  linha("Atualizado em", dataHoraPt(d.processo.atualizadoEm));
  if (d.processo.responsavel) {
    linha("Responsável", d.processo.responsavel);
  }

  /* -------------------------------------------------- 2. Identificação */
  const ident = d.seccoes.identificacao;
  seccao("2. Identificação");
  linha("Nome Completo", ident?.nome ?? d.processo.nomeCliente);
  linha("Profissão", ident?.profissao);
  linha("Entidade Patronal", ident?.entidadePatronal);
  linha("Data de Nascimento", ident?.dataNascimento);
  linha("Nacionalidades", d.seccoes.nacionalidades.join(", ") || null);
  linha("Email", ident?.email ?? d.processo.emailCliente);
  linha("Telefone", ident?.telefone);
  if (ident?.morada) {
    const moradaComp = `${ident.morada}, ${ident.codigoPostal ?? ""} ${ident.localidade ?? ""} — ${ident.freguesia ?? ""}, ${ident.concelho ?? ""}, ${ident.distrito ?? ""}, ${ident.pais ?? "Portugal"}`;
    linha("Morada", moradaComp);
  }

  /* ------------------------------------------------------- 3. Fiscais */
  const fisc = d.seccoes.fiscais;
  if (fisc) {
    seccao("3. Dados Fiscais");
    linha("NIF / NIPC", fisc.nif);
    linha("NIF Português", fisc.nifPortugues ? "Sim" : "Não");
    linha("Reside em Portugal", fisc.resideEmPortugal ? "Sim" : "Não");
    linha("Documento Tipo", fisc.docTipo ? fisc.docTipo.replace("_", " ") : null);
    linha("Documento Número", fisc.docNumero);
    linha("Validade", fisc.docValidade);
    linha("CAE", fisc.cae);
    linha("Certidão Permanente", fisc.codigoCertidaoPermanente);
  }

  /* ------------------------------------------------ 4. Representante */
  const rep = d.seccoes.representante;
  if (d.processo.tipoCliente === "empresa" && rep) {
    seccao("4. Representante Legal");
    linha("É o Representante", rep.eRepresentante ? "Sim" : "Não");
    if (!rep.eRepresentante) {
      linha("Cargo / Relação", rep.relacao);
      linha("Nome", rep.nome);
      linha("Data de Nascimento", rep.dataNascimento);
      linha("Nacionalidades", d.seccoes.nacionalidadesRepresentante.join(", ") || null);
      linha("Profissão", rep.profissao);
      linha("Email", rep.email);
      linha("Telefone", rep.telefone);
      if (rep.morada) {
        const moradaRep = `${rep.morada}, ${rep.codigoPostal ?? ""} ${rep.localidade ?? ""} — ${rep.freguesia ?? ""}, ${rep.concelho ?? ""}, ${rep.distrito ?? ""}, ${rep.pais ?? "Portugal"}`;
        linha("Morada", moradaRep);
      }
    }
  }

  /* ------------------------------------------------ 5. PPE e Negócio */
  const ppe = d.seccoes.ppe;
  const neg = d.seccoes.negocio;
  if (ppe || neg) {
    seccao("5. Declaração PPE e Relação de Negócio");
    if (ppe) {
      linha("Pessoa Politicamente Exposta", ppe.ePpe ? "Sim" : "Não");
      linha("Cargo PPE", ppe.ppeCargo);
      linha("Entidade PPE", ppe.ppeEntidade);
      linha("País PPE", ppe.ppePais);
      linha(
        "Período Exercício",
        ppe.ppeInicio ? (ppe.ppeFim ? `${ppe.ppeInicio} a ${ppe.ppeFim}` : `desde ${ppe.ppeInicio}`) : null,
      );
      linha("Familiar / Próximo de PPE", ppe.eRelacionadoPpe ? "Sim" : "Não");
      linha("Relação com PPE", ppe.relacaoPpe);
      linha("Nome da PPE Relacionada", ppe.ppeRelacionadaNome);
    }
    if (neg) {
      linha("Serviços Contratados", neg.servicos);
      linha("Origem dos Fundos", neg.origemFundos);
    }
  }

  /* ----------------------------------------------------- 6. Faturação */
  const fat = d.seccoes.faturacao;
  if (fat) {
    seccao("6. Faturação");
    linha("Nome / Empresa", fat.nome);
    linha("NIF", fat.nif);
    linha("Email", fat.email);
    linha("Ao Cuidado de", fat.acNome);
    if (fat.morada) {
      const moradaFat = `${fat.morada}, ${fat.codigoPostal ?? ""} ${fat.localidade ?? ""} — ${fat.freguesia ?? ""}, ${fat.concelho ?? ""}, ${fat.distrito ?? ""}, ${fat.pais ?? "Portugal"}`;
      linha("Morada de Faturação", moradaFat);
    }
  }

  /* ------------------------------------------------- 7. Preferências */
  const pref = d.seccoes.preferencias;
  if (pref) {
    seccao("7. RGPD e Preferências");
    linha("Origem do Contacto", pref.origemContacto);
    linha("Detalhe da Origem", pref.origemDetalhe);
    linha("Newsletter", pref.newsletter ? "Autorizada" : "Não autorizada");
    linha("Emails Newsletter", d.seccoes.emailsNewsletter.join(", ") || null);
    linha("Áreas de Interesse", d.seccoes.areasInteresse.join(", ") || null);
    linha("Convites para Eventos", pref.convitesIniciativas ? "Autorizados" : "Não autorizados");
  }

  /* ------------------------------------------------- 8. Termos e Assinatura */
  const fecho = d.seccoes.fecho;
  const ass = d.assinatura;
  if (fecho || ass) {
    seccao("8. Termos, Condições e Assinatura");
    linha("Termos e Condições", fecho?.tcAceitacao ? "Aceites" : "Por aceitar");
    linha("Declaração de Veracidade", fecho?.declaracaoVeracidade ? "Aceite" : "Por aceitar");
    linha("Data de Assinatura", ass?.assinadoEm ? dataHoraPt(ass.assinadoEm) : "Sem registo de assinatura");
    if (d.proposta) {
      linha("Proposta Comercial", `${d.proposta.nome} (${kb(d.proposta.bytes)})`);
    }
  }

  /* ------------------------------------------------- 9. Anexos e Documentos */
  seccao("9. Documentos e Anexos");
  if (d.documentos.length === 0) {
    linha("Anexos", "Nenhum documento anexado.");
  } else {
    for (const doc of d.documentos) {
      linha(TIPO_DOC_PT[doc.tipo] ?? doc.tipo, `${doc.nome} · ${kb(doc.bytes)}`);
    }
  }

  /* ---------------------------------------------------------------- Footer */
  espaco(40);
  y -= 10;
  pagina.drawLine({
    start: { x: MARGEM.x, y },
    end: { x: A4.largura - MARGEM.x, y },
    thickness: 0.5,
    color: LINHA,
  });
  y -= 12;
  escrever(
    `Dossier emitido em ${dataPt(geradoEm)} · LexFlow · Documento confidencial · ${d.processo.referencia}`,
    MARGEM.x,
    y,
    corpo,
    8,
    RODAPE,
  );

  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
