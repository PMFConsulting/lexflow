# Decisão de arquitetura — assinatura digital (passo 7)

Pedido em `docs/BRIEF.md` §2. Estado: **recomendação confirmada; decisão de âmbito por tomar.**

> **Contexto que os screenshots vieram acrescentar:** o passo 7 do formulário atual é só uma
> "Declaração Final" com um checkbox e o botão Submeter — **não há assinatura nenhuma hoje**
> (divergência D1 em `docs/CAMPOS.md`). Isto não é migrar uma funcionalidade, é construir uma.
> Num contexto de POC, é a primeira candidata a ficar para depois: a declaração de veracidade,
> gravada com data/hora de servidor e IP, cobre o mesmo terreno probatório a custo quase zero.

## Recomendação: construir in-house na v1 (`signature_pad` + `pdf-lib`)

1. Nenhuma das duas opções produz assinatura **qualificada** (QES) por si só — DocuSeal e
   in-house dão ambos assinatura eletrónica **simples**. Integrar não compra força legal.
2. Para o que o passo 7 é (aceitação de proposta e T&C por uma única parte, no fim de um
   fluxo que já controlamos de ponta a ponta), a SES com trilho de auditoria é o padrão
   corrente no setor e é admissível como prova nos termos do art. 25.º do eIDAS.
3. O trabalho marginal é pequeno: o brief já exige `pdf-lib` + `@react-pdf/renderer` para o
   dossier, hash SHA-256, IP, user-agent e timestamp de servidor. A assinatura acrescenta
   um canvas e a estampagem da imagem numa página. É trabalho de dias, não de semanas.
4. DocuSeal traz um segundo serviço para operar: Docker, Postgres próprio, storage, backups,
   atualizações — e um segundo sítio onde vivem dados pessoais de clientes, sujeito à mesma
   retenção de 7 anos e aos mesmos pedidos de apagamento. Duplica a superfície de compliance,
   que é a parte cara deste projeto, não o código.
5. O valor real do DocuSeal é multi-parte, roteamento de destinatários e colocação visual de
   campos no PDF. A v1 não precisa de nada disso.
6. Licenciamento: DocuSeal e Documenso são **AGPL-3.0**. Usar como serviço separado via API é
   o caso normal, mas AGPL num produto interno de uma sociedade de advogados é uma conversa
   que vale a pena ter com quem decide, não uma nota de rodapé técnica.
7. Contra o in-house: perdemos a UX de colocação de campos, os lembretes automáticos de
   assinatura e o suporte multi-parte — tudo coisas que vamos querer quando chegar o módulo
   de gestão processual (procurações, contratos de honorários com várias partes).
8. Contra o in-house, parte 2: o trilho de auditoria de conformidade passa a ser código nosso,
   e portanto responsabilidade nossa de o manter correto. É exatamente por isso que o brief
   manda encadear os hashes de `evento_auditoria` — essa peça tem de estar bem feita.
9. **Mitigação:** modelamos `assinatura` seguindo o vocabulário do Documenso
   (`Document` / `Recipient` / `Field` / `AuditLog`), mesmo com um só destinatário e um só
   campo na v1. Trocar por DocuSeal, Documenso ou um QTSP depois é adaptador, não migração.
10. **Gatilho para reavaliar:** no dia em que aparecer assinatura multi-parte, ou em que o
    negócio exigir assinatura qualificada (Chave Móvel Digital / Cartão de Cidadão via QTSP
    português), a decisão inverte-se — e nessa altura o candidato é o Documenso, pelo PAdES,
    não o DocuSeal.

## O que isto implica no schema

`assinatura` guarda: `processo_id`, `tipo` (`simples` na v1, deixa espaço para `avancada`/
`qualificada`), imagem da rubrica (chave de storage privado, nunca o dataURL na BD),
`hash_documento` (SHA-256 do PDF final), `ip`, `user_agent`, `assinado_em` (timestamp do
**servidor**), e `metadados` JSONB para o que um fornecedor externo vier a devolver.

## Dependência a acrescentar ao §1

`signature_pad` — está listada em §2 como referência, mas não em §1 como stack. É a
biblioteca do canvas de rubrica. ~12 kB, sem dependências. Confirma que aprovas.
