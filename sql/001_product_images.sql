-- 001_product_images.sql
-- Product images stored in PostgreSQL (replaces the separate image server).
-- Idempotent and additive: safe to run more than once. No foreign keys on purpose
-- (the live productList lives in MySQL; product ids are looked up there by the API).
CREATE TABLE IF NOT EXISTS product_images (
  product_id     BIGINT       PRIMARY KEY,
  content_type   TEXT         NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size      INTEGER      NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  sha256         CHAR(64)     NOT NULL,
  original_name  TEXT,
  data           BYTEA        NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT product_images_size_matches CHECK (octet_length(data) = byte_size)
);
