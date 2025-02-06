CREATE TYPE "public"."domain_list_type" AS ENUM('disposable', 'allowlist');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"domain" text NOT NULL,
	"action" text NOT NULL,
	"ip" text,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domain_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"type" "domain_list_type" NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "domain_lists_domain_unique" UNIQUE("domain")
);
