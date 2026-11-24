"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Composer } from "@/components/inbox/Composer";
import { Details } from "@/components/inbox/Details";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import {
  type ConversationDetail,
  type ConversationRow,
  displayName,
  type Message,
  type TeamMember,
} from "@/components/inbox/types";
import { ErrorText } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth-client";

const FILTERS = [
  { key: "todas", label: "Abiertas" },
  { key: "mias", label: "Mías" },
  { key: "sin_asignar", label: "Sin asignar" },
  { key: "pausadas", label: "Bot pausado" },
  { key: "cerradas", label: "Cerradas" },
] as const;

function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === y.toDateString()) return "Ayer";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

type ChannelLite = { id: string; name: string; displayPhone: string };

function NewConversation({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<ChannelLite[]>([]);
  const [channelId, setChannelId] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    api<ChannelLite[]>("/api/channels")
      .then((c) => {
        setChannels(c);
        setChannelId(c[0]?.id ?? "");
      })
      .catch((e) => setError(errorMessage(e)));
  }, [open]);

  if (!open)
    return (
      <button type="button" className="btn-ghost w-full" onClick={() => setOpen(true)}>
        + Nueva conversación
      </button>
    );
  return (
    <form
      className="space-y-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          const r = await api<{ id: string }>("/api/conversations", {
            method: "POST",
            body: { channelId, phone },
          });
          setOpen(false);
          setPhone("");
          onCreated(r.id);
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      {channels.length === 0 ? (
        <p className="text-xs text-zinc-500">
          Primero conecta un número en{" "}
          <Link href="/panel/integraciones/whatsapp" className="underline">
            Integraciones → WhatsApp
          </Link>
          .
        </p>
      ) : (
        <>
          {channels.length > 1 && (
            <select
              className="input"
              aria-label="Número"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.displayPhone}
                </option>
              ))}
            </select>
          )}
          <input
            className="input"
            required
            placeholder="Con código de país: 593991234567"
            aria-label="Teléfono"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="submit" className="btn flex-1">
              Crear
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

