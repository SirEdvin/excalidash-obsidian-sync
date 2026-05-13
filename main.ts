import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  RequestUrlParam,
  RequestUrlResponse,
  Setting,
  TFile,
  requestUrl,
} from "obsidian";

const DEFAULT_API_PATH_PREFIX = "/api";
const DEFAULT_CSRF_ENDPOINT = "/csrf-token";
const DEFAULT_CSRF_HEADER = "x-csrf-token";
const DEFAULT_SYNC_DIRECTION: SyncDirection = "obsidian-to-excalidash";

type SyncDirection = "obsidian-to-excalidash" | "bidirectional";

interface ExcaliDashTarget {
  name: string;
  baseUrl: string;
  apiPathPrefix: string;
  csrfTokenEndpoint: string;
  csrfHeaderName: string;
  csrfTokenPlacement: "header";
  staticCsrfToken: string;
  cookieHeader: string;
}

interface ExcaliDashSyncSettings {
  targets: ExcaliDashTarget[];
}

interface DrawingFrontmatter {
  destination?: string;
  direction: SyncDirection;
  id?: string;
  version?: number;
  lastHash?: string;
  lastSynced?: string;
}

interface ExcalidrawScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

interface ExcaliDashDrawing extends ExcalidrawScene {
  id: string;
  name: string;
  version: number;
  preview?: string | null;
  collectionId?: string | null;
}

interface SyncResult {
  path: string;
  status: "synced" | "skipped" | "conflict" | "error";
  message: string;
}

interface ConnectionTestResult {
  drawingCount?: number;
}

const DEFAULT_SETTINGS: ExcaliDashSyncSettings = {
  targets: [],
};

