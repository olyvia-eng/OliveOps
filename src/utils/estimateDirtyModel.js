export function serializeEstimateEditorState(value) {
  return JSON.stringify(value ?? null);
}

export function isEstimateEditorDirty(current, persisted) {
  if (!current || !persisted) return false;
  return serializeEstimateEditorState(current) !== serializeEstimateEditorState(persisted);
}
