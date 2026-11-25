import type { Metadata } from "next";
import { H2, LegalPage, legalContact } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Política de privacidad — Selichat" };
export const dynamic = "force-dynamic";

export default function Page() {
  const email = legalContact();
  return (
    <LegalPage title="Política de privacidad" updated="23 de noviembre de 2026">
      <p>
        Selichat es un CRM de ventas por WhatsApp con asistentes de inteligencia artificial que
        utilizan tiendas en línea (en adelante, «la tienda») para atender a sus clientes. Esta
        política explica qué datos tratamos, para qué y cómo los protegemos.
      </p>

      <H2>1. Quién es responsable</H2>
      <p>
        Cada tienda es responsable de los datos de sus propios clientes y decide cómo usarlos.
        Selichat actúa como encargado del tratamiento: procesa esos datos solo para prestar el
        servicio a la tienda. Respecto de los datos de las cuentas de usuario de Selichat (dueños y
        equipo de la tienda), Selichat es responsable.
      </p>

      <H2>2. Datos que tratamos</H2>
      <ul className="list-disc space-y-1 pl-6">
        <li>Cuenta de usuario: nombre, correo electrónico y datos de inicio de sesión.</li>
        <li>
          Datos de la tienda: catálogo, configuración y credenciales de integraciones (WhatsApp,
          proveedores de IA, logística), que se guardan cifradas.
        </li>
        <li>
          Datos de los clientes de la tienda que escriben por WhatsApp: número de teléfono, nombre
          de perfil, mensajes y archivos que envían, ciudad o dirección de entrega que compartan, y
          el anuncio por el que llegaron.
        </li>
        <li>
          Datos técnicos mínimos para seguridad y auditoría (por ejemplo, registros de acceso).
        </li>
      </ul>

      <H2>3. Para qué los usamos</H2>
      <ul className="list-disc space-y-1 pl-6">
        <li>Recibir y responder mensajes de WhatsApp en nombre de la tienda.</li>
        <li>Gestionar pedidos, envíos y notificaciones sobre el estado de esos pedidos.</li>
        <li>Generar respuestas con los modelos de IA que la tienda configure.</li>
        <li>Seguridad, prevención de fraude y cumplimiento de obligaciones legales.</li>
      </ul>
      <p>No vendemos datos personales ni los usamos para publicidad propia.</p>

      <H2>4. Con quién se comparten</H2>
      <p>
        Solo con los proveedores necesarios para prestar el servicio, según lo que la tienda active:
      </p>
      <ul className="list-disc space-y-1 pl-6">
        <li>Meta Platforms (WhatsApp Business Platform) para enviar y recibir mensajes.</li>
        <li>
          Proveedores de IA elegidos por la tienda (por ejemplo, Anthropic, OpenAI, xAI o Google)
          para generar respuestas.
        </li>
        <li>Plataformas logísticas y de pago que la tienda conecte (por ejemplo, Dropi).</li>
        <li>Proveedores de infraestructura donde se aloja el servicio.</li>
      </ul>

      <H2>5. Cómo los protegemos</H2>
      <p>
        Los datos de cada tienda están aislados a nivel de base de datos, las credenciales se
        guardan cifradas, las comunicaciones viajan cifradas (HTTPS) y los webhooks de WhatsApp se
        verifican con la firma de Meta.
      </p>

      <H2>6. Conservación</H2>
      <p>
        Conservamos los datos mientras la tienda mantenga su cuenta activa o mientras sean
        necesarios para las finalidades descritas. Al cerrar la cuenta o al recibir una solicitud de
        eliminación, los datos se eliminan salvo lo que la ley obligue a conservar.
      </p>

      <H2>7. Tus derechos</H2>
      <p>
        Puedes solicitar acceso, rectificación o eliminación de tus datos. Si eres cliente de una
        tienda, también puedes dirigirte directamente a ella. Consulta cómo pedir la eliminación en{" "}
        <a className="text-brand-700 underline" href="/eliminacion-de-datos">
          Eliminación de datos
        </a>
        .
      </p>

      <H2>8. Contacto</H2>
      <p>
        {email ? (
          <>
            Para cualquier consulta sobre privacidad escríbenos a{" "}
            <a className="text-brand-700 underline" href={`mailto:${email}`}>
              {email}
            </a>
            .
          </>
        ) : (
          "Para cualquier consulta sobre privacidad, contacta a la tienda con la que conversaste o al soporte de Selichat."
        )}
      </p>
    </LegalPage>
  );
}
