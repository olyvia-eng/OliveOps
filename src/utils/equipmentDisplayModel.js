const text = (value) => typeof value === 'string' ? value.trim() : '';

export function resolveBudgetEquipmentName(item, equipmentAssets = []) {
  const snapshotName = text(item?.name) || text(item?.description);
  if (snapshotName) return snapshotName;

  const equipmentId = text(item?.equipmentId);
  if (!equipmentId) return 'Unnamed equipment';
  const asset = equipmentAssets.find((candidate) => text(candidate?.id) === equipmentId);
  return text(asset?.name) || 'Unnamed equipment';
}