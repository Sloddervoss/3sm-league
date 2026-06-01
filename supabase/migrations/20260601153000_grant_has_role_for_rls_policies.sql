-- Allow RLS policies that reference has_role() to evaluate for anonymous users.
-- The function itself remains safe for anon because it returns false when auth.uid() is null.
-- Without this grant, public SELECT policies on tables with additional role-gated
-- policies can fail with "permission denied for function has_role" before the
-- published/public policy can return rows.

GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO anon;
