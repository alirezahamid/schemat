-- PostgreSQL pg_dump-style fixture. ALTER statements intentionally precede CREATE TABLE.
ALTER TABLE ONLY "app"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (tenant_id, id);
ALTER TABLE "app"."users" ADD CONSTRAINT "users_email_key" UNIQUE (email);
ALTER TABLE ONLY "app"."posts" ADD CONSTRAINT "posts_pkey" PRIMARY KEY (tenant_id, id);
ALTER TABLE "app"."posts" ADD CONSTRAINT "posts_author_fkey"
  FOREIGN KEY (tenant_id, author_id) REFERENCES "app"."users" (tenant_id, id);

-- Unknown tables/columns and unsupported ALTER forms are safe no-ops.
ALTER TABLE app.missing ADD CONSTRAINT missing_pkey PRIMARY KEY (id);
ALTER TABLE "app"."users" ADD CONSTRAINT "missing_column_key" UNIQUE (missing_column);
ALTER TABLE "app"."users" DROP CONSTRAINT "old_constraint";
ALTER TABLE malformed statement;

CREATE TABLE "app"."users" (
  tenant_id bigint NOT NULL,
  id bigint NOT NULL,
  email text NOT NULL
);
CREATE TABLE "app"."posts" (
  tenant_id bigint NOT NULL,
  id bigint NOT NULL,
  author_id bigint NOT NULL,
  title text
);
CREATE TABLE audit.events (
  id bigint PRIMARY KEY,
  actor_email text UNIQUE
);
