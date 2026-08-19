# Avaliação de conformidade jurídica — POC JMASSANO

Análise do código feita pelo Opus 5 (leitura direta do repositório, 19/08/2026).
Cada afirmação tem caminho de ficheiro. Fonte: `src/` (features, db/schema, lib, app).

---

## 1. RGPD (Reg. 2016/679)

**✅ Existe**
- Consentimentos granulares e com prova: `consentimento` (FK para `versao_texto_legal`, `aceite`, `aceite_em`, `ip`, `user_agent`, `revogado_em`) — `src/db/schema/legal.ts:42`. Texto versionado e imutável com hash SHA-256 — `legal.ts:22`.
- Newsletter e convites são consentimentos separados, com textos distintos e duas gravações independentes — `src/features/onboarding/consentimentos.ts:26-37` e `src/features/onboarding/acoes.ts:382,390`. Enum `finalidade_consentimento` exclui deliberadamente prestação do serviço e obrigação legal — `src/db/schema/enums.ts:73`.
- Revogação modela-se sem apagar histórico — `consentimentos.ts:141-168`.
- Procura do texto por chave e versão (D38) — `consentimentos.ts:58`.
- Cabeçalhos de segurança (HSTS, nosniff, X-Frame-Options, Referrer-Policy) — `next.config.ts:23`.
- Cookies: só os estritamente necessários (sessão Better Auth + `sidebar_state`, `src/components/ui/sidebar.tsx:27`). Não há tracking → banner não é exigível.

**❌ Falta**
- Aceitação dos T&C e da proposta não gera linha em `consentimento`. São booleanos em `fecho_proposta.tc_aceitacao` / `proposta_aceitacao` (`src/db/schema/seccoes.ts:264`). O enum tem `termos_condicoes` e `proposta`, mas o mapa `TEXTOS` em `consentimentos.ts:25` não os inclui → nunca são escritos, e `VERSAO_TERMOS` (`src/lib/termos.ts:18`) não é gravada em parte nenhuma da BD. Não se consegue provar que articulado o cliente aceitou. Módulo: `consentimentos.ts` + `acoes.ts` case 7.
- Nenhuma política de privacidade / informação do art. 13.º apresentada antes da recolha. Não existe `/politica-privacidade`; o único texto é a cláusula 5 dos T&C (`termos.ts:59`), mostrada no passo 7, depois de todos os dados recolhidos.
- Nenhuma via de exercício de direitos. Sem rota, acção ou script de acesso, retificação, apagamento, limitação, oposição ou portabilidade. O cliente também não tem forma de retirar o consentimento da newsletter depois de submeter (o link mágico expira aos 30 dias — `src/features/processos/acoes.ts:133`).
- Retenção de 7 anos não implementada. `softDelete()` apenas esconde (`src/db/schema/_comum.ts:27`); não há coluna de "termo da relação de negócio", nem job/cron, nem script de expurgo ou anonimização. Os T&C prometem eliminação aos 7 anos (`termos.ts:64`) — promessa hoje sem execução.
- Sem ROPA (art. 30.º) e sem AIPD/DPIA (art. 35.º). `docs/` não tem nenhum dos dois.
- Sem encarregado de proteção de dados nem contacto de privacidade: `organizacao` tem só nome, NIF e prefixo (`src/db/schema/organizacao.ts:14`).
- Subcontratantes sem contrato art. 28.º nem análise de transferência: canais `resend` / `brevo` / `mailjet` / `smtp` (`enums.ts:132`); o Resend é entidade norte-americana e recebe nome + email de clientes.
- Minimização: `email_log` (migração `0008`) guarda destinatários sem prazo de purga definido.

**Prioridade: Alta** (política de privacidade, direitos, consentimento dos T&C, retenção) · **Esforço: 8–11 dias**

---

## 2. Lei 83/2017 (branqueamento de capitais)

