export interface EquipmentDisplayItem {
  equipmentId?: string;
  name?: string;
  description?: string;
}

export interface EquipmentDisplayAsset {
  id?: string;
  name?: string;
}

export function resolveBudgetEquipmentName(
  item: EquipmentDisplayItem | null | undefined,
  equipmentAssets?: EquipmentDisplayAsset[],
): string;