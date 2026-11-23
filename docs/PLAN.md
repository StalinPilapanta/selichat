# Análisis de Chatea Pro + Plan del CRM de ventas IA multitenant

> Fuente: inspección en vivo del workspace **VitashopEc** (team 330967, flow `f300687`) vía MCP de Chatea Pro y MCP de Dropi — 2026-11-16.
> Prompts y configs completos (secretos redactados): `docs/referencia-chateapro/bot_fields_prompts.md` y `bot_fields_catalog.md`.

---

## Parte 1 — Cómo funciona Chatea Pro hoy

### 1.1 Qué es por debajo

Chatea Pro es un **white-label de UChat** (mismo API: `flow_ns`, `sub_flow_ns`, `bot fields`, `user fields`, `inbound webhooks`, AI Hub). No es un CRM hecho para Dropi: es un constructor de chatbots genérico al que le montaron una **plantilla gigante** ("Main de agentes" v3.2.B + "Main de Logístico" v1.1.6.3) que hace todo lo de ventas y logística con nodos, variables y llamadas HTTP.

| Pieza | Inventario en el workspace |
|---|---|
| Flow (bot) | 1 omnicanal (`Omni VitashopEc`), canal principal WhatsApp Cloud |
| Sub-flujos | **58** (lógica, disparadores, funciones, botones) |
| AI Agents | 5 — Ventas WhatsApp (Grok 4.20), Ventas con MCP (Grok), Confirmaciones, Seguimiento, Novedades (GPT-4o-mini) |
| AI Tasks | **36** micro-prompts (extraer datos, JSON para Dropi, clasificar novedad, gancho de venta, analizar dirección, describir imagen, TTS…) |
| Bot fields (config global) | 51 — aquí viven **los prompts, productos y reglas en JSON** |
| User fields (por contacto) | **299** — estado de cada conversación/pedido (muchos "Multiusos texto 1..5") |
| Tags | 49 — funcionan como **máquina de estados** (`[Confirmaciones] Pedido por confirmar`, `[Novedad] en interacción con IA`, `Ya confirmado✅`…) |
| Plantillas WhatsApp (HSM) | 27 — confirmación, recordatorios, guía generada, en reparto, en oficina, entregado, novedad |
| Inbound webhooks | 3 — Confio pagos (x2), Carritos abandonados |
| Integraciones | Dropi (`api.dropi.ec`, token JWT de integración + webhook de estados), Shopify, Confio, ElevenLabs, Meta CAPI |
| Volumen (30 días) | ~1.000 msgs/día, ~35 leads nuevos/día, ~80 contactos activos/día, **<3 % mensajes escritos por humanos** |

### 1.2 Flujo de venta (Agente de Ventas)

```
Anuncio Click-to-WhatsApp / mensaje con palabra clave
  │
  ▼
[Logica: ID de anuncio] ── lee ctwa_clid / ad_id del referral
  │
  ▼
[Disparador de productos Extendido]  (bot field JSON)
  keyW → "Hola 👋 me interesa el Mega Red", idAd → 1202505146...
  → resuelve SLOT  "[Producto Ventas Wp] N"
  │
  ▼
[Multimedia inicial]  mensaje_inicial + imágenes/video/audio + pregunta_de_entrada
  ("📍 ¿Desde qué ciudad nos escribes?")
  │
  ▼
[Logica: Agente Ventas WhatsApp]  ← bucle por cada mensaje del cliente
  Prompt = Config general 2 (capa común)
         + Prompt maestro (plantilla {{variables}}) ó prompt_libre del producto
         + historial + datos ya capturados
  AI Tasks auxiliares por turno:
     [AV] Recolección de datos  → nombre, tel, ciudad, provincia, dirección, cantidad
     [AV] Extraer precios y ofertas
     [AV] Análisis de palabra clave / intención de compra
     [AV] Mensaje para audio (TTS ElevenLabs)
  Salida dividida en hasta 5 mensajes, URLs → media según extensión
  │
  ├── sin respuesta → [Recordatorios] 1h / 5h (ventana 08:00–22:00)
  ├── no compra     → [Remarketing 1/2] 3 / 5 días (plantilla HSM o prompt)
  │
  ▼  datos completos + confirmación
[Análisis final] → [AV] JSON Subir a Dropi → POST orden a Dropi
  flags: "Solo Con Recaudo", "Subir en Pendiente Confirmación"
  validaciones: huella digital (% entrega ≥ 60 % con ≥3 órdenes), flete mínimo
  ├── error → [AL] Diagnosticar error de Dropi → [Reintento de subida]
  └── ok    → Meta CAPI Purchase, contador "Pedidos de hoy / Facturación"
             → upsell post-compra (si activo)
             → (opcional) Confio: enlace de pago anticipado 40 % del envío
```

