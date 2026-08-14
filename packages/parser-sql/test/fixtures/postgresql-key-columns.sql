--
-- PostgreSQL dump excerpt exercising `key` / `index` as ordinary column names.
--
-- Shapes below mirror real dumps: derrickreimer/level@98b6558 priv/repo/structure.sql
-- carries `key text NOT NULL` (lines 393, 589) and `key character varying(255) NOT NULL`
-- (line 923). `key` and `index` are UNRESERVED keywords in PostgreSQL, so these are
-- legitimate columns and must never be mistaken for MySQL inline index definitions.
--

CREATE TABLE public.digests (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    to_email text NOT NULL,
    key text NOT NULL,
    time_zone text NOT NULL
);

CREATE TABLE public.tutorials (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    key character varying(255) NOT NULL,
    current_step integer DEFAULT 1 NOT NULL,
    is_complete boolean DEFAULT false NOT NULL
);

--
-- `index` as a column name, plus a `key` column carrying an inline REFERENCES.
--

CREATE TABLE public.post_locators (
    id uuid NOT NULL,
    post_id uuid NOT NULL,
    key text NOT NULL REFERENCES public.digests (id),
    index integer DEFAULT 0 NOT NULL,
    scope text NOT NULL
);

ALTER TABLE ONLY public.digests
    ADD CONSTRAINT digests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tutorials
    ADD CONSTRAINT tutorials_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.post_locators
    ADD CONSTRAINT post_locators_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.post_locators
    ADD CONSTRAINT post_locators_key_index_key UNIQUE (key, index);