export default class ExcaliDashSyncPlugin extends Plugin {
  settings: ExcaliDashSyncSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "perform-sync",
      name: "Perform sync",
      callback: () => {
        void this.performSync();
      },
    });

    this.addCommand({
      id: "edit-current-drawing-settings",
      name: "Edit current drawing settings",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canEdit = file !== null && isExcalidrawFile(file);
        if (checking) {
          return canEdit;
        }

        if (file !== null && canEdit) {
          new DrawingSettingsModal(this.app, this, file).open();
        }
        return true;
      },
    });

    this.addSettingTab(new ExcaliDashSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<ExcaliDashSyncSettings> | null;
    this.settings = normalizeSettings(loaded);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async performSync(): Promise<void> {
    const files = this.app.vault.getFiles().filter(isExcalidrawFile);
    const results: SyncResult[] = [];

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = parseDrawingFrontmatter(cache?.frontmatter);
      if (frontmatter.destination === undefined) {
        continue;
      }

      const target = this.settings.targets.find((item) => item.name === frontmatter.destination);
      if (target === undefined) {
        results.push({
          path: file.path,
          status: "error",
          message: `Missing ExcaliDash target '${frontmatter.destination}'.`,
        });
        continue;
      }

      results.push(await this.syncFile(file, target, frontmatter));
    }

    this.showSyncSummary(results);
  }

  async syncFile(file: TFile, target: ExcaliDashTarget, frontmatter: DrawingFrontmatter): Promise<SyncResult> {
    try {
      const raw = await this.app.vault.read(file);
      const parsed = parseExcalidrawScene(raw, file.extension === "md");
      if (parsed === null) {
        return { path: file.path, status: "error", message: "Unable to parse Excalidraw scene." };
      }

      const localHash = await sceneHash(parsed.scene);
      const localChanged = localHash !== frontmatter.lastHash;

      if (frontmatter.id === undefined) {
        const created = await createRemoteDrawing(target, file.basename, parsed.scene);
        await this.updateSyncFrontmatter(file, created.id, created.version, localHash);
        return { path: file.path, status: "synced", message: `Created remote drawing ${created.id}.` };
      }

      const remote = await getRemoteDrawing(target, frontmatter.id);
      const remoteHash = await sceneHash(remote);
      const remoteChanged = frontmatter.version !== undefined && remote.version !== frontmatter.version;

      if (frontmatter.direction === "bidirectional" && remoteChanged && !localChanged) {
        await this.writeRemoteSceneToLocal(file, raw, parsed, remote);
        await this.updateSyncFrontmatter(file, remote.id, remote.version, remoteHash);
        return { path: file.path, status: "synced", message: "Pulled remote changes into Obsidian." };
      }

      if (remoteChanged) {
        return {
          path: file.path,
          status: "conflict",
          message: `Remote version is ${remote.version}; last synced version was ${frontmatter.version ?? "unknown"}.`,
        };
      }

      if (!localChanged) {
        return { path: file.path, status: "skipped", message: "No local changes." };
      }

      const updated = await updateRemoteDrawing(target, frontmatter.id, file.basename, parsed.scene, remote.version);
      await this.updateSyncFrontmatter(file, updated.id, updated.version, localHash);
      return { path: file.path, status: "synced", message: `Updated remote drawing to version ${updated.version}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { path: file.path, status: message.includes("409") ? "conflict" : "error", message };
    }
  }

  async updateSyncFrontmatter(file: TFile, id: string, version: number, hash: string): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter["excalidash-id"] = id;
      frontmatter["excalidash-version"] = version;
      frontmatter["excalidash-last-hash"] = hash;
      frontmatter["excalidash-last-synced"] = new Date().toISOString();
    });
  }

  async writeRemoteSceneToLocal(
    file: TFile,
    raw: string,
    parsed: ParsedScene,
    remote: ExcalidrawScene,
  ): Promise<void> {
    const replacement = JSON.stringify({ ...parsed.sceneDocument, ...remote }, null, 2);
    const nextContent = parsed.jsonStart === 0 && parsed.jsonEnd === raw.length
      ? replacement
      : `${raw.slice(0, parsed.jsonStart)}${replacement}${raw.slice(parsed.jsonEnd)}`;

    await this.app.vault.process(file, () => nextContent);
  }

  showSyncSummary(results: SyncResult[]): void {
    if (results.length === 0) {
      new Notice("ExcaliDash sync: no opted-in drawings found.");
      return;
    }

    const synced = results.filter((item) => item.status === "synced").length;
    const skipped = results.filter((item) => item.status === "skipped").length;
    const conflicts = results.filter((item) => item.status === "conflict");
    const errors = results.filter((item) => item.status === "error");

    const details = [...conflicts, ...errors].map((item) => `${item.path}: ${item.message}`).join("\n");
    const summary = `ExcaliDash sync: ${synced} synced, ${skipped} skipped, ${conflicts.length} conflicts, ${errors.length} errors.`;
    new Notice(details.length > 0 ? `${summary}\n${details}` : summary, details.length > 0 ? 12000 : 5000);
  }
}

class ExcaliDashSettingTab extends PluginSettingTab {
  plugin: ExcaliDashSyncPlugin;

  constructor(app: App, plugin: ExcaliDashSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("ExcaliDash sync targets").setHeading();

    this.plugin.settings.targets.forEach((target, index) => {
      const heading = target.name.trim().length > 0 ? target.name : `Target ${index + 1}`;
      new Setting(containerEl).setName(heading).setHeading();

      new Setting(containerEl)
        .setName("Name")
        .setDesc("Frontmatter destination value for this ExcaliDash instance.")
        .addText((text) => text
          .setPlaceholder("home")
          .setValue(target.name)
          .onChange(async (value) => {
            target.name = value.trim();
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName("Base URL")
        .setDesc("ExcaliDash server URL, for example https://excalidash.example.com.")
        .addText((text) => text
          .setPlaceholder("https://excalidash.example.com")
          .setValue(target.baseUrl)
          .onChange(async (value) => {
            target.baseUrl = value.trim();
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName("API path prefix")
        .setDesc("Path prefix for ExcaliDash API routes. Use /api for https://exdh.siredvin.site.")
        .addText((text) => text
          .setPlaceholder(DEFAULT_API_PATH_PREFIX)
          .setValue(target.apiPathPrefix)
          .onChange(async (value) => {
            target.apiPathPrefix = normalizePathPrefix(value.trim());
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName("CSRF token endpoint")
        .setDesc("Used when no static CSRF token is configured.")
        .addText((text) => text
          .setPlaceholder(DEFAULT_CSRF_ENDPOINT)
          .setValue(target.csrfTokenEndpoint)
          .onChange(async (value) => {
            target.csrfTokenEndpoint = value.trim() || DEFAULT_CSRF_ENDPOINT;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName("CSRF header name")
        .setDesc("Header used for write requests.")
        .addText((text) => text
          .setPlaceholder(DEFAULT_CSRF_HEADER)
          .setValue(target.csrfHeaderName)
          .onChange(async (value) => {
            target.csrfHeaderName = value.trim() || DEFAULT_CSRF_HEADER;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName("Static CSRF token")
        .setDesc("Optional. If blank, the plugin requests a token from the endpoint.")
        .addText((text) => text
          .setPlaceholder("optional token")
          .setValue(target.staticCsrfToken)
          .onChange(async (value) => {
            target.staticCsrfToken = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName("Cookie header")
        .setDesc("Optional Cookie header for authenticated ExcaliDash instances.")
        .addTextArea((text) => text
          .setPlaceholder("access-token=...; csrf-token=...")
          .setValue(target.cookieHeader)
          .onChange(async (value) => {
            target.cookieHeader = value.trim();
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .addButton((button) => button
          .setButtonText("Test connection")
          .onClick(async () => {
            await this.plugin.saveSettings();
            if (target.baseUrl.trim().length === 0) {
              new Notice(`ExcaliDash connection test failed for ${formatTargetName(target, index)}: base URL is required.`);
              return;
            }

            try {
              const result = await testExcaliDashConnection(target);
              const suffix = result.drawingCount === undefined ? "" : ` Found ${result.drawingCount} drawings.`;
              new Notice(`ExcaliDash connection test succeeded for ${formatTargetName(target, index)}.${suffix}`);
            } catch (error) {
              new Notice(`ExcaliDash connection test failed for ${formatTargetName(target, index)}: ${sanitizeErrorMessage(error)}`, 10000);
            }
          }))
        .addButton((button) => button
          .setButtonText("Remove target")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.targets.splice(index, 1);
            await this.plugin.saveSettings();
            this.display();
          }));
    });

    new Setting(containerEl)
      .addButton((button) => button
        .setButtonText("Add target")
        .setCta()
        .onClick(async () => {
          this.plugin.settings.targets.push(createDefaultTarget());
          await this.plugin.saveSettings();
          this.display();
        }));
  }
}

class DrawingSettingsModal extends Modal {
  plugin: ExcaliDashSyncPlugin;
  file: TFile;
  destination = "";
  direction: SyncDirection = DEFAULT_SYNC_DIRECTION;

  constructor(app: App, plugin: ExcaliDashSyncPlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    const frontmatter = parseDrawingFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter);
    this.destination = frontmatter.destination ?? "";
    this.direction = frontmatter.direction;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl).setName("ExcaliDash drawing settings").setHeading();

    new Setting(contentEl)
      .setName("Destination")
      .setDesc("Target name. Leave blank to opt this drawing out of sync.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Do not sync");
        for (const target of this.plugin.settings.targets) {
          dropdown.addOption(target.name, target.name);
        }
        dropdown.setValue(this.destination);
        dropdown.onChange((value) => {
          this.destination = value;
        });
      });

    new Setting(contentEl)
      .setName("Sync direction")
      .setDesc("Bidirectional only pulls remote changes when the local drawing has not changed.")
      .addDropdown((dropdown) => dropdown
        .addOption("obsidian-to-excalidash", "Obsidian to ExcaliDash")
        .addOption("bidirectional", "Bidirectional")
        .setValue(this.direction)
        .onChange((value) => {
          this.direction = value === "bidirectional" ? "bidirectional" : "obsidian-to-excalidash";
        }));

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Save")
        .setCta()
        .onClick(async () => {
          await this.save();
          this.close();
        }))
      .addButton((button) => button
        .setButtonText("Cancel")
        .onClick(() => this.close()));
  }

  async save(): Promise<void> {
    await this.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
      if (this.destination.length === 0) {
        delete frontmatter["excalidash-destination"];
        delete frontmatter["excalidash-sync"];
        return;
      }

      frontmatter["excalidash-destination"] = this.destination;
      frontmatter["excalidash-sync"] = this.direction;
    });
  }
}

interface ParsedScene {
  scene: ExcalidrawScene;
  sceneDocument: Record<string, unknown>;
  jsonStart: number;
  jsonEnd: number;
}

function parseExcalidrawScene(raw: string, markdown: boolean): ParsedScene | null {
  const withoutFrontmatter = markdown ? stripYamlFrontmatter(raw) : { content: raw, offset: 0 };
  const candidates = markdown ? findJsonCandidates(withoutFrontmatter.content, withoutFrontmatter.offset) : [{ text: raw, start: 0, end: raw.length }];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.text) as unknown;
      if (isSceneDocument(parsed)) {
        return {
          scene: toScene(parsed),
          sceneDocument: parsed,
          jsonStart: candidate.start,
          jsonEnd: candidate.end,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function stripYamlFrontmatter(raw: string): { content: string; offset: number } {
  if (!raw.startsWith("---\n")) {
    return { content: raw, offset: 0 };
  }

  const end = raw.indexOf("\n---", 4);
  if (end === -1) {
    return { content: raw, offset: 0 };
  }

  const after = raw.indexOf("\n", end + 4);
  const offset = after === -1 ? raw.length : after + 1;
  return { content: raw.slice(offset), offset };
}

function findJsonCandidates(content: string, offset: number): { text: string; start: number; end: number }[] {
  const candidates: { text: string; start: number; end: number }[] = [];
  const fenceRegex = /```(?:json|excalidraw)?\s*\n([\s\S]*?)\n```/gi;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(content)) !== null) {
    const text = match[1] ?? "";
    const relativeStart = match.index + match[0].indexOf(text);
    candidates.push({ text: text.trim(), start: offset + relativeStart, end: offset + relativeStart + text.length });
  }

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push({
      text: content.slice(firstBrace, lastBrace + 1),
      start: offset + firstBrace,
      end: offset + lastBrace + 1,
    });
  }

  return candidates;
}

function isSceneDocument(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return Array.isArray(value.elements) && isRecord(value.appState ?? {}) && isRecord(value.files ?? {});
}

function toScene(value: Record<string, unknown>): ExcalidrawScene {
  return {
    elements: Array.isArray(value.elements) ? value.elements : [],
    appState: isRecord(value.appState) ? value.appState : {},
    files: isRecord(value.files) ? value.files : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sceneHash(scene: ExcalidrawScene): Promise<string> {
  const normalized = JSON.stringify({ elements: scene.elements, appState: scene.appState, files: scene.files });
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createRemoteDrawing(target: ExcaliDashTarget, name: string, scene: ExcalidrawScene): Promise<ExcaliDashDrawing> {
  return requestJson<ExcaliDashDrawing>(target, "POST", "/drawings", {
    name,
    ...scene,
    preview: null,
    collectionId: null,
  });
}

async function getRemoteDrawing(target: ExcaliDashTarget, id: string): Promise<ExcaliDashDrawing> {
  return requestJson<ExcaliDashDrawing>(target, "GET", `/drawings/${encodeURIComponent(id)}`);
}

async function updateRemoteDrawing(
  target: ExcaliDashTarget,
  id: string,
  name: string,
  scene: ExcalidrawScene,
  version: number,
): Promise<ExcaliDashDrawing> {
  return requestJson<ExcaliDashDrawing>(target, "PUT", `/drawings/${encodeURIComponent(id)}`, {
    name,
    ...scene,
    preview: null,
    version,
  });
}

async function testExcaliDashConnection(target: ExcaliDashTarget): Promise<ConnectionTestResult> {
  const csrf = await getCsrfToken(target);
  if (target.staticCsrfToken.length === 0) {
    if (csrf.token.length === 0) {
      throw new Error("CSRF token response did not include a token.");
    }
  }

  const drawings = await requestJson<unknown>(target, "GET", "/drawings?includeData=false", undefined, csrf);
  return { drawingCount: Array.isArray(drawings) ? drawings.length : undefined };
}

async function requestJson<T>(
  target: ExcaliDashTarget,
  method: string,
  path: string,
  body?: unknown,
  csrf?: { header: string; token: string },
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (target.cookieHeader.length > 0) {
    headers.Cookie = target.cookieHeader;
  }

  if (csrf !== undefined && csrf.token.length > 0) {
    headers[csrf.header] = csrf.token;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    const writeCsrf = csrf ?? await getCsrfToken(target);
    if (writeCsrf.token.length > 0) {
      headers[writeCsrf.header] = writeCsrf.token;
    }
  }

  const params: RequestUrlParam = {
    url: buildApiUrl(target, path),
    method,
    headers,
    throw: false,
  };

  if (body !== undefined) {
    params.body = JSON.stringify(body);
  }

  const response = await requestUrl(params);
  return parseJsonResponse<T>(response, target, path, "ExcaliDash request");
}

async function getCsrfToken(target: ExcaliDashTarget): Promise<{ header: string; token: string }> {
  if (target.staticCsrfToken.length > 0) {
    return { header: target.csrfHeaderName, token: target.staticCsrfToken };
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (target.cookieHeader.length > 0) {
    headers.Cookie = target.cookieHeader;
  }

  const response = await requestUrl({
    url: buildApiUrl(target, target.csrfTokenEndpoint),
    method: "GET",
    headers,
    throw: false,
  });

  const json = parseJsonResponse<Partial<{ token: string; header: string }>>(response, target, target.csrfTokenEndpoint, "CSRF token request");
  return {
    header: typeof json.header === "string" && json.header.length > 0 ? json.header : target.csrfHeaderName,
    token: typeof json.token === "string" ? json.token : "",
  };
}

function parseJsonResponse<T>(
  response: RequestUrlResponse,
  target: ExcaliDashTarget,
  path: string,
  requestName: string,
): T {
  const displayPath = getApiDisplayPath(target, path);
  const contentType = getHeader(response.headers, "content-type");

  if (!isJsonContentType(contentType)) {
    const received = contentType.length > 0 ? contentType : "unknown content type";
    throw new Error(`Expected JSON from ${displayPath} but received ${received}; check API path prefix.`);
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${requestName} to ${displayPath} failed with HTTP ${response.status}.`);
  }

  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new Error(`Expected JSON from ${displayPath} but received invalid JSON; check API path prefix.`);
  }
}

