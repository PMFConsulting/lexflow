import type { Destino, Ficheiro, ParametrosOneDrive, Verificacao } from "./tipos";
import { caminho } from "./tipos";

/**
 * OneDrive / SharePoint, através do Microsoft Graph.
 *
 * `fetch` puro, sem SDK: o que é preciso são três chamadas — trocar o refresh
 * token por um access token, criar pastas, e enviar ficheiros. Um SDK traria
 * uma árvore de dependências inteira para isso.
 *
 * Registo da aplicação no Entra ID, uma vez por sociedade:
 *   · aplicação com "Accounts in this organizational directory only"
 *   · permissões delegadas `Files.ReadWrite.All` e `offline_access`
 *   · o `offline_access` é o que devolve o refresh token no consentimento
 * Ver docs/ARMAZENAMENTO.md para o passo a passo.
 */

const GRAFO = "https://graph.microsoft.com/v1.0";

/** O upload simples do Graph aceita até 4 MiB; acima disso é sessão de upload. */
const LIMITE_UPLOAD_SIMPLES = 4 * 1024 * 1024;

/** Margem para não usar um token que expira no meio da sincronização. */
const MARGEM_EXPIRACAO_MS = 60_000;

type TokenEmCache = { valor: string; expiraEm: number };

/**
 * Cache do access token, por cliente e tenant. Vive no processo e não na base
 * de dados de propósito: é material sensível de curta duração, e cada arranque
 * do contentor começa com ele vazio.
 */
const tokens = new Map<string, TokenEmCache>();

export class ErroOneDrive extends Error {
  constructor(
    mensagem: string,
    readonly estado?: number,
  ) {
    super(mensagem);
    this.name = "ErroOneDrive";
  }
}

async function obterToken(p: ParametrosOneDrive): Promise<string> {
  const chaveCache = `${p.tenantId}:${p.clientId}`;
  const guardado = tokens.get(chaveCache);
  if (guardado && guardado.expiraEm > Date.now() + MARGEM_EXPIRACAO_MS) {
    return guardado.valor;
  }

  const corpo = new URLSearchParams({
    client_id: p.clientId,
    grant_type: "refresh_token",
    refresh_token: p.tokenRefresh,
    scope: "https://graph.microsoft.com/.default offline_access",
  });
  if (p.clientSecret) corpo.set("client_secret", p.clientSecret);

  const resposta = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(p.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: corpo,
    },
  );

  if (!resposta.ok) {
    // O corpo da resposta de erro do Entra ID cita o pedido, e o pedido leva o
    // refresh token — por isso nada dele sobe. Fica o código, que é o que
    // distingue "consentimento expirado" de "está tudo em baixo".
    throw new ErroOneDrive(
      `Autenticação Microsoft recusada (HTTP ${resposta.status}). ` +
        "O refresh token pode ter expirado — volte a autorizar a aplicação.",
      resposta.status,
    );
  }

  const json = (await resposta.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new ErroOneDrive("Resposta sem access token.");

  tokens.set(chaveCache, {
    valor: json.access_token,
    expiraEm: Date.now() + (json.expires_in ?? 3600) * 1000,
  });

  return json.access_token;
}

/** Raiz do drive: o do utilizador que consentiu, ou um drive explícito. */
function raiz(p: ParametrosOneDrive): string {
  return p.driveId ? `${GRAFO}/drives/${encodeURIComponent(p.driveId)}` : `${GRAFO}/me/drive`;
}

/** Endereçamento por caminho do Graph: `/root:/a/b:` — os dois pontos são sintaxe. */
function porCaminho(p: ParametrosOneDrive, segmentos: string[]): string {
  const caminhoUrl = caminho(segmentos)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return caminhoUrl ? `${raiz(p)}/root:/${caminhoUrl}` : `${raiz(p)}/root`;
}

export function criarDestinoOneDrive(p: ParametrosOneDrive): Destino {
  async function chamar(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await obterToken(p);
    return fetch(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
  }

  return {
    tipo: "onedrive",

    async garantirPasta(segmentos) {
      // O Graph não cria pastas intermédias: cada nível é um POST ao pai.
      const percorridos: string[] = [];

      for (const segmento of segmentos) {
        const pai =
          percorridos.length === 0
            ? `${raiz(p)}/root/children`
            : `${porCaminho(p, percorridos)}:/children`;

        const resposta = await chamar(pai, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: segmento,
            folder: {},
            // Se já existir, fica a que lá está — nunca se apaga uma pasta de
            // cliente por a sincronização correr duas vezes.
            "@microsoft.graph.conflictBehavior": "fail",
          }),
        });

        // 409 = já existe, que é o resultado desejado num passo idempotente.
        if (!resposta.ok && resposta.status !== 409) {
          throw new ErroOneDrive(
            `Não foi possível criar a pasta "${segmento}" (HTTP ${resposta.status}).`,
            resposta.status,
          );
        }
        percorridos.push(segmento);
      }
    },

    async enviar(segmentos, ficheiro: Ficheiro) {
      if (ficheiro.conteudo.byteLength > LIMITE_UPLOAD_SIMPLES) {
        // Os anexos estão limitados a 4 MB no upload do cliente e o resumo tem
        // uns kilobytes, por isso este caminho não é alcançável hoje. Fica
        // explícito para o dia em que o limite subir: aí é sessão de upload
        // com blocos, não um PUT maior.
        throw new ErroOneDrive(
          `"${ficheiro.nome}" tem mais de 4 MB e o upload simples não o aceita.`,
        );
      }

      const alvo = `${porCaminho(p, [...segmentos, ficheiro.nome])}:/content`;
      const resposta = await chamar(alvo, {
        method: "PUT",
        headers: { "content-type": ficheiro.mime },
        body: new Uint8Array(ficheiro.conteudo),
      });

      if (!resposta.ok) {
        throw new ErroOneDrive(
          `Falha ao enviar "${ficheiro.nome}" (HTTP ${resposta.status}).`,
          resposta.status,
        );
      }
    },

    async verificar(): Promise<Verificacao> {
      try {
        const resposta = await chamar(`${raiz(p)}?$select=id,name`);
        if (!resposta.ok) {
          return { ok: false, detalhe: `O Graph respondeu HTTP ${resposta.status}.` };
        }
        const json = (await resposta.json()) as { name?: string };
        return { ok: true, detalhe: `Ligado ao drive "${json.name ?? "OneDrive"}".` };
      } catch (e) {
        return { ok: false, detalhe: e instanceof Error ? e.message : "Falha desconhecida." };
      }
    },
  };
}

/** Só para os testes: esvazia a cache de tokens entre casos. */
export function limparCacheDeTokens() {
  tokens.clear();
}
