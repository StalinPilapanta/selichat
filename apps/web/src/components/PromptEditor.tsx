"use client";
import {
  ALL_VARIABLES,
  CUSTOM_VARIABLES,
  extractVariables,
  GUIDED_SECTIONS,
  type GuidedSectionKey,
  type PromptScope,
} from "@chatea/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorText } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Mode = "libre" | "guiado";
export interface PromptDraft {
  mode: Mode;
  content: string;
  sections: Partial<Record<GuidedSectionKey, string>>;
  variables: Record<string, string>;
}
interface Version extends PromptDraft {
  id: string;
  version: number;
  note: string;
  publishedAt: string | null;
  createdAt: string;
  active: boolean;
}
interface Preview {
  layers: { name: string; text: string }[];
  missing: string[];
}

const EMPTY: PromptDraft = { mode: "libre", content: "", sections: {}, variables: {} };

/** Inserta texto en la posición del cursor de un textarea. */
function insertAtCursor(
  el: HTMLTextAreaElement | null,
  value: string,
  text: string,
  set: (v: string) => void,
) {
  if (!el) return set(value + text);
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  set(value.slice(0, start) + text + value.slice(end));
  requestAnimationFrame(() => {
    el.focus();
    el.selectionStart = el.selectionEnd = start + text.length;
  });
}

