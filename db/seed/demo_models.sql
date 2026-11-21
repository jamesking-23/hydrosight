-- Demo organisation only: registers the four baseline models so the Forecasts screen has
-- something to show. They are synthetic-origin and unvalidated; nothing here is a claim about skill.
-- Idempotent. Run with a privileged connection (registration normally goes through
-- public.register_model_version by a signed-in person).
insert into public.model_versions (org_id, name, version, kind, target, description, data_origin)
select o.id, m.name, m.version, 'baseline', 'flood_occurrence', m.descr, 'synthetic'
from public.organizations o
cross join (values
  ('persistence', '1', 'Current level persists, with the spread of past changes over the horizon'),
  ('rate_of_rise', '1-lb3', 'Recent 3-hour rise extended to the end of the horizon'),
  ('rainfall_accumulation', '1-d0.9-w12-b4', 'Antecedent rainfall index in 4 bins; event frequency per bin'),
  ('empirical_exceedance', '1', 'Climatology: how often the event happened in the training period')
) as m(name, version, descr)
where o.is_demo
on conflict (org_id, name, version) do nothing;
