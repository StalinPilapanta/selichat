import type { Metadata } from "next";
import { H2, LegalPage, legalContact } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Términos del servicio — Selichat" };
export const dynamic = "force-dynamic";

export default function Page() {
  const email = legalContact();
  return (
    <LegalPage title="Términos del servicio" updated="26 de noviembre de 2026">
      <p>
        Estos términos regulan el uso de Selichat, un CRM de ventas por WhatsApp con asistentes de
        inteligencia artificial para tiendas en línea (en adelante, «la tienda»). Al crear una
        cuenta o usar el servicio, aceptas estos términos.
      </p>

      <H2>1. El servicio</H2>
      <p>
        Selichat permite a la tienda conectar su número de WhatsApp Business, atender a sus
        clientes con ayuda de IA, gestionar leads, pedidos y envíos, y enviar notificaciones sobre
        el estado de esos pedidos. Algunas funciones dependen de servicios de terceros que la tienda
        conecta (Meta, proveedores de IA, plataformas logísticas).
      </p>

      <H2>2. Cuenta y acceso</H2>
      <ul className="list-disc space-y-1 pl-6">
        <li>Debes dar información veraz y mantener tus datos de acceso en secreto.</li>
        <li>
          Eres responsable de lo que hagan los miembros de tu equipo a los que des acceso a la
          tienda.
        </li>
        <li>Avísanos de inmediato si sospechas un acceso no autorizado.</li>
      </ul>

      <H2>3. Uso de WhatsApp</H2>
      <p>
        Al conectar WhatsApp, la tienda acepta también las{" "}
        <a
          className="text-brand-700 underline"
          href="https://www.whatsapp.com/legal/business-policy/"
          target="_blank"
          rel="noreferrer"
        >
          Políticas de WhatsApp Business
        </a>{" "}
        y los términos de Meta. La tienda se compromete a:
      </p>
      <ul className="list-disc space-y-1 pl-6">
        <li>Escribir solo a personas que le dieron su consentimiento para recibir mensajes.</li>
        <li>Respetar las solicitudes de baja de sus clientes.</li>
        <li>No enviar spam, contenido engañoso, ilegal ni productos prohibidos por Meta.</li>
        <li>Usar plantillas aprobadas por Meta para mensajes fuera de la ventana de 24 horas.</li>
      </ul>
      <p>
        Meta puede limitar o suspender un número por incumplir sus políticas; Selichat no responde
        por esas decisiones.
      </p>

      <H2>4. Respuestas generadas con IA</H2>
      <p>
        Los asistentes de IA generan respuestas automáticas a partir del catálogo y la
        configuración de la tienda. Pueden cometer errores. La tienda es responsable de revisar su
        configuración, de la información que entrega a sus clientes y de los precios, promociones y
        pedidos que acepte.
      </p>

      <H2>5. Contenido y datos de la tienda</H2>
      <p>
        La tienda conserva la propiedad de su contenido y de los datos de sus clientes. Nos
        autoriza a tratarlos solo para prestar el servicio, según la{" "}
        <a className="text-brand-700 underline" href="/privacidad">
          Política de privacidad
        </a>
        .
      </p>

      <H2>6. Usos prohibidos</H2>
      <ul className="list-disc space-y-1 pl-6">
        <li>Usar el servicio para fines ilegales o fraudulentos.</li>
        <li>Intentar acceder a datos de otras tiendas o vulnerar la seguridad del servicio.</li>
        <li>Revender o copiar el servicio sin autorización.</li>
      </ul>

      <H2>7. Disponibilidad</H2>
      <p>
        Hacemos lo posible por mantener el servicio disponible, pero puede haber interrupciones por
        mantenimiento o por fallas de terceros (Meta, proveedores de IA, logística, alojamiento).
        El servicio se ofrece «tal cual», sin garantías de resultados de venta.
      </p>

      <H2>8. Limitación de responsabilidad</H2>
      <p>
        En la medida que lo permita la ley, Selichat no responde por daños indirectos, pérdida de
        ventas o de datos derivados del uso del servicio o de servicios de terceros.
      </p>

      <H2>9. Suspensión y baja</H2>
      <p>
        Puedes dejar de usar el servicio y pedir la eliminación de tu cuenta en cualquier momento
        (ver{" "}
        <a className="text-brand-700 underline" href="/eliminacion-de-datos">
          Eliminación de datos
        </a>
        ). Podemos suspender una cuenta que incumpla estos términos o las políticas de Meta.
      </p>

      <H2>10. Cambios</H2>
      <p>
        Podemos actualizar estos términos. Publicaremos la versión vigente en esta página con su
        fecha de actualización.
      </p>

      <H2>11. Ley aplicable</H2>
      <p>Estos términos se rigen por las leyes de la República del Ecuador.</p>

      <H2>12. Contacto</H2>
      <p>
        {email ? (
          <>
            Para consultas sobre estos términos escríbenos a{" "}
            <a className="text-brand-700 underline" href={`mailto:${email}`}>
              {email}
            </a>
            .
          </>
        ) : (
          "Para consultas sobre estos términos, contacta al soporte de Selichat."
        )}
      </p>
    </LegalPage>
  );
}
