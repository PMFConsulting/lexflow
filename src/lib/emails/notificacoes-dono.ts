import {
  ARQUIVO,
  botao,
  escapar,
  FONTE_CORPO,
  FONTE_MONO,
  LINHA,
  MARCA,
  moldura,
  p,
  PAPEL,
  SELO,
  TINTA,
  TINTA_SUAVE,
  linkCopiavel,
} from "./moldura";
import {
  registarNotificacao,
  enfileirarNotificacaoPendente,
} from "@/features/notificacoes/servico";

/**
 * Notificações operacionais enviadas ao Dono da plataforma (EMAIL_NOTIFICACOES).
 *
 * 1. `notificacao_sociedade_criada`: enviada quando uma sociedade é criada via
 *    `criarSociedade`. Informa o nome, NIF, prefixo, dados do administrador e link
 *    direto para o painel de administração da sociedade. Se a conta do admin falhou,
 *    inclui um alerta claro com o motivo.
 *
 * 2. `notificacao_novo_utilizador`: enviada quando um utilizador é onboarded
 *    (via `criarUtilizador`, `concluirConvite` ou `importarUtilizadores`).
 */

export const ASSUNTO_SOCIEDADE_CRIADA = "LexFlow | Nova sociedade onboarded";
export const ASSUNTO_NOVO_UTILIZADOR = "LexFlow | Novo utilizador onboarded";

export function emailNotificacaoSociedadeCriada({
  nome,
  nif,
  prefixo,
  adminNome,
  adminEmail,
  link,
  erroAdmin,
}: {
  nome: string;
  nif: string;
  prefixo: string;
  adminNome?: string | null;
  adminEmail?: string | null;
  link: string;
  erroAdmin?: string | null;
}): string {
  const href = escapar(link);

  const statusAdmin = erroAdmin
    ? `<span style="color:${SELO};font-weight:600;">Erro na criação da conta</span>`
    : adminEmail
      ? `<span style="color:${ARQUIVO};font-weight:600;">Conta criada com sucesso</span>`
      : `<span style="color:${TINTA_SUAVE};">Sem administrador inicial indicado</span>`;

  return moldura(
    `
    ${p("Foi criada uma nova sociedade na plataforma LexFlow.")}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="background:${PAPEL};border:1px solid ${LINHA};border-radius:6px;margin:0 0 18px;">
      <tr>
        <td style="padding:16px 18px;">
          <p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
                    text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 4px;">Sociedade</p>
          <p style="font-family:${FONTE_CORPO};font-size:15px;font-weight:600;color:${TINTA};margin:0 0 12px;">
            ${escapar(nome)}
          </p>

          <p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
                    text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 4px;">NIPC / NIF</p>
          <p style="font-family:${FONTE_MONO};font-size:14px;color:${TINTA};margin:0 0 12px;">
            ${escapar(nif)}
          </p>

          <p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
                    text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 4px;">Prefixo de Processo</p>
          <p style="font-family:${FONTE_MONO};font-size:14px;color:${TINTA};margin:0 0 12px;">
            ${escapar(prefixo)}
          </p>

          ${
            adminEmail
              ? `
          <p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
                    text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 4px;">Administrador Inicial</p>
          <p style="font-family:${FONTE_CORPO};font-size:14px;color:${TINTA};margin:0 0 4px;">
            ${escapar(adminNome ?? "")} (${escapar(adminEmail)})
          </p>
          <p style="font-family:${FONTE_MONO};font-size:12px;margin:0 0 12px;">
            ${statusAdmin}
          </p>`
              : ""
          }

          ${
            erroAdmin
              ? `
          <div style="background:#fee2e2;border:1px solid #f87171;border-radius:4px;padding:10px 12px;margin-top:8px;">
            <p style="font-family:${FONTE_CORPO};font-size:13px;color:#991b1b;margin:0;">
              <strong>Alerta de criação de conta:</strong> ${escapar(erroAdmin)}
            </p>
          </div>`
              : ""
          }
        </td>
      </tr>
    </table>
    ${botao(href, "Ver sociedade no painel")}
    ${linkCopiavel(href)}
  `,
    MARCA,
  );
}

