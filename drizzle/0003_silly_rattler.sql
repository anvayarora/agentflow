CREATE TABLE "growth_attributions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"growth_play_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"baseline_cart_amount_paise" integer NOT NULL,
	"actual_paid_amount_paise" integer NOT NULL,
	"incremental_aov_paise" integer NOT NULL,
	"verified" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"source_signal_ids" jsonb NOT NULL,
	"primary_product_id" text NOT NULL,
	"secondary_product_ids" text[] NOT NULL,
	"proposed_action" jsonb NOT NULL,
	"estimated_impact" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"risk_flags" text[] NOT NULL,
	"policy_compatibility" text NOT NULL,
	"score_bps" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_plays" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"primary_product_id" text NOT NULL,
	"secondary_product_ids" text[] NOT NULL,
	"eligibility" jsonb NOT NULL,
	"commercial_strategy" jsonb NOT NULL,
	"max_incentive_bps" integer NOT NULL,
	"minimum_margin_bps" integer NOT NULL,
	"required_policy_checks" jsonb NOT NULL,
	"customer_eligibility" jsonb NOT NULL,
	"frequency_limit" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"approval_required" boolean NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"product_id" text,
	"variant_id" text,
	"related_product_id" text,
	"severity" text NOT NULL,
	"confidence_bps" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text,
	"quantity" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "growth_attributions" ADD CONSTRAINT "growth_attributions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_attributions" ADD CONSTRAINT "growth_attributions_growth_play_id_growth_plays_id_fk" FOREIGN KEY ("growth_play_id") REFERENCES "public"."growth_plays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_opportunities" ADD CONSTRAINT "growth_opportunities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_opportunities" ADD CONSTRAINT "growth_opportunities_primary_product_id_products_id_fk" FOREIGN KEY ("primary_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_plays" ADD CONSTRAINT "growth_plays_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_plays" ADD CONSTRAINT "growth_plays_opportunity_id_growth_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."growth_opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_plays" ADD CONSTRAINT "growth_plays_primary_product_id_products_id_fk" FOREIGN KEY ("primary_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_signals" ADD CONSTRAINT "growth_signals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_signals_org_type_product_idx" ON "growth_signals" USING btree ("organization_id","type","product_id","related_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_snapshots_org_product_observed_idx" ON "inventory_snapshots" USING btree ("organization_id","product_id","observed_at");