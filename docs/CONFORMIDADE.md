# Conformidade — o mapa para a validação jurídica

Para cada obrigação, **onde é que ela é cumprida no código e na base de dados**, e o que
está por resolver. Escrito para ser lido por quem faz a revisão jurídica com o produto à
frente, e não como declaração de intenções.

O que este documento não é: uma afirmação de que a plataforma está conforme. É o
inventário do que existe e do que falta, e a segunda lista é tão importante como a
primeira. **O que está por confirmar está marcado ⚠ e não escondido.**

---

## 1. Identificação e diligência devida (Lei 83/2017)

| Obrigação | Onde | Estado |
|---|---|---|
| Identificação do cliente — pessoa singular e coletiva | passos 1 e 2 do registo, `dados_identificacao` e `dados_fiscais` | ✔ |
| Documento de identificação, com validade | passo 2; validade recusada se estiver no passado | ✔ |
| Comprovativo de NIF | anexo obrigatório do passo 2 (D56) | ✔ |
| Certidão permanente da entidade | anexo obrigatório do passo 2, percurso Empresa (D56) | ✔ |
| Representante legal de pessoa coletiva | passo 3, só para coletivas (D28) | ✔ |
| Declaração de PPE, cargo, país, entidade e mandato | passo 4, `declaracao_ppe` | ✔ |
| Pessoa relacionada com PPE | passo 4 | ✔ |
| Natureza e finalidade da relação de negócio | passo 4, `relacao_negocio` | ✔ |
| Origem dos fundos | passo 4 | ✔ |
| Classificação de risco | `nivel_risco`, calculado a cada gravação; PPE força risco elevado | ✔ calculado, **não mostrado** (D21) |
| **Beneficiários efetivos e RCBE** | tabela `beneficiario_efetivo` existe, **sem passo que a preencha** | ⚠ **em falta** |

**⚠ O ponto mais grave desta secção é o último.** A identificação do beneficiário
efetivo é obrigação legal da Lei 83/2017 para pessoas coletivas, e o formulário original
da sociedade não a tinha — está registado como ambiguidade A19 em `docs/CAMPOS.md`
desde a análise inicial. A tabela está no esquema; o que falta é a decisão jurídica
sobre o que exatamente recolher, e um passo que o faça. **Não é trabalho técnico
pendente: é uma decisão que precede o técnico.**

---

## 2. Consentimentos e prova (RGPD, artigos 6.º e 7.º)

O princípio que governa todo o desenho: **um consentimento sem o texto que foi mostrado
não prova nada.** Guardar um booleano prova que alguém carregou num sítio; o que a lei
obriga a poder demonstrar é *o que* essa pessoa viu.

| Peça | Onde | Nota |
|---|---|---|
| Texto legal versionado e imutável | `versao_texto_legal` (D3) | Cada consentimento aponta para uma linha desta tabela por FK |
| Consentimento com data, IP e user-agent | `consentimento` | Uma linha por consentimento |
| Retirada não apaga | `revogado_em` na linha antiga + linha nova com `aceite = false` | O histórico é a prova |
| Procura por **chave e versão** | `textoEmVigor` (D38) | Sem isto, mudar o texto no código não chegava a uma instalação a correr, e a pessoa consentia o articulado antigo enquanto o ecrã lhe mostrava o novo |
| Só o que é mesmo consentimento | `finalidade_consentimento` | Prestação do serviço e obrigação legal têm outra base legal; pedir consentimento para elas produziria um consentimento inválido |

### T&C do cliente

| Peça | Onde |
|---|---|
| Leitura até ao fim antes de poder aceitar | `LeitorTermos`, medição do próprio elemento (D30) |
| **Versão aceite, gravada com a aceitação** | `fecho_proposta.tc_versao` |
| Documento servido e registado | `/onboarding/[token]/termos`, evento `termos.abertos_pelo_cliente` |

