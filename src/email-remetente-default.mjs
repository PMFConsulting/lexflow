// Valor único, partilhado por src/env.ts e pelos scripts standalone (não
// passam por tsx/webpack, por isso não podem importar env.ts diretamente).
//
// Neutro e da plataforma, nunca o domínio de uma sociedade concreta: o valor
// que aqui estava (`POC@jmassano.pt`) era o de um cliente do primeiro piloto, e
// uma instalação que se esquecesse de definir `EMAIL_REMETENTE` passava a
// escrever aos clientes de outra sociedade a partir de um domínio antigo que
// ninguém verificou — o Resend recusa-o com 403 (D43) e, nos canais que não
// verificam domínio, sai à mesma com o remetente errado.
//
// Continua a haver valor por omissão em vez de a variável ser obrigatória
// porque `env()` é preguiçoso (D11) e lançar aqui partia o arranque de qualquer
// instalação sem email configurado; o que muda é que o valor por omissão é da
// plataforma e não de um cliente. Em produção define-se `EMAIL_REMETENTE` com
// um endereço do domínio verificado da instalação.
export const EMAIL_REMETENTE_DEFAULT = "lexflow@lex-flow.pt";
