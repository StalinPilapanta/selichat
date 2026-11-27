ALTER TABLE "user" ADD COLUMN "phone" text;--> statement-breakpoint
-- Desde ahora se confirma el correo al registrarse: las cuentas que ya existían quedan
-- confirmadas para no dejar a nadie fuera.
UPDATE "user" SET "email_verified" = true WHERE "email_verified" = false;
