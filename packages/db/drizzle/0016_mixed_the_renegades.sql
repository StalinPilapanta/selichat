ALTER TABLE "conversations" ALTER COLUMN "lead_stage" SET DEFAULT 'interesado';--> statement-breakpoint
-- Leads: «nuevo» se une a «interesado» y las ventas siguen al estado del pedido en Dropi.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM channel_routes LOOP
    PERFORM set_config('app.tenant_id', t, true);
    UPDATE conversations SET lead_stage = 'interesado' WHERE lead_stage = 'nuevo';
    UPDATE conversations c SET
      lead_stage = CASE o.stage
        WHEN 'en_oficina' THEN 'en_agencia'
        WHEN 'entregado' THEN 'cerrado'
        WHEN 'devolucion' THEN 'perdido'
        ELSE 'ganado'
      END,
      lost_reason = CASE WHEN o.stage = 'devolucion' THEN 'devuelto' ELSE NULL END,
      lead_stage_at = o.updated_at
    FROM (
      SELECT DISTINCT ON (conversation_id) conversation_id, stage, updated_at
      FROM orders
      WHERE conversation_id IS NOT NULL AND stage <> 'cancelado'
      ORDER BY conversation_id, created_at DESC
    ) o
    WHERE o.conversation_id = c.id;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
