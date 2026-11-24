CREATE TABLE "dropi_places" (
	"country" text NOT NULL,
	"kind" text NOT NULL,
	"id" integer NOT NULL,
	"name" text NOT NULL,
	"department_id" integer,
	"code" text DEFAULT '' NOT NULL,
	"zip_code" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dropi_places_country_kind_id_pk" PRIMARY KEY("country","kind","id")
);
