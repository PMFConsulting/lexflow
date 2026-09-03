/**
 * Documentos legais da plataforma: Política de Privacidade e Termos de
 * Utilização.
 *
 * São os documentos do software LexFlow enquanto responsável pelo tratamento
 * dos dados que recolhe diretamente — as sociedades que se registam, as
 * pessoas que as administram e a equipa de cada sociedade. São estes que o
 * passo final do registo da sociedade liga ao consentimento obrigatório, e é
 * por isso que cada documento tem uma versão: o consentimento gravado aponta
 * para a versão (D3) — mudar o texto sem subir a versão apagaria a diferença
 * entre o que a pessoa viu e o que passou a estar escrito.
 *
 * Texto-âncora, não redação final: os elementos de identificação da entidade
 * responsável estão por preencher de propósito (não se inventam dados de
 * empresas reais). Antes de produção, a entidade que opera a plataforma
 * substitui os marcadores e confirma a redação com o seu jurista.
 *
 * Distinto de `lib/termos.ts`: esse é o articulado de prestação de serviços
 * jurídicos da **sociedade** para com os **seus** clientes (e o texto de
 * demonstração que o substitui). Aqui o papel é o inverso — o titular é a
 * sociedade/equipa e o responsável é a plataforma.
 */

export const VERSAO_POLITICA_PRIVACIDADE = "2026.09.1";
export const VERSAO_TERMOS_UTILIZACAO = "2026.09.1";

/**
 * Marcadores a substituir pela entidade que opera a plataforma antes da
 * entrada em produção. Centralizados para a mesma designação não divergir
 * entre a política, os termos, o passo de consentimento e o contacto.
 */
export const ENTIDADE_PLACEHOLDER =
  "[designação social, NIPC, sede e contactos da entidade que opera a plataforma — a preencher]";
export const CONTACTO_PRIVACIDADE =
  "[endereço de email e morada para exercício de direitos e questões de privacidade — a preencher]";

export type SeccaoDocumento = {
  titulo: string;
  paragrafos: string[];
};

