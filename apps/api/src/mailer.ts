import type { FastifyBaseLogger } from "fastify";
import nodemailer from "nodemailer";

export type Mailer = (msg: { to: string; subject: string; text: string }) => Promise<void>;

/** Envía por SMTP si hay SMTP_URL; si no, imprime el correo en el log (desarrollo). */
export function createMailer(opts: {
  smtpUrl?: string;
  from: string;
  log: FastifyBaseLogger;
}): Mailer {
  if (!opts.smtpUrl) {
    return async (msg) => {
      opts.log.info({ email: msg }, "📧 correo (sin SMTP configurado, solo log)");
    };
  }
  const transport = nodemailer.createTransport(opts.smtpUrl);
  return async (msg) => {
    await transport.sendMail({ from: opts.from, ...msg });
  };
}
