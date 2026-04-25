-- Lightweight queue for targeted Discord role/nickname syncs.
-- Full bot sync remains the fallback; this queue keeps user-visible changes fast.

CREATE TABLE IF NOT EXISTS public.discord_sync_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  reason       TEXT NOT NULL DEFAULT 'manual',
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discord_sync_queue_pending
  ON public.discord_sync_queue (processed_at, created_at)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_discord_sync_queue_user_pending
  ON public.discord_sync_queue (user_id)
  WHERE processed_at IS NULL;

ALTER TABLE public.discord_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view discord sync queue"
  ON public.discord_sync_queue FOR SELECT
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE OR REPLACE FUNCTION public.enqueue_discord_sync(target_user_id UUID, sync_reason TEXT DEFAULT 'manual')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Coalesce repeated rapid changes for the same user while a sync is pending.
  UPDATE public.discord_sync_queue
  SET reason = CASE
      WHEN position(sync_reason in reason) > 0 THEN reason
      ELSE left(reason || ',' || sync_reason, 200)
    END,
    last_error = NULL
  WHERE user_id = target_user_id
    AND processed_at IS NULL;

  IF NOT FOUND THEN
    INSERT INTO public.discord_sync_queue (user_id, reason)
    VALUES (target_user_id, COALESCE(NULLIF(sync_reason, ''), 'manual'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_discord_sync_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.discord_id IS DISTINCT FROM OLD.discord_id THEN
    PERFORM public.enqueue_discord_sync(NEW.user_id, 'discord_link_changed');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enqueue_discord_sync ON public.profiles;
CREATE TRIGGER profiles_enqueue_discord_sync
AFTER UPDATE OF discord_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enqueue_discord_sync_from_profile();

CREATE OR REPLACE FUNCTION public.enqueue_discord_sync_from_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.enqueue_discord_sync(OLD.user_id, 'team_membership_deleted');
    RETURN OLD;
  END IF;

  PERFORM public.enqueue_discord_sync(NEW.user_id, 'team_membership_changed');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS team_memberships_enqueue_discord_sync ON public.team_memberships;
CREATE TRIGGER team_memberships_enqueue_discord_sync
AFTER INSERT OR UPDATE OR DELETE ON public.team_memberships
FOR EACH ROW EXECUTE FUNCTION public.enqueue_discord_sync_from_membership();

CREATE OR REPLACE FUNCTION public.enqueue_discord_sync_from_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.enqueue_discord_sync(OLD.user_id, 'user_role_deleted');
    RETURN OLD;
  END IF;

  PERFORM public.enqueue_discord_sync(NEW.user_id, 'user_role_changed');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_enqueue_discord_sync ON public.user_roles;
CREATE TRIGGER user_roles_enqueue_discord_sync
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enqueue_discord_sync_from_user_role();
