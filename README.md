# ExcaliDash sync

Sync selected Obsidian Excalidraw notes to ExcaliDash by using frontmatter opt-in metadata.

## MVP behavior

- Configure one or more ExcaliDash targets in plugin settings.
- Drawings are ignored unless their note frontmatter contains `excalidash-destination` matching a configured target name.
- Default direction is Obsidian → ExcaliDash. Set `excalidash-sync: bidirectional` to allow remote changes to flow back when the local drawing has not changed since the last sync.
- Use the **Perform sync** command to sync all eligible drawings.
- Use **Edit current drawing settings** to edit sync frontmatter for the active drawing.
- Supports plain `.excalidraw` JSON and `.excalidraw.md` notes with YAML frontmatter plus fenced or embedded Excalidraw JSON.

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