export const POLITICA_PRIVACIDADE: SeccaoDocumento[] = [
  {
    titulo: "1. Quem trata os dados",
    paragrafos: [
      `A plataforma LexFlow é uma aplicação de gestão de processos e de sociedades de advogados. O responsável pelo tratamento dos dados recolhidos diretamente pela plataforma é ${ENTIDADE_PLACEHOLDER} (adiante, «LexFlow» ou «nós»).`,
      "Esta política aplica-se aos dados pessoais das sociedades que se registam na plataforma, das pessoas que as representam ou administram e das pessoas que integram a equipa de cada sociedade. A plataforma trata ainda, por conta das sociedades, os dados pessoais dos clientes finais dos serviços jurídicos; quanto a esses dados, a sociedade é responsável pelo tratamento e a LexFlow atua como subcontratante, nos termos do contrato celebrado com a sociedade.",
    ],
  },
  {
    titulo: "2. Que dados tratamos e de quem",
    paragrafos: [
      "No registo e na utilização da plataforma tratamos os seguintes dados pessoais:",
      "· identificação e contactos da sociedade — denominação, NIPC, forma jurídica, número de inscrição na Ordem dos Advogados, morada da sede, email, telefone e website;",
      "· dados das pessoas que representam e administram a sociedade — nome, cargo, email, telefone e documento de identificação, quando necessário ao convite e à criação da conta;",
      "· dados da equipa de cada sociedade — nome, data de nascimento, NIF, documento de identificação, cédula profissional e contactos, recolhidos no registo de cada pessoa e nas definições da conta;",
      "· documentos carregados pelas sociedades e pelas suas pessoas — certidões, articulados de termos e condições, comprovativos e demais ficheiros necessários à operação;",
      "· dados de utilização e de ligação — registos de auditoria das ações na plataforma, com data, endereço IP e informação do navegador, e registo dos emails enviados pela plataforma.",
      "Não tratamos dados sensíveis (categorias especiais, artigo 9.º do RGPD) exceto os que as sociedades carregam no âmbito da sua atividade, sob a sua responsabilidade, e os que a lei imponha recolher no cumprimento de deveres de diligência devida.",
    ],
  },
  {
    titulo: "3. Finalidades e fundamentos de licitude",
    paragrafos: [
      "Tratamos os dados para as seguintes finalidades e com os seguintes fundamentos:",
      "· execução do contrato e diligências pré-contratuais — criar e operar a conta da sociedade, gerir processos, convites, acessos e comunicações necessárias ao funcionamento do serviço (artigo 6.º, n.º 1, alínea b) do RGPD);",
      "· cumprimento de obrigações jurídicas a que a LexFlow está sujeita — conservação de registos e deveres de prevenção do branqueamento de capitais quando aplicáveis à plataforma (artigo 6.º, n.º 1, alínea c) do RGPD);",
      "· interesses legítimos — segurança da informação, prevenção de fraudes e abusos, manutenção e melhoria do serviço (artigo 6.º, n.º 1, alínea f) do RGPD);",
      "· consentimento — comunicações informativas e demais finalidades em que a plataforma peça uma autorização separada e livre (artigo 6.º, n.º 1, alínea a) do RGPD). O consentimento pode ser retirado a qualquer momento, sem que isso afete a licitude do tratamento já realizado.",
      "O consentimento prestado no momento do registo da sociedade respeita ao tratamento necessário à criação e à gestão da conta, sendo os documentos correspondentes indicados ao titular e a concessão gravada com data e versão.",
    ],
  },
  {
    titulo: "4. Conservação dos dados",
    paragrafos: [
      "Os dados são conservados apenas durante o período necessário às finalidades que os justificam:",
      "· enquanto durar a relação contratual com a sociedade e, depois, pelo prazo legal aplicável ou pelo prazo razoável para defesa de direitos;",
      "· os documentos e registos sujeitos à legislação de prevenção do branqueamento de capitais são conservados durante sete anos após o termo da relação, por imposição legal; os documentos armazenados em S3 estão sujeitos a uma política de ciclo de vida que os elimina automaticamente no termo desse prazo;",
      "· os registos de auditoria são imutáveis por construção e conservados como prova do funcionamento do sistema;",
      "· findo o prazo aplicável, os dados são eliminados ou anonimizados de forma irreversível.",
    ],
  },
  {
    titulo: "5. Partilha e subcontratantes",
    paragrafos: [
      "Não vendemos nem alugamos dados pessoais. Partilhamos dados apenas:",
      "· com subcontratantes que prestam serviços essenciais à operação da plataforma, no estrito âmbito das instruções da LexFlow e com garantias contratuais de proteção de dados:",
      "— Amazon Web Services (AWS), serviço S3 — armazenamento de documentos carregados pelas sociedades e pelas suas pessoas;",
      "— Resend — envio de correio eletrónico transacional (convites, notificações e comunicações de serviço);",
      "· com autoridades públicas quando a lei o exija.",
      "Sempre que os subcontratantes impliquem transferências internacionais de dados para fora do Espaço Económico Europeu, são aplicadas as garantias previstas nos artigos 44.º a 49.º do RGPD, designadamente cláusulas contratuais-tipo. A lista de subcontratantes é atualizada nesta política sempre que mude.",
    ],
  },
  {
    titulo: "6. Direitos do titular (artigos 15.º a 22.º do RGPD)",
    paragrafos: [
      "O titular dos dados tem o direito de:",
      "· aceder aos seus dados pessoais e obter uma cópia (artigo 15.º);",
      "· retificar dados inexatos ou incompletos (artigo 16.º);",
      "· obter o apagamento dos seus dados (artigo 17.º), nos limites das obrigações legais de conservação — designadamente os sete anos da legislação de prevenção do branqueamento de capitais, que prevalecem sobre o apagamento;",
      "· obter a limitação do tratamento (artigo 18.º);",
      "· opor-se ao tratamento fundado em interesse legítimo (artigo 21.º);",
      "· receber os dados que forneceu num formato estruturado, de uso corrente e leitura automática, e transmiti-los a outro responsável (portabilidade, artigo 20.º);",
      "· não ficar sujeito a decisões exclusivamente automatizadas que produzam efeitos jurídicos (artigo 22.º);",
      "· retirar o consentimento a qualquer momento, quando o tratamento nele se fundamente (artigo 7.º).",
      `Para exercer estes direitos, contacte-nos através de ${CONTACTO_PRIVACIDADE}. Responderemos no prazo de um mês, prorrogável por mais dois quando a complexidade do pedido o justifique, com a devida comunicação.`,
      "Sem prejuízo de qualquer outra via de recurso, o titular pode apresentar reclamação à autoridade de controlo competente — em Portugal, a Comissão Nacional de Proteção de Dados (CNPD).",
    ],
  },
  {
    titulo: "7. Segurança",
    paragrafos: [
      "Aplicamos medidas técnicas e organizativas adequadas ao risco: comunicações cifradas, palavras-passe guardadas com derivados criptográficos fortes, controlo de acesso por perfis e funções, registo de auditoria imutável das ações na plataforma e acesso aos documentos restrito a quem deles necessite no exercício das suas funções.",
    ],
  },
  {
    titulo: "8. Alterações a esta política",
    paragrafos: [
      "Quando esta política mudar de forma material, a versão é atualizada e a nova versão é publicada nesta página com a respetiva data. Sempre que a alteração dependa de consentimento, o consentimento é pedido de novo contra a versão nova.",
    ],
  },
  {
    titulo: "9. Contacto",
    paragrafos: [
      `Para qualquer questão sobre o tratamento de dados ou sobre o exercício de direitos, contacte ${CONTACTO_PRIVACIDADE}.`,
    ],
  },
];