**A medição de leitura perde-se quando o articulado é um PDF.** É o caso quando a
sociedade publica o dela: `X-Frame-Options: DENY` recusa até o próprio domínio, um
`<iframe>` daria um retângulo em branco, e medir o scroll de um PDF noutro separador não
é possível. Nesse caso a caixa destranca ao **abrir** o documento, e o ecrã diz que é
isso que está a acontecer. Fingir a medição era pior do que dizer que ali ela não
existe — a mesma decisão que a proposta comercial anexada já tinha obrigado a tomar
(D52). O evento `termos.abertos_pelo_cliente` fica como prova do lado da plataforma de
que o documento foi entregue, e com que versão.

### T&C da sociedade — quem os escreve e quem os aceita

Até agora o articulado que o cliente aceitava era **texto da plataforma**, o que é uma
inversão de papéis que não se sustenta: quem contrata com o cliente é a sociedade, e o
articulado que o vincula tem de ser o dela. Isso está resolvido:

| Peça | Onde |
|---|---|
| A sociedade entrega o articulado | passo 4 do registo da sociedade, e `/admin/sociedade` depois disso |
| Um documento vivo por sociedade | o anterior fica em soft delete — duas linhas vivas obrigariam a escolher uma por ordenação, e é assim que um cliente aceita o articulado errado |
| A versão **tem de mudar** quando o documento muda | recusado no servidor, com a versão em vigor na mensagem |
| Cada pessoa da equipa aceita-o | passo 5 do registo de utilizador |
| Prova da aceitação | `aceitacao_termos` — versão, data, IP, user-agent. **Nunca atualizada** |
| Quem ainda não aceitou a versão em vigor | `/admin/conformidade` |

⚠ **O texto em `src/lib/termos.ts` continua a ser texto de demonstração**, e é o que
serve enquanto a sociedade não publicar o dela. O ecrã de administração diz isso em
letra visível, e não em rodapé: enquanto não houver articulado publicado, a sociedade
está a fazer os seus clientes aceitarem um contrato que não escreveu.

---

## 3. Dever de informação e sigilo (RGPD 13.º/14.º; EOA)

O passo 4 do registo de cada pessoa da equipa. As três respostas dessa página **não são
do mesmo tipo**, e tratá-las como se fossem é o erro clássico:

| Resposta | Natureza | Obrigatória? | Onde |
|---|---|---|---|
| Informação sobre tratamento de dados | **Tomada de conhecimento**, não consentimento | Sim | `perfil_utilizador.informacao_rgpd_em` |
| Sigilo profissional | **Declaração** | Sim | `sigilo_profissional`, `sigilo_aceite_em` + evento `utilizador.sigilo_declarado` |
| Comunicações internas | **Consentimento** | Não | `comunicacoes_internas` |

A primeira é informação e não consentimento porque a sociedade trata os dados dos seus
advogados ao abrigo do **contrato** e de **obrigações legais**. Pedir consentimento onde
o consentimento não é a base legal produz um consentimento inválido — e, pior, faz a
pessoa acreditar que o pode retirar e ver os seus dados apagados. A caixa diz «tomei
conhecimento» e não «autorizo», e o ecrã explica a diferença.

A terceira é a única que pode ficar por marcar sem impedir o passo de fechar. Se as três
fossem obrigatórias, a que é consentimento deixava de o ser — um consentimento que não
se pode recusar não é livre.

⚠ Os textos de `src/features/convites/textos.ts` são de demonstração, escritos a partir
do que os artigos obrigam a constar. A redação definitiva é da sociedade.

---

## 4. Auditoria imutável

| Propriedade | Como |
|---|---|
| Append-only | `REVOKE` + `RULE … DO INSTEAD NOTHING` no Postgres (D5) — `UPDATE` e `DELETE` afetam zero linhas |
| Cadeia de hash | cada linha encadeia com a anterior, por organização (D6) |
| Verificação | `pnpm auditoria:verificar` revalida a cadeia inteira |
| Autor, IP, user-agent, relógio do servidor | em cada linha; o relógio nunca é o do cliente |
| A auditoria nunca interrompe o resto | cada `registarEvento` corre no seu `try` (D46) |

O que entra na cadeia, dos percursos novos: cada passo gravado dos três registos, a
declaração de sigilo, a aceitação de T&C, a publicação de uma versão nova do articulado,
os convites enviados/reenviados/cancelados, as mudanças de papel, as ativações e
desativações, a criação de cada conta, e cada vez que um documento é aberto ou
descarregado.

