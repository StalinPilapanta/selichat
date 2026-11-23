-- Row Level Security: cada tabla de tenant solo expone filas cuyo tenant_id
-- coincide con current_setting('app.tenant_id'), fijado por withTenant().
-- FORCE aplica la política también al dueño de la tabla.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_settings','ai_providers','agent_configs','integrations','audit_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint
-- Permisos para el rol de la app (si existe; en local lo crea infra/postgres/init.sql).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chatea_app') THEN
    GRANT USAGE ON SCHEMA public TO chatea_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO chatea_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO chatea_app;
  END IF;
END $$;