**Estructura del prompt de ventas** (dos modos por producto):

- **Guiado** – plantilla maestra con variables `{{nombre_asesor}} {{rol}} {{publico_objetivo}} {{angulo_venta}} {{descripcion}} {{variaciones}} {{metodos_pago}} {{preguntas_frecuentes}} {{presentacion_ofertas}} {{upsell}} {{reglas_personalizadas}}…`. Secciones: filosofía (vender desde el dolor), blindaje anti-injection (jerarquía Sistema > Maestro > Producto > Reglas), **registro de estado LLENO/VACÍO/INVÁLIDO** antes de cada respuesta, flujo de 4 interacciones (geografía → oferta → datos → confirmación), validación de dirección, upsell, post-cierre.
- **Libre** – texto completo por producto (los 4 activos usan este): persona ("Laura", "Diana", "Carlos"), precios por cantidad, regalo sorpresa, bloque maestro de envíos (retiro en agencia Servientrega), anti-bucle, resumen con formato fijo, audio de cierre.

**Cada producto = un JSON** con: `activadores_del_flujo`, `embudo_de_ventas`, `informacion_de_producto` (con `id_dropi`, precio, moneda, SIMPLE/VARIABLE), `prompt`, `recordatorios`, `remarketing`, `upsells`, `voz_con_ia`, `meta_conversion`. Existe además un meta-prompt que **genera el JSON del producto a partir de su ficha**.

### 1.3 Flujo logístico y notificaciones (post-venta)

```
Dropi ──webhook──► https://chateapro.app/webhook/dropi/<team>-<secret>
                      │ (cambio de estado de la orden)
                      ▼
            [Identificar estados logísticos]
            estado crudo de transportadora (105 estados: Servientrega,
            Laarcourier, Gintracom, HL-Express…) → ETAPA:
                      │
  ┌───────────────┬───┴──────────┬──────────────┬──────────────┬─────────────┐
  ▼               ▼              ▼              ▼              ▼             ▼
PENDIENTE /    GUIA_GENERADA   EN REPARTO     EN OFICINA     ENTREGADO     NOVEDAD
PEND. CONFIRM.
Confirmaciones Seguimiento    Seguimiento    Seguimiento    Seguimiento   Agente Novedades
HSM confirmar  HSM guía+PDF   HSM reparto    HSM oficina    HSM entregado clasifica motivo
botones:       + gancho IA    + valor a      + 5 recordat.  + post-venta  (11 categorías)
CONFIRMAR /    (≤15 palabras) pagar          escalonados    asesor        pide dato al cliente
MODIFICAR      ver guía                      4 días 08:30                 → [Solucionar novedad
recordatorio                                                                en Dropi] (componente
30h y 2h                                                                    JSON transportadora)
  │                                                                       recordatorio 1h / 5h
  └─► Confirmar/Cancelar en Dropi ; Corregir dirección (IA) ; Hablar con asesor
```

- **Agente de Confirmaciones**: mensaje de gracias + HSM `confirmacion_*` con botones; si el cliente pide cambios, la IA valida el cambio (`[Logístico] Validar cambios en el pedido`) y actualiza Dropi.
- **Agente de Seguimiento**: notifica cada hito con plantilla HSM; IA genera un "gancho de venta" corto por producto; recordatorios de retiro en oficina con presión creciente para evitar devoluciones.
- **Agente de Novedades**: `[Novedades] Mensajes por tipo de novedad` mapea categoría → `motivo` + `dato a solicitar`; IA clasifica (`[Logístico] Clasificar Novedad`), conversa, mapea la solución al **componente JSON que exige la transportadora** y la sube a Dropi; escala a asesor si no puede.
- Canales de notificación: **solo WhatsApp** (HSM fuera de 24 h). Llamadas por voz vía Talkyria (opcional). **No hay SMS en uso**, aunque el canal está habilitado.

### 1.4 Integración con Dropi (lo que se usa)