function Inbox() {
  const router = useRouter();
  const selectedId = useSearchParams().get("c");
  const { data: session } = useSession();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("todas");
  const [q, setQ] = useState("");
  const [list, setList] = useState<ConversationRow[] | null>(null);
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const loadList = useCallback(async () => {
    try {
      const params = new URLSearchParams({ filter });
      if (q.trim()) params.set("q", q.trim());
      setList(await api<ConversationRow[]>(`/api/conversations?${params}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [filter, q]);

  const loadConversation = useCallback(async (id: string, scroll = true) => {
    try {
      const [c, m] = await Promise.all([
        api<ConversationDetail>(`/api/conversations/${id}`),
        api<Message[]>(`/api/conversations/${id}/messages`),
      ]);
      if (selectedRef.current !== id) return;
      setConv(c);
      setMsgs(m);
      setHasMore(m.length === 50);
      if (scroll) requestAnimationFrame(() => bottom.current?.scrollIntoView());
      if (c.unreadCount > 0) await api(`/api/conversations/${id}/read`, { method: "POST" });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(loadList, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadList, q]);

  useEffect(() => {
    api<TeamMember[]>("/api/team")
      .then(setTeam)
      .catch(() => setTeam([]));
  }, []);

  useEffect(() => {
    setConv(null);
    setMsgs([]);
    setShowDetails(false);
    if (selectedId) loadConversation(selectedId);
  }, [selectedId, loadConversation]);

  // Tiempo real: SSE del API. Si se corta, EventSource reconecta solo y un sondeo cada 20 s cubre huecos.
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = (conversationId?: string) => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        loadList();
        const sel = selectedRef.current;
        if (sel && (!conversationId || conversationId === sel)) loadConversation(sel, true);
      }, 250);
    };
    const es = new EventSource("/api/inbox/stream");
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (ev) => {
      try {
        refresh((JSON.parse(ev.data) as { conversationId?: string }).conversationId);
      } catch {
        refresh();
      }
    };
    const poll = setInterval(() => refresh(), 20000);
    return () => {
      es.close();
      clearInterval(poll);
      if (pending) clearTimeout(pending);
    };
  }, [loadList, loadConversation]);

  async function loadOlder() {
    const first = msgs[0];
    if (!conv || !first) return;
    const older = await api<Message[]>(
      `/api/conversations/${conv.id}/messages?before=${encodeURIComponent(first.sentAt)}`,
    );
    setMsgs([...older, ...msgs]);
    setHasMore(older.length === 50);
  }

  const select = (id: string | null) =>
    router.replace(id ? `/panel/inbox?c=${id}` : "/panel/inbox");

  function onContactDeleted() {
    setShowDetails(false);
    select(null);
    loadList();
  }

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-0 flex-col md:h-dvh md:flex-row">
      <aside
        className={`min-h-0 flex-col border-zinc-200 bg-white md:w-80 md:border-r dark:border-zinc-800 dark:bg-zinc-900 ${
          selectedId ? "hidden md:flex" : "flex flex-1 md:flex-none"
        }`}
      >
        <div className="space-y-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Conversaciones</h1>
            <span className={`text-xs ${live ? "text-emerald-600" : "text-zinc-400"}`}>
              ● {live ? "en vivo" : "reconectando"}
            </span>
          </div>
          <input
            className="input"
            placeholder="Buscar nombre o teléfono"
            aria-label="Buscar"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-2.5 py-1 text-xs ${filter === f.key ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <NewConversation
            onCreated={(id) => {
              loadList();
              select(id);
            }}
          />
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list?.length === 0 && (
            <p className="p-4 text-sm text-zinc-500">No hay conversaciones aquí.</p>
          )}
          {list?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => select(c.id)}
              className={`flex w-full gap-3 border-b border-zinc-100 px-3 py-3 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800 ${
                c.id === selectedId ? "bg-emerald-50 dark:bg-emerald-950" : ""
              }`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium dark:bg-zinc-700">
                {displayName(c.contact).replace("+", "").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate ${c.unreadCount ? "font-semibold" : ""}`}>
                    {displayName(c.contact)}
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-400">
                    {when(c.lastMessageAt)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="truncate text-sm text-zinc-500">{c.lastMessagePreview}</span>
                  {c.unreadCount > 0 && (
                    <span className="ml-auto rounded-full bg-emerald-600 px-1.5 text-[11px] text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
                  {c.botPaused && (
                    <span className="rounded bg-amber-100 px-1 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                      bot pausado
                    </span>
                  )}
                  {!c.windowOpen && (
                    <span className="rounded bg-zinc-100 px-1 text-zinc-500 dark:bg-zinc-800">
                      24 h cerrada
                    </span>
                  )}
                  {c.assignedUserId && (
                    <span className="rounded bg-sky-100 px-1 text-sky-800 dark:bg-sky-900 dark:text-sky-200">
                      {c.assignedUserId === session?.user.id
                        ? "tú"
                        : (team.find((t) => t.id === c.assignedUserId)?.name ?? "asignada")}
                    </span>
                  )}
                  {c.labels.map((l) => (
                    <span key={l} className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section
        className={`min-h-0 min-w-0 flex-1 flex-col bg-zinc-100 dark:bg-zinc-950 ${selectedId ? "flex" : "hidden md:flex"}`}
      >
        {!conv ? (
          <div className="m-auto p-6 text-center text-sm text-zinc-500">
            {selectedId ? "Cargando…" : "Elige una conversación."}
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
              <button
                type="button"
                className="md:hidden"
                aria-label="Volver"
                onClick={() => select(null)}
              >
                ←
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{displayName(conv.contact)}</div>
                <div className="truncate text-xs text-zinc-500">
                  +{conv.contact.phone} · {conv.channelName}
                  {conv.productName ? ` · ${conv.productName}` : ""}
                </div>
              </div>
              <button
                type="button"
                className="btn-ghost px-3 py-1 text-xs lg:hidden"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? "Chat" : "Detalles"}
              </button>
            </header>
            {showDetails ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-white lg:hidden dark:bg-zinc-900">
                <Details
                  conv={conv}
                  team={team}
                  onChange={() => loadConversation(conv.id, false)}
                  onDeleted={onContactDeleted}
                />
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {hasMore && (
                    <button
                      type="button"
                      className="btn-ghost mx-auto block text-xs"
                      onClick={loadOlder}
                    >
                      Cargar mensajes anteriores
                    </button>
                  )}
                  {msgs.map((m, i) => {
                    const prev = msgs[i - 1];
                    const newDay =
                      !prev ||
                      new Date(prev.sentAt).toDateString() !== new Date(m.sentAt).toDateString();
                    return (
                      <div key={m.id}>
                        {newDay && (
                          <div className="my-3 text-center">
                            <span className="rounded-full bg-white px-3 py-1 text-[11px] text-zinc-500 shadow-sm dark:bg-zinc-800">
                              {dayLabel(m.sentAt)}
                            </span>
                          </div>
                        )}
                        <MessageBubble m={m} team={team} />
                      </div>
                    );
                  })}
                  <div ref={bottom} />
                </div>
                <Composer conv={conv} onSent={() => loadConversation(conv.id)} />
              </>
            )}
          </>
        )}
      </section>

      {conv && (
        <aside className="hidden min-h-0 w-80 overflow-y-auto border-l border-zinc-200 bg-white lg:block dark:border-zinc-800 dark:bg-zinc-900">
          <Details
            conv={conv}
            team={team}
            onChange={() => loadConversation(conv.id, false)}
            onDeleted={onContactDeleted}
          />
        </aside>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Inbox />
    </Suspense>
  );
}
