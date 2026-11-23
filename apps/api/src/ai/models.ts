import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { type Database, schema, withTenant } from "@chatea/db";
import { type AgentKind, type AiProviderKind, decryptSecret } from "@chatea/shared";
import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";

export class AiNotConfiguredError extends Error {
  constructor(public agent: AgentKind) {
    super("ia_no_configurada");
  }
}

export function buildModel(
  kind: AiProviderKind,
  apiKey: string,
  model: string,
  baseUrl?: string | null,
): LanguageModel {
  switch (kind) {
    case "anthropic":
      return createAnthropic({ apiKey })(model);
    case "openai":
      return createOpenAI({ apiKey })(model);
    case "xai":
      return createXai({ apiKey })(model);
    case "google":
      return createGoogle({ apiKey })(model);
    case "openai_compatible":
      return createOpenAICompatible({ name: "custom", apiKey, baseURL: baseUrl ?? "" })(model);
  }
}

export interface ResolvedModel {
  model: LanguageModel;
  temperature: number;
  label: string;
}

export type ModelResolver = (tenantId: string, agent: AgentKind) => Promise<ResolvedModel>;

/** Modelo configurado por el tenant para un agente; la API key se descifra solo aquí. */
export function createModelResolver(db: Database, encryptionKey: string): ModelResolver {
  return async (tenantId, agent) => {
    const row = await withTenant(db, tenantId, async (tx) => {
      const [r] = await tx
        .select({
          model: schema.agentConfigs.model,
          temperature: schema.agentConfigs.temperature,
          kind: schema.aiProviders.kind,
          apiKeyEnc: schema.aiProviders.apiKeyEnc,
          baseUrl: schema.aiProviders.baseUrl,
        })
        .from(schema.agentConfigs)
        .innerJoin(schema.aiProviders, eq(schema.aiProviders.id, schema.agentConfigs.providerId))
        .where(eq(schema.agentConfigs.agent, agent));
      return r;
    });
    if (!row?.model) throw new AiNotConfiguredError(agent);
    const apiKey = decryptSecret(row.apiKeyEnc, encryptionKey);
    return {
      model: buildModel(row.kind as AiProviderKind, apiKey, row.model, row.baseUrl),
      temperature: row.temperature,
      label: `${row.kind}/${row.model}`,
    };
  };
}
