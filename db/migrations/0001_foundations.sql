-- 0001_foundations.sql
-- Extensions and the shared enums that carry HydroSight's honesty rules.
-- Reversible: see the DOWN block at the bottom (run manually; never edit this
-- file after it has been applied anywhere shared).

-- Extensions live in their own schema (Supabase convention; keeps the public
-- schema free of PostGIS helper tables such as spatial_ref_sys).
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Rule 2: every value carries exactly one source type.
create type public.source_type as enum ('measured', 'estimated', 'forecast', 'community', 'synthetic');

create type public.quality_flag as enum ('unchecked', 'good', 'suspect', 'bad', 'missing');

-- Rule 4: everything starts as prototype; only a human admin may promote.
create type public.service_status as enum ('prototype', 'validated', 'operational');

create type public.alert_level as enum ('normal', 'advisory', 'watch', 'warning', 'severe_warning');

create type public.alert_status as enum (
  'draft', 'in_review', 'approved', 'published', 'updated', 'cancelled', 'expired'
);

-- DOWN (manual):
--   drop type public.alert_status, public.alert_level, public.service_status,
--             public.quality_flag, public.source_type;
--   drop extension postgis;
