# Alien Technology

Private Investigator Notes. A phone-first, local-first field intelligence notebook.

Live: https://alien-technology.netlify.app (Netlify project `alien-technology`, team SQUAD).

## What it does
- Case vaults with Active, Sealed and Archived status.
- One-tap capture from anywhere: voice (with optional live transcription), photo (original bytes kept, SHA-256 and chain of custody logged, EXIF and GPS read), text notes and location pings.
- Subject dossiers with visual redaction, linked notes and connected entities.
- Timeline with filters, global search, evidence detail with integrity verification.
- Mobile evidence board (React Flow): cards, red strings, drag, pinch, long-press to link.
- Case map (MapLibre with OpenFreeMap tiles): pins, subject rings, offline fallback.
- Sealed cases are encrypted at rest with a passcode (PBKDF2-SHA256, AES-GCM-256).
- Export and import of a case or the whole vault as a zip with Markdown, media and a SHA-256 manifest.
- Installable on the Home Screen and works with no signal.

## Privacy model
Everything lives in IndexedDB on the device. There is no backend and no account. The only network requests are the app's own files and map tiles from tiles.openfreemap.org (only the viewed area). Live transcription is off by default; when turned on, the phone's speech service may process audio on Apple or Google servers. The Content-Security-Policy in `public/_headers` enforces this.

## Code
- React 19, TypeScript, Vite 8, Tailwind v4, TanStack Router (file routes in `src/routes`), Dexie, Zustand.
- Data access goes through `src/data` (repositories in `repo.ts`, live hooks in `hooks.ts`). Screens never touch Dexie directly. Only Active cases accept writes (`assertWritable`).
- Design tokens and display modes (standard, high contrast, night vision) live in `src/styles.css`.

## Run and ship
```
npm install
npm run dev        # local development
npm test           # unit tests
npm run build      # typecheck and production build into dist/
```
Deploys are manual uploads to the Netlify project `alien-technology`; Netlify runs `npm run build` and publishes `dist`.
