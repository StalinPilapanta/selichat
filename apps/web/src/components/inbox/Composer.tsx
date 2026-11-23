"use client";
import { windowRemainingMs } from "@chatea/shared";
import { useEffect, useRef, useState } from "react";
import { ErrorText } from "@/components/ui";
import { api, errorMessage, uploadFile } from "@/lib/api";
import type { ConversationDetail, Template } from "./types";

function remaining(lastInboundAt: string | null) {
  const ms = windowRemainingMs(lastInboundAt);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function Composer({ conv, onSent }: { conv: ConversationDetail; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tplId, setTplId] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const open = conv.windowOpen;

  useEffect(() => {
    if (open) return;
    api<Template[]>(`/api/channels/${conv.channelId}/templates`)
      .then((t) => setTemplates(t.filter((x) => x.status === "APPROVED")))
      .catch(() => setTemplates([]));
  }, [open, conv.channelId]);

  const tpl = templates.find((t) => t.id === tplId);
  const tplText = tpl?.components.find((c) => c.type.toUpperCase() === "BODY")?.text ?? "";
  const nVars = Math.max(0, ...[...tplText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));

  async function send(body: object) {
    setBusy(true);
    setError("");
    try {
      const msg = await api<{ status: string; error?: { title?: string; detail?: string } }>(
        `/api/conversations/${conv.id}/messages`,
        { method: "POST", body },
      );
      if (msg.status === "fallido")
        setError(`${msg.error?.title ?? "No se envió"}: ${msg.error?.detail ?? ""}`);
      onSent();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendText() {
    const body = text.trim();
    if (!body) return;
    if (await send({ kind: "text", body })) setText("");
  }

  async function sendFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const up = await uploadFile(file);
      await send({
        kind: "media",
        mediaType: up.kind,
        url: up.url,
        caption: text.trim() || undefined,
        filename: up.kind === "document" ? file.name : undefined,
      });
      setText("");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="space-y-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Pasaron más de 24 h desde el último mensaje del cliente (o nunca escribió). WhatsApp solo
          permite enviar una plantilla aprobada.
        </p>
        {templates.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No hay plantillas aprobadas. Créalas o sincronízalas en Integraciones → WhatsApp.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <select
              className="input max-w-xs"
              aria-label="Plantilla"
              value={tplId}
              onChange={(e) => {
                setTplId(e.target.value);
                setParams([]);
              }}
            >
              <option value="">Elegir plantilla…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
            {Array.from({ length: nVars }, (_, k) => k + 1).map((n) => (
              <input
                key={`p-${n}`}
                className="input max-w-[12rem]"
                placeholder={`{{${n}}}`}
                aria-label={`Variable ${n}`}
                value={params[n - 1] ?? ""}
                onChange={(e) => {
                  const p = [...params];
                  p[n - 1] = e.target.value;
                  setParams(p);
                }}
              />
            ))}
            <button
              type="button"
              className="btn"
              disabled={busy || !tpl || params.filter(Boolean).length < nVars}
              onClick={async () => {
                if (
                  await send({
                    kind: "template",
                    templateId: tplId,
                    params: params.slice(0, nVars),
                  })
                ) {
                  setTplId("");
                  setParams([]);
                }
              }}
            >
              Enviar plantilla
            </button>
          </div>
        )}
        {tpl && (
          <p className="text-sm text-zinc-500">
            {tplText.replace(/\{\{(\d+)\}\}/g, (w, n) => params[Number(n) - 1] || w)}
          </p>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 text-[11px] text-zinc-500">
        Ventana de 24 h abierta · quedan {remaining(conv.lastInboundAt)}
      </div>
      <div className="flex items-end gap-2">
        <button
          type="button"
          className="btn-ghost px-3"
          aria-label="Adjuntar archivo"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          📎
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/ogg,audio/mp4,application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) sendFile(f);
            e.target.value = "";
          }}
        />
        <textarea
          className="input max-h-40 min-h-[2.5rem] flex-1 resize-none"
          rows={1}
          placeholder="Escribe un mensaje… (Enter envía, Shift+Enter nueva línea)"
          aria-label="Mensaje"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendText();
            }
          }}
        />
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={sendText}>
          Enviar
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
