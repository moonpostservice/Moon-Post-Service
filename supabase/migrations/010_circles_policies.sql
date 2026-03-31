-- Migration: Moon Circles tables RLS policies
-- Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
-- Covers: moon_circles, circle_members, circle_nights, circle_contributions

-- Helper function: check if the current user is a member of a given circle.
-- SECURITY DEFINER ensures the function can read circle_members regardless of the caller's RLS context.
CREATE OR REPLACE FUNCTION public.user_is_circle_member(cid uuid)
RETURNS boolean AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM circle_members
    WHERE circle_id = cid
      AND user_id = auth.uid()
  );
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- moon_circles
-- ============================================================

-- Users can read circles they are a member of.
CREATE POLICY "Members can read their circles"
  ON moon_circles FOR SELECT
  TO authenticated
  USING (public.user_is_circle_member(id));

-- Users can create circles as themselves.
CREATE POLICY "Users can create circles"
  ON moon_circles FOR INSERT
  TO authenticated
  WITH CHECK (creator_id = auth.uid());

-- ============================================================
-- circle_members
-- ============================================================

-- Users can read members of circles they belong to.
CREATE POLICY "Members can read circle members"
  ON circle_members FOR SELECT
  TO authenticated
  USING (public.user_is_circle_member(circle_id));

-- ============================================================
-- circle_nights
-- ============================================================

-- Users can read nights for circles they belong to.
CREATE POLICY "Members can read circle nights"
  ON circle_nights FOR SELECT
  TO authenticated
  USING (public.user_is_circle_member(circle_id));

-- ============================================================
-- circle_contributions
-- ============================================================

-- Users can read contributions for circles they belong to.
CREATE POLICY "Members can read circle contributions"
  ON circle_contributions FOR SELECT
  TO authenticated
  USING (public.user_is_circle_member(circle_id));

-- Users can insert contributions only as themselves AND only if they are a member.
CREATE POLICY "Members can insert own contributions"
  ON circle_contributions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.user_is_circle_member(circle_id)
  );
