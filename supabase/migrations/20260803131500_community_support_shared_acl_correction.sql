BEGIN;

-- Correct installations that applied the initial shared-data migration
-- while Supabase default table privileges remained on authenticated.
REVOKE ALL ON
  public.community_support_settings,
  public.community_support_ledger_entries,
  public.community_support_recurring_costs,
  public.community_support_race_costs,
  public.community_support_products
FROM authenticated;

GRANT SELECT, UPDATE ON public.community_support_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON
  public.community_support_ledger_entries,
  public.community_support_recurring_costs,
  public.community_support_products
TO authenticated;
GRANT SELECT ON public.community_support_race_costs TO authenticated;

COMMIT;
