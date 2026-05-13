# ExcaliDash ↔ Obsidian Drawing Sync Notes

> Workspace handoff for planning an Obsidian plugin / sync bridge with Albina.
>
> Generated: 2026-05-13

## TL;DR

ExcaliDash appears to have a usable HTTP REST backend for drawings and collections, but it is best treated as an **internal, undocumented API**, not a stable public plugin API. A sync feature is feasible by using the drawing CRUD endpoints, but the design should account for bearer-token auth, CSRF-protected login/key-management, optimistic version conflicts, and possible upstream route changes.

Repository checked: <https://github.com/ZimengXiong/ExcaliDash>

## Relevant ExcaliDash API Surface

### Drawings

```text
GET    /drawings
GET    /drawings?includeData=true
GET    /drawings/:id
POST   /drawings
PUT    /drawings/:id
DELETE /drawings/:id
POST   /drawings/:id/duplicate
```

### Collections

```text
GET    /collections
POST   /collections
PUT    /collections/:id
DELETE /collections/:id
```

### Import / Export

```text
GET  /export/excalidash
POST /import/excalidash/verify
POST /import/excalidash
```

The import/export endpoints are more backup/migration oriented. For syncing specific Obsidian drawings, the targeted drawing CRUD routes are probably the better fit.

## Drawing Payload Shape

ExcaliDash stores drawing records roughly as:

```ts
{
  id: string,
  name: string,
  elements: unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
  preview?: string | null,
  collectionId?: string | null,
  version: number,
  createdAt: string,
  updatedAt: string
}
```

### Create Drawing

```http
POST /drawings
Content-Type: application/json
```

```json
{
  "name": "My Obsidian Drawing",
  "elements": [],
  "appState": {},
  "files": {},
  "preview": null,
  "collectionId": null
}
```

### Update Drawing

```http
PUT /drawings/<id>
Content-Type: application/json
```

```json
{
  "name": "My Obsidian Drawing",
  "elements": [],
  "appState": {},
  "files": {},
  "preview": null,
  "version": 3
}
```

## Version Conflict Behavior

ExcaliDash uses optimistic concurrency for scene updates.

If `elements`, `appState`, or `files` are updated, the backend increments `version`. If the request includes a stale `version`, the API can return:

```http
409 Conflict
```

with a body similar to:

```json
{
  "error": "Conflict",
  "code": "VERSION_CONFLICT",
  "message": "Drawing has changed since this editor state was loaded.",
  "currentVersion": 4
}
```

Design implication:

1. Fetch the drawing before update: `GET /drawings/:id`.
2. Use its current `version` in `PUT /drawings/:id`.
3. If a conflict occurs, decide whether to:
   - stop and report conflict,
   - overwrite from Obsidian intentionally,
   - create a duplicate,
   - or attempt a future merge strategy.

For a first version, prefer explicit conflict reporting over silent overwrite.

## Auth and CSRF Notes

The Obsidian plugin uses personal API keys for normal drawing and collection sync:

```http
Authorization: Bearer <api-key>
```

Bearer-authenticated sync requests do not send cookies and do not request or send CSRF tokens.

Cookie sessions and CSRF are only used to generate or reuse a personal API key from username/password credentials.

CSRF token route:

```text
GET /csrf-token
```

Expected response shape:

```json
{
  "token": "...",
  "header": "x-csrf-token"
}
```

Login route:

```text
POST /auth/login
```

The login route sets temporary auth cookies. It does **not** appear to return the access token in the JSON response. The backend auth middleware can read either:

```http
Authorization: Bearer <access-token>
```

or the access-token cookie, but normal login is cookie-oriented.

API key routes used after temporary login:

```text
GET /auth/api-keys
POST /auth/api-keys
```

For login and API-key creation, the client usually needs:

```http
Cookie: <ExcaliDash auth + CSRF client cookies>
x-csrf-token: <token from /csrf-token>
```

The plugin extracts `Set-Cookie` only into an in-memory temporary session for login/key-management and stores only the resulting personal API key for future sync.

## Recommended Architecture Options

### Option A: Direct Obsidian Plugin Client

The Obsidian plugin talks directly to ExcaliDash.

Responsibilities:

- store ExcaliDash URL and API key material,
- optionally login once with username/password to create a personal API key,
- request CSRF tokens only for login/key-management,
- parse `.excalidraw` / `.excalidraw.md` files,
- upsert drawings,
- handle version conflicts,
- keep path-to-drawing-id mapping.

Pros:

- fewer moving parts,
- entirely inside Obsidian.

Cons:

- login + CSRF handling inside Obsidian may be fiddly,
- credentials live in plugin settings,
- less convenient for logging/debugging,
- harder to reuse from other agents/tools.

### Option B: Local Sync Bridge / Homelab Daemon

Recommended for a cleaner first serious version.

```text
Obsidian plugin
  ↓ local HTTP / IPC
small sync bridge service
  ↓ authenticated HTTP
ExcaliDash backend
```

The bridge owns:

- ExcaliDash login,
- cookie jar,
- CSRF token handling,
- retries,
- conflict handling,
- mapping database,
- logs.

The Obsidian plugin only detects eligible drawing files and says: “sync this path now.”

Pros:

- much easier to debug,
- avoids embedding most auth complexity in Obsidian,
- reusable by Albina/Hermes/CLI jobs,
- can later become a proper sync daemon.

Cons:

- another tiny service to run,
- local IPC/API needs basic access controls.

### Option C: Add Proper API Token Support to ExcaliDash

Best long-term upstream/fork improvement.

Add personal access tokens or service tokens:

```http
Authorization: Bearer excalidash_pat_...
```

Then allow token-authenticated non-browser API requests to bypass CSRF, while retaining CSRF for cookie-browser flows.

Pros:

- cleanest plugin API,
- no cookie jar needed,
- easier for agents and automations,
- upstreamable feature.

Cons:

- requires modifying ExcaliDash itself,
- needs careful token storage, hashing, scopes, revocation, and UI.

## Obsidian Excalidraw File Considerations

Obsidian drawings may be plain `.excalidraw` JSON or `.excalidraw.md` files from the Obsidian Excalidraw plugin.

The sync code needs to extract scene data like:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "...",
  "elements": [],
  "appState": {},
  "files": {}
}
```

Then send these fields to ExcaliDash:

```json
{
  "elements": scene.elements,
  "appState": scene.appState,
  "files": scene.files
}
```

Need to verify exact parsing rules for `.excalidraw.md`, because the scene JSON may be embedded inside Markdown rather than being the entire file.

## Suggested Sync Semantics

### Selection Rules

Allow one or more of:

- folder allowlist, e.g. `Diagrams/`;
- frontmatter flag, e.g. `excalidash-sync: true`;
- Obsidian command: “Sync current drawing to ExcaliDash”;
- optional collection mapping, e.g. `excalidash-collection: Architecture`.

### Local Mapping State

Store mapping in plugin data or bridge SQLite:

```json
{
  "Diagrams/Foo.excalidraw.md": {
    "excalidashId": "uuid-here",
    "lastHash": "sha256-of-normalized-scene",
    "lastVersion": 4,
    "lastSyncedMtime": 1780480000000
  }
}
```

Use a content hash to avoid unnecessary API writes.

### Basic Upsert Flow

```text
for each eligible drawing:
  parse Obsidian file into Excalidraw scene
  normalize scene
  hash scene
  if hash unchanged:
    skip
  if no excalidashId mapping:
    POST /drawings
    save id/version/hash
  else:
    GET /drawings/:id
    PUT /drawings/:id with latest version
    save new version/hash
```

### Conflict Policy for MVP

Start conservative:

- if ExcaliDash version changed since last sync, stop and surface a conflict;
- do not silently overwrite edits made in ExcaliDash;
- optionally offer commands:
  - “Overwrite ExcaliDash from Obsidian”
  - “Duplicate Obsidian version in ExcaliDash”
  - “Open both versions”

## MVP Feature Shape

1. Plugin settings:
   - ExcaliDash base URL,
   - auth mode / bridge URL,
   - folder allowlist,
   - optional target collection,
   - dry-run toggle.
2. Command: “Sync current Excalidraw drawing to ExcaliDash”.
3. Parse current file.
4. Upsert into ExcaliDash.
5. Store mapping.
6. Show success/error notification.
7. Log conflicts clearly.

## Open Questions for Albina

- Should this be a pure Obsidian plugin or an Obsidian plugin + local bridge daemon?
- Is one-way sync from Obsidian to ExcaliDash enough for v1?
- Should ExcaliDash edits ever sync back into Obsidian?
- Where should mapping state live: Obsidian plugin data JSON, bridge SQLite, or both?
- Should selection be frontmatter-based, folder-based, command-based, or all three?
- Do we want to upstream API-token support to ExcaliDash?
- How should `.excalidraw.md` parsing handle embedded assets/files?
- What is the expected behavior when an ExcaliDash drawing is deleted?
- Should the plugin create/manage ExcaliDash collections?

## Risks / Pitfalls

- API is undocumented and could change upstream.
- Cookie + CSRF handling may be awkward from Obsidian plugin code.
- `.excalidraw.md` parsing may have edge cases.
- Bidirectional sync would be much harder than one-way sync.
- Silent overwrite would be dangerous; prefer conflict surfacing.
- Large embedded `files` objects may create heavy payloads.
- Preview SVG generation may require using Excalidraw rendering utilities or leaving `preview: null` initially.

## Initial Recommendation

For planning, assume **one-way Obsidian → ExcaliDash sync** with a small bridge service unless Albina strongly prefers a self-contained plugin.

The most robust path is:

1. MVP with manual command sync and plugin-local mapping.
2. Add bridge daemon if direct auth/CSRF is too annoying.
3. Later add ExcaliDash API tokens for clean automation.
4. Only consider bidirectional sync after one-way sync is stable.