export function PromptEditor({
  scope,
  productId,
  allowGuided = false,
  initialDraft,
  help,
}: {
  scope: PromptScope;
  productId?: string;
  allowGuided?: boolean;
  initialDraft?: PromptDraft | null;
  help?: string;
}) {
  const [draft, setDraft] = useState<PromptDraft>(initialDraft ?? EMPTY);
  const [versions, setVersions] = useState<Version[]>([]);
  const [dirty, setDirty] = useState(Boolean(initialDraft));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const focused = useRef<{ el: HTMLTextAreaElement; key: "content" | GuidedSectionKey } | null>(
    null,
  );

  const query = `/api/prompts?scope=${scope}${productId ? `&productId=${productId}` : ""}`;
  const load = useCallback(
    async (adopt: boolean) => {
      try {
        const v = await api<Version[]>(query);
        setVersions(v);
        const base = v.find((x) => x.active) ?? v[0];
        if (adopt && base) {
          setDraft({
            mode: base.mode,
            content: base.content,
            sections: base.sections,
            variables: base.variables,
          });
          setDirty(false);
        }
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [query],
  );
  useEffect(() => {
    load(!initialDraft);
  }, [load, initialDraft]);

  const update = (patch: Partial<PromptDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setPreview(null);
  };
  const setText = (key: "content" | GuidedSectionKey, v: string) =>
    key === "content"
      ? update({ content: v })
      : update({ sections: { ...draft.sections, [key]: v } });
  const textOf = (key: "content" | GuidedSectionKey) =>
    key === "content" ? draft.content : (draft.sections[key] ?? "");

  function insertVar(name: string) {
    const f = focused.current ?? {
      el: null as unknown as HTMLTextAreaElement,
      key: draft.mode === "libre" ? "content" : "contextualizacion",
    };
    insertAtCursor(f.el, textOf(f.key), `{{${name}}}`, (v) => setText(f.key, v));
  }

  async function save(publish: boolean) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const note = publish ? "" : (prompt("Nota para esta versión (opcional)") ?? "");
      const row = await api<Version>("/api/prompts", {
        method: "POST",
        body: { scope, productId: productId ?? null, ...draft, note, publish },
      });
      setNotice(
        publish
          ? `Versión ${row.version} publicada: ya la usa el agente.`
          : `Borrador guardado como versión ${row.version}.`,
      );
      setDirty(false);
      await load(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function publishVersion(v: Version) {
    if (!confirm(`¿Publicar la versión ${v.version}? El agente empezará a usarla de inmediato.`))
      return;
    try {
      await api(`/api/prompts/${v.id}/publish`, { method: "POST" });
      setNotice(`Versión ${v.version} publicada.`);
      await load(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function runPreview() {
    if (!productId) return;
    try {
      setPreview(
        await api<Preview>("/api/prompts/preview", { method: "POST", body: { productId, draft } }),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const allText = [draft.content, ...Object.values(draft.sections)].join("\n");
  const unknown = extractVariables(allText).filter((v) => !(v in ALL_VARIABLES));
  const usedCustom = scope === "product" ? Object.keys(CUSTOM_VARIABLES) : [];

  const area = (key: "content" | GuidedSectionKey, rows: number, placeholder?: string) => (
    <textarea
      className="input font-mono text-[13px] leading-relaxed"
      rows={rows}
      placeholder={placeholder}
      value={textOf(key)}
      onFocus={(e) => {
        focused.current = { el: e.currentTarget, key };
      }}
      onChange={(e) => setText(key, e.target.value)}
    />
  );

  return (
    <div className="space-y-4">
      {help && <p className="text-sm text-zinc-500">{help}</p>}
      {allowGuided && (
        <div className="inline-flex rounded-lg border border-zinc-300 p-1 text-sm dark:border-zinc-700">
          {(["libre", "guiado"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => update({ mode: m })}
              className={`rounded-md px-3 py-1 ${draft.mode === m ? "bg-emerald-600 text-white" : ""}`}
            >
              {m === "libre" ? "Libre (texto completo)" : "Guiado (maestro + secciones)"}
            </button>
          ))}
        </div>
      )}

      <div>
        <div className="mb-1 text-xs font-medium text-zinc-500">
          Insertar variable (se reemplaza sola al conversar):
        </div>
        <div className="flex flex-wrap gap-1">
          {Object.entries(ALL_VARIABLES).map(([k, d]) => (
            <button
              key={k}
              type="button"
              title={d}
              onClick={() => insertVar(k)}
              className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs hover:bg-emerald-100 dark:bg-zinc-800 dark:hover:bg-emerald-900"
            >
              {`{{${k}}}`}
            </button>
          ))}
        </div>
      </div>

      {draft.mode === "libre" || !allowGuided ? (
        area("content", 18, "Escribe aquí las instrucciones…")
      ) : (
        <div className="space-y-4">
          {GUIDED_SECTIONS.map((s) => (
            <div key={s.key}>
              <div className="label">{s.label}</div>
              <p className="mb-1 text-xs text-zinc-500">{s.hint}</p>
              {area(s.key, 5)}
            </div>
          ))}
        </div>
      )}

      {usedCustom.length > 0 && (
        <details className="card p-4" open={draft.mode === "guiado"}>
          <summary className="cursor-pointer text-sm font-medium">
            Variables de este producto (las usa el prompt maestro)
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {usedCustom.map((k) => (
              <div key={k}>
                <label className="label font-mono text-xs" htmlFor={`var-${k}`}>{`{{${k}}}`}</label>
                <input
                  id={`var-${k}`}
                  className="input"
                  placeholder={CUSTOM_VARIABLES[k as keyof typeof CUSTOM_VARIABLES]}
                  value={draft.variables[k] ?? ""}
                  onChange={(e) =>
                    update({ variables: { ...draft.variables, [k]: e.target.value } })
                  }
                />
              </div>
            ))}
          </div>
        </details>
      )}

      {unknown.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Variables desconocidas (no se reemplazarán): {unknown.map((u) => `{{${u}}}`).join(", ")}
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      {notice && <p className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={busy} onClick={() => save(true)}>
          Guardar y publicar
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || !dirty}
          onClick={() => save(false)}
        >
          Guardar borrador
        </button>
        {productId && (
          <button type="button" className="btn-ghost" onClick={runPreview}>
            Ver prompt final
          </button>
        )}
        {dirty && <span className="self-center text-xs text-zinc-500">Cambios sin guardar</span>}
      </div>

      {preview && (
        <div className="card space-y-3 p-4">
          <div className="text-sm font-medium">
            Así lo recibe el agente (capa de arriba = mayor prioridad)
          </div>
          {preview.missing.length > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Faltan valores para: {preview.missing.map((m) => `{{${m}}}`).join(", ")}
            </p>
          )}
          {preview.layers.map((l) => (
            <details
              key={l.name}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800"
            >
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{l.name}</summary>
              <pre className="max-h-96 overflow-auto px-3 pb-3 text-xs whitespace-pre-wrap">
                {l.text}
              </pre>
            </details>
          ))}
        </div>
      )}

      {versions.length > 0 && (
        <details className="card p-0">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Historial ({versions.length} versiones)
          </summary>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {versions.map((v) => (
              <div
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">v{v.version}</span>{" "}
                  <span className="text-zinc-500">
                    {new Date(v.createdAt).toLocaleString()} · {v.mode}
                    {v.note ? ` · ${v.note}` : ""}
                  </span>
                  {v.active && (
                    <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                      activa
                    </span>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="text-emerald-700 hover:underline dark:text-emerald-400"
                    onClick={() => {
                      if (
                        dirty &&
                        !confirm("Tienes cambios sin guardar. ¿Reemplazarlos con esta versión?")
                      )
                        return;
                      setDraft({
                        mode: v.mode,
                        content: v.content,
                        sections: v.sections,
                        variables: v.variables,
                      });
                      setDirty(true);
                    }}
                  >
                    Cargar en el editor
                  </button>
                  {!v.active && (
                    <button
                      type="button"
                      className="text-emerald-700 hover:underline dark:text-emerald-400"
                      onClick={() => publishVersion(v)}
                    >
                      Publicar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
