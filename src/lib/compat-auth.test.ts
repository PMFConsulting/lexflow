import { describe, expect, it } from "vitest";
import { hashPassword as betterAuthHash, verifyPassword as betterAuthVerify } from "better-auth/crypto";
import { hashPassword, verifyPassword } from "./compat-auth";

describe("compat-auth (BUG-001)", () => {
  it("generates a hash in salt:scrypt hex format that matches better-auth structure", async () => {
    const pwd = "minha-password-segura-123";
    const hash = await hashPassword(pwd);

    expect(typeof hash).toBe("string");
    const [salt, key] = hash.split(":");
    expect(salt).toHaveLength(32); // 16 bytes in hex
    expect(key).toHaveLength(128); // 64 bytes in hex
  });

  it("verifies correctly with compat-auth verifyPassword", async () => {
    const pwd = "outra-password-teste-456";
    const hash = await hashPassword(pwd);

    const ok = await verifyPassword(hash, pwd);
    expect(ok).toBe(true);

    const errado = await verifyPassword(hash, "password-errada");
    expect(errado).toBe(false);
  });

  it("cross-verifies: hash from compat-auth is verifiable by better-auth/crypto", async () => {
    const pwd = "password-interoperabilidade-789";
    const hash = await hashPassword(pwd);

    const ok = await betterAuthVerify({ hash, password: pwd });
    expect(ok).toBe(true);
  });

  it("cross-verifies: hash from better-auth/crypto is verifiable by compat-auth", async () => {
    const pwd = "password-better-auth-criada";
    const hash = await betterAuthHash(pwd);

    const ok = await verifyPassword(hash, pwd);
    expect(ok).toBe(true);
  });

  it("handles malformed hash safely", async () => {
    expect(await verifyPassword("invalido", "pwd")).toBe(false);
    expect(await verifyPassword("", "pwd")).toBe(false);
  });
});
