-- A private link for one recording, so its transcript, notes and audio can be
-- handed to Claude. The owner turns it on from the app. share_nonce is a random
-- value; the link carries a proof made from it with the service key, so
-- clearing the value ends the link for good. The link also stops by itself at
-- share_expires_at. Applied to the quiet-work project.

alter table public.alien_recordings
  add column if not exists share_nonce text,
  add column if not exists share_expires_at timestamptz;
