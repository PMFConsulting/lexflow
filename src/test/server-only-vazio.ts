/**
 * Stand-in for the `server-only` package during the tests.
 *
 * The real package resolves to a module that throws — that is how it stops a
 * server module from entering the client bundle. Outside Next there is no
 * `react-server` condition to divert it, so any test touching a file with
 * `import "server-only"` blew up on import, before it even ran. The alias is in
 * `vitest.config.ts`.
 */
export {};
