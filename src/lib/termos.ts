/**
 * Terms and Conditions for the provision of legal services. Single source for
 * the three places it appears: the step 7 reader (D30 measures reading to the
 * end), `/termos-condicoes`, and the PDF in the welcome email — duplicating
 * the text would let them diverge, and in a consent the text is the evidence.
 *
 * Demonstration text, written for the POC from legal requirements; the firm's
 * definitive wording replaces it here. Bump `VERSAO_TERMOS` whenever the text
 * changes — it's what `versao_texto_legal` records alongside consent, and
 * without it there's no way to tell what the client actually accepted.
 *
 * Fallback only, not the contract: once the firm delivers its own wording,
 * `termosEmVigor` (D59) serves that instead, everywhere. This platform text is
 * what's served meanwhile — the firm is contracting with the client, and
 * `/admin` says so on screen while no firm wording is published. See
 * `docs/TERMOS_SOCIEDADE.md`.
 */

export const VERSAO_TERMOS = "2026.08-poc";

export type SeccaoTermos = {
  titulo: string;
  paragrafos: string[];
};

export const TERMOS_CONDICOES: SeccaoTermos[] = [
  {
    titulo: "1. Objeto",
    paragrafos: [
      "As presentes condições regulam a prestação de serviços jurídicos pela sociedade aderente (adiante, a Sociedade), através da plataforma LexFlow ao cliente identificado no processo de onboarding a que este documento diz respeito.",
      "Os serviços concretos a prestar são os indicados pelo cliente no passo relativo à relação de negócio e os que venham a ser acordados por escrito entre as partes, incluindo por correio eletrónico.",
      "A aceitação destas condições não constitui, por si só, aceitação de mandato: a Sociedade reserva-se o direito de recusar a constituição da relação quando as diligências de identificação e de diligência devida não puderem ser concluídas.",
    ],
  },
  {
    titulo: "2. Honorários e despesas",
    paragrafos: [
      "Os honorários são os constantes da proposta apresentada ao cliente, que faz parte integrante destas condições. Salvo indicação em contrário, os valores não incluem IVA à taxa legal em vigor.",
      "São da responsabilidade do cliente as despesas necessárias à execução do mandato, nomeadamente taxas de justiça, emolumentos, custos de registo, certidões, traduções e deslocações, quando previamente comunicadas.",
      "A faturação é emitida para os dados indicados pelo cliente no passo de faturação. O prazo de pagamento é de 30 dias a contar da data de emissão, salvo condições diferentes acordadas por escrito.",
    ],
  },
  {
    titulo: "3. Identificação do cliente e prevenção do branqueamento de capitais",
    paragrafos: [
      "A Sociedade está sujeita aos deveres de identificação, diligência e comunicação previstos na Lei n.º 83/2017, de 18 de agosto, e no Regulamento n.º 2/2020 da Ordem dos Advogados.",
      "O cliente obriga-se a prestar informação verdadeira, completa e atualizada, e a comunicar à Sociedade qualquer alteração aos elementos de identificação, à qualidade de pessoa politicamente exposta ou à origem dos fundos, no prazo de 30 dias a contar da alteração.",
      "A recusa em prestar os elementos exigidos, ou a impossibilidade de os confirmar, determina a não constituição ou a cessação da relação de negócio, nos termos legalmente previstos.",
      "A Sociedade não pode informar o cliente sobre eventuais comunicações efetuadas às autoridades competentes ao abrigo daquele regime, por lhe estar vedado por lei.",
    ],
  },
  {
    titulo: "4. Sigilo profissional",
    paragrafos: [
      "Toda a informação transmitida à Sociedade está abrangida pelo segredo profissional do advogado, nos termos do Estatuto da Ordem dos Advogados, e não é divulgada a terceiros sem consentimento do cliente, salvo quando a lei o imponha.",
      "O dever de sigilo mantém-se após o termo da relação de negócio, sem limite de prazo.",
    ],
  },
  {
    titulo: "5. Proteção de dados pessoais",
    paragrafos: [
      "Os dados pessoais recolhidos são tratados pela Sociedade, na qualidade de responsável pelo tratamento, para a execução do contrato de prestação de serviços jurídicos e para o cumprimento de obrigações legais a que a Sociedade está sujeita — designadamente as decorrentes da Lei n.º 83/2017.",
      "Estes dois fundamentos não dependem de consentimento e não podem ser revogados enquanto durar a relação ou o prazo de conservação legal.",
      "Dependem de consentimento, e só desses, o envio de newsletter e os convites para iniciativas. O consentimento é livre, pode ser retirado a qualquer momento, e a sua retirada não afeta a licitude do tratamento feito até aí nem a prestação do serviço jurídico contratado.",
      "Os dados são conservados durante sete anos após o termo da relação de negócio, prazo imposto pela legislação de prevenção do branqueamento de capitais. Findo esse prazo, são eliminados ou anonimizados.",
      "O cliente pode exercer os direitos de acesso, retificação, apagamento, limitação, portabilidade e oposição, e apresentar reclamação junto da Comissão Nacional de Proteção de Dados. O apagamento não abrange os dados cuja conservação a lei imponha.",
    ],
  },
  {
    titulo: "6. Registo do processo e assinatura",
    paragrafos: [
      "O preenchimento do processo de onboarding fica registado, incluindo a data e a hora de cada passo gravado, num registo de auditoria não alterável.",
      "A rubrica aposta no último passo vale como assinatura eletrónica simples e é associada a um resumo criptográfico do conteúdo submetido, de forma a permitir demonstrar que o que foi assinado é o que aqui consta.",
      "O cliente declara que os dados prestados são verdadeiros e que tomou conhecimento integral destas condições antes de as aceitar.",
    ],
  },
  {
    titulo: "7. Comunicações",
    paragrafos: [
      "As comunicações entre as partes são feitas para os contactos indicados no processo de onboarding. O cliente obriga-se a manter atualizado o endereço de correio eletrónico indicado.",
      "As comunicações por correio eletrónico consideram-se recebidas no dia útil seguinte ao do envio, salvo prova em contrário.",
    ],
  },
  {
    titulo: "8. Cessação",
    paragrafos: [
      "Qualquer das partes pode fazer cessar a relação, por escrito, sem prejuízo dos honorários e despesas devidos pelos serviços já prestados e dos deveres deontológicos do advogado quanto à salvaguarda dos interesses do cliente.",
      "A cessação não prejudica os deveres de conservação de documentos e de sigilo que subsistam por imposição legal.",
    ],
  },
  {
    titulo: "9. Lei aplicável e foro",
    paragrafos: [
      "Estas condições regem-se pela lei portuguesa.",
      "Para a resolução de qualquer litígio é competente o foro da comarca da sede da Sociedade, com expressa renúncia a qualquer outro, sem prejuízo do recurso aos meios de resolução alternativa de litígios legalmente previstos.",
      "Chegou ao fim do documento. Pode agora fechar e aceitar os Termos e Condições.",
    ],
  },
];

