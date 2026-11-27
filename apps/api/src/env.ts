import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** URL pública de la web: el navegador llega al API a través de ella (/api/*). */
  WEB_URL: z.url().default("http://localhost:3100"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /**
   * Pedir que la persona confirme su correo antes de entrar (cuentas con contraseña).
   * Por defecto sí; en pruebas no (las pruebas crean cuentas sin bandeja de correo).
   */
  REQUIRE_EMAIL_VERIFICATION: z.enum(["true", "false"]).optional(),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("Chatea <no-reply@example.com>"),
  LOG_LEVEL: z.string().default("info"),
  /** Carpeta donde se guardan los archivos subidos (volumen persistente en producción). */
  UPLOAD_DIR: z.string().default("./data/uploads"),
  /** Espera tras el último mensaje del cliente antes de que responda la IA (agrupa ráfagas). */
  AGENT_DEBOUNCE_MS: z.coerce.number().int().min(0).default(2500),
  /** Cada cuánto se revisan los recordatorios automáticos; 0 = desactivado. */
  FOLLOWUPS_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
  /** Consulta de estados en Dropi para tiendas conectadas por cuenta (MCP); 0 = apagado. */
  DROPI_SYNC_INTERVAL_MS: z.coerce.number().int().min(0).default(600_000),
  /** Buscador de agencias Servientrega (servicio servientrega-ubicaciones). Vacío = desactivado. */
  SERVIENTREGA_URL: z.string().default("https://servientrega.neolabsgroup.io"),
  /** Versión de la Graph API de Meta para WhatsApp Cloud. */
  WHATSAPP_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default("v27.0"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Variables de entorno inválidas:\n${issues.join("\n")}`);
  }
  return parsed.data;
}