**✅ Existe**
- Declaração PPE completa, incluindo PPE relacionada e família próxima — `src/db/schema/seccoes.ts:164`; passo 4 obrigatório (`src/features/onboarding/passos.ts:36`).
- Origem de fundos e serviços contratados, obrigatórios sempre — `seccoes.ts:186`.
- Identificação com documento (tipo, número, validade), NIF com mod-11 — `seccoes.ts:68`, `src/lib/validacao-pt.ts`.
- Motor de risco com PPE a forçar risco elevado, e reposição auditada (`risco.elevado` / `risco.reposto`, `acoes.ts:314,331`).
- Representante legal obrigatório para pessoa coletiva — `passos.ts:83`.
- Auditoria imutável como suporte do dever de conservação.

**❌ Falta**
- Beneficiário efetivo sem UI. A tabela existe (`seccoes.ts:147`) e o campo `codigoRcbe` também (`seccoes.ts:135`), mas nenhum componente os escreve — `beneficiario` só aparece em `db/schema`. Para pessoas coletivas é incumprimento direto do dever de identificação (art. 23.º e 30.º).
- Sem verificação da identificação — o sistema recolhe o documento mas não valida contra fonte independente (certidão permanente, RCBE, listas de sanções/PPE). O dever é de identificação e comprovação (art. 24.º).
- Sem registo de comunicação de operações suspeitas (art. 43.º-45.º): nenhuma tabela, acção ou ecrã. Também não há registo de recusa de relação de negócio.
- Sem diligência contínua / atualização periódica (art. 27.º): há índice em `docValidade` e alerta previsto, mas nenhum mecanismo de revisão dos dados ao fim de N anos.
- Conservação de 7 anos: prevista em comentário, não executada.

**Prioridade: Alta** (beneficiário efetivo, comunicação de suspeitas) · **Esforço: 6–9 dias**

---

## 3. eIDAS (Reg. 910/2014) / assinatura

**✅ Existe**
- Assinatura eletrónica simples: rubrica PNG + SHA-256 do dossier em serialização canónica + IP + user-agent + relógio do servidor — `src/features/onboarding/acoes.ts:412-434`, tabela `assinatura` em `src/db/schema/documentos.ts:63`.
- Leitura obrigatória dos T&C antes de destrancar a caixa — `src/features/onboarding/componentes/LeitorTermos.tsx`.
- Cadeia de auditoria encadeada por hash, append-only por `REVOKE` + `RULE` (migração `0002`), verificável por `pnpm auditoria:verificar` (`scripts/verificar-auditoria.ts`).

**Avaliação jurídica.** A assinatura simples é admissível (art. 25.º/1 eIDAS: não pode ser recusada como prova só por ser eletrónica) e adequada para aceitação de T&C e de proposta de honorários — não há aqui forma legal escrita exigida. O valor probatório é livremente apreciado: em impugnação, o ónus é da sociedade. A cadeia de auditoria + hash do conteúdo é uma base sólida.

**❌ Falta**
- O hash não é selado no tempo. Sem carimbo temporal qualificado (RFC 3161 / TSA), a data provada é a do próprio sistema — e quem controla o servidor controla o relógio. Módulo: `lib/assinatura/timestamp.ts` novo, chamado em `acoes.ts` case 7.
- O `hashDocumento` não cobre o texto dos T&C nem a proposta — só as secções do dossier (`seccoes.ts` via `seccoesDoProcesso`). Alterar o articulado depois da assinatura não parte o hash.
- Para assinatura avançada/qualificada (necessária se um dia se assinar procuração ou contrato de mandato com forma legal): falta integração com a Chave Móvel Digital (AMA) ou um QTSP. O schema já está preparado para adaptador (comentário em `documentos.ts:58`).
- Não é entregue ao cliente um comprovativo autónomo da assinatura (o `summary.pdf` vai no email de boas-vindas, mas sem o hash nem os metadados da rubrica).

**Prioridade: Média** (Alta se houver documentos com forma legal) · **Esforço: 3 dias (timestamp + hash alargado); 8–12 dias (CMD/QTSP)**

