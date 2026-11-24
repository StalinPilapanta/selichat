import type { FastifyBaseLogger } from "fastify";
import nodemailer from "nodemailer";

export type Mailer = ((msg: { to: string; subject: string; text: string }) => Promise<void>) & {
  /** Estado del correo para /health (sin credenciales). */
  status: () => string;
};

/** Quita cualquier credencial que pudiera venir en un mensaje de error. */
const redact = (s: string) =>
  s.replace(/re_[A-Za-z0-9_]+/g, "re_***").replace(/:\/\/[^@\s]+@/g, "://***@");

/** Envía por SMTP si hay SMTP_URL; si no, imprime el correo en el log (desarrollo). */
export function createMailer(opts: {
  smtpUrl?: string;
  from: string;
  log: FastifyBaseLogger;
}): Mailer {
  if (!opts.smtpUrl) {
    const m = async (msg: { to: string; subject: string; text: string }) => {
      opts.log.info({ email: msg }, "📧 correo (sin SMTP configurado, solo log)");
    };
    return Object.assign(m, { status: () => "sin_smtp" });
  }
  // Tolera errores comunes al pegar en Coolify: comillas, espacios o "SMTP_URL=" delante.
  const url = opts.smtpUrl
    .trim()
    .replace(/^SMTP_URL\s*=\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  if (!/^smtps?:\/\//i.test(url)) {
    // Nunca tumbar el API por un SMTP mal escrito: se avisa en /api/health.
    const bad = "error: SMTP_URL mal formado (debe empezar con smtps://)";
    opts.log.error({ err: bad }, "SMTP no disponible");
    const m = async (msg: { to: string; subject: string; text: string }) => {
      opts.log.error(
        { to: msg.to, subject: msg.subject },
        "correo no enviado: SMTP_URL mal formado",
      );
      throw new Error("smtp_mal_configurado");
    };
    return Object.assign(m, { status: () => bad });
  }
  let state = "verificando";
  let transport: ReturnType<typeof nodemailer.createTransport>;
  try {
    transport = nodemailer.createTransport(url);
  } catch (e) {
    const bad = `error: ${redact((e as Error).message).slice(0, 200)}`;
    const m = async () => {
      throw new Error("smtp_mal_configurado");
    };
    return Object.assign(m, { status: () => bad });
  }
  transport
    .verify()
    .then(() => {
      state = "ok";
    })
    .catch((e: Error) => {
      state = `error: ${redact(e.message).slice(0, 200)}`;
      opts.log.error({ err: state }, "SMTP no disponible");
    });
  const m = async (msg: { to: string; subject: string; text: string }) => {
    try {
      await transport.sendMail({ from: opts.from, ...msg });
      state = "ok";
    } catch (e) {
      state = `error_envio: ${redact((e as Error).message).slice(0, 200)}`;
      opts.log.error({ err: state }, "no se pudo enviar el correo");
      throw e;
    }
  };
  return Object.assign(m, { status: () => state });
}
