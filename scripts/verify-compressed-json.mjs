import LZString from "lz-string";

const { compressToBase64, decompressFromBase64 } = LZString;

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
const markdown = `# Excalidraw Data

\`\`\`compressed-json
${spacedCompressed}
\`\`\`
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

console.log("compressed-json Excalidraw markdown smoke test passed");
