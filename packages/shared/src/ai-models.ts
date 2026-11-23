import type { AgentKind, AiProviderKind } from "./ai-providers.js";

/**
 * Modelos recomendados por proveedor y agente.
 * Es una guía editable: la pantalla de IA cruza esta lista con los modelos que
 * devuelve la API del proveedor con la key del tenant, y marca los que no existan.
 * Revisar al menos cada trimestre. Última revisión: 2026-11-21.
 */
export type ModelTier = "premium" | "balanceado" | "economico";

export interface ModelOption {
  id: string;
  label: string;
  tier: ModelTier;
  note: string;
  recommendedFor: AgentKind[];
}

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  premium: "Premium",
  balanceado: "Balanceado",
  economico: "Económico",
};

export const MODEL_CATALOG: Record<AiProviderKind, ModelOption[]> = {
  anthropic: [
    {
      id: "claude-sonnet-5-5",
      label: "Claude Sonnet 5.5",
      tier: "balanceado",
      note: "Mejor relación calidad/costo para vender y resolver novedades; herramientas muy confiables.",
      recommendedFor: ["ventas", "novedades"],
    },
    {
      id: "claude-haiku-5-5",
      label: "Claude Haiku 5.5",
      tier: "economico",
      note: "Rápido y barato: confirmaciones, avisos de seguimiento y tareas cortas.",
      recommendedFor: ["confirmacion", "seguimiento", "utilidad"],
    },
    {
      id: "claude-opus-5-5",
      label: "Claude Opus 5.5",
      tier: "premium",
      note: "Máxima calidad para productos de ticket alto; varias veces más caro.",
      recommendedFor: [],
    },
  ],
  openai: [
    {
      id: "gpt-6.1-terra",
      label: "GPT-6.1 Terra",
      tier: "balanceado",
      note: "Buen equilibrio para conversaciones de venta.",
      recommendedFor: ["ventas", "novedades"],
    },
    {
      id: "gpt-6-luna",
      label: "GPT-6 Luna",
      tier: "economico",
      note: "Muy barato: confirmaciones, seguimiento y clasificación.",
      recommendedFor: ["confirmacion", "seguimiento", "utilidad"],
    },
    {
      id: "gpt-6.1-sol",
      label: "GPT-6.1 Sol",
      tier: "premium",
      note: "El más capaz de OpenAI; úsalo si Terra no alcanza.",
      recommendedFor: [],
    },
    {
      id: "gpt-5.4-mini",
      label: "GPT-5.4 mini",
      tier: "economico",
      note: "Generación anterior; alternativa si tu cuenta no tiene Luna.",
      recommendedFor: [],
    },
  ],
  xai: [
    {
      id: "grok-4.7",
      label: "Grok 4.7",
      tier: "balanceado",
      note: "Modelo principal de xAI; contexto largo para conversaciones extensas.",
      recommendedFor: ["ventas", "novedades"],
    },
    {
      id: "grok-4-1-fast-non-reasoning",
      label: "Grok 4.1 Fast",
      tier: "economico",
      note: "Muy barato y rápido para avisos y tareas cortas.",
      recommendedFor: ["confirmacion", "seguimiento", "utilidad"],
    },
    {
      id: "grok-4.20",
      label: "Grok 4.20",
      tier: "balanceado",
      note: "El que usa hoy tu agente de ventas en Chatea Pro.",
      recommendedFor: [],
    },
  ],
  google: [
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      tier: "balanceado",
      note: "Alternativa para ventas.",
      recommendedFor: ["ventas"],
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      tier: "economico",
      note: "Barato para tareas cortas.",
      recommendedFor: ["confirmacion", "seguimiento", "utilidad"],
    },
  ],
  openai_compatible: [],
};

export function recommendedModel(kind: AiProviderKind, agent: AgentKind): ModelOption | undefined {
  return MODEL_CATALOG[kind].find((m) => m.recommendedFor.includes(agent));
}
