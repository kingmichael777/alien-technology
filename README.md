# Alien Technology

Record a conversation on your phone. Get the full transcript, with each speaker labeled, and clean notes: a summary, key points, follow-ups, details worth keeping and open questions. Everything is saved and searchable.

Live: https://alien-technology.netlify.app (Netlify project `alien-technology`).

## How it works
1. **Record.** The phone records with the browser's MediaRecorder (AAC on iPhone, Opus elsewhere). Every second of audio is also written to IndexedDB, so a crash or a closed app loses nothing: the next launch puts the recording back together.
2. **Upload.** Each recording uploads straight to a private Supabase Storage bucket (`alien-recordings`) through one-time upload links, in parts of up to 40 MB. Without a connection it waits on the phone and uploads later.
3. **Transcribe.** The `alien-tech` Edge Function sends the audio to ElevenLabs Scribe v2 with speaker separation.
4. **Notes.** The function sends the transcript to OpenAI, which returns structured notes. Speakers appear in notes as `{speaker_0}` tokens, so renaming a speaker updates the notes and transcript everywhere without rewriting anything.
5. **Sync.** The app polls the function for status, then caches transcripts and notes on the phone for offline reading and search.
6. **Never lose audio.** If the server copy disappears or the server is still waiting for audio that a phone holds, that phone uploads it again. A phone only drops a recording missing from the server when it holds no audio for it.

## Pieces
- `src/` the app: React 19, TypeScript, Vite, Tailwind v4, TanStack Router, Dexie, Zustand. Installable PWA that opens and records offline.
  - `lib/recorder.ts` microphone, recording, crash recovery
  - `lib/sync.ts` uploads, status, fetching transcripts and notes
  - `lib/library.ts` rename, retry, rewrite notes, delete, audio
  - `lib/notes.ts` titles, status lines, search, sharing text
  - `lib/earlier.ts` one-time import of voice notes from the first version of the app
- `supabase/functions/alien-tech/` the server function (Deno). Runs on the `quiet-work` Supabase project.
  - `index.ts` actions: ping, begin, uploaded, process, renote, list, get, get_many, update, audio, delete
  - `ai.ts` ElevenLabs and OpenAI calls; `store.ts` database and storage; `lib.ts` pure shaping helpers (tested in `lib_test.ts`)
- Database: table `public.alien_recordings` (row level security on, no policies: only the function's service role reads or writes it) and the private bucket `alien-recordings`.

## Access
The app talks only to the function, with an access code in the `x-alien-key` header. The server keeps only the code's SHA-256 (Vault secret `ALIEN_TECH_KEY_SHA256`). A phone connects by opening `https://alien-technology.netlify.app/#connect=<code>` or by pasting the code on the first screen. ElevenLabs and OpenAI keys stay in Vault (`ELEVENLABS_API_KEY`, `OPENAI_API_KEY`).

## Run and ship
```
npm install
npm run dev        # local development
npm test           # unit tests
npm run build      # typecheck and production build into dist/
```
Server function tests: `deno test supabase/functions/alien-tech/lib_test.ts`.

The app deploys to Netlify (`npm run build`, publish `dist`). The function deploys to Supabase with JWT verification off (it checks the access code itself).
