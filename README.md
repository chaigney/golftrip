# Golf Trip App (Realtime)

A lightweight React app for golf trip scoring with **realtime sync** via Firebase Firestore.

## Features
- Multiple matches; per-match game modes (Best Ball, High–Low, Captain & Mate, Aggregate, Stableford, Skins with carry)
- Per-hole par shading; score colors based on relation to par
- Team rows show value + per-hole points; totals only add when a hole is complete
- **Realtime room**: create a trip, share the URL (`?trip=<id>`) with friends; everyone can edit
- **Overall records**: computed from completed matches

## Quick Start

1. **Create Firebase project** → Firestore (Native mode) and enable **Anonymous Auth**.
2. Create a **web app** in Firebase; copy the config into `.env` (see `.env.example`).
3. **Install & run**:
```bash
npm i
npm run dev
```
4. Open the app → click **Create Trip** → share the URL that includes `?trip=<id>`.

### Firestore Rules (simple shared room)
For a private trip among friends, you can temporarily allow open access during the weekend, then tighten later:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /trips/{tripId} {
      allow read, write: if true; // anyone with the link can edit
    }
  }
}
```

For stricter access, add a 6-digit **PIN** field on the trip and require it in UI or rules.

## Deploy (Vercel)
1. Push this folder to GitHub.
2. In Vercel: **New Project** → import repo → add the env vars from `.env`.
3. Deploy. Share your live URL with `?trip=<id>`.
