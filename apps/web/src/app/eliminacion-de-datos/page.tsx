import type { Metadata } from "next";
import { H2, LegalPage, legalContact } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Eliminación de datos — Selichat" };
export const dynamic = "force-dynamic";

export default function Page() {
  const email = legalContact();
  return (
    <LegalPage title="Instrucciones para eliminar tus datos" updated="23 de noviembre de 2026">
      <H2>Si conversaste con una tienda por WhatsApp</H2>
      <ol className="list-decimal space-y-1 pl-6">
        <li>Escribe a la tienda por el mismo chat de WhatsApp: «Quiero que eliminen mis datos».</li>
        <li>
          {email ? (
            <>
              O envía un correo a{" "}
              <a className="text-emerald-700 underline" href={`mailto:${email}`}>
                {email}
              </a>{" "}
              indicando tu número de WhatsApp (con código de país) y el nombre de la tienda.
            </>
          ) : (
            "O pide al soporte de Selichat la eliminación indicando tu número de WhatsApp (con código de país) y el nombre de la tienda."
          )}
        </li>
        <li>
          Eliminaremos tus datos de contacto, conversaciones y archivos asociados en un plazo máximo
          de 30 días y te confirmaremos por el mismo medio.
        </li>
      </ol>

      <H2>Si tienes una cuenta en Selichat</H2>
      <ol className="list-decimal space-y-1 pl-6">
        <li>
          El dueño de la tienda puede eliminar productos, conversaciones e integraciones desde el
          panel.
        </li>
        <li>
          Para cerrar la cuenta y borrar todos los datos de la tienda, solicítalo
          {email ? (
            <>
              {" "}
              a{" "}
              <a className="text-emerald-700 underline" href={`mailto:${email}`}>
                {email}
              </a>
            </>
          ) : (
            " al soporte de Selichat"
          )}{" "}
          desde el correo registrado como dueño.
        </li>
      </ol>

      <p>
        Algunos datos pueden conservarse por el tiempo que exija la ley (por ejemplo, registros
        contables de pedidos). Los mensajes ya entregados a WhatsApp también quedan sujetos a las
        políticas de Meta.
      </p>
    </LegalPage>
  );
}
