import {
  botao,
  escapar,
  FONTE_MONO,
  LATAO,
  linkCopiavel,
  LINHA,
  moldura,
  p,
  PAPEL,
  saudacao,
  TINTA,
  TINTA_SUAVE,
} from "./moldura";

/**
 * As credenciais de acesso de uma conta criada por um administrador.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Porque é a palavra-passe no corpo, e não um link de definição
 *
 * O convite com link (a pessoa escolhe a palavra-passe, a plataforma nunca a
 * conhece) é a forma melhor, e existe: é o `convite_utilizador`, e é o caminho
 * de quem entra pelo registo de utilizador. Este email serve o outro caminho —
 * o administrador que cria a conta diretamente — e o que ele substitui é pior
 * do que ele: a palavra-passe mostrada no ecrã de quem criou a conta, que
 * passava pelas mãos de terceiros e não obrigava a nada a seguir.
 *
 * O que torna isto aceitável não está nesta mensagem, está no que vem depois:
 * a palavra-passe é **temporária** e a plataforma não deixa fazer mais nada
 * antes de a trocar (`utilizador.deve_redefinir_password`). Uma palavra-passe
 * que só serve para escolher outra tem uma janela de utilidade curta, e é essa
 * a diferença entre um segredo que viaja por email e uma credencial permanente
 * que viaja por email.
 *
 * O corpo desta mensagem **não é guardado em lado nenhum**: o `email_log`
 * regista assunto e destinatário e nunca o corpo (D34), e o `evento_auditoria`
 * — que dura sete anos — regista que a conta foi criada e para que endereço, e
 * mais nada.
 */

export const ASSUNTO_CREDENCIAIS = "LexFlow | As suas credenciais de acesso";

/** Uma linha de destaque — a sociedade, o perfil. */
const destaque = (etiqueta: string, valor: string) => `
<p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
   text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 6px;">
  ${escapar(etiqueta)}
  <span style="color:${TINTA};font-weight:500;">${escapar(valor)}</span>
</p>`;

/**
 * As duas credenciais, em mono e dentro de uma caixa.
 *
 * Em mono porque é o que se copia à mão ou se lê ao telefone, e é a regra do
 * projeto para qualquer identificador. Numa caixa própria porque uma
 * palavra-passe no meio de um parágrafo perde-se — e a consequência de se
 * perder é uma pessoa que não entra.
 */
const caixaCredenciais = (email: string, palavraPasse: string) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:${PAPEL};border:1px solid ${LINHA};border-radius:6px;margin:0 0 18px;">
  <tr>
    <td style="padding:16px 18px;">
      <p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
                text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 4px;">Email</p>
      <p style="font-family:${FONTE_MONO};font-size:14px;color:${TINTA};margin:0 0 14px;
                word-break:break-all;">${escapar(email)}</p>
      <p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
                text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 4px;">Palavra-passe temporária</p>
      <p style="font-family:${FONTE_MONO};font-size:16px;font-weight:600;color:${TINTA};margin:0;
                letter-spacing:0.04em;word-break:break-all;">${escapar(palavraPasse)}</p>
    </td>
  </tr>
</table>`;

export function emailCredenciais({
  nome,
  sociedade,
  email,
  palavraPasse,
  link,
  logotipoUrl,
}: {
  nome?: string | null;
  /** `null` para uma conta de administração da plataforma, que não é de nenhuma. */
  sociedade?: string | null;
  email: string;
  palavraPasse: string;
  /** O endereço de início de sessão desta instalação. */
  link: string;
  logotipoUrl?: string | null;
}): string {
  const href = escapar(link);

  return moldura(
    `
    ${saudacao(nome)}
    ${sociedade ? destaque("Sociedade ", sociedade) : ""}
    ${p(
      "Foi criada uma conta para si na plataforma LexFlow. Estas são as credenciais com que " +
        "entra da primeira vez:",
    )}
    ${caixaCredenciais(email, palavraPasse)}
    ${p(
      "<strong>A palavra-passe acima é temporária.</strong> Assim que entrar, a plataforma " +
        "pede-lhe para definir uma palavra-passe sua — de pelo menos 12 caracteres — e não " +
        "avança para mais nada antes disso. A partir daí, é essa que passa a valer e esta " +
        "deixa de funcionar.",
    )}
    ${botao(href, "Entrar na plataforma")}
    ${linkCopiavel(href)}
    ${p(
      "Se não reconhece este convite, avise-nos e ignore a mensagem — sem esta palavra-passe " +
        "ninguém entra na conta. Não reencaminhe este email.",
    )}
  `,
    LATAO,
    logotipoUrl,
  );
}
