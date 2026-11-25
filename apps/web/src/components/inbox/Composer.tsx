"use client";
/**
 * Caja de escritura: «Responder» o «Nota interna» (Alt+R / Alt+N), borrador por conversación,
 * respuestas rápidas con «/», adjuntar con el clip, arrastrando o pegando una imagen, y si
 * pasaron las 24 h, el envío de una plantilla aprobada.
 */
import { windowRemainingMs } from "@chatea/shared";
import {
  Clock,
  LayoutTemplate,
  Lock,
  Paperclip,
  Plus,
  SendHorizontal,
  Trash2,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorText } from "@/components/ui";
import { api, errorMessage, uploadFile } from "@/lib/api";
import type { ConversationDetail, QuickReply, Template } from "./types";

const ACCEPT =
  "image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/ogg,audio/mp4,application/pdf";

function remaining(lastInboundAt: string | null) {
  const ms = windowRemainingMs(lastInboundAt);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return { ms, label: h ? `${h} h ${m} min` : `${m} min` };
}

const draftKey = (id: string) => `borrador:${id}`;
export function readDraft(id: string) {
  try {
    return localStorage.getItem(draftKey(id)) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(id: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(draftKey(id), text);
    else localStorage.removeItem(draftKey(id));
  } catch {}
}

/** Respuestas rápidas: listado para elegir y un formulario corto para crear. */
function QuickRepliesPanel({
  items,
  onPick,
  onChange,
  onClose,
}: {
  items: QuickReply[];
  onPick: (q: QuickReply) => void;
  onChange: () => void;
  onClose: () => void;
}) {
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-96 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Respuestas rápidas</span>
        <button type="button" className="btn-quiet btn-sm" onClick={onClose}>
          Cerrar
        </button>
      </div>
      {items.length === 0 && (
        <p className="mb-2 text-xs text-zinc-500">
          Guarda textos que repites (precio, envío, garantía…) y úsalos escribiendo «/» en el chat.
        </p>
      )}
      <ul className="space-y-1">
        {items.map((q) => (
          <li key={q.id} className="group flex items-start gap-2">
            <button
              type="button"
              onClick={() => onPick(q)}
              className="min-w-0 flex-1 rounded-xl px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className="text-xs font-semibold text-brand-700 dark:text-brand-300">
                /{q.shortcut}
              </span>
              <span className="block truncate text-sm text-zinc-600 dark:text-zinc-400">
                {q.body}
              </span>
            </button>
            <button
              type="button"
              className="btn-quiet btn-icon btn-sm opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label={`Borrar /${q.shortcut}`}
              onClick={async () => {
                await api(`/api/quick-replies/${q.id}`, { method: "DELETE" }).catch(() => {});
                onChange();
              }}
            >
              <Trash2 />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await api("/api/quick-replies", { method: "POST", body: { shortcut, body } });
            setShortcut("");
            setBody("");
            onChange();
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">/</span>
          <input
            className="input"
            placeholder="atajo (ej. precio)"
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value.replace(/\s+/g, "").toLowerCase())}
            aria-label="Atajo"
            required
          />
        </div>
        <textarea
          className="input min-h-16 resize-y"
          placeholder="Texto que se insertará"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Texto de la respuesta"
          required
        />
        <button type="submit" className="btn-secondary btn-sm">
          <Plus />
          Guardar respuesta
        </button>
        <ErrorText>{error}</ErrorText>
      </form>
    </div>
  );
}

export function Composer({
  conv,
  onSent,
  onNote,
}: {
  conv: ConversationDetail;
  onSent: () => void;
  /** Se guardó una nota interna (para refrescar el hilo). */
  onNote?: () => void;
}) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tplId, setTplId] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [quick, setQuick] = useState<QuickReply[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const open = conv.windowOpen;
  const win = remaining(conv.lastInboundAt);

  // Borrador por conversación.
  useEffect(() => {
    setText(readDraft(conv.id));
    setMode("reply");
    setError("");
  }, [conv.id]);
  useEffect(() => {
    if (mode === "reply") writeDraft(conv.id, text);
  }, [conv.id, text, mode]);

  const loadQuick = useCallback(() => {
    api<QuickReply[]>("/api/quick-replies")
      .then(setQuick)
      .catch(() => setQuick([]));
  }, []);
  useEffect(loadQuick, [loadQuick]);

  useEffect(() => {
    if (open) return;
    api<Template[]>(`/api/channels/${conv.channelId}/templates`)
      .then((t) => setTemplates(t.filter((x) => x.status === "APPROVED")))
      .catch(() => setTemplates([]));
  }, [open, conv.channelId]);

  // Alt+R responder · Alt+N nota interna.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.code === "KeyR") setMode("reply");
      else if (e.code === "KeyN") setMode("note");
      else return;
      e.preventDefault();
      setTimeout(() => area.current?.focus(), 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Alto automático del cuadro de texto.
  useEffect(() => {
    void text;
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  // «/atajo» al inicio de una línea abre las coincidencias.
  const slash = useMemo(() => {
    const m = /(^|\n)\/([a-z0-9_-]*)$/i.exec(text);
    if (!m || mode !== "reply") return null;
    const term = (m[2] ?? "").toLowerCase();
    return {
      start: text.length - term.length - 1,
      items: quick.filter((q) => q.shortcut.includes(term) || q.body.toLowerCase().includes(term)),
    };
  }, [text, quick, mode]);
  const slashCount = slash?.items.length ?? 0;
  useEffect(() => {
    void slashCount;
    setSel(0);
  }, [slashCount]);

  function insertQuick(q: QuickReply) {
    const base = slash ? text.slice(0, slash.start) : text;
    setText(`${base}${q.body}`);
    setQuickOpen(false);
    setTimeout(() => area.current?.focus(), 0);
  }

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

  async function submit() {
    const body = text.trim();
    if (!body || busy) return;
    if (mode === "note") {
      setBusy(true);
      setError("");
      try {
        await api(`/api/conversations/${conv.id}/notes`, { method: "POST", body: { body } });
        setText("");
        onNote?.();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (await send({ kind: "text", body })) setText("");
  }

  async function sendFile(file: File) {
    if (!open) {
      setError("Con la ventana de 24 h cerrada solo se pueden enviar plantillas.");
      return;
    }
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

  const note = mode === "note";
  const tabs = (
    <div className="flex items-center gap-1 text-xs">
      <button
        type="button"
        onClick={() => setMode("reply")}
        className={`rounded-full px-3 py-1 font-semibold ${
          !note
            ? "bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200"
            : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        }`}
        title="Alt+R"
      >
        Responder
      </button>
      <button
        type="button"
        onClick={() => setMode("note")}
        className={`flex items-center gap-1 rounded-full px-3 py-1 font-semibold ${
          note
            ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        }`}
        title="Alt+N"
      >
        <Lock className="size-3" />
        Nota interna
      </button>
      {open && !note && (
        <span
          className={`ml-auto flex items-center gap-1 ${win.ms < 2 * 3600_000 ? "text-amber-600 dark:text-amber-400" : "text-zinc-500"}`}
          title="Ventana de 24 h de WhatsApp"
        >
          <Clock className="size-3" />
          quedan {win.label}
        </span>
      )}
    </div>
  );

  // Ventana cerrada y respondiendo: solo plantillas.
  if (!open && !note) {
    return (
      <div className="space-y-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        {tabs}
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <LayoutTemplate className="mt-px size-4 shrink-0" />
          Pasaron más de 24 h desde el último mensaje del cliente. WhatsApp solo permite una
          plantilla aprobada para volver a escribirle.
        </div>
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
              <SendHorizontal />
              Enviar plantilla
            </button>
          </div>
        )}
        {tpl && (
          <p className="rounded-xl bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {tplText.replace(/\{\{(\d+)\}\}/g, (w, n) => params[Number(n) - 1] || w)}
          </p>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  return (
    <section
      aria-label="Escribir"
      className={`relative border-t bg-white p-3 dark:bg-zinc-900 ${
        note ? "border-amber-300 dark:border-amber-800" : "border-zinc-200 dark:border-zinc-800"
      }`}
      onDragOver={(e) => {
        if (note || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (note) return;
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) sendFile(f);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-brand-400 bg-brand-50/90 text-sm font-semibold text-brand-800 dark:bg-brand-950/90 dark:text-brand-200">
          Suelta el archivo para enviarlo
        </div>
      )}
      {(quickOpen || slashCount > 0) && (
        <div className="relative">
          {quickOpen ? (
            <QuickRepliesPanel
              items={quick}
              onPick={insertQuick}
              onChange={loadQuick}
              onClose={() => setQuickOpen(false)}
            />
          ) : (
            <div
              role="listbox"
              className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-64 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            >
              {slash?.items.map((q, i) => (
                <button
                  key={q.id}
                  type="button"
                  role="option"
                  aria-selected={i === sel}
                  onMouseEnter={() => setSel(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertQuick(q);
                  }}
                  className={`block w-full rounded-xl px-3 py-1.5 text-left ${i === sel ? "bg-brand-50 dark:bg-brand-950" : ""}`}
                >
                  <span className="text-xs font-semibold text-brand-700 dark:text-brand-300">
                    /{q.shortcut}
                  </span>
                  <span className="block truncate text-sm text-zinc-600 dark:text-zinc-400">
                    {q.body}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mb-2">{tabs}</div>
      <div className="flex items-end gap-2">
        {!note && (
          <>
            <button
              type="button"
              className="btn-quiet btn-icon"
              aria-label="Adjuntar archivo"
              title="Adjuntar (o arrastra un archivo)"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip />
            </button>
            <button
              type="button"
              className="btn-quiet btn-icon"
              aria-label="Respuestas rápidas"
              title="Respuestas rápidas (escribe «/»)"
              onClick={() => setQuickOpen((o) => !o)}
            >
              <Zap />
            </button>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept={ACCEPT}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) sendFile(f);
            e.target.value = "";
          }}
        />
        <textarea
          ref={area}
          className={`input max-h-44 min-h-10 flex-1 resize-none ${
            note
              ? "border-amber-300 bg-amber-50 focus:border-amber-500 focus:ring-amber-500/15 dark:border-amber-800 dark:bg-amber-950"
              : ""
          }`}
          rows={1}
          placeholder={
            note
              ? "Nota para tu equipo (el cliente no la ve)…"
              : "Escribe un mensaje… «/» para respuestas rápidas"
          }
          aria-label={note ? "Nota interna" : "Mensaje"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
            if (f && !note) {
              e.preventDefault();
              sendFile(f);
            }
          }}
          onKeyDown={(e) => {
            if (slash && slashCount > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, slashCount - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const q = slash.items[sel];
                if (q) insertQuick(q);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="button"
          className={note ? "btn bg-amber-500 hover:bg-amber-600" : "btn btn-icon"}
          disabled={busy || !text.trim()}
          onClick={submit}
          aria-label={note ? "Guardar nota" : "Enviar"}
        >
          {note ? "Guardar nota" : <SendHorizontal />}
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
