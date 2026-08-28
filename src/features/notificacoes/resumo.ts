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
} from "@/lib/emails/moldura";

export type DadoSociedadeResumo = {
  sociedadeId?: string;
  nome: string;
  nif: string;
  prefixo: string;
  adminNome?: string | null;
  adminEmail?: string | null;
  erroAdmin?: string | null;
};

export type DadoUtilizadorResumo = {
  nome: string;
  email: string;
  sociedadeNome?: string | null;
  papel: string;
  organizacaoId?: string | null;
};

export type DadosResumoDiario = {
  data?: Date;
  sociedades: DadoSociedadeResumo[];
  utilizadores: DadoUtilizadorResumo[];
  processosSubmetidos24h?: number;
  urlPainelAdmin?: string;
};

const formatadorData = new Intl.DateTimeFormat("pt-PT", {
  dateStyle: "long",
});

function rotuloPapel(papel: string): string {
  switch (papel) {
    case "super_admin":
      return "Admin Plataforma";
    case "society_admin":
      return "Admin Sociedade";
    case "gestor":
      return "Gestor";
    case "utilizador":
      return "Utilizador";
    default:
      return papel;
  }
}

export function gerarAssuntoResumo({
  data = new Date(),
  sociedadesCount,
  utilizadoresCount,
}: {
  data?: Date;
  sociedadesCount: number;
  utilizadoresCount: number;
}): string {
  const dataFormatada = new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(data);

  if (sociedadesCount === 0 && utilizadoresCount === 0) {
    return `LexFlow | Resumo Diário — ${dataFormatada}`;
  }

  const partes = [];
  if (sociedadesCount > 0) {
    partes.push(`${sociedadesCount} nova${sociedadesCount > 1 ? "s" : ""} sociedade${sociedadesCount > 1 ? "s" : ""}`);
  }
  if (utilizadoresCount > 0) {
    partes.push(`${utilizadoresCount} novo${utilizadoresCount > 1 ? "s" : ""} utilizador${utilizadoresCount > 1 ? "es" : ""}`);
  }

  return `LexFlow | Resumo Diário: ${partes.join(", ")} (${dataFormatada})`;
}

