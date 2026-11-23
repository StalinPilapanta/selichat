import { type Database, schema, withTenant } from "@chatea/db";
import { CUSTOM_VARIABLES, GUIDED_SECTIONS } from "@chatea/shared";
import { APICallError, generateText, Output } from "ai";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AiNotConfiguredError, type ModelResolver } from "../ai/models.js";
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
- En las secciones puedes usar variables como {{nombre_asesor}}, {{presentacion_ofertas}} o {{preguntas_frecuentes}}; se reemplazan solas.`;

const body = z.object({
  source: z.string().trim().min(30, "Pega una ficha más completa").max(30000),
  country: z.string().max(40).optional(),
});

export async function aiRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; db: Database; resolveModel: ModelResolver },
) {
  const { auth, db, resolveModel } = opts;
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

    const started = Date.now();
    try {
      const result = await generateText({
        model: resolved.model,
        temperature: resolved.temperature,
        instructions: INSTRUCTIONS,
        prompt: `País de venta: ${parsed.data.country ?? "Ecuador"}\n\nFICHA DEL PRODUCTO:\n${parsed.data.source}`,
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
}
