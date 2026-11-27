"use client";
/** Mi perfil: nombre que ve el equipo y cambio de contraseña. */
import { UserCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { PhoneField } from "@/components/PhoneField";
import { ErrorText, PageHeader } from "@/components/ui";
import { authClient, useSession } from "@/lib/auth-client";

const MIN_PASSWORD = 8;
type Msg = { ok: boolean; text: string } | null;

function Feedback({ msg }: { msg: Msg }) {
  if (!msg) return null;
  if (!msg.ok) return <ErrorText>{msg.text}</ErrorText>;
  return <p className="text-sm text-brand-700 dark:text-brand-400">{msg.text}</p>;
}

export default function ProfilePage() {
  const { data: session, refetch } = useSession();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [nameMsg, setNameMsg] = useState<Msg>(null);
  const [savingName, setSavingName] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [closeOthers, setCloseOthers] = useState(true);
  const [passMsg, setPassMsg] = useState<Msg>(null);
  const [savingPass, setSavingPass] = useState(false);

  useEffect(() => {
    if (session?.user.name) setName(session.user.name);
  }, [session?.user.name]);

  if (!session) return null;

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setNameMsg({ ok: false, text: "Escribe tu nombre." });
    setSavingName(true);
    if (!phone) return setNameMsg({ ok: false, text: "Escribe tu WhatsApp completo." });
    const { error } = await authClient.updateUser({ name: clean, phone });
    setSavingName(false);
    if (error) return setNameMsg({ ok: false, text: error.message ?? "No se pudo guardar." });
    setNameMsg({ ok: true, text: "Nombre guardado." });
    refetch();
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < MIN_PASSWORD)
      return setPassMsg({
        ok: false,
        text: `La nueva contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`,
      });
    if (next !== repeat) return setPassMsg({ ok: false, text: "Las contraseñas no coinciden." });
    setSavingPass(true);
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: closeOthers,
    });
    setSavingPass(false);
    if (error)
      return setPassMsg({
        ok: false,
        text: /invalid|incorrect/i.test(error.message ?? "")
          ? "La contraseña actual no es correcta."
          : (error.message ?? "No se pudo cambiar la contraseña."),
      });
    setCurrent("");
    setNext("");
    setRepeat("");
    setPassMsg({
      ok: true,
      text: closeOthers
        ? "Contraseña cambiada. Cerramos tu sesión en los demás equipos."
        : "Contraseña cambiada.",
    });
  };

  return (
    <div>
      <PageHeader
        icon={UserCircle}
        title="Mi perfil"
        description="Tus datos de acceso. Valen para todas las tiendas en las que participas."
      />

      <form onSubmit={saveName} className="card mb-6 space-y-4">
        <h2 className="font-medium">Datos</h2>
        <label className="block">
          <span className="label">Nombre</span>
          <input
            className="input"
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
              setNameMsg(null);
            }}
          />
          <span className="mt-1 block text-xs text-zinc-500">
            Lo ve tu equipo en las conversaciones asignadas y en las notas.
          </span>
        </label>
        <div>
          <span className="label">WhatsApp</span>
          <PhoneField
            key={session.user.phone ?? "sin"}
            value={session.user.phone ?? ""}
            onChange={(v) => {
              setPhone(v);
              setNameMsg(null);
            }}
          />
        </div>
        <label className="block">
          <span className="label">Correo</span>
          <input className="input" value={session.user.email} disabled />
          <span className="mt-1 block text-xs text-zinc-500">
            Es tu usuario para entrar; no se puede cambiar desde aquí.
          </span>
        </label>
        <Feedback msg={nameMsg} />
        <button type="submit" className="btn" disabled={savingName}>
          {savingName ? "Guardando…" : "Guardar"}
        </button>
      </form>

      <form onSubmit={savePassword} className="card space-y-4">
        <h2 className="font-medium">Cambiar contraseña</h2>
        <label className="block">
          <span className="label">Contraseña actual</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">Nueva contraseña</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">Repite la nueva contraseña</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={closeOthers}
            onChange={(e) => setCloseOthers(e.target.checked)}
          />
          Cerrar sesión en los demás equipos
        </label>
        <Feedback msg={passMsg} />
        <button type="submit" className="btn" disabled={savingPass}>
          {savingPass ? "Cambiando…" : "Cambiar contraseña"}
        </button>
      </form>
    </div>
  );
}