| Operación | Uso |
|---|---|
| Crear orden (`CON RECAUDO` / `SIN RECAUDO`, estado inicial `PENDIENTE CONFIRMACION`) | Cierre de venta |
| Cotizar flete por transportadora | Validar flete mínimo / elegir transportadora |
| Huella digital del comprador (`delivery_probability`, `risk_label`) | Antifraude antes de subir |
| Confirmar / cancelar / modificar orden | Agente de confirmaciones |
| Webhook de cambio de estado | Motor de notificaciones |
| Solucionar novedad (por transportadora) | Agente de novedades |
| Catálogo, ciudades, departamentos, transportadoras | Datos maestros |

Transportadoras activas (EC): Servientrega, Gintracom, Laarcourier, Veloces, Urbano. Moneda USD.

### 1.5 Debilidades de Chatea Pro (la oportunidad)

1. **Todo es "variables sueltas"**: 299 user fields, "Multiusos texto 1..5", estados en tags → frágil, imposible de auditar o reportar.
2. **Productos limitados a slots** (`[Producto Ventas Wp] 1..N`) en JSON dentro de un campo de texto.
3. **Prompts gigantes y copiados** entre productos (restos de "Isabel" en prompts de "Laura"), sin versionado ni pruebas. Prompt maestro pensado para Colombia (COP, barrio) aplicado a Ecuador.
4. **El LLM hace trabajo determinista**: el estado LLENO/VACÍO, extraer JSON para Dropi, leer PDFs de agencias — esto debería ser código + tool calling.
5. **Mapeo de estados de Dropi** por lógica de nodos; 105 estados crudos sin tabla canónica.
6. **Sin CRM real**: no hay pipeline, métricas de embudo por producto/anuncio, ni vista de pedidos unificada.
7. **Sin SMS ni fallback** de canal; sin multitenant propio (cada cliente clona la plantilla).
8. Secretos (token Dropi/Confio/OpenAI) legibles por cualquier integración con scope "Manage Team".

---

## Parte 2 — Producto a construir

**Nombre de trabajo:** `chatea` (CRM de ventas conversacional con IA, multitenant).

### 2.1 Alcance funcional

| Módulo | Qué hace |
|---|---|
| **Tenants y equipo** | Organización, usuarios, roles (owner, admin, asesor, logística), planes y límites |
| **Canales** | WhatsApp Cloud API (número propio por tenant), SMS, (después Messenger/IG/TikTok) |
| **Inbox CRM** | Conversaciones en vivo, toma de control humano, notas, etiquetas, asignación |
| **Pipeline** | Lead → Interesado → Datos completos → Pedido creado → Confirmado → En tránsito → Entregado / Novedad / Devolución |
| **Catálogo** | Productos, variantes, ofertas por cantidad, media, FAQs, upsells, importación desde Dropi |
| **Prompt Studio** | Prompt maestro por tenant + prompt por producto (guiado o libre), variables, versiones, preview, pruebas |
| **Agente IA de ventas** | Conversa, captura datos, cotiza, valida, crea pedido en Dropi |
| **Agente IA logístico** | Confirmación, seguimiento, novedades; notifica por WhatsApp y SMS |
| **Motor de automatizaciones** | Recordatorios, remarketing, reglas evento → acción con horarios |
| **Integraciones** | Dropi (por país), Meta CAPI, Shopify/Woo (después), pasarela de pago (Confio u otra), TTS |
| **Analítica** | Embudo por producto/anuncio, tasa de confirmación, entrega, devolución, costo IA por pedido |

### 2.2 Arquitectura propuesta

```
                ┌──────────────── Web App (Next.js) ─────────────────┐
                │ Inbox · Pipeline · Catálogo · Prompt Studio ·      │
                │ Automatizaciones · Analítica · Configuración       │
                └───────────────▲────────────────────────────────────┘
                                │ REST/WS (auth JWT, tenant en token)
┌───────────────────────────────┴────────────────────────────────────┐
│ API (NestJS/Fastify, TypeScript)                                    │
│  ├─ Channel Gateway   WhatsApp webhooks · SMS · envío con reintentos│
│  ├─ Conversation Svc  mensajes, sesiones, ventana 24h               │
│  ├─ Agent Orchestrator  ┐                                           │
│  │    SalesAgent         │ LLM con tool-calling + estado en DB       │
│  │    LogisticsAgent     │ (provider-agnostic: Claude/OpenAI/Grok)   │
│  │    IncidentAgent     ┘                                           │
│  ├─ Commerce Svc      productos, pedidos, máquina de estados        │
│  ├─ Dropi Adapter     órdenes, cotización, huella, novedades, webhook│
│  ├─ Notification Engine  evento → regla → canal (WA HSM / SMS)      │
│  └─ Scheduler         recordatorios, remarketing, timeouts          │
└──────┬───────────────────┬──────────────────────┬──────────────────┘
       │                   │                      │
 PostgreSQL (RLS por    Redis + BullMQ         Object storage (S3/R2)
 tenant_id, pgvector)   colas y jobs diferidos media de productos
```

