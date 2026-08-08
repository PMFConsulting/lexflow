import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * O alias `@/` existe no `tsconfig.json` e é o que todo o código-fonte usa
 * (79 importações em 26 ficheiros). O Next resolve-o sozinho; o Vitest não lê
 * os `paths` do TypeScript, por isso tem de o saber aqui.
 *
 * Enquanto nenhum módulo com testes importava por alias, a falta passou
 * despercebida — os testes só se viam a si próprios, com caminhos relativos.
 * `schemas.ts` importa `@/lib/validacao-pt` e foi aí que partiu. Repor o alias
 * é mais barato do que abrir uma exceção de estilo num ficheiro só: o próximo
 * módulo testado que importe por `@/` volta a partir da mesma maneira.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