export function emailNotificacaoNovoUtilizador({
  nome,
  email,
  sociedade,
  papel,
}: {
  nome: string;
  email: string;
  sociedade?: string | null;
  papel: string;
}): string {
  const papelLegivel =
    papel === "society_admin"
      ? "Administrador da Sociedade"
      : papel === "gestor"
        ? "Gestor"
        : papel === "super_admin"
          ? "Administrador da Plataforma"
          : "Utilizador";

  return moldura(
    `
    ${p("Foi integrado um novo utilizador na plataforma LexFlow.")}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="background:${PAPEL};border:1px solid ${LINHA};border-radius:6px;margin:0 0 18px;">
      <tr>
        <td style="padding:16px 18px;">
          <p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
                    text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 4px;">Utilizador</p>
          <p style="font-family:${FONTE_CORPO};font-size:15px;font-weight:600;color:${TINTA};margin:0 0 4px;">
            ${escapar(nome)}
          </p>
          <p style="font-family:${FONTE_MONO};font-size:13px;color:${TINTA_SUAVE};margin:0 0 12px;">
            ${escapar(email)}
          </p>

          ${
            sociedade
              ? `
          <p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
                    text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 4px;">Sociedade</p>
          <p style="font-family:${FONTE_CORPO};font-size:14px;color:${TINTA};margin:0 0 12px;">
            ${escapar(sociedade)}
          </p>`
              : ""
          }

          <p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
                    text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 4px;">Papel / Perfil</p>
          <p style="font-family:${FONTE_CORPO};font-size:14px;color:${TINTA};margin:0;">
            ${escapar(papelLegivel)}
          </p>
        </td>
      </tr>
    </table>
  `,
    ARQUIVO,
  );
}

/**
 * Notifica a criação de uma nova sociedade (Frente P):
 * 1. Regista notificação in-app (visível no painel da plataforma e no sino).
 * 2. Enfileira em `notificacoes_pendentes` para o Resumo Diário às 9:00 (zero emails imediatos).
 */
export async function notificarDonoSociedadeCriada({
  sociedadeId,
  nome,
  nif,
  prefixo,
  adminNome,
  adminEmail,
  erroAdmin,
}: {
  sociedadeId: string;
  nome: string;
  nif: string;
  prefixo: string;
  adminNome?: string | null;
  adminEmail?: string | null;
  erroAdmin?: string | null;
}): Promise<void> {
  const link = `/admin/sociedades/${sociedadeId}`;

  // 1. Notificação in-app
  await registarNotificacao({
    organizacaoId: sociedadeId,
    paraPapel: "super_admin",
    titulo: erroAdmin
      ? `[Alerta] Sociedade criada com erro no admin: ${nome}`
      : `Nova sociedade criada: ${nome}`,
    corpo: `Foi criada a sociedade "${nome}" (NIPC: ${nif}, Prefixo: ${prefixo}).${
      adminEmail ? ` Administrador inicial: ${adminNome ?? ""} (${adminEmail}).` : ""
    }${erroAdmin ? ` Motivo do alerta: ${erroAdmin}` : ""}`,
    link,
  });

  // 2. Fila para o Resumo Diário único às 9:00 (zero emails imediatos)
  await enfileirarNotificacaoPendente({
    tipo: "sociedade_criada",
    organizacaoId: sociedadeId,
    dados: {
      sociedadeId,
      nome,
      nif,
      prefixo,
      adminNome,
      adminEmail,
      erroAdmin,
    },
  });
}

/**
 * Notifica a integração de um novo utilizador (Frente P):
 * 1. Regista notificação in-app (visível no back-office da sociedade e na plataforma).
 * 2. Enfileira em `notificacoes_pendentes` para o Resumo Diário às 9:00 (zero emails imediatos).
 */
export async function notificarDonoNovoUtilizador({
  nome,
  email,
  sociedadeNome,
  papel,
  organizacaoId,
}: {
  nome: string;
  email: string;
  sociedadeNome?: string | null;
  papel: string;
  organizacaoId?: string | null;
}): Promise<void> {
  const papelLegivel =
    papel === "society_admin"
      ? "Administrador da Sociedade"
      : papel === "gestor"
        ? "Gestor"
        : papel === "super_admin"
          ? "Administrador da Plataforma"
          : "Utilizador";

  const link = organizacaoId ? `/admin/sociedades/${organizacaoId}` : "/admin/utilizadores";

  // 1. Notificação in-app
  await registarNotificacao({
    organizacaoId: organizacaoId ?? null,
    paraPapel: null,
    titulo: `Novo utilizador integrado: ${nome}`,
    corpo: `O utilizador ${nome} (${email}) foi registado com perfil de ${papelLegivel}${
      sociedadeNome ? ` na sociedade ${sociedadeNome}` : ""
    }.`,
    link,
  });

  // 2. Fila para o Resumo Diário único às 9:00 (zero emails imediatos)
  await enfileirarNotificacaoPendente({
    tipo: "novo_utilizador",
    organizacaoId: organizacaoId ?? null,
    dados: {
      nome,
      email,
      sociedadeNome,
      papel,
      organizacaoId,
    },
  });
}
