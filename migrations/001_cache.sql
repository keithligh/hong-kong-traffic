create table if not exists cache_object (
  key text primary key,
  body bytea,
  content_type text,
  fetched_at_ms bigint,
  claim_until_ms bigint
);
