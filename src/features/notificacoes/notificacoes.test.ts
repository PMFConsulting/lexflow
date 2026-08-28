import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  gerarAssuntoResumo,
  gerarResumoDiarioHtml,
} from "./resumo";

type Linha = Record<string, any>;

const inseridos: { tabela: string; valores: Linha }[] = [];
const atualizados: { tabela: string; valores: Linha }[] = [];
let linhas: Record<string, Linha[]> = {};
let sessaoMock: { conta: { id: string; email: string }; eu: Linha } | null = null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest-test" }),
}));

vi.mock("@/lib/sessao", () => ({
  eSuperAdmin: (papel: string) => papel === "super_admin",
  exigirSessao: async () => {
    if (!sessaoMock) throw new Error("Sem sessão");
    return sessaoMock;
  },
  exigirSocietyAdmin: async () => {
    if (!sessaoMock || sessaoMock.eu.papel !== "society_admin") throw new Error("Não é society_admin");
    return sessaoMock;
  },
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async () => ({ id: "audit-1" }),
}));

const tabelaDe = (t: unknown) => {
  if (typeof t === "object" && t !== null) {
    if ("paraPapel" in t) return "notificacao";
    if ("processadoEm" in t) return "notificacoes_pendentes";
    if ("notificarSubmissoesEmail" in t) return "organizacao";
  }
  return String(t);
};

vi.mock("@/db", () => ({
  db: () => ({
    select: (cols?: unknown) => ({
      from: (t: unknown) => {
        const tab = tabelaDe(t);
        const ler = () => {
          const list = linhas[tab] ?? [];
          if (cols && typeof cols === "object" && "contagem" in (cols as Record<string, unknown>)) {
            return [{ contagem: list.filter((r) => !r.lidaEm).length }];
          }
          return list;
        };
        const queryObj = {
          leftJoin: () => queryObj,
          where: (cond?: unknown) => {
            const innerQuery = {
              limit: (n?: number) => (n ? ler().slice(0, n) : ler()),
              orderBy: () => ({
                limit: (n?: number) => (n ? ler().slice(0, n) : ler()),
                then: (res: any) => Promise.resolve(res(ler())),
              }),
              then: (res: any) => Promise.resolve(res(ler())),
            };
            return innerQuery;
          },
          orderBy: () => ({
            limit: (n?: number) => (n ? ler().slice(0, n) : ler()),
            then: (res: any) => Promise.resolve(res(ler())),
          }),
          then: (res: any) => Promise.resolve(res(ler())),
        };
        return queryObj;
      },
    }),
    insert: (t: unknown) => ({
      values: async (v: Linha) => {
        const tab = tabelaDe(t);
        const item = { id: `id-${Date.now()}-${Math.random()}`, ...v };
        inseridos.push({ tabela: tab, valores: item });
        (linhas[tab] ??= []).push(item);
        return [item];
      },
    }),
    update: (t: unknown) => ({
      set: (v: Linha) => ({
        where: async () => {
          const tab = tabelaDe(t);
          atualizados.push({ tabela: tab, valores: v });
          const list = linhas[tab] ?? [];
          for (const item of list) {
            Object.assign(item, v);
          }
          return list;
        },
      }),
    }),
  }),
}));

import {
  consultarNotificacoes,
  contarNotificacoesNaoLidas,
} from "./consultas";
import {
  registarNotificacao,
  enfileirarNotificacaoPendente,
} from "./servico";
import {
  marcarNotificacaoComoLida,
  marcarTodasComoLidas,
  alterarPreferenciaNotificacaoSubmissoes,
} from "./acoes";

