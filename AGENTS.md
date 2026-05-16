# ExcaliDash sync

Obsidian plugin that syncs opted-in Excalidraw drawings from vault frontmatter into ExcaliDash, with cautious bidirectional pulls when safe.

## Where to find things

- `README.md` — user-facing behavior, BRAT install steps, frontmatter contract, auth setup, and conflict behavior.
- `main.ts` — plugin implementation: settings UI, commands, Excalidraw parsing, ExcaliDash API client, sync/conflict logic.
- `manifest.json` — Obsidian plugin metadata; keep `version` aligned with package files.
- `versions.json` — Obsidian plugin version compatibility map; add every released version.
- `docs/excalidash-api-notes.md` — notes on ExcaliDash internal REST routes, payload shape, auth, CSRF, and design tradeoffs.
- `.github/workflows/release.yml` — tag-triggered GitHub release workflow that uploads BRAT assets.
- `scripts/verify-compressed-json.mjs` and `scripts/verify-collection-resolution.mjs` — focused regression tests.

## Commands

```bash
npm ci
npm run dev
npm run build
npm test
```

Use `npm run build` before release work; it type-checks with `tsc` and creates `main.js` via esbuild. `main.js` is a required BRAT release asset even when ignored by git.

## Non-obvious rules

- Sync is opt-in only: never sync drawings unless frontmatter has `excalidash-destination` matching a configured target.
- Treat ExcaliDash routes as internal/unstable. Keep `docs/excalidash-api-notes.md` updated when route or payload assumptions change.
- Normal drawing/collection sync must use `Authorization: Bearer <apiKey>` through Obsidian `requestUrl`; do not reintroduce cookie-based sync.
- Username/password mode is only for generating/reusing an API key. Temporary cookies and CSRF are for login/key management only and must not be stored.
- Preserve conflict safety. One-way sync reports remote version changes as conflicts; bidirectional pull is allowed only when the local scene hash still matches `excalidash-last-hash`.
- Do not create ExcaliDash collections from the plugin. Resolve `excalidash-collection` by id first, then exact name/title, and fail clearly if not found.
- Keep support for the legacy frontmatter typo `bydirectional` unless deliberately migrating existing users.
- Remote pulls into `compressed-json` Excalidraw notes are not supported; keep that limitation explicit unless the parser/writer is safely extended.

## Testing

Run `npm test` for repository regression coverage and `npm run build` for TypeScript plus bundle verification. For sync changes, test manually in a disposable Obsidian vault with plain `.excalidraw`, `.excalidraw.md`, embedded/fenced/compressed-json data, nested folders, collection changes, remote conflicts, and bidirectional pulls.

## Code style

This is a compact TypeScript Obsidian plugin. Prefer small pure helpers around parsing, hashing, URL building, collection resolution, and auth. Use Obsidian APIs (`requestUrl`, `normalizePath`, `TFile`/`TFolder`, `fileManager.processFrontMatter`) instead of browser or Node shortcuts. Keep UI text sentence case, commands concise, and settings clear for non-developer users.

## Security

- Never commit secrets, API keys, passwords, cookies, test vault data, or generated screenshots.
- Avoid logging credentials or full request headers.
- Persist only long-lived user-required API keys; clear transient username/password material once a generated key exists when changing credential flows.
- Keep auth errors actionable but do not echo sensitive values.
- Treat vault writes as user-data mutations: prefer narrow updates, preserve existing frontmatter, and fail rather than overwrite ambiguous content.

## Release discipline

This repository is BRAT-distributed. For any shipped change, bump the plugin version consistently in `manifest.json`, `package.json`, `package-lock.json`, and `versions.json`; build; test; commit; push; tag with the existing `vX.Y.Z` convention; and verify the GitHub release contains `manifest.json`, `main.js`, and `styles.css` when present. Do not mutate or reuse an existing release for changed code/assets.
