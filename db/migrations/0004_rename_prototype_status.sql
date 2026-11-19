-- 0004: HydroSight is a commercial product, not a prototype. The lifecycle state that
-- means "not yet validated by a human admin with an evidence link" is renamed from
-- 'prototype' to 'unvalidated'. The safety rule is unchanged: everything starts unvalidated,
-- and only an authorised human may promote it. Existing rows and column defaults follow
-- the rename automatically.
alter type public.service_status rename value 'prototype' to 'unvalidated';

-- DOWN: alter type public.service_status rename value 'unvalidated' to 'prototype';
