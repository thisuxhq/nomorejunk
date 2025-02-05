CREATE TABLE IF NOT EXISTS "allowlist_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "allowlist_domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"domain" text NOT NULL,
	"action" text NOT NULL,
	"ip" text,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "disposable_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "disposable_domains_domain_unique" UNIQUE("domain")
);
