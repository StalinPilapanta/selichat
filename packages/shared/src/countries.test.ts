import { describe, expect, it } from "vitest";
import { internationalPhone } from "./countries.js";

describe("WhatsApp del dueño", () => {
  it("quita el 0 de la operadora y antepone el prefijo del país", () => {
    expect(internationalPhone("593", "0991234567")).toBe("593991234567");
    expect(internationalPhone("593", "099 123 4567")).toBe("593991234567");
    expect(internationalPhone("593", "+593 99 123 4567")).toBe("593991234567");
    expect(internationalPhone("57", "300 123 4567")).toBe("573001234567");
  });
  it("rechaza números incompletos", () => {
    expect(internationalPhone("593", "09912")).toBe("");
    expect(internationalPhone("593", "")).toBe("");
  });
});
