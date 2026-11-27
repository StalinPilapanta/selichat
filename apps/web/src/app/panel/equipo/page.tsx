"use client";
import { ROLE_LABELS, ROLES, type Role } from "@chatea/shared";
import { Users } from "lucide-react";
import { useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { authClient, useActiveOrganization, useSession } from "@/lib/auth-client";

const INVITABLE = ROLES.filter((r) => r !== "owner");
const initialsOf = (name: string) =>
  name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";
const roleLabel = (r: string | null | undefined) => ROLE_LABELS[(r ?? "") as Role] ?? r ?? "";

export default function Page() {
  const { data: org, refetch } = useActiveOrganization();
  const { data: session } = useSession();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof INVITABLE)[number]>("asesor");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const myRole = org?.members.find((m) => m.userId === session?.user.id)?.role;
  const canManage = myRole === "owner" || myRole === "admin";
  const pending = org?.invitations.filter((i) => i.status === "pending") ?? [];

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const res = await authClient.organization.inviteMember({ email, role });
    if (res.error) return setError(res.error.message ?? "No se pudo invitar");
    setNotice(`Invitación enviada a ${email}.`);
    setEmail("");
    refetch();
  }

  async function act(p: Promise<{ error: { message?: string } | null }>) {
    const res = await p;
    if (res.error) setError(res.error.message ?? "Error");
    refetch();
  }

  return (
    <>
      <PageHeader
        icon={Users}
        title="Equipo"
        description="Quién tiene acceso a esta tienda y con qué rol."
      />
      {canManage && (
        <form onSubmit={invite} className="card mb-6 space-y-3">
          <div>
            <h2 className="font-semibold">Invitar a alguien</h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              Le llega un correo con el enlace para unirse a esta tienda con el rol que elijas.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="label" htmlFor="email">
                Correo
              </label>
              <input
                id="email"
                type="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="role">
                Rol
              </label>
              <select
                id="role"
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
              >
                {INVITABLE.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn">
              Invitar
            </button>
          </div>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
      {notice && <p className="mb-4 text-sm text-brand-700 dark:text-brand-400">{notice}</p>}

      <h2 className="mb-3 font-medium">
        Miembros <span className="text-zinc-500">· {org?.members.length ?? 0}</span>
      </h2>
      <div className="card divide-y divide-zinc-200 p-0 dark:divide-zinc-800">
        {org?.members.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800 dark:bg-brand-950 dark:text-brand-300">
                {initialsOf(m.user.name || m.user.email)}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{m.user.name}</span>
                  <span className="badge badge-brand">{roleLabel(m.role)}</span>
                  {m.userId === session?.user.id && (
                    <span className="text-xs text-zinc-500">(tú)</span>
                  )}
                </div>
                <div className="truncate text-sm text-zinc-500">{m.user.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {canManage && m.role !== "owner" && m.userId !== session?.user.id && (
                <button
                  type="button"
                  className="text-sm text-red-600 hover:underline"
                  onClick={() =>
                    act(authClient.organization.removeMember({ memberIdOrEmail: m.id }))
                  }
                >
                  Quitar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {pending.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 font-medium">Invitaciones pendientes</h2>
          <div className="card divide-y divide-zinc-200 p-0 dark:divide-zinc-800">
            {pending.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 px-6 py-3">
                <div className="min-w-0 truncate text-sm">
                  {i.email} · {roleLabel(i.role)}
                </div>
                {canManage && (
                  <button
                    type="button"
                    className="text-sm text-red-600 hover:underline"
                    onClick={() =>
                      act(authClient.organization.cancelInvitation({ invitationId: i.id }))
                    }
                  >
                    Cancelar
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