Decisiones clave:

- **Multitenancy**: base compartida, `tenant_id` en todas las tablas + **Row Level Security** de Postgres. Secretos de integraciones cifrados (KMS / libsodium) y nunca expuestos al LLM.
- **El estado vive en la DB, no en el prompt**: el agente lee/escribe un objeto `checkout_state` tipado (nombre, teléfono, ciudad, dirección, producto, cantidad, oferta) con herramientas `update_order_data`. Reemplaza el "registro LLENO/VACÍO" y las AI Tasks de extracción.
- **Tool calling en vez de AI Tasks**: `get_product`, `get_offers`, `search_city`, `quote_shipping`, `check_buyer_risk`, `create_order`, `send_media`, `send_audio`, `schedule_followup`, `handoff_to_human`, `classify_incident`, `submit_incident_solution`.
- **Prompts compuestos por capas** (igual que Chatea Pro, pero versionados): `Sistema (plataforma, fijo)` → `Maestro del tenant` → `Producto (guiado/libre)` → `Reglas personalizadas` → `Contexto dinámico (estado, país, horario)`.
- **Estados de Dropi normalizados**: tabla `carrier_status_map (pais, transportadora, estado_crudo) → etapa_canonica`, editable desde admin.
- **Proveedor LLM abstracto** por tenant/agente con límites de costo; registrar tokens y costo por conversación.

### 2.3 Modelo de datos (núcleo)

```
tenants(id, nombre, pais, moneda, zona_horaria, plan)
users(id, tenant_id, email, rol)
channels(id, tenant_id, tipo[whatsapp|sms], credenciales_cifradas, numero)
integrations(id, tenant_id, tipo[dropi|meta_capi|pago|tts], config_cifrada, estado)

contacts(id, tenant_id, telefono, nombre, ciudad, tags[], origen_ad_id, ctwa_clid)
conversations(id, tenant_id, contact_id, channel_id, estado, agente_activo, bot_pausado, ultima_entrada_at)
messages(id, conversation_id, direccion, autor[cliente|ia|humano|sistema], tipo, contenido, media_url, wa_message_id, estado_entrega)

products(id, tenant_id, nombre, descripcion, precio, moneda, dropi_product_id, tipo[SIMPLE|VARIABLE], estado)
product_variants(id, product_id, atributos, dropi_variation_id, precio)
product_offers(id, product_id, cantidad, precio_total, etiqueta)          -- "2x $38"
product_media(id, product_id, tipo, url, orden, uso[inicial|cierre|faq])
product_faqs(id, product_id, pregunta, respuesta)
product_triggers(id, product_id, tipo[keyword|ad_id], valor)
product_upsells(id, product_id, upsell_product_id, momento, precio)

prompts(id, tenant_id, scope[master|product|agent], ref_id, modo[guiado|libre], version, contenido, secciones_json, activo)
agent_configs(id, tenant_id, tipo[ventas|confirmacion|seguimiento|novedades], persona, modelo, temperatura, skills_json)

orders(id, tenant_id, contact_id, conversation_id, estado, total, flete, rate_type, direccion_json, dropi_order_id, guia, transportadora)
order_items(id, order_id, product_id, variant_id, cantidad, precio)
order_events(id, order_id, origen[dropi|ia|humano], estado_crudo, etapa, payload, created_at)
incidents(id, order_id, categoria, motivo, dato_solicitado, estado, solucion_json)

automation_rules(id, tenant_id, evento, condiciones_json, accion, canal, plantilla_id, delay, ventana_horaria)
message_templates(id, tenant_id, canal, nombre_wa, idioma, categoria, cuerpo, variables, estado_meta)
scheduled_jobs(id, tenant_id, tipo, ref_id, run_at, estado)
carrier_status_map(pais, transportadora, estado_crudo, etapa)
ai_runs(id, tenant_id, conversation_id, agente, modelo, tokens_in, tokens_out, costo, tools_json, latencia)
```

