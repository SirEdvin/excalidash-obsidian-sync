function resolveCollectionId(collection, value) {
  if (!Array.isArray(value)) {
    throw new Error("ExcaliDash collections response was not a JSON array.");
  }

  const collections = value.filter((item) => typeof item === "object" && item !== null && typeof item.id === "string");
  return collections.find((item) => item.id === collection)?.id
    ?? collections.find((item) => item.name === collection || item.title === collection)?.id
    ?? null;
}

const collections = [
  { id: "first", name: "Shared", title: "First title" },
  { id: "name-match", name: "Collection A" },
  { id: "title-match", title: "Collection B" },
  { id: "Collection A", name: "Conflicting name" },
];

const cases = [
  ["Collection A", "Collection A"],
  ["Collection B", "title-match"],
  ["missing", null],
];

for (const [input, expected] of cases) {
  const actual = resolveCollectionId(input, collections);
  if (actual !== expected) {
    throw new Error(`Expected '${input}' to resolve to '${expected}', got '${actual}'.`);
  }
}

try {
  resolveCollectionId("anything", { id: "not-array" });
  throw new Error("Expected non-array collection response to fail.");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("not a JSON array")) {
    throw error;
  }
}

console.log("ExcaliDash collection resolution smoke test passed");
