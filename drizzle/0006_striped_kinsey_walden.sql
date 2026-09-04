CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket_key" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "growth_attributions" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "growth_attributions" ADD COLUMN "shop_domain" text;--> statement-breakpoint
ALTER TABLE "growth_attributions" ADD COLUMN "salesperson_profile_id" text;--> statement-breakpoint
ALTER TABLE "growth_attributions" ADD COLUMN "baseline_cart_hash" text;--> statement-breakpoint
ALTER TABLE "growth_attributions" ADD COLUMN "post_play_cart_hash" text;--> statement-breakpoint
ALTER TABLE "growth_attributions" ADD COLUMN "attributable_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_attributions" ADD COLUMN "status" text DEFAULT 'POTENTIAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_attributions" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_idx" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_buckets_key_idx" ON "rate_limit_buckets" USING btree ("bucket_key");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_attributions_transaction_unique_idx" ON "growth_attributions" USING btree ("organization_id","transaction_id");