### 2.4 Motor de notificaciones (WhatsApp + SMS)

```
evento (dropi.status_changed | order.created | conversation.idle | incident.opened ...)
  → normalizar (carrier_status_map → etapa)
  → buscar automation_rules del tenant para esa etapa
  → decidir canal:
       ventana 24h abierta        → mensaje libre WA (texto IA + gancho)
       fuera de ventana           → plantilla HSM aprobada
       WA falla / no tiene WA / regla lo pide → SMS (texto corto + link de seguimiento)
  → respetar horario (08:00–22:00 zona del tenant), deduplicar por (orden, etapa)
  → enviar, registrar en messages + order_events, reintentar con backoff
```

Etapas iniciales: `pedido_creado`, `por_confirmar` (+ recordatorios 2h/30h), `confirmado`, `guia_generada`, `en_reparto`, `en_oficina` (+ recordatorios diarios), `entregado`, `novedad` (+ 1h/5h), `devolucion`.

SMS: proveedor con cobertura Ecuador/LatAm (Twilio, Infobip o un agregador local más barato); abstraer con interfaz `SmsProvider`.

---

## Parte 3 — Plan de trabajo por fases

Cada fase termina con algo usable. Estimaciones para 1 desarrollador full-time con ayuda de IA.

### Fase 0 — Fundaciones (1 semana) — ✅ COMPLETADA 2026-11-20
- Monorepo (pnpm + Turborepo): `apps/web`, `apps/api`, `packages/db`, `packages/shared`.
- Postgres + Prisma/Drizzle con RLS, Redis, Docker Compose local, CI (lint, test, typecheck).
- Auth (email + magic link / Google), tenants, usuarios, roles, invitaciones.
- Cifrado de secretos, logging estructurado, observabilidad básica.
- **Entregable:** login, crear tenant, invitar usuario.
- **Hecho además:** proveedores de IA por tenant (API key cifrada) y modelo/temperatura configurables por agente; configuración de país, moneda, zona horaria y horario de envío; registro de auditoría; Dockerfiles + `docker-compose.prod.yml` para Coolify; CI en GitHub Actions; 14 pruebas (cifrado, RLS, API de punta a punta).
- **Pendiente de la Fase 0:** configurar SMTP real y Google OAuth en producción; primer despliegue en Coolify.

### Fase 1 — Catálogo + Prompt Studio (1–2 semanas) — ✅ COMPLETADA 2026-11-20 (salvo importación desde Dropi)
- CRUD de productos, variantes, ofertas, media (upload a S3/R2), FAQs, triggers (keyword / ad_id), upsells.
- Importar producto desde Dropi (`list_products` → id, precio, variantes, imágenes).
- Prompt Studio: maestro + por producto, modo guiado (secciones) y libre, variables `{{...}}` con autocompletado, versiones y rollback.
- Generador IA "ficha → producto+prompt" (equivalente al meta-prompt de Chatea Pro).
- **Script de migración**: leer bot fields de Chatea Pro (MCP) e importar los 4 productos y prompts actuales.
- **Entregable:** catálogo VitashopEc cargado con sus prompts.
- **Hecho:** catálogo completo (ofertas, variantes, multimedia con subida de archivos, FAQs, disparadores únicos por tienda, upsells, recordatorios/remarketing); prompts por capas (plataforma → común → maestro → producto) con versiones, publicación, rollback y vista previa del prompt final; generador IA "ficha → producto + prompt guiado" con el modelo que configure la tienda; importador desde Chatea Pro idempotente (re-importar actualiza, no duplica). 49 pruebas.
- **Movido a la Fase 4:** importar producto desde Dropi (requiere el adapter de Dropi y su credencial propia).
- **Pendiente del usuario:** correr la importación real de VitashopEc desde *Catálogo → Importar desde Chatea Pro* con su token. Las ofertas por cantidad viven dentro de los prompts libres de Chatea Pro y hay que cargarlas a mano en la pestaña Ofertas.

