"use client";
import { formatPhone, LEAD_STAGES, type LeadStage, windowRemainingMs } from "@chatea/shared";
import {
  ArrowLeft,
  Hand,
  Info,
  Megaphone,
  MessageCircle,
  Plus,
  Search,
  Timer,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer, readDraft } from "@/components/inbox/Composer";
import { Details } from "@/components/inbox/Details";
import { MessageBubble, NoteBubble } from "@/components/inbox/MessageBubble";
import {
  avatarClass,
  type ConversationDetail,
  type ConversationRow,
  displayName,
  initialsOf,
  type Message,
  type Note,
  type TeamMember,
} from "@/components/inbox/types";
import { EmptyState, ErrorText } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth-client";

const FILTERS = [
  { key: "todas", label: "Abiertas" },
  { key: "mias", label: "Mías" },
  { key: "sin_asignar", label: "Sin asignar" },
  { key: "pausadas", label: "Humano" },
  { key: "cerradas", label: "Cerradas" },
] as const;

const STAGE_DOT: Record<string, string> = {
  interesado: "bg-sky-500",
  datos: "bg-amber-500",
  ganado: "bg-emerald-500",
  en_agencia: "bg-violet-500",
  cerrado: "bg-zinc-400",
  perdido: "bg-red-500",
};

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

/** Minutos que el cliente lleva esperando respuesta (su último mensaje no fue contestado). */
function waitingMinutes(c: ConversationRow, now: number) {
  if (!c.lastInboundAt || c.status !== "abierta") return 0;
  const lastIn = Date.parse(c.lastInboundAt);
  const lastAny = c.lastMessageAt ? Date.parse(c.lastMessageAt) : lastIn;
  if (lastAny > lastIn + 1000) return 0; // ya se le respondió
  return Math.floor((now - lastIn) / 60_000);
}

function Avatar({ c, size = "size-11" }: { c: ConversationRow; size?: string }) {
  return (
    <span className="relative shrink-0">
      <span
        className={`grid ${size} place-items-center rounded-full text-sm font-bold ${avatarClass(c.contact.phone)}`}
      >
        {initialsOf(c.contact)}
      </span>
      {c.windowOpen && (
        <span
          className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-900"
          title="Ventana de 24 h abierta"
        />
      )}
    </span>
  );
}

function Chip({
  className,
  children,
  title,
}: {
  className: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span title={title} className={`badge ${className}`}>
      {children}
    </span>
  );
}

function ConversationItem({
  c,
  active,
  now,
  assigned,
  onSelect,
}: {
  c: ConversationRow;
  active: boolean;
  now: number;
  assigned: string | null;
  onSelect: () => void;
}) {
  const unread = c.unreadCount > 0;
  const wait = waitingMinutes(c, now);
  const left = c.windowOpen ? windowRemainingMs(c.lastInboundAt) : 0;
  const draft = active ? "" : readDraft(c.id);
  const stage = c.leadStage as LeadStage | undefined;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`flex w-full gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
        active ? "bg-brand-50 dark:bg-brand-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
      }`}
    >
      <Avatar c={c} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate ${unread ? "font-bold" : "font-medium"}`}>
            {displayName(c.contact)}
          </span>
          <span
            className={`shrink-0 text-[11px] tabular-nums ${unread ? "font-semibold text-brand-600 dark:text-brand-400" : "text-zinc-400"}`}
          >
            {when(c.lastMessageAt)}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <span
            className={`truncate text-sm ${unread ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-500"}`}
          >
            {draft ? (
              <>
                <span className="font-semibold text-amber-600 dark:text-amber-400">Borrador: </span>
                {draft}
              </>
            ) : (
              c.lastMessagePreview
            )}
          </span>
          {unread && (
            <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-600 px-1 text-[10.5px] font-bold text-brand-ink">
              {c.unreadCount}
            </span>
          )}
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {stage && LEAD_STAGES[stage] && (
            <Chip className="badge-neutral">
              <span className={`size-1.5 rounded-full ${STAGE_DOT[stage] ?? "bg-zinc-400"}`} />
              {LEAD_STAGES[stage]}
            </Chip>
          )}
          {wait >= 2 && (
            <Chip
              className={
                wait >= 60 ? "badge-danger" : wait >= 15 ? "badge-warning" : "badge-neutral"
              }
              title="Tiempo esperando respuesta"
            >
              <Timer />
              {wait >= 60 ? `${Math.floor(wait / 60)} h` : `${wait} min`}
            </Chip>
          )}
          {c.windowOpen && left < 2 * 3600_000 && (
            <Chip className="badge-warning" title="La ventana de 24 h está por cerrarse">
              24 h por vencer
            </Chip>
          )}
          {c.botPaused && (
            <Chip className="badge-warning" title={c.handoffReason ?? "La IA está pausada"}>
              <Hand />
              Humano
            </Chip>
          )}
          {c.contact.sourceAdId && (
            <Chip className="bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200">
              <Megaphone />
              Anuncio
            </Chip>
          )}
          {assigned && <Chip className="badge-info">{assigned}</Chip>}
        </span>
      </span>
    </button>
  );
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
      <button
        type="button"
        className="btn-secondary btn-icon"
        aria-label="Nueva conversación"
        title="Nueva conversación"
        onClick={() => setOpen(true)}
      >
        <Plus />
      </button>
    );
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh]">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-zinc-950/40"
        onClick={() => setOpen(false)}
      />
      <form
        className="card relative w-full max-w-sm space-y-3"
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
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Nueva conversación</h2>
          <button
            type="button"
            className="btn-quiet btn-icon btn-sm"
            aria-label="Cerrar"
            onClick={() => setOpen(false)}
          >
            <X />
          </button>
        </div>
        {channels.length === 0 ? (
          <p className="text-sm text-zinc-500">
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
            <button type="submit" className="btn w-full">
              Crear conversación
            </button>
          </>
        )}
        <ErrorText>{error}</ErrorText>
      </form>
    </div>
  );
}

