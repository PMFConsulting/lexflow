/**
 * Substituto do pacote `server-only` durante os testes.
 *
 * O pacote real resolve para um módulo que lança — é essa a forma de ele
 * impedir que um módulo de servidor entre no pacote do cliente. Fora do Next
 * não há condição `react-server` para o desviar, por isso qualquer teste que
 * toque num ficheiro com `import "server-only"` rebentava na importação, antes
 * de chegar a correr. O alias está em `vitest.config.ts`.
 */
export {};
