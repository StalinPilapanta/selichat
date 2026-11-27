/** Integraciones de la tienda: las disponibles y las que llegan en próximas fases. */
import {
  CreditCard,
  type LucideIcon,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  Mic,
  Sparkles,
  Store,
  Truck,
} from "lucide-react";

export interface IntegrationInfo {
  key: string;
  name: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  phase?: string;
}

export const INTEGRATIONS: IntegrationInfo[] = [
  {
    key: "ia",
    icon: Sparkles,
    name: "Modelos de IA",
    description:
      "Claude, OpenAI, Grok o Gemini con tus propias API keys, y qué modelo usa cada agente.",
    href: "/panel/integraciones/ia",
  },
  {
    key: "whatsapp",
    icon: MessageCircle,
    name: "WhatsApp",
    description: "Tu número de WhatsApp Business (Cloud API de Meta) y sus plantillas.",
    href: "/panel/integraciones/whatsapp",
  },
  {
    key: "dropi",
    icon: Truck,
    name: "Dropi",
    description:
      "Sube los pedidos confirmados, valida la cobertura y recibe los estados logísticos.",
    href: "/panel/integraciones/dropi",
  },
  {
    key: "meta",
    icon: Megaphone,
    name: "Meta (Conversiones)",
    description: "Eventos de compra y lead hacia tus campañas de Meta Ads.",
    phase: "Fase 4",
  },
  {
    key: "sms",
    icon: MessageSquareText,
    name: "SMS",
    description: "Avisos logísticos por SMS cuando WhatsApp no llega.",
    phase: "Fase 5",
  },
  {
    key: "voz",
    icon: Mic,
    name: "Voz con IA",
    description: "Audios de cierre y llamadas de confirmación con IA (ElevenLabs).",
    phase: "Fase 5",
  },
  {
    key: "pagos",
    icon: CreditCard,
    name: "Pagos anticipados",
    description: "Links de pago para cobrar parte del envío (Confio, Payphone…).",
    phase: "Fase 7",
  },
  {
    key: "tiendas",
    icon: Store,
    name: "Shopify / WooCommerce",
    description: "Carritos abandonados y catálogo desde tu tienda online.",
    phase: "Fase 7",
  },
];
