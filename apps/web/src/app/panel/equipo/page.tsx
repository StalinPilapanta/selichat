"use client";
import { ROLE_LABELS, ROLES, type Role } from "@chatea/shared";
import { Users } from "lucide-react";
import { useState } from "react";
import { ErrorText, PageHeader } from "@/components/ui";
import { authClient, useActiveOrganization, useSession } from "@/lib/auth-client";

const INVITABLE = ROLES.filter((r) => r !== "owner");
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
        <form onSubmit={invite} className="card mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
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
        </form>
      )}
      <ErrorText>{error}</ErrorText>
      {notice && <p className="mb-4 text-sm text-brand-700 dark:text-brand-400">{notice}</p>}

      <div className="card divide-y divide-zinc-200 p-0 dark:divide-zinc-800">
        {org?.members.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 px-6 py-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{m.user.name}</div>
              <div className="truncate text-sm text-zinc-500">{m.user.email}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm">{roleLabel(m.role)}</span>
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
