# Catálogo de Bot Fields — ChateaPro (NatureVitaEC / VitashopEc)

Fuente: export `flow_bot_fields` (51 campos, 1 página). Los secretos se muestran como `[REDACTED]`.

| # | Nombre | Tipo | Categoría | Propósito |
|---|---|---|---|---|
| 0 | Configuración general | array | config | Plantilla vacía de config general (conexión Dropi, validaciones de orden, respuesta IA 'multiple'); parece la versión por defecto sin rellenar |
| 1 | [Confio] Token | text | credentials | JWT de la integración Confio (pagos) — [REDACTED] |
| 2 | [Ventas Wp] Confirmaciones | array | config | Pago anticipado en confirmación de ventas: ofrecer a todos, cobrar 40% del envío, estrategia de persuasión (pruebas Confio) |
| 3 | [Producto Ventas Wp] 4 | array | prompt | Producto slot 4: Drenaje Linfático Aurelys — triggers, embudo, prompt libre 'Laura V5', recordatorios, remarketing, upsells, voz |
| 4 | [Producto Ventas Wp] 3 | array | prompt | Producto slot 3: NAD+ PRO MAX — triggers, embudo, prompt libre (Laura/Isabel), recordatorios, remarketing |
| 5 | [Producto Ventas Wp] 2 | array | prompt | Producto slot 2: BioKids Moringa — triggers, embudo, prompt libre 'Diana', recordatorios |
| 6 | [Logistico] Plantillas de mensaje | array | template | Esqueleto de plantillas WhatsApp (namespace/name/lang = 'string') para confirmaciones, seguimiento y novedad |
| 7 | [Novedades] Mensajes por tipo de novedad | array | status-mapping | Mapeo tipo de novedad Dropi -> {motivo, dato a solicitar} para mensajes de incidencias de entrega |
| 8 | [Logistico] Novedad | array | status-mapping | Config de novedades: plantillas HSM, tiempos (no solucionado 5h, recordatorio 1h), días de ofrecimiento, subir a Dropi |
| 9 | [Logistico] Seguimiento | array | status-mapping | Seguimiento logístico por estado (guía generada, en reparto, en oficina, entregado): prompts de gancho de venta, plantillas, recordatorios de oficina |
| 10 | [Logistico] Confirmaciones | array | prompt | Confirmaciones logísticas: mensaje de agradecimiento, plantillas y tiempos de recordatorio, prompt de análisis de dirección, validaciones de orden, pago anticipado |
| 11 | [Logistico] Configuracion General | array | prompt | Config general del agente logístico: datos de tienda, personalidad (Laura), saludo, anticancelación, restricciones, capacidades, modelo gpt-4o-mini |
| 12 | [Logistico] Extraer nombre de Shopify o Dropi? | boolean | config | Si true, el nombre de producto se toma de Shopify; si no, de Dropi |
| 13 | [Logístico] Versión de bot | text | other | Versión del bot logístico (1.1.6.3) |
| 14 | [Logistico] Desactivar modificación con anulación | boolean | config | Si true, cambiar ciudad/depto/transportadora no anula y recrea la orden |
| 15 | [Producto Ventas Wp] 1 | array | prompt | Producto slot 1: MegaRed Omega-3 Krill — triggers, embudo, prompt libre 'Carlos', recordatorios, remarketing |
| 16 | [Minimax] Activador | boolean | config | Activa/desactiva Minimax (proveedor de voz/TTS) |
| 17 | [Minimax] Api key | text | credentials | API key de Minimax (vacía) |
| 18 | [Meta] Iniciar Pago | number | other | Contador diario de eventos 'Iniciar Pago' enviados al pixel de Meta |
| 19 | [Meta] Comprar | number | other | Contador diario de eventos 'Comprar' enviados al pixel de Meta |
| 20 | [Meta] Ver Contenido | number | other | Contador diario de eventos 'Ver Contenido' enviados al pixel de Meta |
| 21 | [Meta] Agregar al carrito | number | other | Contador diario de eventos 'Agregar al carrito' enviados al pixel de Meta |
| 22 | [Ventas Wp] Configuracion general 2 | array | prompt | Capa de comportamiento IA de ventas: rol humanizador, manejo de URLs, restricciones, división de mensajes (hasta 5), prompt identificador de producto |
| 23 | [WhatsApp IA] Pedidos de hoy | text | other | Contador de pedidos de hoy |
| 24 | [Ventas Wp] Intento de cancelación ⁉️ | boolean | config | Flag: habilita skill/flujo de intento de cancelación |
| 25 | [Ventas Wp] Pedido programado ⏱️ | boolean | config | Flag: habilita skill de pedido programado |
| 26 | [Ventas Wp] Oficina 📦 | boolean | config | Flag: habilita envío a oficina de transportadora |
| 27 | [Ventas Wp] Disparador de productos | array | config | Disparador de productos (vacío; reemplazado por la versión Extendido) |
| 28 | [Ventas Wp] Configuracion general | array | prompt | Config general de ventas: conexión Dropi, validaciones, prompt de autogeneración de producto ('producto_segundos.prompt_datos') y PROMPT MAESTRO con variables {{...}} |
| 29 | [Whatsapp IA] Tipo de actividad | text | other | Valor reservado interno de tipo de actividad (NO MODIFICAR) |
| 30 | [Ventas Wp] Prompt teléfono de contacto recibido | text | prompt | Instrucción inyectada cuando el cliente comparte su teléfono |
| 31 | [Ventas Wp] Mensaje inicial solicitud teléfono | text | template | Mensaje inicial que pide acceso al número de WhatsApp |
| 32 | [Ventas Wp] Desactivar solicitud inicial teléfono | boolean | config | Si true, no se pide el teléfono al iniciar el chat |
| 33 | [Ventas Wp] Desactivar solicitud final teléfono | boolean | config | Si true, no se pide el teléfono al completar la compra |
| 34 | [Ventas Wp] Mensaje final solicitud teléfono | text | template | Mensaje final que pide acceso al número de WhatsApp para el envío |
| 35 | [Ventas Wp] Desactivar Skill Potencial | boolean | config | Si true, el agente no mueve a 'Cliente potencial' |
| 36 | [Ventas Wp] Desactivar Skill Programar | boolean | config | Si true, el agente no mueve a 'Programado' |
| 37 | [WhatsApp IA] Instrucciones recolección de datos | text | prompt | Instrucciones adicionales de recolección de datos (vacío) |
| 38 | [Ventas Wp] Desactivar asignación a asesor | boolean | config | Si true, nunca asigna a asesor humano a quien entra sin palabra clave |
| 39 | [WhatsApp IA] Desactivar consulta de recordatorios | boolean | config | Si true, no consulta el estado de productos en cada recordatorio |
| 40 | Today_previo | date | other | Fecha previa (control de reseteo diario de contadores) |
| 41 | [Ventas Wp] Solo Con Recaudo | boolean | config | Si true, las órdenes se suben a Dropi siempre Con Recaudo (COD) |
| 42 | [Ventas Wp] Disparador de productos Extendido | longtext | config | Índice de enrutamiento: producto -> slot [Producto Ventas Wp] N, palabras clave, IDs de anuncio, estado |
| 43 | [Ventas Wp] Solo Pendiente confirmación | boolean | config | Si true, las órdenes se suben a Dropi en 'Pendiente confirmación' |
| 44 | [Ventas Wp] Desactivar Skill Datos producto físico | boolean | config | Si true, el agente no puede mover a 'datos completados' con skill de producto físico |
| 45 | [WhatsApp IA] Registros del bot | array | other | Registro de configuración del bot (marca con recaudo, mensaje teléfono, nombre del espacio VitashopEc) |
| 46 | [WhatsApp IA] Versión de bot | text | other | Versión del bot de ventas WhatsApp IA (3.2.B) |
| 47 | [WhatsApp IA] Nota estado de ventas | boolean | config | Muestra/oculta la nota '🎉 Felicidades por la nueva venta' en los chats |
| 48 | [WhatsApp IA] Facturación de hoy | number | other | Facturación acumulada de hoy (USD) |
| 49 | [WhatsApp IA] Ventas de productos #1 | array | other | Ventas de hoy por producto |
| 50 | [Integraciones] Datos de integracion | array | credentials | Credenciales de integración: Dropi (URL + api_key), OpenAI api_key, Shopify (vacío) — [REDACTED] |

**Totales por categoría:** config: 20, credentials: 3, other: 12, prompt: 10, status-mapping: 3, template: 3
