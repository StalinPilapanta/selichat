import { type Database, schema, withTenant } from "@chatea/db";
import { CUSTOM_VARIABLES, GUIDED_SECTIONS } from "@chatea/shared";
import { APICallError, generateText, Output } from "ai";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { chatTurn, type SimDeps, SimError, simulateConversation } from "../agent/simulate.js";
import { AiNotConfiguredError, type ModelResolver, VISION_KINDS } from "../ai/models.js";
import type { Auth } from "../auth.js";
import { requireTenant } from "../plugins/tenant.js";

/** Lo que la IA propone a partir de la ficha; el usuario lo revisa antes de guardar. */
const draftSchema = z.object({
  name: z.string().describe("Nombre comercial corto del producto"),
  description: z.string().describe("Descripción clara en 2-4 frases"),
  price: z
    .string()
    .describe("Precio unitario, solo número con punto decimal, ej. 27.99. Vacío si no aparece"),
  offers: z
    .array(z.object({ quantity: z.number().int(), totalPrice: z.string(), label: z.string() }))
    .describe("Ofertas por cantidad que aparezcan en la ficha. Vacío si no hay"),
  faqs: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .describe("5 a 8 preguntas frecuentes con respuestas basadas en la ficha"),
  initialMessage: z
    .string()
    .describe("Mensaje inicial persuasivo y corto para WhatsApp, con el nombre del asesor"),
  entryQuestion: z
    .string()
    .describe("Pregunta de entrada que genere conexión y descubra para qué lo quiere el cliente"),
  sections: z.object(
    Object.fromEntries(GUIDED_SECTIONS.map((s) => [s.key, z.string().describe(s.hint)])) as Record<
      (typeof GUIDED_SECTIONS)[number]["key"],
      z.ZodString
    >,
  ),
  variables: z.object(
    Object.fromEntries(
      Object.entries(CUSTOM_VARIABLES).map(([k, d]) => [k, z.string().describe(d)]),
    ) as Record<keyof typeof CUSTOM_VARIABLES, z.ZodString>,
  ),
});
export type ProductDraft = z.infer<typeof draftSchema>;

const INSTRUCTIONS = `Eres experto en ventas conversacionales por WhatsApp para tiendas de dropshipping con pago contra entrega en Latinoamérica.
A partir de la ficha del producto, completa los datos del producto y el prompt guiado para el asesor de ventas.
Reglas:
- Usa SOLO información de la ficha. Si un dato no aparece (precio, ofertas, ingredientes), déjalo vacío: no lo inventes.
- Vende desde el dolor o deseo del cliente, no desde las características.
- No prometas curas ni resultados médicos garantizados.
- Escribe en español neutro latinoamericano, cercano y natural.
- En las secciones puedes usar variables como {{nombre_asesor}}, {{presentacion_ofertas}} o {{preguntas_frecuentes}}; se reemplazan solas.
- Si hay fotos del producto, úsalas para describirlo: qué es, presentación y contenido, y lo que se lea en el empaque o la etiqueta (ingredientes, beneficios, modo de uso, advertencias). Trata ese texto como parte de la ficha; lo que no se vea ni esté escrito, no lo inventes.`;

/**
 * Fotos que la IA puede mirar: solo https del CDN de Dropi (las sube el proveedor). Así el
 * proveedor de IA no recibe direcciones arbitrarias.
 */
const PHOTO_HOSTS = /(^|\.)cloudfront\.net$|(^|\.)dropi\.[a-z.]+$/i;
const photoUrl = z
  .string()
  .url()
  .refine((u) => {
    try {
      const url = new URL(u);
      return url.protocol === "https:" && PHOTO_HOSTS.test(url.hostname);
    } catch {
      return false;
    }
  }, "Foto no permitida");

const body = z.object({
  source: z.string().trim().min(30, "Pega una ficha más completa").max(30000),
  country: z.string().max(40).optional(),
  /** Fotos del producto (de Dropi) para que la IA lea el empaque. */
  imageUrls: z.array(photoUrl).max(4).optional(),
});

