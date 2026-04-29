-- Migration: Add coordinates to profiles for server-side moon timing
-- Needed by send-roulette-message Edge Function to calculate moonrise
-- without exposing the recipient's city to the client.
-- Populated during profile onboarding (geocode city → store once).
-- Nullable: Edge Function falls back to immediate delivery if not set.

ALTER TABLE profiles
  ADD COLUMN latitude  numeric,
  ADD COLUMN longitude numeric;
