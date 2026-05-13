import LZString from "lz-string";

const { compressToBase64, decompressFromBase64 } = LZString;

function replaceCompressedScene(markdown, remoteScene) {
  const match = /```compressed-json\s*\n([\s\S]*?)\n```/i.exec(markdown);
  if (match === null || match.index === undefined) {
    throw new Error("Missing compressed-json fenced block in sample markdown.");
  }

  const payloadStart = match.index + match[0].indexOf(match[1]);
  const payloadEnd = payloadStart + match[1].length;
  const current = JSON.parse(decompressFromBase64(match[1].replace(/\s+/g, "")));
  const replacement = compressToBase64(JSON.stringify({ ...current, ...remoteScene }));
  return `${markdown.slice(0, payloadStart)}${replacement}${markdown.slice(payloadEnd)}`;
}

const scene = {
  type: "excalidraw",
  version: 2,
  source: "https://github.com/zsviczian/obsidian-excalidraw-plugin",
  elements: [],
  appState: { gridSize: null },
  files: {},
};

const compressed = compressToBase64(JSON.stringify(scene));
const spacedCompressed = compressed.match(/.{1,32}/g)?.join("\n  ") ?? compressed;
const markdown = `---
excalidash-destination: home
---

# Excalidraw Data

\`\`\`compressed-json
${spacedCompressed}
\`\`\`

Trailing note text.
`;

const match = /```compressed-json\s*\n([\s\S]*?)\n```/i.exec(markdown);
if (match === null) {
  throw new Error("Missing compressed-json fenced block in sample markdown.");
}

const decompressed = decompressFromBase64(match[1].replace(/\s+/g, ""));
const parsed = JSON.parse(decompressed);
const expectedKeys = ["type", "version", "source", "elements", "appState", "files"];

for (const key of expectedKeys) {
  if (!(key in parsed)) {
    throw new Error(`Missing key after compressed-json decode: ${key}`);
  }
}

if (!Array.isArray(parsed.elements) || typeof parsed.appState !== "object" || typeof parsed.files !== "object") {
  throw new Error("Decoded payload is not an Excalidraw scene document.");
}

const updatedMarkdown = replaceCompressedScene(markdown, {
  elements: [{ id: "remote-element", type: "rectangle" }],
  appState: { viewBackgroundColor: "#ffffff" },
  files: { "file-id": { mimeType: "image/png" } },
});
const updatedMatch = /```compressed-json\s*\n([\s\S]*?)\n```/i.exec(updatedMarkdown);
const updatedScene = JSON.parse(decompressFromBase64(updatedMatch[1].replace(/\s+/g, "")));

if (!updatedMarkdown.startsWith("---\nexcalidash-destination: home\n---") || !updatedMarkdown.endsWith("Trailing note text.\n")) {
  throw new Error("Compressed-json update did not preserve surrounding markdown.");
}

if (updatedScene.source !== scene.source || updatedScene.elements[0]?.id !== "remote-element" || updatedScene.files["file-id"] === undefined) {
  throw new Error("Compressed-json update did not merge metadata and remote scene fields.");
}

console.log("compressed-json Excalidraw markdown smoke test passed");