---

## 4. Regulamento 2/2020 da OA

**✅ Existe**
- Papéis diferenciados com PPE invisível ao `assistente` — `src/lib/sessao.ts:43`, aplicado em `processos/page.tsx:41` e `processos/[id]/page.tsx:117`.
- Aprovação reservada a `admin`/`socio`/`advogado` — `sessao.ts:54`.
- Registo de auditoria conservável.

**❌ Falta**
- Sem responsável pelo cumprimento normativo designado no sistema (art. 12.º do Regulamento) — não há campo, papel nem ecrã.
- Sem relatório anual de atividade nem exportação agregada para a OA.
- Sem procedimentos escritos de aceitação de cliente materializados: o fluxo aprova/rejeita (`features/processos/acoes.ts:559,610`) mas não obriga a fundamentar a aceitação em risco elevado, nem exige aprovação de nível superior nesses casos (a `podeAprovarRiscoElevado` foi removida — D20).
- `ppe.consultado` nunca é emitido. Está documentado como exemplo em `src/db/schema/auditoria.ts:22` mas não existe no código — o acesso a dados sensíveis por quem pode vê-los não deixa rasto.

**Prioridade: Média-Alta** · **Esforço: 4–5 dias**

---

## 5. Estatuto da OA / deontologia

**✅ Existe**
- Cláusula de sigilo nos T&C — `src/lib/termos.ts:52`.
- Isolamento multi-tenant verificado nas consultas (a rota de download compara `organizacaoId` e devolve 404 indistinto — `src/app/(backoffice)/processos/[id]/documentos/[documentoId]/route.ts:70`).
- Download de documentos auditado (`documento.descarregado`, `route.ts:118`).
- AES-256-GCM em `src/lib/storage/cifra.ts`.

**❌ Falta — o ponto mais sério da secção**
- A cifra AES-256-GCM protege apenas as credenciais de ligação ao armazenamento, não os dados dos clientes. Os únicos consumidores de `cifrar`/`decifrar` são `lib/storage/index.ts:67` e `features/configuracao`. NIF, número de documento, morada, declaração de PPE e os próprios documentos de identificação em base64 (`documento.dados`, `src/db/schema/documentos.ts:41`) estão em claro no Postgres. Quem tiver acesso de leitura à base tem o arquivo inteiro de uma sociedade de advogados.
- Sem MFA. `src/lib/auth.ts` tem email+password apenas.
- Sessão de 30 dias (`auth.ts:44`) — contraria a D14, que decidiu 8 horas, e é longa demais para um sistema com dados sujeitos a sigilo.
- Sem RLS no Postgres (assumido no corte de âmbito) — os guards são só de aplicação.
- Sem verificação de conflitos de interesses: grep a `conflito` não devolve nada fora dos T&C. É dever deontológico prévio à aceitação (art. 99.º EOA).
- Publicidade: não avaliável no código — depende do conteúdo da newsletter, que o sistema não gere.

**Prioridade: Alta** (cifra em repouso, MFA, sessão) · **Esforço: 5–7 dias**

---

## 6. Documentos legais

**✅ Existe**
- T&C completos e versionados: objeto, honorários, AML, sigilo, RGPD, assinatura, comunicações, cessação, lei aplicável e foro — `src/lib/termos.ts:25-98`. Em três sítios da mesma fonte (leitor, `/termos-condicoes`, PDF anexo).
- Proposta de honorários com aceitação separada dos T&C — `seccoes.ts:276`, `schemas.ts` passo 7.
- Declaração de veracidade com prova de consentimento.

