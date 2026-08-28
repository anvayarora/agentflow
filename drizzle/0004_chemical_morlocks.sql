CREATE TABLE "import_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_file" text NOT NULL,
	"source_type" text NOT NULL,
	"status" text NOT NULL,
	"mappings" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"errors" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"shop_domain" text NOT NULL,
	"shopify_product_gid" text NOT NULL,
	"shopify_variant_gid" text,
	"sku" text NOT NULL,
	"source" text NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_mappings" ADD CONSTRAINT "product_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_mappings" ADD CONSTRAINT "product_mappings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_mappings_org_product_idx" ON "product_mappings" USING btree ("organization_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_mappings_org_shop_sku_idx" ON "product_mappings" USING btree ("organization_id","shop_domain","sku");