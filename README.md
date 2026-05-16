# ExcaliDash sync

Sync the current Obsidian Excalidraw note to ExcaliDash by using frontmatter opt-in metadata.

## MVP behavior

- Configure one or more ExcaliDash targets in plugin settings. Each target includes a **Test connection** button to verify its URL and bearer-token authentication.
- Drawings are ignored unless their note frontmatter contains `excalidash-destination` matching a configured target name.
- Drawings can optionally set `excalidash-collection` to an ExcaliDash collection id, name, or title. Blank or absent means no collection; the plugin never creates collections.
- Default direction is Obsidian → ExcaliDash. Set `excalidash-sync: bidirectional` to allow remote changes to flow back when the local drawing has not changed since the last sync. The parser also accepts the legacy typo `bydirectional`.
- Use the **Sync current drawing** command to sync the active opted-in drawing.
- Use **Edit current drawing settings** to edit sync and collection frontmatter for the active drawing.
- Supports plain `.excalidraw` JSON and `.excalidraw.md` notes with YAML frontmatter plus fenced, embedded, or `compressed-json` Excalidraw data for Obsidian-to-ExcaliDash upload/sync.

## Install with BRAT

This plugin is not in the community plugin directory yet, so install it with [BRAT](https://community.obsidian.md/plugins/obsidian42-brat):

1. In Obsidian, open **Settings → Community plugins** and turn off **Restricted mode** if needed.
2. Install and enable **BRAT** from the community plugin browser.
3. Open **Settings → BRAT**.
4. Choose **Add beta plugin**.
5. Paste this repository URL:

   ```text
   https://github.com/SirEdvin/excalidash-obsidian-sync
   ```

6. Confirm the install, then enable **ExcaliDash sync** in **Settings → Community plugins**.
7. Open **Settings → ExcaliDash sync** and add at least one ExcaliDash target before running sync.

BRAT will track updates from this repository. If a release is available, use the latest release; otherwise use the default branch build.

## Frontmatter

```yaml
excalidash-destination: home
excalidash-collection: My collection # optional id, name, or title
excalidash-sync: obsidian-to-excalidash # or bidirectional
excalidash-id: generated-after-first-sync
excalidash-version: 4
excalidash-last-hash: sha256-like-browser-hash
excalidash-last-synced: 2026-05-13T12:00:00.000Z
```

## ExcaliDash API assumptions

The plugin uses the internal routes documented in `docs/excalidash-api-notes.md`:

- `GET /api/csrf-token`
- `POST /api/auth/login`
- `GET /api/auth/api-keys`
- `POST /api/auth/api-keys`
- `GET /api/drawings/:id`
- `POST /api/drawings`
- `PUT /api/drawings/:id`
- `GET /api/collections`

For `https://exdh.siredvin.site`, configure the target as:

- Base URL: `https://exdh.siredvin.site`
- API path prefix: `/api`
- Auth mode: `API key`
- API key: your ExcaliDash personal API key

Normal drawing and collection sync requests send `Authorization: Bearer <apiKey>` and do not send cookies or CSRF tokens. Existing targets are migrated to API key mode with an empty API key; paste a personal API key before syncing.

If you do not already have a personal API key, set the target auth mode to **Username and password**, enter your login credentials, and click **Generate API key from login**. The plugin logs in with a temporary cookie session, uses CSRF only for login/API-key management, stores the returned key as `generatedApiKey`, and then uses bearer auth for normal sync. The temporary login cookie is not stored and is not used for drawing or collection sync.

## Conflict behavior

- Existing remote drawings are fetched before update and written back with the latest remote version.
- If `excalidash-collection` is set, the plugin fetches `/collections`, resolves id first and then exact name/title, and fails that drawing if no collection matches.
- Collection changes are included in drawing create and update requests, so changing or clearing `excalidash-collection` can move an existing remote drawing.
- A remote version change since the last sync is reported as a conflict for one-way sync.
- Bidirectional sync pulls the remote scene into Obsidian only when the local scene hash still matches `excalidash-last-hash`.
- If both local and remote changed, the plugin reports a conflict and leaves both copies untouched.
- Bidirectional remote pulls into `compressed-json` Excalidraw notes are not supported; convert the note to plain JSON or use Obsidian-to-ExcaliDash sync for those files.