export function gerarResumoDiarioHtml({
  data = new Date(),
  sociedades,
  utilizadores,
  processosSubmetidos24h = 0,
  urlPainelAdmin = "https://poc.terlicalabs.com/admin",
}: DadosResumoDiario): string {
  const dataExtenso = formatadorData.format(data);
  const hrefAdmin = escapar(urlPainelAdmin);

  const totalSociedades = sociedades.length;
  const totalUtilizadores = utilizadores.length;

  const htmlSociedades =
    totalSociedades > 0
      ? `
      <div style="margin-bottom: 24px;">
        <h3 style="font-family:${FONTE_CORPO};font-size:16px;font-weight:600;color:${TINTA};margin:0 0 10px;">
          🏢 Novas Sociedades Integradas (${totalSociedades})
        </h3>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="background:${PAPEL};border:1px solid ${LINHA};border-radius:6px;border-collapse:collapse;">
          <thead>
            <tr style="background:#f4f4f5;border-bottom:1px solid ${LINHA};">
              <th style="padding:10px 12px;font-family:${FONTE_MONO};font-size:11px;text-align:left;color:${TINTA_SUAVE};text-transform:uppercase;">Sociedade / NIF</th>
              <th style="padding:10px 12px;font-family:${FONTE_MONO};font-size:11px;text-align:left;color:${TINTA_SUAVE};text-transform:uppercase;">Prefixo</th>
              <th style="padding:10px 12px;font-family:${FONTE_MONO};font-size:11px;text-align:left;color:${TINTA_SUAVE};text-transform:uppercase;">Admin Inicial</th>
            </tr>
          </thead>
          <tbody>
            ${sociedades
              .map(
                (s, idx) => `
              <tr style="${idx > 0 ? `border-top:1px solid ${LINHA};` : ""}">
                <td style="padding:12px;font-family:${FONTE_CORPO};font-size:13px;color:${TINTA};">
                  <strong>${escapar(s.nome)}</strong><br/>
                  <span style="font-family:${FONTE_MONO};font-size:12px;color:${TINTA_SUAVE};">NIF: ${escapar(s.nif)}</span>
                </td>
                <td style="padding:12px;font-family:${FONTE_MONO};font-size:13px;color:${TINTA};">
                  ${escapar(s.prefixo)}
                </td>
                <td style="padding:12px;font-family:${FONTE_CORPO};font-size:13px;color:${TINTA};">
                  ${
                    s.adminEmail
                      ? `${escapar(s.adminNome ?? "")} <br/><span style="font-family:${FONTE_MONO};font-size:11px;color:${TINTA_SUAVE};">${escapar(s.adminEmail)}</span>`
                      : '<span style="color:#71717a;">—</span>'
                  }
                  ${
                    s.erroAdmin
                      ? `<div style="color:${SELO};font-size:11px;font-weight:600;margin-top:2px;">Erro: ${escapar(s.erroAdmin)}</div>`
                      : ""
                  }
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>`
      : "";

  const htmlUtilizadores =
    totalUtilizadores > 0
      ? `
      <div style="margin-bottom: 24px;">
        <h3 style="font-family:${FONTE_CORPO};font-size:16px;font-weight:600;color:${TINTA};margin:0 0 10px;">
          👥 Novos Utilizadores Integrados (${totalUtilizadores})
        </h3>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="background:${PAPEL};border:1px solid ${LINHA};border-radius:6px;border-collapse:collapse;">
          <thead>
            <tr style="background:#f4f4f5;border-bottom:1px solid ${LINHA};">
              <th style="padding:10px 12px;font-family:${FONTE_MONO};font-size:11px;text-align:left;color:${TINTA_SUAVE};text-transform:uppercase;">Utilizador</th>
              <th style="padding:10px 12px;font-family:${FONTE_MONO};font-size:11px;text-align:left;color:${TINTA_SUAVE};text-transform:uppercase;">Sociedade</th>
              <th style="padding:10px 12px;font-family:${FONTE_MONO};font-size:11px;text-align:left;color:${TINTA_SUAVE};text-transform:uppercase;">Perfil</th>
            </tr>
          </thead>
          <tbody>
            ${utilizadores
              .map(
                (u, idx) => `
              <tr style="${idx > 0 ? `border-top:1px solid ${LINHA};` : ""}">
                <td style="padding:12px;font-family:${FONTE_CORPO};font-size:13px;color:${TINTA};">
                  <strong>${escapar(u.nome)}</strong><br/>
                  <span style="font-family:${FONTE_MONO};font-size:12px;color:${TINTA_SUAVE};">${escapar(u.email)}</span>
                </td>
                <td style="padding:12px;font-family:${FONTE_CORPO};font-size:13px;color:${TINTA};">
                  ${escapar(u.sociedadeNome ?? "Plataforma")}
                </td>
                <td style="padding:12px;font-family:${FONTE_CORPO};font-size:12px;color:${TINTA};">
                  <span style="display:inline-block;padding:2px 6px;background:#e4e4e7;border-radius:4px;font-family:${FONTE_MONO};font-size:11px;">
                    ${escapar(rotuloPapel(u.papel))}
                  </span>
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>`
      : "";

  const htmlSemEventos =
    totalSociedades === 0 && totalUtilizadores === 0
      ? `
      <div style="background:${PAPEL};border:1px solid ${LINHA};border-radius:6px;padding:20px;text-align:center;margin-bottom:20px;">
        <p style="font-family:${FONTE_CORPO};font-size:14px;color:${TINTA_SUAVE};margin:0;">
          Sem novos registos de sociedades ou utilizadores nas últimas 24 horas.
        </p>
      </div>`
      : "";

  const conteudo = `
    <div style="margin-bottom: 18px;">
      <span style="display:inline-block;padding:4px 8px;background:${ARQUIVO};color:#ffffff;border-radius:4px;font-family:${FONTE_MONO};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">
        Resumo Diário
      </span>
      <h2 style="font-family:${FONTE_CORPO};font-size:20px;font-weight:600;color:${TINTA};margin:8px 0 4px;">
        Resumo Operacional Terlica
      </h2>
      <p style="font-family:${FONTE_CORPO};font-size:13px;color:${TINTA_SUAVE};margin:0 0 16px;">
        Atividade registada na plataforma até às 09:00 de ${escapar(dataExtenso)}.
      </p>
    </div>

    <!-- Indicadores Rápidos -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="margin-bottom: 20px;">
      <tr>
        <td width="32%" style="background:${PAPEL};border:1px solid ${LINHA};border-radius:6px;padding:12px;text-align:center;">
          <div style="font-family:${FONTE_MONO};font-size:10px;text-transform:uppercase;color:${TINTA_SUAVE};">Novas Sociedades</div>
          <div style="font-family:${FONTE_CORPO};font-size:22px;font-weight:700;color:${TINTA};margin-top:4px;">${totalSociedades}</div>
        </td>
        <td width="2%"></td>
        <td width="32%" style="background:${PAPEL};border:1px solid ${LINHA};border-radius:6px;padding:12px;text-align:center;">
          <div style="font-family:${FONTE_MONO};font-size:10px;text-transform:uppercase;color:${TINTA_SUAVE};">Novos Utilizadores</div>
          <div style="font-family:${FONTE_CORPO};font-size:22px;font-weight:700;color:${TINTA};margin-top:4px;">${totalUtilizadores}</div>
        </td>
        <td width="2%"></td>
        <td width="32%" style="background:${PAPEL};border:1px solid ${LINHA};border-radius:6px;padding:12px;text-align:center;">
          <div style="font-family:${FONTE_MONO};font-size:10px;text-transform:uppercase;color:${TINTA_SUAVE};">Processos (24h)</div>
          <div style="font-family:${FONTE_CORPO};font-size:22px;font-weight:700;color:${TINTA};margin-top:4px;">${processosSubmetidos24h}</div>
        </td>
      </tr>
    </table>

    ${htmlSemEventos}
    ${htmlSociedades}
    ${htmlUtilizadores}

    <div style="margin-top: 24px;">
      ${botao(hrefAdmin, "Aceder ao Painel de Administração")}
      ${linkCopiavel(hrefAdmin)}
    </div>
  `;

  return moldura(conteudo, MARCA);
}