**❌ Falta**
- O articulado é texto de demonstração — declarado no próprio ficheiro (`termos.ts:10`). Nada disto entra em produção sem revisão e assunção pela sociedade.
- Política de privacidade autónoma: inexistente.
- Informações pré-contratuais e direito de livre resolução (DL 24/2014). O onboarding é celebrado à distância; se o cliente for consumidor, há dever de informação pré-contratual e 14 dias de livre resolução, com formulário próprio. Os T&C não mencionam nenhum dos dois — e a cláusula 9 impõe foro convencionado, que perante consumidor é nula (art. 74.º CPC / DL 446/85). Deve ser revisto por jurista.
- Sem termos de uso da plataforma distintos do contrato de mandato.
- O bloco resumido para email (`termos.ts:101`) afirma que o processo "fica sujeito a revisão pela equipa" — verdade hoje, mas descreve tratamento sem indicar base legal.

**Prioridade: Alta** (livre resolução + foro + política de privacidade) · **Esforço: 2 dias de implementação + revisão jurídica externa**

---

## 7. Categorias especiais (art. 9.º RGPD)

**Verificação campo a campo em `src/db/schema/seccoes.ts`:** nome, profissão, entidade patronal, data de nascimento, nacionalidade(s), morada, telefone, email, NIF, documento, PPE, origem de fundos, faturação, áreas de interesse. Nenhum campo pede dados de saúde, biometria, convicções religiosas, filiação sindical ou vida sexual. Nacionalidade não é categoria especial.

**❌ Riscos por confirmar**
- A declaração de PPE identifica cargos públicos/políticos. A qualidade de PPE decorre da função, mas o conjunto (cargo + entidade + país + período) pode revelar opinião política na aceção do art. 9.º/1. Base legal: art. 9.º/2 alínea g) (interesse público relevante, Lei 83/2017) — defensável, mas tem de estar escrita na ROPA e na política de privacidade. Hoje não está em lado nenhum.
- Upload livre. `tipo_documento` inclui `outro` (`enums.ts:45`) e o dropzone aceita qualquer PDF/imagem dentro dos formatos permitidos (`src/features/onboarding/formatos.ts`). Um cliente pode carregar um atestado médico ou um relatório clínico sem que nada o impeça ou sinalize. Falta um aviso no campo e uma regra de triagem.

**Prioridade: Média** · **Esforço: 1–2 dias**

---

## 8. Registos e arquivo

**✅ Existe**
- `evento_auditoria` append-only com cadeia de hashes por organização, imutável no Postgres (migração `0002`) e verificável (`scripts/verificar-auditoria.ts`).
- Documentos com `hash_sha256`, MIME, tamanho e validade — `documentos.ts:21`.
- Arquivo no servidor da sociedade por SFTP, com `summary.pdf` e `dados_cliente.pdf` por pasta (`src/lib/storage/`), com evento `armazenamento.sincronizado`.
- `softDelete()` aplicado nas tabelas com retenção legal.

**❌ Falta**
- Cópia do Cartão de Cidadão. `tipo_doc_id` inclui `cartao_cidadao` (`enums.ts:34`) e `tipo_documento` inclui `identificacao` — o sistema aceita e conserva a imagem do CC. O art. 5.º/2 da Lei 7/2007 proíbe a conservação e reprodução do Cartão de Cidadão salvo consentimento expresso do titular. Esse consentimento não existe no fluxo: não há finalidade no enum, não há caixa no passo 2, não há linha em `consentimento`. É a não-conformidade mais fácil de corrigir e a mais fácil de ser apanhada numa inspeção.
- Retenção de 7 anos sem execução: nem contagem a partir do termo da relação, nem expurgo, nem anonimização.
- Documentos em base64 na base de dados, com limite de 4 MB (`documentos.ts:41`) — assumido como compromisso de POC. Não aguenta um arquivo de 7 anos nem permite cifra por objeto.
- Sem verificação periódica automática da integridade da cadeia (o script existe, mas nada o corre).

**Prioridade: Alta** (consentimento CC, retenção) · **Esforço: 4–6 dias**

---

# TOP 10 ACÇÕES — por prioridade

