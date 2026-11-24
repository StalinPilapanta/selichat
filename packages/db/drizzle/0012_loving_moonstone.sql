CREATE TABLE "dropi_routes" (
	"secret" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	CONSTRAINT "dropi_routes_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT current_setting('app.tenant_id', true) NOT NULL,
	"order_id" uuid NOT NULL,
	"source" text NOT NULL,
	"raw_status" text,
	"stage" text,
	"message" text DEFAULT '' NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT current_setting('app.tenant_id', true) NOT NULL,
	"contact_id" uuid,
	"conversation_id" uuid,
	"product_id" uuid,
	"stage" text DEFAULT 'pendiente_subida' NOT NULL,
	"source" text DEFAULT 'ia' NOT NULL,
	"customer" jsonb NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"rate_type" text DEFAULT 'CON RECAUDO' NOT NULL,
	"shipping_cost" numeric(12, 2),
	"dropi_order_id" text,
	"dropi_status" text,
	"carrier" text,
	"tracking_code" text,
	"upload_error" text,
	"upload_attempts" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp with time zone,
	"risk" jsonb,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dropi_routes" ADD CONSTRAINT "dropi_routes_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_stage_idx" ON "orders" USING btree ("tenant_id","stage","created_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_dropi_idx" ON "orders" USING btree ("tenant_id","dropi_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_conversation_open_uq" ON "orders" USING btree ("conversation_id") WHERE "orders"."stage" <> 'cancelado' and "orders"."conversation_id" is not null;