function getHeader(headers: Record<string, string>, name: string): string {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    }
  }
  return "";
}

function isJsonContentType(contentType: string): boolean {
  return contentType === "application/json" || contentType.endsWith("+json");
}

function buildApiUrl(target: ExcaliDashTarget, path: string): string {
  const apiPathPrefix = normalizePathPrefix(target.apiPathPrefix);
  if (apiPathPrefix.length === 0 || baseUrlEndsWithPathPrefix(target.baseUrl, apiPathPrefix)) {
    return joinUrl(target.baseUrl, path);
  }

  return joinUrl(target.baseUrl, joinPath(apiPathPrefix, path));
}

function getApiDisplayPath(target: ExcaliDashTarget, path: string): string {
  const apiPathPrefix = normalizePathPrefix(target.apiPathPrefix);
  if (apiPathPrefix.length === 0) {
    return normalizePath(path);
  }

  return joinPath(apiPathPrefix, path);
}

function baseUrlEndsWithPathPrefix(baseUrl: string, pathPrefix: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    const pathname = normalizePath(parsed.pathname);
    return pathname === pathPrefix || pathname.endsWith(pathPrefix);
  } catch {
    return normalizePath(baseUrl) === pathPrefix || normalizePath(baseUrl).endsWith(pathPrefix);
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function joinPath(prefix: string, path: string): string {
  return `${normalizePathPrefix(prefix)}${normalizePath(path)}`;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return `/${trimmed.replace(/^\/+/, "")}`;
}

function normalizePathPrefix(pathPrefix: string): string {
  const trimmed = pathPrefix.trim().replace(/^\/+|\/+$/g, "");
  return trimmed.length > 0 ? `/${trimmed}` : "";
}

function formatTargetName(target: ExcaliDashTarget, index: number): string {
  return target.name.trim().length > 0 ? target.name.trim() : `Target ${index + 1}`;
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(cookie\s*[:=]\s*)[^\n,;]+/gi, "$1[redacted]")
    .replace(/(csrf[-_\s]*(?:token)?\s*[:=]\s*)[^\n,;]+/gi, "$1[redacted]")
    .replace(/(x-csrf-token\s*[:=]\s*)[^\n,;]+/gi, "$1[redacted]");
}

