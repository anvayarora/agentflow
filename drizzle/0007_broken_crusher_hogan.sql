CREATE TABLE "checkout_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"shopping_session_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"provider" text,
	"provider_order_id" text,
	"transaction_id" text,
	"amount_paise" integer NOT NULL,
	"currency" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_transaction_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"product_id" text,
	"shopify_product_gid" text,
	"shopify_variant_gid" text,
	"sku" text,
	"product_title" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_public_price_paise" integer NOT NULL,
	"authorized_unit_price_paise" integer NOT NULL,
	"line_total_paise" integer NOT NULL,
	"currency" text NOT NULL,
	"growth_play_id" text,
	"snapshot_status" text DEFAULT 'IMMUTABLE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"raw_body_hash" text NOT NULL,
	"status" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce_transactions" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "commerce_transactions" ADD COLUMN "provider_order_id" text;--> statement-breakpoint
ALTER TABLE "commerce_transactions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "checkout_reservations" ADD CONSTRAINT "checkout_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_reservations" ADD CONSTRAINT "checkout_reservations_shopping_session_id_shopping_sessions_id_fk" FOREIGN KEY ("shopping_session_id") REFERENCES "public"."shopping_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_transaction_lines" ADD CONSTRAINT "commerce_transaction_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_transaction_lines" ADD CONSTRAINT "commerce_transaction_lines_transaction_id_commerce_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."commerce_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_transaction_lines" ADD CONSTRAINT "commerce_transaction_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_reservations_tenant_idempotency_idx" ON "checkout_reservations" USING btree ("organization_id","shopping_session_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "checkout_reservations_provider_order_idx" ON "checkout_reservations" USING btree ("organization_id","provider_order_id");--> statement-breakpoint
CREATE INDEX "commerce_transaction_lines_org_transaction_idx" ON "commerce_transaction_lines" USING btree ("organization_id","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_idx" ON "payment_webhook_events" USING btree ("organization_id","provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "commerce_transactions_org_provider_order_idx" ON "commerce_transactions" USING btree ("organization_id","provider_order_id");--> statement-breakpoint
CREATE INDEX "commerce_transactions_org_idempotency_idx" ON "commerce_transactions" USING btree ("organization_id","shopping_session_id","idempotency_key");