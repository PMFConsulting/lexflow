import type { NextConfig } from "next";

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
};

export default nextConfig;
