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
      /**
       * O `server-only` real resolve para um módulo que lança de propósito —
       * é assim que impede um ficheiro de servidor de entrar no pacote do
       * cliente. Fora do Next não há condição `react-server` que o desvie, e
       * qualquer teste sobre um módulo de servidor (`lib/email.ts`, por
       * exemplo) morria na importação, antes da primeira asserção.
       */
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-vazio.ts", import.meta.url),
      ),
    },
  },
  test: {
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
