"use client";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { useActiveOrganization, useSession } from "@/lib/auth-client";

const STEPS = [
  {
    title: "Invita a tu equipo",
    desc: "Asesores y logística con su propio rol.",
    href: "/panel/equipo",
  },
  {
    title: "Conecta un modelo de IA",
    desc: "Claude, OpenAI, Grok, Gemini u OpenRouter, y elige el modelo de cada agente.",
    href: "/panel/integraciones/ia",
  },
  {
    title: "Define país, moneda y horario",
    desc: "Horario en el que la IA puede escribir a tus clientes.",
    href: "/panel/configuracion",
  },
  {
    title: "Carga tus productos y prompts",
    desc: "Créalos a mano, con IA desde la ficha, o impórtalos desde Chatea Pro.",
    href: "/panel/catalogo",
  },
  {
    title: "Conecta WhatsApp",
    desc: "Tu número de WhatsApp Business y sus plantillas; los mensajes llegan a Conversaciones.",
    href: "/panel/integraciones/whatsapp",
  },
  {
    title: "Conecta Dropi",
    desc: "Con tu cuenta de Dropi: los pedidos confirmados se suben solos y su estado vuelve aquí.",
    href: "/panel/integraciones/dropi",
  },
];

export default function Page() {
  const { data: session } = useSession();
  const { data: org } = useActiveOrganization();
  return (
    <>
      <PageHeader
        title={`Hola, ${session?.user.name ?? ""}`}
        description={`Estás en ${org?.name ?? ""}. Así queda lista tu tienda:`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((s) => {
          const cls = `card h-full ${s.href ? "hover:border-brand-500" : "opacity-60"}`;
          const content = (
            <>
              <div className="font-medium">{s.title}</div>
              <div className="mt-1 text-sm text-zinc-500">{s.desc}</div>
            </>
          );
          return s.href ? (
            <Link key={s.title} href={s.href} className={cls}>
              {content}
            </Link>
          ) : (
            <div key={s.title} className={cls}>
              {content}
            </div>
          );
        })}
      </div>
    </>
  );
}
