CREATE TABLE "salesperson_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"speaker_id" text NOT NULL,
	"language_support" text[] NOT NULL,
	"tone_preset" text NOT NULL,
	"pace_preset" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_merchant_default" boolean DEFAULT false NOT NULL,
	"avatar_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD COLUMN "salesperson_profile_id" text;--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD COLUMN "preferred_language" text;--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD COLUMN "detected_language" text;--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD COLUMN "preferred_script" text;--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD COLUMN "voice_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD COLUMN "voice_pace" text;--> statement-breakpoint
ALTER TABLE "salesperson_profiles" ADD CONSTRAINT "salesperson_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "salesperson_profiles_org_display_name_idx" ON "salesperson_profiles" USING btree ("organization_id","display_name");--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD CONSTRAINT "shopping_sessions_salesperson_profile_id_salesperson_profiles_id_fk" FOREIGN KEY ("salesperson_profile_id") REFERENCES "public"."salesperson_profiles"("id") ON DELETE no action ON UPDATE no action;