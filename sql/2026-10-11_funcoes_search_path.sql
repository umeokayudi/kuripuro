-- v1.0.22: fixes the Supabase "function_search_path_mutable" warnings.
-- The functions already use public.* names, so behavior does not change.
-- Undo: alter function ... reset search_path;
alter function public.kp_base_location(text) set search_path = public;
alter function public.jobs_fill_area() set search_path = public;
alter function public.service_contracts_area_on_insert() set search_path = public;
alter function public.service_contracts_propagate_area() set search_path = public;
