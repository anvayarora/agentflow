ALTER TABLE "shopping_sessions" ADD COLUMN "shopify_shop_domain" text;
--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD COLUMN "shopify_customer_id" text;
--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD COLUMN "shopify_cart_id" text;
--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD COLUMN "canonical_line_items" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD COLUMN "cart_hash" text;
--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD COLUMN "last_synced_at" timestamp with time zone;
