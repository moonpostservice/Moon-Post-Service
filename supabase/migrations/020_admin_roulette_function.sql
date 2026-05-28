-- Migration: Admin function for roulette backstage dashboard
-- Only callable by the admin user (mymanko@gmail.com).
-- Returns full message rows joined with sender/recipient profile info.

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
  IF (SELECT email FROM profiles WHERE id = auth.uid()) != 'mymanko@gmail.com' THEN
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
