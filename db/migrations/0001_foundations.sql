-- 0001_foundations.sql
-- Extensions and the shared enums that carry HydroSight's honesty rules.
-- Reversible: see the DOWN block at the bottom (run manually; never edit this
-- file after it has been applied anywhere shared).

create extension if not exists postgis;
create extension if not exists pgcrypto;  -- gen_random_uuid()

-- Rule 2: every value carries exactly one source type.
create type source_type as enum ('measured', 'estimated', 'forecast', 'community', 'synthetic');

create type quality_flag as enum ('unchecked', 'good', 'suspect', 'bad', 'missing');

-- Rule 4: everything starts as prototype; only a human admin may promote.
create type service_status as enum ('prototype', 'validated', 'operational');

create type alert_level as enum ('normal', 'advisory', 'watch', 'warning', 'severe_warning');

create type alert_status as enum (
  'draft', 'in_review', 'approved', 'published', 'updated', 'cancelled', 'expired'
);

-- DOWN (manual):
--   drop type alert_status, alert_level, service_status, quality_flag, source_type;
