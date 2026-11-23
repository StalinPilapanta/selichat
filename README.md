# chatea

CRM de ventas conversacional con IA, para varios clientes a la vez (multitenant): ventas por WhatsApp, pedidos en Dropi y notificaciones logísticas.
El plan completo está en [`docs/PLAN.md`](docs/PLAN.md).

## Stack

| Capa          | Tecnología                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Monorepo      | pnpm workspaces + Turborepo, Biome (lint/format)                                               |
| Web           | Next.js 16 (App Router) + Tailwind 4 — `apps/web`                                              |
| API           | Fastify 5 + Better Auth (email/contraseña, enlace mágico, Google, organizaciones) — `apps/api` |
| Base de datos | PostgreSQL 17 + pgvector, Drizzle ORM, **Row Level Security** por tenant — `packages/db`       |
| Colas         | Redis (BullMQ a partir de la Fase 3)                                                           |
| Compartido    | Cifrado AES-256-GCM, roles, tipos de proveedores de IA — `packages/shared`                     |
| Despliegue    | Docker Compose en Coolify (VPS Hostinger)                                                      |

## Cómo está armado el multitenant

- **Tenant = organización** de Better Auth. Un usuario puede pertenecer a varias tiendas y cambiar entre ellas.
- Roles: `owner`, `admin`, `asesor`, `logistica`.
- Todas las tablas de negocio llevan `tenant_id` y tienen **RLS forzado**. La app se conecta con el rol `chatea_app`, que no es superusuario ni dueño de las tablas, así que Postgres no deja ver ni escribir filas de otro tenant aunque haya un bug en el código.
- Toda consulta a tablas de tenant pasa por `withTenant(db, tenantId, fn)`, que fija `app.tenant_id` dentro de la transacción.
- Los secretos (API keys de IA, y más adelante los tokens de Dropi y WhatsApp) se guardan cifrados con `ENCRYPTION_KEY` y nunca se devuelven al navegador.

## Desarrollo local

Requisitos: Node 22 (`nvm use`, ver `.nvmrc`), pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env
# genera las claves y pégalas en ENCRYPTION_KEY y BETTER_AUTH_SECRET
openssl rand -base64 32
openssl rand -base64 32

pnpm db:up            # Postgres (puerto 5433) + Redis (6379)
set -a; . ./.env; set +a
pnpm db:migrate
pnpm build            # compila los paquetes compartidos
pnpm dev              # web en http://localhost:3100, API en http://localhost:4000
```

Sin `SMTP_URL`, los correos (invitaciones, enlaces mágicos) se imprimen en el log del API.

| Comando                     | Qué hace                                                             |
| --------------------------- | -------------------------------------------------------------------- |
| `pnpm lint` / `pnpm format` | Biome                                                                |
| `pnpm typecheck`            | TypeScript en todo el monorepo                                       |
| `pnpm test`                 | Pruebas unitarias + integración (RLS y API contra el Postgres local) |
| `pnpm db:generate`          | Genera una migración desde `packages/db/src/schema`                  |
| `pnpm db:migrate`           | Aplica migraciones (usa `MIGRATION_DATABASE_URL`)                    |

Si agregas una tabla de tenant, súmala a `TENANT_TABLES` y al arreglo de la migración de RLS. Hay una prueba que falla si una tabla de tenant queda sin RLS forzado.

## Despliegue en Coolify

1. En Coolify: **New Resource → Docker Compose**, apuntando a este repo y al archivo `docker-compose.prod.yml`.
2. Asigna el dominio solo al servicio `web` (puerto 3100). El API no se expone: el navegador lo alcanza por `/api/*` a través de la web.
3. Variables de entorno:

| Variable                                                                      | Valor                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `WEB_URL`                                                                     | `https://tu-dominio`                                                                             |
| `POSTGRES_PASSWORD`                                                           | contraseña larga aleatoria (usuario dueño, migraciones)                                          |
| `APP_DB_PASSWORD`                                                             | otra contraseña larga aleatoria (usuario de la app)                                              |
| `ENCRYPTION_KEY`                                                              | `openssl rand -base64 32`. **Guárdala bien: si se pierde, no se pueden descifrar los secretos.** |
| `BETTER_AUTH_SECRET`                                                          | `openssl rand -base64 32`                                                                        |
| `SMTP_URL`, `EMAIL_FROM`                                                      | para enviar invitaciones y enlaces mágicos                                                       |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_ENABLED=true` | opcional, login con Google (callback: `https://tu-dominio/api/auth/callback/google`)             |

El contenedor del API aplica las migraciones pendientes cada vez que arranca.

## Conectar WhatsApp (Cloud API de Meta)

1. En [Meta for Developers](https://developers.facebook.com/apps) crea una app tipo **Empresa** y agrégale el producto **WhatsApp**.
2. En el Business Manager crea un **usuario del sistema** con los permisos `whatsapp_business_messaging` y `whatsapp_business_management` y genera un **token permanente**.
3. En chatea: **Integraciones → WhatsApp** pega Phone Number ID, WABA ID, el token y el **App Secret** (Configuración de la app → Básica). chatea valida el token contra Meta antes de guardar.
4. Copia la **URL del webhook** y el **token de verificación** que muestra chatea y pégalos en Meta → WhatsApp → Configuración. Suscribe el campo `messages` (y `message_templates` si quieres el estado de plantillas en vivo).
5. Meta exige HTTPS público para el webhook: en local usa un túnel (cloudflared/ngrok) apuntando al puerto 3100; en producción es tu dominio de Coolify.

Cada webhook se valida con la firma `X-Hub-Signature-256` (App Secret) y los mensajes repetidos se descartan por su id. Fuera de la ventana de 24 h solo se pueden enviar plantillas aprobadas.
