import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { type Database, schema, withTenant } from "@chatea/db";
import { type AgentKind, type AiProviderKind, decryptSecret } from "@chatea/shared";
import type { LanguageModel, TranscriptionModel } from "ai";
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
  /** Proveedor; decide si se le pueden mandar imágenes. */
  kind?: AiProviderKind;
}

/** Proveedores cuyos modelos de chat aceptan imágenes. */
export const VISION_KINDS: AiProviderKind[] = ["anthropic", "openai", "xai", "google"];

/** Modelo de transcripción por proveedor (Anthropic y los compatibles no transcriben). */
export function buildTranscriber(kind: AiProviderKind, apiKey: string): TranscriptionModel | null {
  switch (kind) {
    case "openai":
      return createOpenAI({ apiKey }).transcription("gpt-4o-mini-transcribe");
    case "xai":
      return createXai({ apiKey }).transcription("grok-voice-transcribe-2.0");
    case "google":
      return createGoogle({ apiKey }).transcription("gemini-3.5-transcribe");
    default:
      return null;
  }
}

export type TranscriberResolver = (tenantId: string) => Promise<TranscriptionModel | null>;

/**
 * Transcriptor del tenant: primero el proveedor del agente de ventas; si no transcribe
 * (p. ej. Claude), cualquier otro proveedor conectado que sí lo haga.
 */
export function createTranscriberResolver(
  db: Database,
  encryptionKey: string,
): TranscriberResolver {
  return async (tenantId) => {
    const rows = await withTenant(db, tenantId, async (tx) => {
      const [agent] = await tx
        .select({ providerId: schema.agentConfigs.providerId })
        .from(schema.agentConfigs)
        .where(eq(schema.agentConfigs.agent, "ventas"));
      const providers = await tx
        .select({
          id: schema.aiProviders.id,
          kind: schema.aiProviders.kind,
          apiKeyEnc: schema.aiProviders.apiKeyEnc,
        })
        .from(schema.aiProviders);
      return providers.sort(
        (a, b) => Number(b.id === agent?.providerId) - Number(a.id === agent?.providerId),
      );
    });
    for (const p of rows) {
      const kind = p.kind as AiProviderKind;
      if (!["openai", "xai", "google"].includes(kind)) continue;
      return buildTranscriber(kind, decryptSecret(p.apiKeyEnc, encryptionKey));
    }
    return null;
  };
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
      kind: row.kind as AiProviderKind,
    };
  };
}
