-- Migration: Add Moon Roulette opt-in flag to profiles
-- Default TRUE = all existing users are opted in automatically.
-- Set to FALSE to be excluded from the recipient pool entirely.

ALTER TABLE profiles
  ADD COLUMN receive_moon_roulette boolean NOT NULL DEFAULT true;
