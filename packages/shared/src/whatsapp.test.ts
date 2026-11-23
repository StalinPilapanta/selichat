import { describe, expect, it } from "vitest";
import { normalizeRecipient, windowOpen, windowRemainingMs } from "./whatsapp.js";

describe("whatsapp utils", () => {
  it("normaliza wa_id de Argentina y México", () => {
    expect(normalizeRecipient("5491122334455")).toBe("541122334455");
    expect(normalizeRecipient("5215512345678")).toBe("525512345678");
    expect(normalizeRecipient("+593 99 123 4567")).toBe("593991234567");
  });
  it("ventana de 24 horas", () => {
    const now = Date.parse("2026-11-21T12:00:00Z");
    expect(windowOpen(null, now)).toBe(false);
    expect(windowOpen("2026-11-20T12:30:00Z", now)).toBe(true);
    expect(windowOpen("2026-11-20T11:59:00Z", now)).toBe(false);
    expect(windowRemainingMs("2026-11-21T11:00:00Z", now)).toBe(23 * 3600 * 1000);
  });
});
