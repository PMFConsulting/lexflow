import { createAuthClient } from "better-auth/react";

/** Better Auth client for the login and sign-up forms. */
export const clienteAuth = createAuthClient();

export const { signIn, signUp, signOut, useSession } = clienteAuth;