| # | Acção | Módulo | Prio. | Dias |
|---|---|---|---|---|
| 1 | Consentimento expresso para conservação de cópia do Cartão de Cidadão (art. 5.º/2 Lei 7/2007): nova finalidade no enum, caixa no passo 2, linha em `consentimento`; sem ela, não aceitar upload de CC | `db/schema/enums.ts`, `onboarding/consentimentos.ts`, `onboarding/schemas.ts` (passo 2), `Anexos.tsx` | Alta | 2 |
| 2 | Gravar T&C e proposta como consentimentos a sério: acrescentar `termos_condicoes` e `proposta` ao mapa `TEXTOS`, semear `versao_texto_legal` com o articulado completo + `VERSAO_TERMOS`, e chamar `registarConsentimento` no case 7 | `onboarding/consentimentos.ts`, `onboarding/acoes.ts:400`, `lib/termos.ts` | Alta | 2 |
| 3 | Política de privacidade + informação do art. 13.º no início do fluxo (rota `/politica-privacidade`, ligação no passo 1, identificação do responsável e do contacto de privacidade) | novo `app/politica-privacidade/`, `onboarding/componentes/Formulario.tsx`, `db/schema/organizacao.ts` | Alta | 2 |
| 4 | Cifra em repouso dos dados pessoais e dos documentos — estender o `cifra.ts` que já existe a `documento.dados` e às colunas de identificação; a médio prazo, mover ficheiros para bucket privado com chave por objeto | `lib/storage/cifra.ts`, `db/schema/documentos.ts`, `onboarding/documentos.ts` | Alta | 4 |
| 5 | Beneficiário efetivo e RCBE no percurso Empresa — a tabela já existe, falta o passo e o schema Zod (dever legal, art. 30.º Lei 83/2017) | `onboarding/schemas.ts`, `onboarding/passos.ts`, `onboarding/componentes/` | Alta | 4 |
| 6 | Retenção de 7 anos executável: coluna de termo da relação de negócio, script `pnpm retencao:expurgar` (simulação + execução) e anonimização, com evento de auditoria por linha expurgada | `db/migrations/`, novo `scripts/expurgar.ts`, `features/auditoria/registar.ts` | Alta | 4 |
| 7 | Via de exercício dos direitos do titular: exportação do dossier em JSON+PDF (acesso e portabilidade), pedido de retificação e retirada de consentimento a partir de um link permanente do cliente; cada pedido auditado | novo `features/titular/`, `app/(cliente)/` | Alta | 4 |
| 8 | MFA (TOTP) + sessão de 8 horas — o plugin `twoFactor` do Better Auth mais uma tabela; corrigir `expiresIn` para bater com a D14 | `lib/auth.ts` | Alta | 2 |
| 9 | Revisão jurídica dos T&C com articulado definitivo da sociedade, incluindo direito de livre resolução de 14 dias (DL 24/2014), informações pré-contratuais e revisão da cláusula de foro perante consumidor. Subir `VERSAO_TERMOS` | `lib/termos.ts` (+ externo) | Alta | 2 + externo |
| 10 | ROPA e AIPD/DPIA documentadas, `ppe.consultado` emitido no acesso a dados sensíveis, e comunicação de operações suspeitas registada | `docs/RGPD-ROPA.md`, `docs/RGPD-DPIA.md`, `processos/[id]/page.tsx`, nova tabela `comunicacao_suspeita` | Média-Alta | 5 |

**Total estimado: ~31 dias de desenvolvimento**, mais revisão jurídica externa dos T&C, da política de privacidade e da AIPD.

---

## Notas de leitura

1. A arquitetura está bem posicionada — a auditoria imutável, o versionamento de textos legais e a separação de finalidades de consentimento são exatamente as peças caras de enxertar depois, e estão feitas. O que falta é sobretudo aplicação e superfície, não fundação.
2. Os itens 1, 2 e 5 são incumprimentos legais concretos e verificáveis, não melhorias — bloqueiam uso real.
3. O item 4 é o que mais preocupa numa sociedade de advogados: o risco não é regulatório mas de sigilo profissional — hoje, uma cópia da base de dados é o arquivo completo, em claro.
