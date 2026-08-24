import type { NextConfig } from "next";

/**
 * Content-Security-Policy.
 *
 * O que faltava, e é a rede por baixo de tudo o resto: um XSS nesta plataforma
 * não é um `alert(1)` — é um script na página do onboarding a ler o token do
 * URL, que é o único fator de autenticação do dossier (D4), ou no back-office a
 * ler os documentos de identificação que a sessão já abriu.
 *
 * Duas concessões, e ambas medidas:
 *
 * · **`script-src 'unsafe-inline'`.** O App Router injeta o payload de
 *   hidratação em `<script>` inline (`self.__next_f.push(...)`). Sem `nonce`
 *   não há como os distinguir de um script injetado, e o `nonce` obriga a
 *   gerar um por pedido no `middleware` e a servir todas as páginas
 *   dinamicamente — o que custa o cache estático de uma POC inteira para
 *   fechar um vetor que o `default-src 'self'` já reduz a "inline apenas".
 *   Fica assinalado aqui como o degrau seguinte, e não escondido.
 *
 * · **`style-src 'unsafe-inline'`.** O `LeitorProposta` injeta o `<style>` do
 *   `/custos.html` com `dangerouslySetInnerHTML`, e o Tailwind e o Radix
 *   escrevem estilos inline em elementos. Estilo inline não executa código.
 *
 * O que a política fecha de facto: `object-src 'none'` (sem Flash, sem
 * `<embed>` de um PDF de terceiros), `frame-ancestors 'none'` (clickjacking —
 * a mesma regra do `X-Frame-Options`, agora na norma que os browsers atuais
 * lêem), `base-uri 'self'` (uma etiqueta `<base>` injetada reescrevia todos os
 * links relativos da página para um domínio à escolha), `form-action 'self'`
 * (um formulário injetado não submete credenciais para fora) e — o que mais
 * conta — `connect-src 'self'`, que impede um script já a correr de mandar o
 * que leu para qualquer sítio.
 *
 * `'unsafe-eval'` só em desenvolvimento: o React Refresh precisa dele, a
 * produção não.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // `blob:` é o que a rubrica do passo 7 usa para se pré-visualizar a si
  // própria antes de ser gravada.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // `ws:` em desenvolvimento é o canal do hot reload.
  `connect-src 'self'${process.env.NODE_ENV === "development" ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  // Só em produção: em desenvolvimento a aplicação corre em `http://localhost`
  // e esta diretiva mandava o browser procurar um `https` que não existe.
  ...(process.env.NODE_ENV === "development" ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  /**
   * Saída autónoma: o Next traça as dependências que a aplicação usa mesmo e
   * escreve um servidor mínimo em `.next/standalone`.
   *
   * Sem isto a imagem Docker leva o `node_modules` inteiro — cerca de 800 MB
   * em vez de ~150 MB. Num servidor de 4 GB, isso conta.
   */
  output: "standalone",

  experimental: {
    /**
     * As Server Actions aceitam 1 MB por omissão, e um documento de
     * identificação fotografado passa isso à vontade. O limite real de negócio
     * são 4 MB, validado em `documentos.ts`; aqui fica com folga para o
     * base64 e o resto do corpo do pedido caberem.
     */
    serverActions: { bodySizeLimit: "6mb" },
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Fica ao lado do `frame-ancestors 'none'` da CSP, e não em vez dele:
          // é a mesma regra para browsers que ainda não leem a segunda.
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
