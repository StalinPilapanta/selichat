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
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("Chatea <no-reply@example.com>"),
  LOG_LEVEL: z.string().default("info"),
  /** Carpeta donde se guardan los archivos subidos (volumen persistente en producción). */
  UPLOAD_DIR: z.string().default("./data/uploads"),
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