describe("Frente P: Notificações in-app e resumo diário", () => {
  beforeEach(() => {
    inseridos.length = 0;
    atualizados.length = 0;
    linhas = {};
    sessaoMock = null;
  });

  describe("Consultas e Ações de Notificações In-App", () => {
    it("permite registar notificações in-app e consultá-las", async () => {
      await registarNotificacao({
        organizacaoId: "org-1",
        titulo: "Novo processo submetido: PMF-2026-0001",
        corpo: "Foi submetido um novo processo.",
        link: "/processos/proc-1",
      });

      expect(inseridos.length).toBe(1);
      expect(inseridos[0]?.tabela).toBe("notificacao");
      expect(inseridos[0]?.valores.titulo).toBe("Novo processo submetido: PMF-2026-0001");

      const notificacoes = await consultarNotificacoes({
        papel: "society_admin",
        organizacaoId: "org-1",
      });
      expect(notificacoes.length).toBe(1);
      expect(notificacoes[0]?.titulo).toBe("Novo processo submetido: PMF-2026-0001");
    });

    it("conta notificações não lidas corretamente", async () => {
      linhas["notificacao"] = [
        { id: "n1", organizacaoId: "org-1", titulo: "N1", lidaEm: null },
        { id: "n2", organizacaoId: "org-1", titulo: "N2", lidaEm: null },
        { id: "n3", organizacaoId: "org-1", titulo: "N3", lidaEm: new Date() },
      ];

      const contagem = await contarNotificacoesNaoLidas({
        papel: "society_admin",
        organizacaoId: "org-1",
      });
      expect(contagem).toBe(2);
    });

    it("permite marcar notificação como lida", async () => {
      linhas["notificacao"] = [
        { id: "n1", organizacaoId: "org-1", titulo: "N1", lidaEm: null },
      ];

      sessaoMock = {
        conta: { id: "u-1", email: "admin@pmf.pt" },
        eu: { id: "u-1", papel: "society_admin", organizacaoId: "org-1" },
      };

      const res = await marcarNotificacaoComoLida("n1");
      expect(res.ok).toBe(true);
      expect(atualizados.length).toBeGreaterThan(0);
      expect(atualizados[0]?.valores.lidaEm).toBeInstanceOf(Date);
    });

    it("permite marcar todas as notificações como lidas", async () => {
      linhas["notificacao"] = [
        { id: "n1", organizacaoId: "org-1", titulo: "N1", lidaEm: null },
        { id: "n2", organizacaoId: "org-1", titulo: "N2", lidaEm: null },
      ];

      sessaoMock = {
        conta: { id: "u-1", email: "admin@pmf.pt" },
        eu: { id: "u-1", papel: "society_admin", organizacaoId: "org-1" },
      };

      const res = await marcarTodasComoLidas();
      expect(res.ok).toBe(true);
      expect(atualizados.length).toBeGreaterThan(0);
      expect(atualizados[0]?.valores.lidaEm).toBeInstanceOf(Date);
    });

    it("permite alterar a preferência de notificação de submissões por email", async () => {
      linhas["organizacao"] = [
        { id: "org-1", nome: "PMF", notificarSubmissoesEmail: false },
      ];

      sessaoMock = {
        conta: { id: "u-1", email: "admin@pmf.pt" },
        eu: { id: "u-1", papel: "society_admin", organizacaoId: "org-1" },
      };

      const res = await alterarPreferenciaNotificacaoSubmissoes(true);
      expect(res.ok).toBe(true);
      expect(res.valor).toBe(true);
      expect(atualizados.find((a) => a.tabela === "organizacao")?.valores.notificarSubmissoesEmail).toBe(true);
    });

    it("R2-01: registarNotificacao e enfileirarNotificacaoPendente não são exportadas de './acoes' — não podem voltar a ser Server Actions", async () => {
      /*
       * `acoes.ts` tem `"use server"` no topo: o Next regista automaticamente
       * como Server Action pública toda a função `async` que esse ficheiro
       * exportar, com o próprio nome/id da função a servir de endpoint, sem
       * qualquer guarda a menos que o código a escreva. Foi assim que um `POST`
       * anónimo ao `Next-Action` de `registarNotificacao` e de
       * `enfileirarNotificacaoPendente` conseguia escrever notificações in-app
       * e entradas na fila sem sessão nenhuma (R2-01, pentest ronda 2) — eram
       * as únicas 2 das 53 Server Actions sem `exigirSessao()`.
       *
       * O fix não foi acrescentar `exigirSessao()`: as duas só são chamadas de
       * dentro de outra ação já autenticada, nunca precisaram de sessão
       * própria. O que precisavam era de deixar de ser alcançáveis por fora —
       * por isso mudaram-se para `./servico.ts`, um módulo sem `"use server"`.
       * Este teste falha se alguém as voltar a exportar daqui.
       */
      const acoes = await import("./acoes");
      expect((acoes as Record<string, unknown>).registarNotificacao).toBeUndefined();
      expect((acoes as Record<string, unknown>).enfileirarNotificacaoPendente).toBeUndefined();
    });
  });

  describe("Fila de Notificações Pendentes e Resumo Diário", () => {
    it("permite enfileirar notificações pendentes para o resumo diário", async () => {
      await enfileirarNotificacaoPendente({
        tipo: "sociedade_criada",
        organizacaoId: "org-2",
        dados: {
          nome: "Costa & Silva Advogados",
          nif: "501234567",
          prefixo: "CSA",
        },
      });

      expect(inseridos.length).toBe(1);
      expect(inseridos[0]?.tabela).toBe("notificacoes_pendentes");
      expect(inseridos[0]?.valores.tipo).toBe("sociedade_criada");
      expect(inseridos[0]?.valores.dados.nome).toBe("Costa & Silva Advogados");
    });

    it("gera o assunto do resumo diário corretamente com plurais", () => {
      const assunto1 = gerarAssuntoResumo({
        data: new Date("2026-08-28T09:00:00Z"),
        sociedadesCount: 1,
        utilizadoresCount: 1,
      });
      expect(assunto1).toContain("1 nova sociedade");
      expect(assunto1).toContain("1 novo utilizador");

      const assunto2 = gerarAssuntoResumo({
        data: new Date("2026-08-28T09:00:00Z"),
        sociedadesCount: 3,
        utilizadoresCount: 5,
      });
      expect(assunto2).toContain("3 novas sociedades");
      expect(assunto2).toContain("5 novos utilizadores");
    });

    it("gera o template HTML do Resumo Diário com a identidade da marca LexFlow", () => {
      const html = gerarResumoDiarioHtml({
        data: new Date("2026-08-28T09:00:00Z"),
        sociedades: [
          {
            nome: "Teixeira & Associados",
            nif: "501999884",
            prefixo: "TXA",
            adminNome: "Dr. Diogo",
            adminEmail: "diogo@txa.pt",
          },
        ],
        utilizadores: [
          {
            nome: "Dra. Maria Joana",
            email: "maria@txa.pt",
            sociedadeNome: "Teixeira & Associados",
            papel: "utilizador",
          },
        ],
        processosSubmetidos24h: 12,
        urlPainelAdmin: "https://poc.terlicalabs.com/admin",
      });

      expect(html).toContain("Resumo Operacional Terlica");
      expect(html).toContain("Teixeira &amp; Associados");
      expect(html).toContain("501999884");
      expect(html).toContain("TXA");
      expect(html).toContain("diogo@txa.pt");
      expect(html).toContain("Dra. Maria Joana");
      expect(html).toContain("maria@txa.pt");
      expect(html).toContain("https://poc.terlicalabs.com/admin");
    });
  });
});
