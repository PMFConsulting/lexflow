# API dos onboardings

Uma superfície HTTP para os três percursos de registo — cliente, sociedade e pessoa da
equipa — para que um bot os possa conduzir em conversa, em vez de mandar a pessoa
para um formulário.

## A regra que governa esta API

**Ela não tem lógica própria.** Cada rota chama exatamente a mesma função que o ecrã
chama — `guardarPasso`, `guardarPassoSociedade`, `guardarPassoConvite`,
`carregarDocumento…`, `submeter`, `concluirConvite` — e o que acrescenta é transporte:
ler o corpo, autenticar quem chama, dar forma à resposta.

Isto não é elegância. É a única disciplina que impede o que sempre acontece a uma
segunda porta para a mesma casa: a validação apertar de um lado e não do outro, e
passar a haver dois conjuntos de regras com o mesmo nome. Um campo que o formulário
recusa é recusado aqui, com a mesma mensagem; uma verificação que o fecho exige — o
código por email (D57), os documentos obrigatórios (D56), a declaração de sigilo — é
exigida aqui também. **Não há caminho programático que salte um passo.**

## Autenticação

Duas camadas, e as duas são precisas.

1. **O token do link mágico**, no caminho do URL. Diz *qual* registo se está a
   preencher. É o mesmo que a pessoa tem no email — não há aqui nada que o dono do
   link não pudesse fazer pelo browser.

2. **A chave da API**, no header `Authorization: Bearer <chave>`. Diz *quem* chama.
   Não é redundante com a primeira: um token de link vive num email, e um email é
   reencaminhado, colado em conversas e indexado por quem tenha acesso à caixa. Que
   ele abra um formulário no browser é o desenho; que abra uma porta programática,
   que se percorre em segundos e sem olhos humanos pelo meio, é outra coisa.

A chave vem de `API_CHAVE`. **Sem ela configurada, a API responde `503` e não fica
aberta** — um recuo permissivo aqui seria a instalação que esqueceu a variável a
servir dados de KYC a quem os peça.

Limite: **60 pedidos por minuto** por chave. Ao exceder, `429` com `Retry-After`.

## Códigos de resposta

| Código | Quando | O que fazer |
|---|---|---|
| `200` | Correu bem | Seguir |
| `400` | O corpo não é JSON válido | Corrigir o pedido |
| `401` | Chave em falta ou errada | Corrigir o header |
| `404` | Token não resolve, ou passo que não existe | Ver `codigo` no corpo: `expirado`, `arquivado`, `cancelado`, `desconhecido`, `passo_invalido` |
| `409` | Pedido no sítio errado | A mensagem diz o endpoint certo |
| `415` | Upload sem `multipart/form-data` | Reenviar como multipart |
| `422` | O corpo chegou bem e a **regra** falhou | Ver `erros`, por nome de campo |
| `429` | Demasiados pedidos | Esperar o `Retry-After` |
| `503` | `API_CHAVE` não configurada | Configurar no servidor |

A distinção entre `400` e `422` é a que mais importa a um bot: em `400` o pedido
estava mal formado e reformula-se sozinho; em `422` foi a regra de negócio que
recusou, e o que falta é perguntar à pessoa.

## Forma dos erros de validação

```json
{
  "ok": false,
  "erros": {
    "nif": ["O NIF não é válido — o último dígito teria de ser 4."],
    "telefone": ["O número de telefone tem de ter 9 dígitos — indicou 10."]
  },
  "mensagem": null
}
```

`erros` vem **por campo**, com a mensagem que a pessoa veria no ecrã. É isso que
permite ao bot dizer qual campo corrigir em vez de repetir «não foi possível
guardar».

## Endpoints

Todos com `Authorization: Bearer <chave>`.

### Cliente

| Método | Caminho | O que faz |
|---|---|---|
| `GET` | `/api/onboarding/cliente/{token}` | Estado: passo atual, passos gravados, percurso, documentos anexados |
| `POST` | `/api/onboarding/cliente/{token}/passo/{n}` | Grava o passo `n` (1–7) |
| `POST` | `/api/onboarding/cliente/{token}/documento` | Anexa um documento (multipart) |
| `POST` | `/api/onboarding/cliente/{token}/submeter` | Submete o registo |

O `GET` **não devolve os dados preenchidos**. Um registo de KYC tem morada, NIF,
documento de identificação e declaração de PPE lá dentro, e uma API de estado não é
sítio para os despejar — o que o bot precisa de saber é o que falta.

Os campos de cada passo estão em `src/features/onboarding/schemas.ts`. O corpo é o
mesmo objeto que o formulário monta.

Notas do percurso:

- O passo 3 (Representante Legal) **só existe para pessoas coletivas** (D28). O `GET`
  devolve o `percurso` já filtrado — é por ele que se navega, não pelos números de 1 a 7.
- O passo 2 não fecha sem os documentos obrigatórios (D56): identificação e
  comprovativo de NIF em ambos os percursos, mais a certidão permanente para empresas.
- O passo 7 exige o **código de verificação por email** (D57). O bot pede-o com
  `POST /passo/7` — que o recusa com `erros.otp` até o código estar validado. A
  validação faz-se no browser, com o link; é deliberado que não haja endpoint para
  ela, porque um código de seis dígitos verificável por API é um código verificável
  por script.