export async function aiRoutes(
  app: FastifyInstance,
  opts: {
    auth: Auth;
    db: Database;
    resolveModel: ModelResolver;
    sim?: Omit<SimDeps, "db" | "resolveModel">;
  },
) {
  const { auth, db, resolveModel } = opts;
  const simDeps: SimDeps = { db, resolveModel, ...opts.sim };
  const editors = requireTenant(auth, db, ["owner", "admin"]);

  app.post("/api/ai/generate-product", { preHandler: editors }, async (req, reply) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "datos_invalidos", issues: parsed.error.issues });

    let resolved: Awaited<ReturnType<ModelResolver>>;
    try {
      resolved = await resolveModel(req.ctx.tenantId, "utilidad");
    } catch (e) {
      if (e instanceof AiNotConfiguredError)
        return reply.code(409).send({ error: "ia_no_configurada", agent: e.agent });
      throw e;
    }

    const prompt = `País de venta: ${parsed.data.country ?? "Ecuador"}\n\nFICHA DEL PRODUCTO:\n${parsed.data.source}`;
    // Solo los modelos que ven imágenes reciben las fotos.
    const photos =
      resolved.kind && VISION_KINDS.includes(resolved.kind) ? (parsed.data.imageUrls ?? []) : [];
    const started = Date.now();
    try {
      const result = await generateText({
        model: resolved.model,
        temperature: resolved.temperature,
        instructions: INSTRUCTIONS,
        ...(photos.length
          ? {
              messages: [
                {
                  role: "user" as const,
                  content: [
                    { type: "text" as const, text: `${prompt}\n\nFOTOS DEL PRODUCTO: adjuntas.` },
                    ...photos.map((u) => ({ type: "image" as const, image: new URL(u) })),
                  ],
                },
              ],
            }
          : { prompt }),
        output: Output.object({ schema: draftSchema }),
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(90_000),
      });
      await withTenant(db, req.ctx.tenantId, (tx) =>
        tx.insert(schema.auditLog).values({
          actorUserId: req.ctx.userId,
          action: "ai.generate_product",
          data: {
            model: resolved.label,
            inputTokens: result.usage.inputTokens ?? null,
            outputTokens: result.usage.outputTokens ?? null,
            ms: Date.now() - started,
            photos: photos.length,
          },
        }),
      );
      return result.output;
    } catch (e) {
      const status = APICallError.isInstance(e) ? e.statusCode : undefined;
      // Solo el tipo de error: el mensaje completo puede incluir la ficha y la respuesta del modelo.
      req.log.warn(
        { errName: (e as Error).name, status, model: resolved.label },
        "fallo generando producto con IA",
      );
      return reply.code(502).send({
        error: status === 401 || status === 403 ? "ia_api_key_invalida" : "ia_fallo",
        model: resolved.label,
      });
    }
  });

  /**
   * Detalle del producto a partir de sus fotos (Dropi no entrega la descripción del proveedor):
   * qué es, presentación y lo que se lee en el empaque. Solo con modelos que ven imágenes.
   */
  const describeBody = z.object({
    name: z.string().trim().min(2).max(200),
    categories: z.array(z.string().max(80)).max(10).default([]),
    imageUrls: z.array(photoUrl).min(1, "El producto no tiene fotos").max(4),
  });
  app.post("/api/ai/describe-product", { preHandler: editors }, async (req, reply) => {
    const parsed = describeBody.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "datos_invalidos",
        detail: parsed.error.issues[0]?.message,
      });
    let resolved: Awaited<ReturnType<ModelResolver>>;
    try {
      resolved = await resolveModel(req.ctx.tenantId, "utilidad");
    } catch (e) {
      if (e instanceof AiNotConfiguredError)
        return reply.code(409).send({ error: "ia_no_configurada", agent: e.agent });
      throw e;
    }
    if (!resolved.kind || !VISION_KINDS.includes(resolved.kind))
      return reply.code(409).send({
        error: "ia_sin_vision",
        message:
          "El modelo de «Tareas rápidas» no puede leer fotos. Usa Claude, OpenAI, Grok o Gemini en Integraciones → Modelos de IA.",
      });
    const { name, categories, imageUrls } = parsed.data;
    try {
      const result = await generateText({
        model: resolved.model,
        temperature: 0.2,
        instructions: `Describes productos para una tienda que vende por WhatsApp en Latinoamérica, a partir de sus fotos.
Escribe en español, en texto plano (sin markdown), con estas partes si se pueden ver:
- Qué es y para qué sirve, en 2-3 frases.
- Presentación y contenido (unidades, ml, gramos, cápsulas).
- Lo que se lee en el empaque o la etiqueta: ingredientes, beneficios, modo de uso, advertencias.
Usa SOLO lo que se ve en las fotos o dice el nombre. No inventes beneficios, cifras ni promesas médicas. Si algo no se lee, no lo menciones.`,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Producto: ${name}${categories.length ? `\nCategorías: ${categories.join(", ")}` : ""}`,
              },
              ...imageUrls.map((u) => ({ type: "image" as const, image: new URL(u) })),
            ],
          },
        ],
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(60_000),
      });
      return { description: result.text.trim().slice(0, 3500) };
    } catch (e) {
      const status = APICallError.isInstance(e) ? e.statusCode : undefined;
      req.log.warn(
        { errName: (e as Error).name, status, model: resolved.label },
        "fallo describiendo producto con IA",
      );
      return reply.code(502).send({
        error: status === 401 || status === 403 ? "ia_api_key_invalida" : "ia_fallo",
        model: resolved.label,
      });
    }
  });

  // ---------- Banco de pruebas del agente (nada se envía por WhatsApp) ----------
  const simMessage = z.object({
    role: z.enum(["cliente", "agente"]),
    text: z.string().max(4000),
    tools: z.array(z.string()).optional(),
  });
  const chatBody = z.object({
    productId: z.uuid(),
    history: z.array(simMessage).max(60).default([]),
    checkout: z.record(z.string(), z.string()).default({}),
  });
  const simBody = z.object({
    productId: z.uuid(),
    persona: z
      .string()
      .trim()
      .min(5)
      .max(1000)
      .default("Mujer de 45 años interesada, pregunta el precio y si es contra entrega, y compra."),
    maxTurns: z.number().int().min(2).max(10).default(6),
    checks: z.array(z.string().max(300)).max(10).default([]),
  });

  const simError = (
    e: unknown,
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    if (e instanceof AiNotConfiguredError)
      return reply.code(409).send({ error: "ia_no_configurada", agent: e.agent });
    if (e instanceof SimError) return reply.code(404).send({ error: e.message });
    const status = APICallError.isInstance(e) ? e.statusCode : undefined;
    return reply.code(502).send({
      error: status === 401 || status === 403 ? "ia_api_key_invalida" : "ia_fallo",
      detail: (e as Error).message.slice(0, 300),
    });
  };

  app.post("/api/agent/chat", { preHandler: editors }, async (req, reply) => {
    const b = chatBody.safeParse(req.body);
    if (!b.success)
      return reply.code(400).send({ error: "datos_invalidos", issues: b.error.issues });
    try {
      return await chatTurn(simDeps, req.ctx.tenantId, b.data);
    } catch (e) {
      return simError(e, reply);
    }
  });

  app.post("/api/agent/simulate", { preHandler: editors }, async (req, reply) => {
    const b = simBody.safeParse(req.body);
    if (!b.success)
      return reply.code(400).send({ error: "datos_invalidos", issues: b.error.issues });
    try {
      return await simulateConversation(simDeps, req.ctx.tenantId, b.data);
    } catch (e) {
      return simError(e, reply);
    }
  });
}