export const TERMOS_UTILIZACAO: SeccaoDocumento[] = [
  {
    titulo: "1. Objeto",
    paragrafos: [
      "Os presentes Termos de Utilização regulam o acesso e a utilização da plataforma LexFlow (adiante, «plataforma»), uma aplicação de gestão de processos e de sociedades de advogados, disponibilizada em regime de subscrição (software como serviço) pela entidade que a opera — designação e contactos em [a preencher], tal como na Política de Privacidade.",
      "Ao registar uma sociedade na plataforma, o utilizador declara que representa a sociedade e que tem poderes para a vincular nos termos destes Termos.",
    ],
  },
  {
    titulo: "2. Conta e acesso",
    paragrafos: [
      "O acesso à plataforma faz-se com conta individual criada a partir de um convite. Cada utilizador é responsável por manter a confidencialidade das suas credenciais e por todas as atividades realizadas na sua conta.",
      "A sociedade deve manter atualizados os elementos de identificação e contacto que forneceu e comunicar de imediato qualquer utilização não autorizada da conta.",
      "A criação de contas é feita pela própria plataforma ou pelos administradores da sociedade; não existe registo público aberto.",
    ],
  },
  {
    titulo: "3. Utilização da plataforma",
    paragrafos: [
      "A plataforma destina-se à gestão da atividade profissional de sociedades de advogados e dos respetivos processos. O utilizador compromete-se a utilizá-la de forma lícita e de acordo com a sua finalidade, abstendo-se de:",
      "· tentar aceder a contas, processos ou dados de outras sociedades ou de terceiros;",
      "· perturbar, sobrecarregar ou comprometer o funcionamento da plataforma;",
      "· carregar conteúdos ilícitos ou que violem direitos de terceiros;",
      "· contornar mecanismos de segurança, autenticação ou controlo de acesso.",
    ],
  },
  {
    titulo: "4. Dados pessoais",
    paragrafos: [
      "O tratamento de dados pessoais no âmbito da utilização da plataforma rege-se pela Política de Privacidade, que faz parte integrante destes Termos. Os clientes finais dos serviços jurídicos são titulares de dados cujo tratamento é da responsabilidade da sociedade; a plataforma trata esses dados exclusivamente por conta e sob instrução da sociedade.",
    ],
  },
  {
    titulo: "5. Obrigações da sociedade",
    paragrafos: [
      "A sociedade é responsável pela licitude do tratamento de dados que realiza através da plataforma, designadamente pela existência de fundamento para o tratamento dos dados dos seus clientes, pela informação prestada aos titulares e pelo cumprimento das obrigações legais a que esteja sujeita, incluindo as de prevenção do branqueamento de capitais.",
    ],
  },
  {
    titulo: "6. Propriedade intelectual",
    paragrafos: [
      "A plataforma, o seu código, textos, logótipos e demais elementos distintivos são propriedade da entidade que a opera ou de terceiros licenciantes. Os conteúdos carregados pelas sociedades — documentos, articulados e demais ficheiros — pertencem a quem os carregou, que concede à plataforma os direitos estritamente necessários à prestação do serviço.",
    ],
  },
  {
    titulo: "7. Disponibilidade e responsabilidade",
    paragrafos: [
      "A plataforma é disponibilizada «tal como está», com a diligência razoável de um prestador profissional. Não é garantida a indisponibilidade zero, designadamente por manutenções programadas, falhas de rede ou de fornecedores terceiros.",
      "A plataforma não é responsável pelos atos ou omissões das sociedades utilizadoras perante os seus clientes, nem pelo conteúdo dos documentos que as sociedades carreguem. A responsabilidade da plataforma em relação a cada sociedade limita-se, em qualquer caso, ao valor das subscrições pagas nos doze meses anteriores ao facto gerador, salvo dolo ou culpa grave.",
    ],
  },
  {
    titulo: "8. Suspensão e cessação",
    paragrafos: [
      "A plataforma pode suspender ou encerrar o acesso de uma sociedade que viole estes Termos ou a lei, mediante aviso prévio sempre que possível.",
      "A sociedade pode cessar a utilização a qualquer momento, pedindo o encerramento da conta ao seu contacto na plataforma. A cessação não elimina os deveres de conservação legal dos dados nem os registos de auditoria já produzidos.",
    ],
  },
  {
    titulo: "9. Alterações aos Termos",
    paragrafos: [
      "Estes Termos podem ser alterados sempre que a plataforma evolua ou a lei o exija. A versão nova é publicada nesta página com a respetiva data e, quando a alteração afete materialmente as condições de utilização, os utilizadores são notificados. A continuação da utilização após a entrada em vigor da versão nova implica a sua aceitação.",
    ],
  },
  {
    titulo: "10. Lei aplicável e foro",
    paragrafos: [
      "Estes Termos regem-se pela lei portuguesa. Para qualquer litígio emergente da sua utilização é competente o foro da comarca da sede da entidade que opera a plataforma, com expressa renúncia a qualquer outro, sem prejuízo das normas imperativas aplicáveis à proteção do consumidor quando o utilizador seja consumidor.",
    ],
  },
  {
    titulo: "11. Contacto",
    paragrafos: [
      "Questões sobre estes Termos ou sobre a plataforma: [contacto de apoio e jurídico — a preencher], tal como identificado na Política de Privacidade.",
    ],
  },
];
