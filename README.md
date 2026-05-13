# ExcaliDash sync

Sync selected Obsidian Excalidraw notes to ExcaliDash by using frontmatter opt-in metadata.

## MVP behavior

- Configure one or more ExcaliDash targets in plugin settings. Each target includes a **Test connection** button to verify its URL, auth cookie, and CSRF configuration.
- Drawings are ignored unless their note frontmatter contains `excalidash-destination` matching a configured target name.
- Default direction is Obsidian → ExcaliDash. Set `excalidash-sync: bidirectional` to allow remote changes to flow back when the local drawing has not changed since the last sync. The parser also accepts the legacy typo `bydirectional`.
- Use the **Perform sync** command to sync all eligible drawings.
- Use **Edit current drawing settings** to edit sync frontmatter for the active drawing.
- Supports plain `.excalidraw` JSON and `.excalidraw.md` notes with YAML frontmatter plus fenced or embedded Excalidraw JSON.

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
excalidash-sync: obsidian-to-excalidash # or bidirectional
excalidash-id: generated-after-first-sync
excalidash-version: 4
excalidash-last-hash: sha256-like-browser-hash
excalidash-last-synced: 2026-05-13T12:00:00.000Z
```

## ExcaliDash API assumptions

The plugin uses the internal routes documented in `docs/excalidash-api-notes.md`:

- `GET /csrf-token`
- `GET /drawings/:id`
- `POST /drawings`
- `PUT /drawings/:id`

Write calls send the CSRF token in the configured header, defaulting to `x-csrf-token`. If your ExcaliDash instance requires auth cookies, place the cookie header in the target configuration.

## Conflict behavior

- Existing remote drawings are fetched before update and written back with the latest remote version.
- A remote version change since the last sync is reported as a conflict for one-way sync.
- Bidirectional sync pulls the remote scene into Obsidian only when the local scene hash still matches `excalidash-last-hash`.
- If both local and remote changed, the plugin reports a conflict and leaves both copies untouched.
