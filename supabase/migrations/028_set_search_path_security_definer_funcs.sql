-- Phase 4 hardening: pin search_path on SECURITY DEFINER functions so they can't
-- be hijacked via a caller-controlled search_path. Zero behavior change — these
-- already reference public objects. (Addresses lint 0011 function_search_path_mutable.)
ALTER FUNCTION public.check_mutual_reveal()                       SET search_path = public;
ALTER FUNCTION public.release_queued_roulette_messages()         SET search_path = public;
ALTER FUNCTION public.sweep_roulette_delivery_notifications()    SET search_path = public;
ALTER FUNCTION public.touch_roulette_updated_at()                SET search_path = public;
ALTER FUNCTION public.trigger_roulette_delivery_notification()   SET search_path = public;
ALTER FUNCTION public.user_participates_in_roulette(uuid)        SET search_path = public;