### Sociedade

| Método | Caminho | O que faz |
|---|---|---|
| `GET` | `/api/onboarding/sociedade/{token}` | Estado do registo da sociedade |
| `POST` | `/api/onboarding/sociedade/{token}/passo/{n}` | Grava o passo `n` (1–6) |
| `POST` | `/api/onboarding/sociedade/{token}/documento` | Anexa a certidão ou o PDF dos T&C |
| `POST` | `/api/onboarding/sociedade/{token}/submeter` | Submete e convida o administrador |

O `submeter` devolve `adminEmail` e `emailEnviado`, e não só `ok`: a submissão cria um
convite para essa pessoa, e o bot tem de poder dizer «foi enviado para X» ou «o
convite existe mas o email não saiu». Um `ok: true` sozinho tornava esses dois casos
indistinguíveis.

### Pessoa da equipa (convite)

| Método | Caminho | O que faz |
|---|---|---|
| `GET` | `/api/onboarding/convite/{token}` | Estado, papel, e se essa pessoa exerce advocacia |
| `POST` | `/api/onboarding/convite/{token}/passo/{n}` | Grava o passo `n` (1–5) |
| `POST` | `/api/onboarding/convite/{token}/documento` | Anexa identificação ou cédula |
| `POST` | `/api/onboarding/convite/{token}/concluir` | Cria a conta (passo 6) |

O `GET` devolve `exerceAdvocacia`, e o bot precisa disso **antes** de perguntar: pedir
a cédula profissional a um assistente é pedir um número que ele não tem, e não a pedir
a um advogado é um passo que nunca fecha.

`POST /passo/6` responde `409` a apontar para `/concluir`: o passo 6 cria uma conta com
palavra-passe, que é uma transação e não uma gravação de campos.

`POST /concluir` recebe `{ "password": "…", "confirmacao": "…" }` e volta a verificar
os cinco passos anteriores — documentos anexados, sigilo declarado, articulado aceite.
A palavra-passe atravessa o corpo em claro, como em qualquer formulário de registo: é
HTTPS que a protege em trânsito, e do lado de cá é convertida em hash (scrypt,
`better-auth/crypto`) antes de qualquer escrita. **Não é registada em lado nenhum** —
nem em `email_log`, nem em `evento_auditoria`, nem nas linhas de consola.

## Upload de documentos

`multipart/form-data`, com dois campos:

- `ficheiro` — o ficheiro
- `tipo` — a categoria

As categorias aceites por percurso:

| Percurso | Categorias |
|---|---|
| Cliente | `identificacao`, `comprovativo_nif`, `certidao_permanente`, `procuracao`, `ata_designacao`, `comprovativo_rcbe`, `outro` |
| Sociedade | `certidao_sociedade`, `termos_sociedade`, `outro` |
| Convite | `identificacao`, `cedula_profissional`, `outro` |

São allowlists e não o enum inteiro, de propósito: `proposta_comercial` é um documento
que a sociedade anexa e o cliente **recebe** (D52) — um cliente que o pudesse carregar
passava a aceitar uma proposta escrita por ele próprio.

Regras iguais às do formulário: PDF, JPG, PNG, WEBP ou HEIC, máximo 4 MB, e os
primeiros bytes têm de bater certo com o formato declarado (D39). Os T&C da sociedade
só em PDF.

## Exemplo — percorrer um convite

```bash
CHAVE="…"
TOKEN="…"
BASE="https://poc.terlicalabs.com/api/onboarding/convite/$TOKEN"

# 1. onde estamos, e se esta pessoa precisa de cédula
curl -s -H "Authorization: Bearer $CHAVE" "$BASE"

# 2. dados pessoais
curl -s -X POST "$BASE/passo/1" \
  -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"nomeCompleto":"Ana Ribeiro","dataNascimento":"1988-04-12","nif":"249886340",
       "telefone":"912345678","docTipo":"cartao_cidadao","docNumero":"12345678 9 ZZ1",
       "docValidade":"2030-01-01","morada":"Rua das Flores 12","pais":"PT",
       "localidade":"Lisboa","codigoPostal":"1200-192","freguesia":"Misericórdia",
       "concelho":"Lisboa","distrito":"Lisboa"}'

# 3. documentos
curl -s -X POST "$BASE/documento" \
  -H "Authorization: Bearer $CHAVE" \
  -F "tipo=identificacao" -F "ficheiro=@cc.pdf"

# 4. …passos 2 a 5…

# 5. a conta
curl -s -X POST "$BASE/concluir" \
  -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"password":"uma-palavra-passe-longa","confirmacao":"uma-palavra-passe-longa"}'
```

## O que a API deliberadamente não faz

- **Não cria registos.** Abrir um processo de cliente, convidar uma sociedade ou
  convidar uma pessoa continuam a ser atos da sociedade — pelo back-office ou pelo
  script no servidor. Uma API que criasse registos era uma API que gerava links
  mágicos, e um link mágico gerado por engano é um dossier acessível a quem o receba.
- **Não valida códigos OTP.** Ver acima.
- **Não devolve dados pessoais preenchidos.** O `GET` diz o que falta, não o que lá está.
- **Não devolve ficheiros.** Os documentos servem-se pelas rotas do link mágico, para
  quem tem o link, e pelo back-office, para quem tem sessão.
