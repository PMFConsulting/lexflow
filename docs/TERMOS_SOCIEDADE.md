# T&C da sociedade — slot preparado, por acionar

Revisão de produto de 23/08/2026, ponto 2. **Nada disto está ligado**: o que
existe é o espaço, documentado aqui para que o dia em que a sociedade entregar o
articulado não seja um dia de migração com o sistema a correr.

## O problema

Os Termos e Condições que o cliente aceita no passo 7 vêm hoje de
`src/lib/termos.ts` — texto escrito para a POC a partir do que a lei obriga a
constar. É útil para demonstrar o mecanismo e está errado em substância: quem
contrata com o cliente é a **sociedade**, e o articulado que o vincula é o dela.
A plataforma é o canal, não a parte.

Enquanto isto não se resolver, a sociedade está a fazer os seus clientes aceitar
um contrato que não escreveu.

## O que já existe

Tudo por adição, na migração `0015`. Nenhuma coluna existente foi tocada.

| Onde | O quê | Estado |
|---|---|---|
| `organizacao.termos_documento_ref` | referência do ficheiro dos T&C da sociedade | `null`, sem leitor |
| `organizacao.termos_versao` | a versão do articulado dela | `null`, sem leitor |
| `organizacao.termos_atualizado_em` | quando é que ela o submeteu | `null`, sem leitor |
| enum `tipo_documento` → `termos_sociedade` | o tipo do documento, quando existir | nunca escrito |

Enquanto as três colunas forem `null`, `LeitorTermos` continua a servir
`src/lib/termos.ts` e o cliente não tem de fazer rigorosamente nada de novo. É
esse o contrato desta preparação: presença sem efeito.

A coluna `termos_documento_ref` é `text` e **não** uma FK para `documento`. Não é
distração: `documento.processo_id` é `not null`, e os T&C da sociedade não são de
processo nenhum. Escolher entre "tabela própria para documentos da sociedade" e
"`processo_id` deixa de ser obrigatório" é uma decisão que se toma bem com o
articulado à frente e mal hoje — uma FK inventada agora era uma restrição a
defender uma forma que ainda não se sabe qual é.

## O que falta, pela ordem por que se faz

1. **Receber o articulado.** PDF ou texto. Se vier em PDF, decidir se o passo 7
   passa a mostrar um PDF (e perde-se a medição de leitura da D30, pela mesma
   razão que a proposta comercial anexada a perdeu — ver `LeitorProposta`) ou se
   o texto é transcrito para `SeccaoTermos[]` e o PDF fica como cópia oficial.
   **Recomendado:** transcrever. A medição de "leu até ao fim" é o que dá valor
   probatório à aceitação, e é a única coisa que se perde ao passar a PDF.
2. **Decidir onde vive o ficheiro** (ver acima), e ligar `termos_documento_ref`.
3. **Ecrã de submissão no back-office**, em `/configuracao`, restrito a `admin`
   pela mesma razão que o `/emails` (D35).
4. **`textoEmVigor` a procurar pela versão da sociedade** quando ela existe, e
   pela `VERSAO_TERMOS` da plataforma quando não existe.

## O que não se pode esquecer

A D3 e a D38, que são a mesma coisa vista de dois lados: os consentimentos
apontam para uma **versão**, e é por chave *e* versão que `textoEmVigor` procura.
Substituir o articulado sem subir `termos_versao` apaga a diferença entre o que o
cliente aceitou e o que passou a estar escrito — que é precisamente a prova que
esta parte do sistema existe para guardar.

Subir a versão cria uma linha nova em `versao_texto_legal`; os consentimentos
anteriores continuam a apontar para o texto que quem os deu viu de facto. É isso
que tem de continuar a valer no dia em que a fonte do texto deixar de ser um
ficheiro `.ts` e passar a ser uma coluna.