### Fase 2 — Canal WhatsApp + Inbox CRM (2 semanas) — ✅ COMPLETADA 2026-11-21
- WhatsApp Cloud API: onboarding de número (Embedded Signup), webhook, envío de texto/media/botones/plantillas, estados de entrega.
- Gestión de plantillas HSM (crear, sincronizar estado con Meta).
- Inbox en tiempo real (WebSocket), pausar/reanudar bot, asignación, notas, etiquetas.
- Captura de `referral` (ad_id, ctwa_clid) → contacto.
- **Entregable:** conversar con clientes desde la app sin IA.
- **Hecho:** conexión manual por tienda (Phone Number ID, WABA, token permanente, App Secret) validada contra Meta; webhook por canal con firma `X-Hub-Signature-256`, dedupe por `wamid`, todos los tipos de mensaje, referral de anuncio (`ad_id`, `ctwa_clid`) y producto detectado por anuncio o palabra clave; estados de entrega que no retroceden; envío de texto, archivos y plantillas con ventana de 24 h; plantillas (sincronizar, crear con ejemplos, estado en vivo); bandeja en tiempo real (SSE) con filtros, búsqueda, asignación, pausa del bot, etiquetas, notas internas y media entrante descargada y cacheada. 18 pruebas nuevas.
- **Pendiente / después:** Embedded Signup (registro con un clic) requiere ser *tech provider* aprobado por Meta → Fase 8. El bus en tiempo real es en memoria (una sola instancia del API); pasar a Redis pub/sub si se escala a varias.

### Fase 3 — Agente IA de ventas (2–3 semanas)
- Orquestador: router de producto (trigger/ad_id/clasificación) → composición de prompt por capas → LLM con tools → post-procesado (split de mensajes, media por URL).
- `checkout_state` tipado + tools (`update_order_data`, `get_offers`, `search_city`, `quote_shipping`, `send_media`, `handoff_to_human`).
- Embudo inicial (mensaje + multimedia + pregunta de entrada), anti-bucle, límites de turnos, guardrails anti-injection.
- Debounce de mensajes (agrupar ráfagas del cliente antes de responder), transcripción de audios entrantes, descripción de imágenes.
- TTS opcional (ElevenLabs) para audio de cierre.
- **Banco de pruebas**: conversaciones simuladas por producto (cliente-IA vs agente) con aserciones (pide ciudad, no repite datos, precio correcto, crea orden). Corre en CI al cambiar prompts.
- **Entregable:** el agente cierra ventas en sandbox con los prompts migrados.

### Fase 4 — Integración Dropi + Pedidos (1–2 semanas)
- Adapter Dropi por país (URL base + token por tenant): crear orden, cotizar, huella digital, confirmar/cancelar, catálogo, ciudades, transportadoras.
- Tool `check_buyer_risk` + reglas configurables (% entrega mínimo, nº órdenes, flete mínimo, solo con recaudo, subir en pendiente confirmación).
- Webhook de estados por tenant (URL con secreto) → `order_events` → `carrier_status_map`.
- Vista de pedidos y pipeline Kanban; reintento de subida con diagnóstico de error.
- Meta CAPI (Lead / Purchase con ctwa_clid).
- **Entregable:** venta completa WhatsApp → orden en Dropi → estado de vuelta en el CRM.

### Fase 5 — Agente logístico + notificaciones WA/SMS (2 semanas)
- Notification Engine + Scheduler (BullMQ) con reglas por etapa, ventanas horarias, dedupe.
- Confirmaciones: plantilla con botones CONFIRMAR / MODIFICAR, recordatorios, cambio de datos validado por IA, actualización en Dropi.
- Seguimiento: guía generada (PDF/link), en reparto, en oficina (+ recordatorios), entregado (+ post-venta), con "gancho" IA.
- Canal SMS + fallback automático y plantillas SMS por etapa.
- **Entregable:** el cliente final recibe todos los avisos logísticos sin intervención humana.

### Fase 6 — Agente de novedades (1–2 semanas)
- Clasificación de novedad (categorías de Chatea Pro como semilla), mensajes `motivo`/`dato` por categoría editables.
- Conversación para obtener solución (nueva fecha, dirección, referencia, retiro en oficina) y envío a Dropi con el formato de cada transportadora.
- Escalamiento a asesor, recordatorios 1h/5h, métricas de novedades resueltas por IA.
- **Entregable:** novedades resueltas automáticamente y registradas.

### Fase 7 — Remarketing, recordatorios y analítica (1–2 semanas)
- Recordatorios de venta (1h/5h) y remarketing (3/5 días) por producto, con plantilla o mensaje IA.
- Carritos abandonados (webhook Shopify/Woo).
- Dashboard: leads, conversión por producto/anuncio, tasa confirmación, entrega, devolución, novedades, costo IA por pedido, tiempo de respuesta.
- **Entregable:** paridad funcional con la plantilla de Chatea Pro.