function parseDrawingFrontmatter(frontmatter: Record<string, unknown> | undefined): DrawingFrontmatter {
  const syncValue = frontmatter?.["excalidash-sync"];
  const direction = syncValue === "bidirectional" || syncValue === "bydirectional" ? "bidirectional" : DEFAULT_SYNC_DIRECTION;
  const version = frontmatter?.["excalidash-version"];

  return {
    destination: readNonEmptyString(frontmatter?.["excalidash-destination"]),
    direction,
    id: readNonEmptyString(frontmatter?.["excalidash-id"]),
    version: typeof version === "number" ? version : Number.isFinite(Number(version)) ? Number(version) : undefined,
    lastHash: readNonEmptyString(frontmatter?.["excalidash-last-hash"]),
    lastSynced: readNonEmptyString(frontmatter?.["excalidash-last-synced"]),
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isExcalidrawFile(file: TFile): boolean {
  return file.path.endsWith(".excalidraw") || file.path.endsWith(".excalidraw.md");
}

function normalizeSettings(loaded: Partial<ExcaliDashSyncSettings> | null): ExcaliDashSyncSettings {
  return {
    targets: Array.isArray(loaded?.targets) ? loaded.targets.map(normalizeTarget) : [],
  };
}

function normalizeTarget(target: Partial<ExcaliDashTarget>): ExcaliDashTarget {
  return {
    name: target.name ?? "",
    baseUrl: target.baseUrl ?? "",
    apiPathPrefix: normalizePathPrefix(target.apiPathPrefix ?? DEFAULT_API_PATH_PREFIX),
    csrfTokenEndpoint: target.csrfTokenEndpoint ?? DEFAULT_CSRF_ENDPOINT,
    csrfHeaderName: target.csrfHeaderName ?? DEFAULT_CSRF_HEADER,
    csrfTokenPlacement: "header",
    staticCsrfToken: target.staticCsrfToken ?? "",
    cookieHeader: target.cookieHeader ?? "",
  };
}

function createDefaultTarget(): ExcaliDashTarget {
  return normalizeTarget({ name: "home" });
}