⚠ **O `REVOKE` não morde quando o utilizador da aplicação é também o dono da tabela** —
o dono contorna-o, e só as `RULE`s protegem. Criar um `app_user` separado do dono é o
passo que fecha isto em produção; a migração `0002` já o aplica se o papel existir.

---

## 5. Contas e acesso

| Peça | Como |
|---|---|
| Sem registo público | `disableSignUp: true` — fecha a página **e** o endpoint (D23) |
| Uma conta nasce no fim do registo, nunca antes | `concluirConvite`, tudo numa transação |
| Palavra-passe: mínimo 12 caracteres, scrypt | `better-auth/crypto`, nunca uma reimplementação |
| A palavra-passe nunca é registada | nem em `email_log`, nem na auditoria, nem em consola |
| Limite de tentativas de login | 10 por IP em 15 minutos (`middleware.ts`) |
| Tokens de link guardados só em SHA-256 | D4, nos três percursos |
| Não é possível ficar sem administradores | `alterarPapel` e `alterarEstadoUtilizador` recusam a última conta de administração |
| Desativar não apaga | tudo o que a pessoa escreveu continua a apontar para ela |
| Chave da API sem valor por omissão | sem `API_CHAVE`, a API responde 503 e não fica aberta |

⚠ **MFA (TOTP) ficou fora do corte da POC.** Num sistema que guarda documentos de
identificação e declarações de PPE, é o ponto de segurança mais relevante em falta. É o
plugin `twoFactor` do Better Auth mais uma tabela — não é um refactor.

---

## 6. Retenção e apagamento

| Peça | Estado |
|---|---|
| Soft delete nas tabelas com retenção legal | ✔ `apagado_em` |
| Auditoria não apagável | ✔ por construção |
| **Purga aos 7 anos** | ⚠ **desenhada em `docs/SCHEMA.md`, não implementada** |
| Direito ao apagamento vs. retenção obrigatória | ⚠ a articulação precisa de validação jurídica |

⚠ Esta é a segunda lacuna mais relevante, a seguir aos beneficiários efetivos. O
esquema está preparado para reter; o que não existe é o que **apaga quando o prazo
passa**, e reter para sempre é tão incumpridor como não reter.

---

## 7. Dados pessoais em armazenamento

| Peça | Estado |
|---|---|
| Documentos fora de URL público | ✔ servidos por rota autorizada, `Cache-Control: private, no-store` |
| Download registado na auditoria | ✔ |
| Verificação de conteúdo (magic bytes) | ✔ um ficheiro que diz ser PDF e não é não entra (D39) |
| Arquivo no servidor da sociedade, por SFTP | ✔ com pinning da chave do host (D26) |
| Fornecedores na UE | ✔ VPS na UE, com empresa da UE (D16b) |
| **Ficheiros em base64 na base de dados** | ⚠ compromisso de POC |

⚠ Os ficheiros vivem em `documento.dados` e `documento_organizacao.dados`, em base64. É
um compromisso assumido — o correto é um bucket privado com só a chave na base — e tem
consequência prática: **quem tiver leitura da base de dados tem os documentos de
identificação**. Numa instalação a sério isto muda antes de entrar em produção.

---

## 8. O que uma validação jurídica deve olhar primeiro

Por ordem de gravidade, e sem cosmética:

1. **Beneficiários efetivos e RCBE** não são recolhidos. Obrigação legal, e a decisão é
   jurídica antes de ser técnica (§1).
2. **Purga aos 7 anos** desenhada e não implementada (§6).
3. **Ficheiros em base64 na base de dados** (§7).
4. **MFA em falta** para quem acede a dados de KYC (§5).
5. **Textos legais por confirmar**: os T&C da plataforma, a informação de RGPD e a
   declaração de sigilo são todos de demonstração (§2, §3).
6. **O `REVOKE` da auditoria** não morde com o utilizador atual (§4).

Os pontos 1, 2 e 5 precisam de decisão da sociedade ou do jurista. Os pontos 3, 4 e 6
são trabalho técnico com âmbito conhecido.
