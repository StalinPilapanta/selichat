-- RLS para respuestas rápidas (mismo patrón que el resto de tablas de la tienda).
DO $$
BEGIN
  ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;
  ALTER TABLE quick_replies FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON quick_replies;
  CREATE POLICY tenant_isolation ON quick_replies
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chatea_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO chatea_app;
  END IF;
END $$;
