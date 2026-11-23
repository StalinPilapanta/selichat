import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, recommendedModel } from "./ai-models.js";
import { AGENT_KINDS, AI_PROVIDER_KINDS } from "./ai-providers.js";

describe("MODEL_CATALOG", () => {
  it("Claude, OpenAI y xAI recomiendan un modelo para cada agente", () => {
    for (const kind of ["anthropic", "openai", "xai"] as const) {
      for (const agent of AGENT_KINDS)
        expect(recommendedModel(kind, agent), `${kind}/${agent}`).toBeDefined();
    }
  });
  it("IDs únicos y como máximo una recomendación por agente y proveedor", () => {
    for (const kind of AI_PROVIDER_KINDS) {
      const ids = MODEL_CATALOG[kind].map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const agent of AGENT_KINDS) {
        expect(
          MODEL_CATALOG[kind].filter((m) => m.recommendedFor.includes(agent)).length,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});
