-- 0027_adiciona_bucket_s3.sql
-- Bucket S3 dedicado por sociedade — nulo mantém o destino em SFTP, como hoje.
ALTER TABLE "armazenamento_sociedade" ADD COLUMN IF NOT EXISTS "bucket_s3" text;
