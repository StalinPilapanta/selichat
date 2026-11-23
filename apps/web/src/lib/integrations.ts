/** Integraciones de la tienda: las disponibles y las que llegan en próximas fases. */
export interface IntegrationInfo {
  key: string;
  name: string;
  description: string;
  href?: string;
  phase?: string;
}

export const INTEGRATIONS: IntegrationInfo[] = [
  {
    key: "ia",
    name: "Modelos de IA",
    description:
      "Claude, OpenAI, Grok o Gemini con tus propias API keys, y qué modelo usa cada agente.",
    href: "/panel/integraciones/ia",
  },
  {
    key: "whatsapp",
    name: "WhatsApp",
    description: "Tu número de WhatsApp Business (Cloud API de Meta) y sus plantillas.",
    href: "/panel/integraciones/whatsapp",
  },
  {
    key: "dropi",
    name: "Dropi",
    description: "Crear pedidos, cotizar envíos, huella del comprador y estados logísticos.",
    phase: "Fase 4",
  },
  {
    key: "meta",
    name: "Meta (Conversiones)",
    description: "Eventos de compra y lead hacia tus campañas de Meta Ads.",
    phase: "Fase 4",
  },
  {
    key: "sms",
    name: "SMS",
    description: "Avisos logísticos por SMS cuando WhatsApp no llega.",
    phase: "Fase 5",
  },
  {
    key: "voz",
    name: "Voz con IA",
    description: "Audios de cierre y llamadas de confirmación con IA (ElevenLabs).",
    phase: "Fase 5",
  },
  {
    key: "pagos",
    name: "Pagos anticipados",
    description: "Links de pago para cobrar parte del envío (Confio, Payphone…).",
    phase: "Fase 7",
  },
  {
    key: "tiendas",
    name: "Shopify / WooCommerce",
    description: "Carritos abandonados y catálogo desde tu tienda online.",
    phase: "Fase 7",
  },
];
