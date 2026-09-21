CREATE TYPE "public"."batch_status" AS ENUM('running', 'done', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."slot_source" AS ENUM('fixture', 'rpc');--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_hash" text NOT NULL,
	"slots" jsonb NOT NULL,
	"status" "batch_status" DEFAULT 'running' NOT NULL,
	"done_count" integer DEFAULT 0 NOT NULL,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_done_count_is_nonnegative" CHECK ("batches"."done_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"hash" text PRIMARY KEY NOT NULL,
	"policy_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"body" jsonb NOT NULL,
	"preset_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_hash_is_sha256" CHECK ("policy_versions"."hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_hash" text NOT NULL,
	"slot" bigint NOT NULL,
	"baseline" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_policy_hash_slot_key" UNIQUE("policy_hash","slot")
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"slot" bigint PRIMARY KEY NOT NULL,
	"source" "slot_source" NOT NULL,
	"tx_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slots_slot_is_nonnegative" CHECK ("slots"."slot" >= 0),
	CONSTRAINT "slots_tx_count_is_nonnegative" CHECK ("slots"."tx_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_policy_hash_policy_versions_hash_fk" FOREIGN KEY ("policy_hash") REFERENCES "public"."policy_versions"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_policy_hash_policy_versions_hash_fk" FOREIGN KEY ("policy_hash") REFERENCES "public"."policy_versions"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_slot_slots_slot_fk" FOREIGN KEY ("slot") REFERENCES "public"."slots"("slot") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_versions_policy_id_idx" ON "policy_versions" USING btree ("policy_id");