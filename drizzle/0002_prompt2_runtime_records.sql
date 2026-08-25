CREATE TABLE "runtime_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runtime_records" ADD CONSTRAINT "runtime_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_records_organization_kind_id_idx" ON "runtime_records" USING btree ("organization_id","kind","id");
