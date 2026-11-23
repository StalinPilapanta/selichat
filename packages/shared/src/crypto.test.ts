import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto.js";

const key = randomBytes(32).toString("base64");

describe("crypto", () => {
  it("cifra y descifra", () => {
    const enc = encryptSecret("sk-secreto-123", key);
    expect(enc).not.toContain("sk-secreto");
    expect(decryptSecret(enc, key)).toBe("sk-secreto-123");
  });

  it("usa IV aleatorio", () => {
    expect(encryptSecret("x", key)).not.toBe(encryptSecret("x", key));
  });

  it("falla con otra clave o si se altera", () => {
    const enc = encryptSecret("dato", key);
    expect(() => decryptSecret(enc, randomBytes(32).toString("base64"))).toThrow();
    const parts = enc.split(":");
    parts[3] = Buffer.from("otro").toString("base64");
    expect(() => decryptSecret(parts.join(":"), key)).toThrow();
  });

  it("rechaza claves de tamaño incorrecto", () => {
    expect(() => encryptSecret("x", Buffer.from("corta").toString("base64"))).toThrow();
  });

  it("acepta un texto largo como clave (derivada con SHA-256)", () => {
    const passphrase = "a".repeat(20) + "Zx9QwErTyUiOpAsDfGhJkL1234567890";
    const enc = encryptSecret("dato", passphrase);
    expect(decryptSecret(enc, passphrase)).toBe("dato");
    expect(() => decryptSecret(enc, key)).toThrow();
    expect(() => encryptSecret("x", "corta")).toThrow();
  });

  it("enmascara", () => {
    expect(maskSecret("sk-abcdef1234")).toBe("••••1234");
  });
});