### Fase 8 — SaaS (1–2 semanas)
- Onboarding guiado (conectar WhatsApp, Dropi, cargar primer producto, generar prompt).
- Planes y facturación (Stripe / pasarela local), límites (conversaciones, mensajes IA, números).
- Panel super-admin, auditoría, exportación de datos, backups.
- **Entregable:** un segundo tenant se registra y vende solo.

**Total estimado:** 13–19 semanas a paridad + SaaS. **MVP vendible = Fases 0–5** (~9–12 semanas): ventas IA + Dropi + confirmación/seguimiento por WA y SMS.

---

## Ideas tomadas de Vocero (github.com/MauroProto/Vocero, revisado 2026-11-20)

Proyecto Python/FastAPI sin licencia: se reusan ideas, no código.

| Idea | Dónde aplica |
|---|---|
| Webhook de Meta: verificación `hub.challenge`, deduplicar por `message.id`, procesar en segundo plano y responder 200 al instante | Fase 2. Mejora: dedupe en DB/Redis (Vocero lo hace en memoria) y **validar la firma `X-Hub-Signature-256`** (Vocero no lo hace) |
| Bloqueo por contacto para no procesar dos mensajes del mismo cliente a la vez | Fase 3: cola BullMQ con un grupo por conversación + debounce de ráfagas |
| Descarga de media de WhatsApp en 2 pasos (obtener URL → bajar con el token) y transcripción de notas de voz | Fases 2–3 (ElevenLabs Scribe u otro STT configurable) |
| Normalizar teléfonos por país (p. ej. Argentina 549 → 54 al responder) | Fase 2: función `normalizePhone` por país en `packages/shared` |
| Salida estructurada con esquema estricto para extraer datos | Ya aplicado en el generador IA (Fase 1) y para `checkout_state` (Fase 3) |
| **Llamadas de voz salientes con IA** (ElevenLabs Agents + Twilio): variables dinámicas por llamada, herramientas que el agente invoca durante la llamada y webhook de estado (`busy`, `no-answer`, `failed`) | Fase 5: llamada de confirmación de pedido como alternativa a Talkyria, con herramientas `confirmar_pedido` y `corregir_direccion` que actualizan Dropi |

## Parte 4 — Decisiones (actualizado 2026-11-20)

| Decisión | Estado |
|---|---|
| Stack | ✅ TypeScript end-to-end: Next.js 16 + **Fastify 5** (en vez de NestJS: más liviano para 1 dev) + Drizzle + Postgres 17/pgvector + Redis/BullMQ + Better Auth |
| Hosting | ✅ VPS Hostinger con **Coolify** (Docker Compose: web, api, postgres, redis). Sin servicios gestionados por ahora; respaldos de Postgres desde Coolify |
| LLM | ✅ **Configurable por tenant y por agente desde el CRM**: Anthropic, OpenAI, xAI, Google o cualquier API compatible con OpenAI (OpenRouter, Groq, DeepSeek…). El cliente trae sus propias keys. Ejecución con Vercel AI SDK en la Fase 3 |
| WhatsApp | Cloud API directa de Meta (tech provider) |
| SMS | ⏳ Interfaz `SmsProvider`; candidatos: Twilio, Infobip, Vonage. Decidir en la Fase 5 con pruebas de entrega reales en Ecuador |
| País inicial | Ecuador (Dropi EC, USD), diseñado para CO/MX/PE/CL/CR/PA/GT/PY/AR |
| Pagos anticipados | ⏳ Interfaz `PaymentProvider`; evaluar Confio vs pasarelas locales (Payphone, Kushki, PagoPlux) en la Fase 7 |

## Parte 5 — Riesgos

- **Aprobación de Meta** como tech provider y plantillas UTILITY (2 plantillas de novedad ya fueron rechazadas en Chatea Pro): iniciar el trámite en Fase 0.
- **API de Dropi**: confirmar endpoints de novedades y webhooks para integraciones propias (el token actual es de tipo "CHATEA PRO"); pedir credencial de integración propia.
- **Costo IA**: medir desde Fase 3; los prompts libres actuales son muy largos → usar prompt caching.
- **Calidad del agente**: sin banco de pruebas, cada cambio de prompt rompe ventas. El harness de Fase 3 es obligatorio.
