"use client";
import type { Message, TeamMember } from "./types";

const TICKS: Record<string, string> = {
  pendiente: "🕓",
  enviado: "✓",
  entregado: "✓✓",
  leido: "✓✓",
  fallido: "⚠",
};

function mediaSrc(m: Message) {
  // Entrante: se baja de Meta a través del API. Saliente: la URL pública con la que se envió.
  return m.direction === "in" ? `/api/messages/${m.id}/media` : (m.media?.url ?? "");
}

function Body({ m }: { m: Message }) {
  const src = mediaSrc(m);
  switch (m.type) {
    case "image":
    case "sticker":
      return (
        <>
          <a href={src} target="_blank" rel="noreferrer">
            {/* biome-ignore lint/performance/noImgElement: media de WhatsApp servida por el API */}
            <img
              src={src}
              alt={m.body || "Imagen"}
              className={`rounded-lg ${m.type === "sticker" ? "h-28 w-28" : "max-h-72 max-w-full"} object-contain`}
            />
          </a>
          {m.body && <p className="mt-1 whitespace-pre-wrap">{m.body}</p>}
        </>
      );
    case "video":
      return (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: videos de clientes sin subtítulos */}
          <video src={src} controls className="max-h-72 max-w-full rounded-lg" />
          {m.body && <p className="mt-1 whitespace-pre-wrap">{m.body}</p>}
        </>
      );
    case "audio":
      return (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: notas de voz */}
          <audio src={src} controls className="max-w-full" />
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
        <a href={src} target="_blank" rel="noreferrer" className="underline">
          📄 {m.media?.filename || "Documento"}
          {m.body ? ` — ${m.body}` : ""}
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
          className="underline"
        >
          📍 {m.body}
        </a>
      );
    }
    case "template":
      return (
        <>
          <div className="mb-1 text-xs opacity-70">
            📋 Plantilla {(m.data?.template as { name?: string })?.name}
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

export function MessageBubble({ m, team }: { m: Message; team: TeamMember[] }) {
  const out = m.direction === "out";
  const author =
    m.author === "humano"
      ? (team.find((t) => t.id === m.authorUserId)?.name ?? "Equipo")
      : m.author === "ia"
        ? "IA"
        : null;
  const ref = m.data?.referral as { headline?: string; sourceId?: string } | undefined;
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${
          out
            ? m.status === "fallido"
              ? "bg-red-50 dark:bg-red-950"
              : "bg-brand-100 dark:bg-brand-900"
            : "bg-white dark:bg-zinc-800"
        }`}
      >
        {ref && (
          <div className="mb-2 rounded-lg bg-black/5 px-2 py-1 text-xs dark:bg-white/10">
            📣 Desde anuncio{ref.headline ? `: ${ref.headline}` : ""}{" "}
            {ref.sourceId ? `(#${ref.sourceId})` : ""}
          </div>
        )}
        {author && <div className="mb-0.5 text-[11px] font-medium opacity-60">{author}</div>}
        <Body m={m} />
        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] opacity-60">
          {new Date(m.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {out && (
            <span className={m.status === "leido" ? "text-sky-600 opacity-100" : ""}>
              {TICKS[m.status] ?? ""}
            </span>
          )}
        </div>
        {m.status === "fallido" && m.error && (
          <div className="mt-1 text-xs text-red-700 dark:text-red-300">
            {m.error.title}
            {m.error.detail ? `: ${m.error.detail}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}
