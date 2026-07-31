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
};

export default nextConfig;