type Item = { kind: "msg"; at: string; m: Message } | { kind: "note"; at: string; n: Note };

function Inbox() {
  const router = useRouter();
  const selectedId = useSearchParams().get("c");
  const { data: session } = useSession();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("todas");
  const [q, setQ] = useState("");
  const [list, setList] = useState<ConversationRow[] | null>(null);
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const bottom = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  // Reloj para «esperando N min».
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const loadList = useCallback(async () => {
    try {
      const params = new URLSearchParams({ filter });
      if (q.trim()) params.set("q", q.trim());
      setList(await api<ConversationRow[]>(`/api/conversations?${params}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [filter, q]);

  const loadNotes = useCallback(async (id: string) => {
    const n = await api<Note[]>(`/api/conversations/${id}/notes`).catch(() => [] as Note[]);
    if (selectedRef.current === id) setNotes(n);
  }, []);

  const loadConversation = useCallback(
    async (id: string, scroll = true) => {
      try {
        const [c, m] = await Promise.all([
          api<ConversationDetail>(`/api/conversations/${id}`),
          api<Message[]>(`/api/conversations/${id}/messages`),
        ]);
        if (selectedRef.current !== id) return;
        setConv(c);
        setMsgs(m);
        setHasMore(m.length === 50);
        loadNotes(id);
        if (scroll) requestAnimationFrame(() => bottom.current?.scrollIntoView());
        if (c.unreadCount > 0) await api(`/api/conversations/${id}/read`, { method: "POST" });
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [loadNotes],
  );

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
    setNotes([]);
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

  // Mensajes y notas internas en un solo hilo (las notas desde el primer mensaje cargado).
  const timeline = useMemo<Item[]>(() => {
    const from = msgs[0]?.sentAt ?? "";
    const items: Item[] = [
      ...msgs.map((m) => ({ kind: "msg" as const, at: m.sentAt, m })),
      ...notes
        .filter((n) => !hasMore || n.createdAt >= from)
        .map((n) => ({ kind: "note" as const, at: n.createdAt, n })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [msgs, notes, hasMore]);

  const nameOf = (id: string | null) =>
    id === session?.user.id ? "tú" : (team.find((t) => t.id === id)?.name ?? null);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col md:h-dvh md:flex-row">
      <aside
        className={`min-h-0 flex-col border-zinc-200 bg-white md:w-[22rem] md:border-r dark:border-zinc-800 dark:bg-zinc-900 ${
          selectedId ? "hidden md:flex" : "flex flex-1 md:flex-none"
        }`}
      >
        <div className="space-y-3 p-3 pb-2">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Conversaciones</h1>
            <div className="flex items-center gap-2">
              <span
                className={`flex items-center gap-1 text-[11px] ${live ? "text-emerald-600" : "text-zinc-400"}`}
                title={live ? "Recibiendo mensajes en vivo" : "Reconectando…"}
              >
                <span
                  className={`size-1.5 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-zinc-400"}`}
                />
                {live ? "en vivo" : "reconectando"}
              </span>
              <NewConversation
                onCreated={(id) => {
                  loadList();
                  select(id);
                }}
              />
            </div>
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              className="input rounded-full pl-9"
              placeholder="Buscar nombre o teléfono"
              aria-label="Buscar"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filter === f.key
                    ? "bg-brand-600 text-brand-ink"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {list?.length === 0 && (
            <div className="px-2 py-10 text-center text-sm text-zinc-500">
              {q ? "Nadie coincide con la búsqueda." : "No hay conversaciones aquí."}
            </div>
          )}
          {list?.map((c) => (
            <ConversationItem
              key={c.id}
              c={c}
              now={now}
              active={c.id === selectedId}
              assigned={c.assignedUserId ? (nameOf(c.assignedUserId) ?? "asignada") : null}
              onSelect={() => select(c.id)}
            />
          ))}
        </div>
      </aside>

      <section
        className={`min-h-0 min-w-0 flex-1 flex-col ${selectedId ? "flex" : "hidden md:flex"}`}
      >
        {!conv ? (
          <div className="chat-bg grid flex-1 place-items-center p-6">
            {selectedId ? (
              <span className="text-sm text-zinc-500">Cargando…</span>
            ) : (
              <div className="max-w-sm">
                <EmptyState
                  icon={MessageCircle}
                  title="Elige una conversación"
                  description="Aquí ves el chat con el cliente, lo que hizo la IA, y puedes responder o dejar una nota a tu equipo."
                />
              </div>
            )}
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
              <button
                type="button"
                className="btn-quiet btn-icon md:hidden"
                aria-label="Volver a la lista"
                onClick={() => select(null)}
              >
                <ArrowLeft />
              </button>
              <Avatar c={conv} size="size-10" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{displayName(conv.contact)}</div>
                <div className="truncate text-xs text-zinc-500">
                  {formatPhone(conv.contact.phone)} · {conv.channelName}
                  {conv.productName ? ` · ${conv.productName}` : ""}
                </div>
              </div>
              {conv.botPaused && (
                <span className="badge badge-warning hidden sm:inline-flex">
                  <Hand />
                  Atiende un humano
                </span>
              )}
              <button
                type="button"
                className={`btn-quiet btn-icon lg:hidden ${showDetails ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
                aria-label={showDetails ? "Ver chat" : "Ver ficha del cliente"}
                aria-pressed={showDetails}
                onClick={() => setShowDetails(!showDetails)}
              >
                <Info />
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
                <div className="chat-bg min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-4 md:px-6">
                  {hasMore && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm mx-auto mt-3 flex"
                      onClick={loadOlder}
                    >
                      Cargar mensajes anteriores
                    </button>
                  )}
                  {timeline.map((it, i) => {
                    const prev = timeline[i - 1];
                    const newDay =
                      !prev || new Date(prev.at).toDateString() !== new Date(it.at).toDateString();
                    const day = newDay && (
                      <div className="my-4 text-center">
                        <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-zinc-500 shadow-sm backdrop-blur dark:bg-zinc-800/90">
                          {dayLabel(it.at)}
                        </span>
                      </div>
                    );
                    if (it.kind === "note")
                      return (
                        <div key={`n-${it.n.id}`}>
                          {day}
                          <NoteBubble
                            body={it.n.body}
                            at={it.n.createdAt}
                            author={nameOf(it.n.userId) ?? "Equipo"}
                          />
                        </div>
                      );
                    // Mismo remitente, seguido y en menos de 5 min: van agrupados.
                    const p = prev?.kind === "msg" ? prev.m : null;
                    const first =
                      newDay ||
                      !p ||
                      p.direction !== it.m.direction ||
                      p.author !== it.m.author ||
                      Date.parse(it.m.sentAt) - Date.parse(p.sentAt) > 5 * 60_000;
                    return (
                      <div key={it.m.id}>
                        {day}
                        <MessageBubble m={it.m} team={team} first={first} />
                      </div>
                    );
                  })}
                  <div ref={bottom} />
                </div>
                <Composer
                  conv={conv}
                  onSent={() => loadConversation(conv.id)}
                  onNote={() => {
                    loadNotes(conv.id);
                    requestAnimationFrame(() => bottom.current?.scrollIntoView());
                  }}
                />
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