/** Abridged version for inclusion in the body of the emails. */
export const TERMOS_CONDICOES_EMAIL = `
<h2 style="font-size:15px;margin:24px 0 8px;color:#101a24;">Termos e Condições</h2>
<p style="font-size:13px;line-height:1.6;color:#333;margin:0 0 8px;">
  Ao submeter o processo, confirmou que leu e aceitou os Termos e Condições do serviço,
  incluindo:
</p>
<ul style="font-size:13px;line-height:1.7;color:#333;margin:0 0 8px;padding-left:18px;">
  <li>Os dados fornecidos serão tratados para a prestação do serviço jurídico contratado e
  para o cumprimento de obrigações legais (nomeadamente prevenção de branqueamento de
  capitais e financiamento do terrorismo — Lei 83/2017).</li>
  <li>Os dados são conservados pelo período legalmente exigido (7 anos) e tratados com
  confidencialidade.</li>
  <li>Declarou que as informações prestadas são verdadeiras e assumiu a responsabilidade
  pela sua atualização.</li>
  <li>O processo fica sujeito a revisão pela equipa antes do início da prestação do
  serviço.</li>
</ul>
<p style="font-size:13px;line-height:1.6;color:#333;margin:0;">
  Pode exercer os seus direitos de acesso, retificação, apagamento, limitação e oposição
  nos termos do RGPD, contactando a nossa equipa.
</p>
`;
