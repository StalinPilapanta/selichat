import { z } from "zod";

/**
 * Proveedores de IA que un tenant puede conectar desde el CRM.
 * Cada agente (ventas, confirmación, seguimiento, novedades) elige proveedor + modelo.
 * "openai_compatible" cubre OpenRouter, Groq, DeepSeek, Ollama, etc. con una base URL.
 */
export const AI_PROVIDER_KINDS = [
  "anthropic",
  "openai",
  "xai",
  "google",
  "openai_compatible",
] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export const AI_PROVIDER_LABELS: Record<AiProviderKind, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  xai: "xAI (Grok)",
  google: "Google (Gemini)",
  openai_compatible: "Compatible con OpenAI (OpenRouter, Groq, DeepSeek…)",
};

export const AGENT_KINDS = [
  "ventas",
  "confirmacion",
  "seguimiento",
  "novedades",
  "utilidad",
] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const aiProviderInputSchema = z.object({
  kind: z.enum(AI_PROVIDER_KINDS),
  name: z.string().min(1).max(80),
  apiKey: z.string().min(1),
  baseUrl: z.url().optional(),
});
export type AiProviderInput = z.infer<typeof aiProviderInputSchema>;
