"use client";
import {
  AlertCircle,
  Bot,
  Check,
  CheckCheck,
  Clock,
  FileText,
  LayoutTemplate,
  MapPin,
  Megaphone,
} from "lucide-react";
import type { Message, TeamMember } from "./types";

function mediaSrc(m: Message) {
  // Entrante: se baja de Meta a través del API. Saliente: la URL pública con la que se envió.
  return m.direction === "in" ? `/api/messages/${m.id}/media` : (m.media?.url ?? "");
}

/** Estado del envío como en WhatsApp: reloj, ✓, ✓✓ y ✓✓ azul al leerse. */
function Ticks({ status }: { status: string }) {
  if (status === "pendiente") return <Clock className="size-3.5" aria-label="Enviando" />;
  if (status === "fallido")
    return <AlertCircle className="size-3.5 text-red-600" aria-label="No se envió" />;
  if (status === "leido")
    return <CheckCheck className="size-3.5 text-sky-500" aria-label="Leído" />;
  if (status === "entregado") return <CheckCheck className="size-3.5" aria-label="Entregado" />;
  return <Check className="size-3.5" aria-label="Enviado" />;
}

function Body({ m }: { m: Message }) {
  const src = mediaSrc(m);
  switch (m.type) {
    case "image":
    case "sticker":
      return (
        <>
          <a href={src} target="_blank" rel="noreferrer" className="block">
            {/* biome-ignore lint/performance/noImgElement: media de WhatsApp servida por el API */}
            <img
              src={src}
              alt={m.body || "Imagen"}
              className={`rounded-xl ${m.type === "sticker" ? "h-28 w-28" : "max-h-72 max-w-full"} object-contain`}
            />
          </a>
          {m.body && <p className="mt-1.5 whitespace-pre-wrap">{m.body}</p>}
        </>
      );
    case "video":
      return (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: videos de clientes sin subtítulos */}
          <video src={src} controls className="max-h-72 max-w-full rounded-xl" />
          {m.body && <p className="mt-1.5 whitespace-pre-wrap">{m.body}</p>}
        </>
      );
    case "audio":
      return (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: notas de voz */}
          <audio src={src} controls className="h-10 max-w-full" />
          {typeof m.data?.transcript === "string" && m.data.transcript ? (
            <p className="mt-1 whitespace-pre-wrap text-sm italic opacity-80">
              «{m.data.transcript}»
            </p>
          ) : m.data?.transcriptError ? (
            <p className="mt-1 text-xs opacity-70">No se pudo transcribir</p>
          ) : null}
        </>
      );
    case "document":
      return (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-xl bg-black/5 px-3 py-2 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
        >
          <FileText className="size-5 shrink-0 opacity-70" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{m.media?.filename || "Documento"}</span>
            {m.body && <span className="block truncate text-xs opacity-70">{m.body}</span>}
          </span>
        </a>
      );
    case "location": {
      const lat = m.data?.latitude;
      const lng = m.data?.longitude;
      return (
        <a
          href={`https://maps.google.com/?q=${lat},${lng}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 underline-offset-2 hover:underline"
        >
          <MapPin className="size-4 shrink-0" />
          {m.body || "Ubicación"}
        </a>
      );
    }
    case "template":
      return (
        <>
          <div className="mb-1 flex items-center gap-1 text-xs opacity-70">
            <LayoutTemplate className="size-3.5" />
            Plantilla {(m.data?.template as { name?: string })?.name}
          </div>
          <p className="whitespace-pre-wrap">{m.body}</p>
        </>
      );
    case "reaction":
      return <span className="text-2xl">{m.body}</span>;
    case "unsupported":
      return <span className="italic opacity-70">Mensaje no soportado por WhatsApp Cloud API</span>;
    default:
      return <p className="whitespace-pre-wrap break-words">{m.body}</p>;
  }
}

/**
 * Burbuja de chat. `first` = primera de un grupo del mismo remitente: lleva la «colita»
 * (esquina recta) y el autor; las siguientes van pegadas.
 */
export function MessageBubble({
  m,
  team,
  first = true,
}: {
  m: Message;
  team: TeamMember[];
  first?: boolean;
}) {
  const out = m.direction === "out";
  const author =
    m.author === "humano"
      ? (team.find((t) => t.id === m.authorUserId)?.name ?? "Equipo")
      : m.author === "ia"
        ? "IA"
        : m.author === "sistema"
          ? "Aviso automático"
          : null;
  const ref = m.data?.referral as { headline?: string; sourceId?: string } | undefined;
  const failed = m.status === "fallido";
  const tone = out
    ? failed
      ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
      : "border-brand-100 bg-brand-50 dark:border-brand-900 dark:bg-brand-950"
    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
  const tail = first ? (out ? "rounded-tr-md" : "rounded-tl-md") : "";
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"} ${first ? "mt-3" : "mt-0.5"}`}>
      <div
        className={`max-w-[85%] rounded-2xl border px-3 pt-2 pb-1.5 text-[14px] leading-snug shadow-sm sm:max-w-[68%] ${tone} ${tail}`}
      >
        {ref && (
          <div className="mb-2 flex items-start gap-1.5 rounded-xl bg-violet-50 px-2 py-1.5 text-xs text-violet-900 dark:bg-violet-950 dark:text-violet-200">
            <Megaphone className="mt-px size-3.5 shrink-0" />
            <span>
              Desde un anuncio{ref.headline ? `: ${ref.headline}` : ""}
              {ref.sourceId ? ` (#${ref.sourceId})` : ""}
            </span>
          </div>
        )}
        {author && first && (
          <div
            className={`mb-0.5 flex items-center gap-1 text-[11px] font-semibold ${
              m.author === "ia" ? "text-brand-700 dark:text-brand-300" : "opacity-60"
            }`}
          >
            {m.author === "ia" && <Bot className="size-3" />}
            {author}
          </div>
        )}
        <Body m={m} />
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] tabular-nums opacity-60">
          {new Date(m.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {out && <Ticks status={m.status} />}
        </div>
        {failed && m.error && (
          <div className="mt-1 text-xs text-red-700 dark:text-red-300">
            {m.error.title}
            {m.error.detail ? `: ${m.error.detail}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

/** Nota interna del equipo dentro del hilo (el cliente no la ve). */
export function NoteBubble({ body, author, at }: { body: string; author: string; at: string }) {
  return (
    <div className="mt-3 flex justify-center">
      <div className="max-w-[85%] rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 shadow-sm sm:max-w-[68%] dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
        <div className="mb-0.5 text-[11px] font-semibold opacity-70">
          Nota interna · {author} ·{" "}
          {new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
        <p className="whitespace-pre-wrap">{body}</p>
      </div>
    </div>
  );
}
