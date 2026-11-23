"use client";
import { ROLE_LABELS, type Role } from "@chatea/shared";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell, ErrorText } from "@/components/ui";
import { authClient, useSession } from "@/lib/auth-client";

type Invitation = {
  organizationName: string;
  inviterEmail: string;
  role: string | null;
  email: string;
};

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [inv, setInv] = useState<Invitation | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) return;
    authClient.organization.getInvitation({ query: { id } }).then((res) => {
      if (res.error) setError(res.error.message ?? "Invitación no válida o vencida");
      else setInv(res.data as Invitation);
    });
  }, [session, id]);

  const next = encodeURIComponent(`/invitacion/${id}`);
  if (!isPending && !session) {
    return (
      <AuthShell
        title="Te invitaron a Chatea"
        subtitle="Entra o crea una cuenta con el correo al que llegó la invitación."
      >
        <div className="space-y-3">
          <Link href={`/entrar?next=${next}`} className="btn w-full">
            Entrar
          </Link>
          <Link href={`/registro?next=${next}`} className="btn-ghost w-full">
            Crear cuenta
          </Link>
        </div>
      </AuthShell>
    );
  }

  async function respond(accept: boolean) {
    const res = accept
      ? await authClient.organization.acceptInvitation({ invitationId: id })
      : await authClient.organization.rejectInvitation({ invitationId: id });
    if (res.error) return setError(res.error.message ?? "No se pudo procesar la invitación");
    router.push(accept ? "/panel" : "/crear-tienda");
  }

  return (
    <AuthShell
      title={inv ? `Únete a ${inv.organizationName}` : "Invitación"}
      subtitle={
        inv
          ? `${inv.inviterEmail} te invitó como ${ROLE_LABELS[inv.role as Role] ?? inv.role ?? "miembro"}.`
          : undefined
      }
    >
      <ErrorText>{error}</ErrorText>
      {inv && (
        <div className="flex gap-3">
          <button type="button" className="btn flex-1" onClick={() => respond(true)}>
            Aceptar
          </button>
          <button type="button" className="btn-ghost flex-1" onClick={() => respond(false)}>
            Rechazar
          </button>
        </div>
      )}
    </AuthShell>
  );
}
