import { createAuthClient } from "better-auth/react";

/** Cliente do Better Auth para os formulários de entrada e registo. */
export const clienteAuth = createAuthClient();

export const { signIn, signUp, signOut, useSession } = clienteAuth;
