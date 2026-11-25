ALTER TABLE "conversations" ADD COLUMN "lead_stage" text DEFAULT 'nuevo' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "lead_stage_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "lost_reason" text;--> statement-breakpoint
CREATE INDEX "conversations_tenant_lead_idx" ON "conversations" USING btree ("tenant_id","lead_stage","lead_stage_at");--> statement-breakpoint
-- Leads: ubica las conversaciones existentes en su etapa (por tienda, porque la tabla tiene RLS forzado).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT id FROM organization LOOP
    PERFORM set_config('app.tenant_id', t, true);
    UPDATE conversations c SET
      lead_stage = CASE
        WHEN EXISTS (SELECT 1 FROM orders o WHERE o.conversation_id = c.id AND o.stage <> 'cancelado') THEN 'ganado'
        WHEN c.checkout_state->>'etapa' = 'confirmado' THEN 'ganado'
        WHEN c.checkout_state->>'etapa' = 'cancelado' THEN 'perdido'
        WHEN c.checkout_state->>'etapa' = 'datos' THEN 'datos'
        WHEN c.product_id IS NOT NULL THEN 'interesado'
        ELSE 'nuevo'
      END,
      lost_reason = CASE WHEN c.checkout_state->>'etapa' = 'cancelado' THEN 'cancelo' ELSE NULL END,
      lead_stage_at = coalesce(c.last_message_at, c.created_at);
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
