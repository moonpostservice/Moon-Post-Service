-- Migration: Admin audit log + user suspension + roulette message admin-delete

-- 1. Audit log table
CREATE TABLE admin_actions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           uuid NOT NULL REFERENCES auth.users(id),
  admin_email        text NOT NULL,
  action             text NOT NULL,
  target_user_id     uuid REFERENCES auth.users(id),
  target_message_id  uuid REFERENCES moon_roulette_messages(id),
  reason             text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Only admins can read; no one can write directly (Edge Function uses service role)
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_read_audit" ON admin_actions
  FOR SELECT TO authenticated
  USING (
    (SELECT email FROM profiles WHERE id = auth.uid()) IN ('mymanko@gmail.com', 'yoashf@gmail.com')
  );

-- 2. Suspension on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended_reason text;

-- 3. Admin-delete on roulette messages (soft delete)
ALTER TABLE moon_roulette_messages ADD COLUMN IF NOT EXISTS admin_deleted_at timestamptz;
ALTER TABLE moon_roulette_messages ADD COLUMN IF NOT EXISTS admin_deleted_by uuid REFERENCES auth.users(id);

-- 4. Admin function: get all users for backstage
CREATE OR REPLACE FUNCTION get_admin_users_data()
RETURNS TABLE (
  id               uuid,
  username         text,
  email            text,
  city             text,
  created_at       timestamptz,
  last_active      timestamptz,
  suspended_at     timestamptz,
  suspended_reason text,
  receive_roulette boolean,
  roulette_sent    bigint,
  roulette_received bigint,
  conversations    bigint,
  has_push_sub     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT email FROM profiles WHERE id = auth.uid()) NOT IN ('mymanko@gmail.com', 'yoashf@gmail.com') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.username,
    p.email,
    p.city,
    p.created_at,
    p.last_active,
    p.suspended_at,
    p.suspended_reason,
    COALESCE(p.receive_moon_roulette, true) AS receive_roulette,
    (SELECT COUNT(*) FROM moon_roulette_messages m WHERE m.sender_id = p.id)    AS roulette_sent,
    (SELECT COUNT(*) FROM moon_roulette_messages m WHERE m.recipient_id = p.id) AS roulette_received,
    (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.profile_id = p.id) AS conversations,
    (SELECT EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = p.id)) AS has_push_sub
  FROM profiles p
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_admin_users_data() TO authenticated;

-- 5. Update get_admin_roulette_data to include admin_deleted_at
CREATE OR REPLACE FUNCTION get_admin_roulette_data()
RETURNS TABLE (
  id                     uuid,
  status                 roulette_status,
  message_text           text,
  photo_url              text,
  song_title             text,
  sender_id              uuid,
  sender_username        text,
  sender_email           text,
  sender_city_profile    text,
  sender_city            text,
  recipient_id           uuid,
  recipient_username     text,
  recipient_email        text,
  recipient_city_profile text,
  recipient_city         text,
  created_at             timestamptz,
  release_at             timestamptz,
  released_at            timestamptz,
  notified_at            timestamptz,
  recipient_read_at      timestamptz,
  parent_id              uuid,
  send_attempt           int,
  moon_phase             text,
  moon_illumination      numeric,
  sender_deleted_at      timestamptz,
  recipient_deleted_at   timestamptz,
  admin_deleted_at       timestamptz,
  reveal_count           bigint,
  sender_last_active     timestamptz,
  recipient_last_active  timestamptz,
  receive_moon_roulette  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT email FROM profiles WHERE id = auth.uid()) NOT IN ('mymanko@gmail.com', 'yoashf@gmail.com') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.status,
    m.message_text,
    m.photo_url,
    m.song_title,
    m.sender_id,
    sp.username              AS sender_username,
    sp.email                 AS sender_email,
    sp.city                  AS sender_city_profile,
    m.sender_city,
    m.recipient_id,
    rp.username              AS recipient_username,
    rp.email                 AS recipient_email,
    rp.city                  AS recipient_city_profile,
    m.recipient_city,
    m.created_at,
    m.release_at,
    m.released_at,
    m.notified_at,
    m.recipient_read_at,
    m.parent_id,
    m.send_attempt,
    m.moon_phase,
    m.moon_illumination,
    m.sender_deleted_at,
    m.recipient_deleted_at,
    m.admin_deleted_at,
    (SELECT COUNT(*) FROM moon_roulette_reveals r WHERE r.roulette_message_id = m.id) AS reveal_count,
    sp.last_active           AS sender_last_active,
    rp.last_active           AS recipient_last_active,
    rp.receive_moon_roulette
  FROM moon_roulette_messages m
  LEFT JOIN profiles sp ON sp.id = m.sender_id
  LEFT JOIN profiles rp ON rp.id = m.recipient_id
  ORDER BY m.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_admin_roulette_data() TO authenticated;
