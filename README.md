# Alien Technology

Record a conversation on your phone. Get the full transcript, with each speaker labeled, and clean notes: a summary, key points, follow-ups, details worth keeping and open questions. Everything is saved and searchable. Each person has their own account and sees only their own recordings.

Live: https://alientek.org (Netlify project `alien-technology`).

## How it works
1. **Record.** The phone records with the browser's MediaRecorder (AAC on iPhone, Opus elsewhere). Every second of audio is also written to IndexedDB, so a crash or a closed app loses nothing: the next launch puts the recording back together.
2. **Upload.** Each recording uploads straight to a private Supabase Storage bucket (`alien-recordings`) through one-time upload links, in parts of up to 40 MB. Without a connection it waits on the phone and uploads later.
3. **Transcribe.** The `alien-tech` Edge Function sends the audio to ElevenLabs Scribe v2 with speaker separation.
4. **Notes.** The function sends the transcript to OpenAI, which returns structured notes. Speakers appear in notes as `{speaker_0}` tokens, so renaming a speaker updates the notes and transcript everywhere without rewriting anything.
5. **Sync.** The app polls the function for status, then caches transcripts and notes on the phone for offline reading and search.
6. **Never lose audio.** If the server copy disappears or the server is still waiting for audio that a phone holds, that phone uploads it again. A phone only drops a recording missing from the server when it holds no audio for it.

## Naming a recording while it records
The recording screen has a **Name this recording** button under the timer. The name can be set or changed at any point without pausing the audio. It is written to the phone right away with the rest of the recording's state, so a crash keeps it. When the recording is saved the name rides along as `localTitle` and shows everywhere at once; the phone hands it to the server as the recording's title as soon as the upload begins, then the server's copy takes over. Renaming a saved recording that hasn't uploaded yet works the same way, so it also works offline.

## Recording a Google Meet or Zoom call
On a computer, in Chrome or Edge, **Record a Meet or Zoom call** asks the browser to share the meeting's tab with its sound (`getDisplayMedia`), mixes that with the microphone in one audio track, and records the mix like any other recording. The tab's picture is requested because browsers won't share sound without it; it is never recorded. The recording ends when the tab stops being shared. Phones can't do this (no browser there can share another app's sound), and neither can Safari. The app does not announce the recording to the other people on the call.

## Sending a recording to Claude
**Send to Claude** on a recording copies a short message with two links, ready to paste into Claude or Claude Code:

- `https://alientek.org/c/<key>` returns the recording as plain text: title, date, speakers, notes and the whole transcript with times. Netlify passes `/c/*` to the `alien-share` function.
- `.../functions/v1/alien-share/c/<key>/audio` downloads the audio file.

Nobody signs in to open them, so anyone holding the link can read that one recording. The key is the recording's id plus a proof made with the service key from a random value on the row (`share_nonce`), so it can't be guessed and one recording's link never opens another. A link works for 7 days (`share_expires_at`); copying it again gives the same link a fresh week. **Turn the link off** clears the value, which ends the link for good. A link also stops when its owner's account is paused or removed. **Copy the full text** puts the notes and transcript on the clipboard with no link at all.

## Pieces
- `src/` the app: React 19, TypeScript, Vite, Tailwind v4, TanStack Router, Dexie, Zustand. Installable PWA that opens and records offline.
  - `lib/recorder.ts` microphone, meeting tab plus microphone, recording, crash recovery
  - `lib/account.ts` signing in and out, and what a phone keeps when the account changes
  - `lib/sync.ts` uploads, status, fetching transcripts and notes
  - `lib/library.ts` rename, retry, rewrite notes, delete, audio
  - `lib/notes.ts` titles, status lines, search, sharing text
  - `lib/earlier.ts` one-time import of voice notes from the first version of the app
- `supabase/functions/alien-tech/` the server function (Deno). Runs on the `quiet-work` Supabase project.
  - `index.ts` actions: auth_config, auth_google, auth_start, auth_verify, sign_out, ping, begin, uploaded, process, renote, list, get, get_many, update, audio, delete, accounts_list, account_add, account_update, account_remove
  - `accounts.ts` sign-in codes, sessions and the master's account tools; `google.ts` checks Google ID tokens
  - `ai.ts` ElevenLabs and OpenAI calls; `store.ts` database and storage; `lib.ts` pure shaping helpers (tested in `lib_test.ts`)
- `supabase/functions/alien-share/` the link for Claude (Deno), on the same project and tables. Its own function so the recorder's function is never touched by it.
  - `index.ts` actions: share_on, share_off, share_status (each needs the phone's session), and GET `/c/<key>` and `/c/<key>/audio` (no session)
  - `lib.ts` the link key and the plain-text page (tested in `lib_test.ts`)
- Database: table `public.alien_recordings` (row level security on, no policies: only the function's service role reads or writes it) and the private bucket `alien-recordings`.

## Accounts
The app talks only to the function. Sign-up is by invitation: only an email the master account has added can sign in.

- **Signing in with Google.** The page goes to Google and comes back with an ID token, which the function checks against Google's published keys (signature, issuer, the app's client ID, expiry, the nonce this phone made, a verified email). Nothing new is created: the Google email must already be on the list. It is on once the Vault secret `ALIEN_TECH_GOOGLE_CLIENT_ID` holds the client ID of a Google web OAuth client with JavaScript origin `https://alientek.org` and redirect address `https://alientek.org/`. No client secret is used.
- **Signing in by email.** A person types their email and gets a 6-digit code by email (Resend). The code works once, for 10 minutes, with 5 tries; an email gets at most 5 codes an hour. The server answers the same way whether or not the email has an account. The phone then keeps a session token and sends it in the `x-alien-session` header. A phone unused for 180 days signs in again.
- **What is stored.** Tables `alien_accounts`, `alien_login_codes` and `alien_sessions` (row level security on, no policies). A code is kept only as an HMAC and a session token only as its SHA-256.
- **Privacy between accounts.** Every recording has an `owner_id`. Every action checks it, and someone else's recording answers exactly like one that doesn't exist. This holds for the master too.
- **The master account** adds, pauses, turns back on and removes accounts from Settings, and sees how much each has recorded. Removing an account deletes its recordings. There is one master. It is made once by hand in the database (see the migration), so its address stays out of this repository.
- **On the phone.** Signing out, or signing in as someone else, removes that phone's copies of what the server holds. A recording that hasn't uploaded yet is never removed.
- **The old access code.** A phone still on the earlier app sends the shared code in `x-alien-key` and is treated as the master, for as long as the Vault secret `ALIEN_TECH_KEY_SHA256` exists. Delete the secret to retire it.

ElevenLabs, OpenAI and Resend keys stay in Vault (`ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`). Sign-in emails are plain text. Their sender is the Vault secret `ALIEN_TECH_EMAIL_FROM` when it is set, on a domain verified in Resend; without it they come from `alien@mikerashid.com`.

## Run and ship
```
npm install
npm run dev        # local development
npm test           # unit tests
npm run build      # typecheck and production build into dist/
```
Server function tests: `deno test supabase/functions/alien-tech/lib_test.ts supabase/functions/alien-share/lib_test.ts`.

The app deploys to Netlify (`npm run build`, publish `dist`). The Netlify project is not linked to this repository: a push to `main` publishes nothing. Each release is uploaded from a checkout of `main` and built by Netlify. Both functions deploy to Supabase with JWT verification off (they check the session themselves).
