import { Input, Select, TextArea } from '../ui';
import type { EquipmentAsset, EquipmentCostType } from '../../types';

export interface EquipmentAssetFormValue {
  name: string;
  type: string;
  costType: EquipmentCostType;
  fuelCostPerHour: number;
  equipmentPayment: number;
  equipmentPaymentFrequencyPerYear: number;
  yearlyInsuranceCost: number;
  yearlyMaintenanceCost: number;
  notes: string;
}

export const emptyEquipmentAssetFormValue = (): EquipmentAssetFormValue => ({
  name: '',
  type: '',
  costType: 'owned',
  fuelCostPerHour: 0,
  equipmentPayment: 0,
  equipmentPaymentFrequencyPerYear: 12,
  yearlyInsuranceCost: 0,
  yearlyMaintenanceCost: 0,
  notes: '',
});

export const toEquipmentAssetPayload = (
  value: EquipmentAssetFormValue,
  existing?: Pick<EquipmentAsset, 'status' | 'serialNumber' | 'purchaseDate' | 'purchasePrice' | 'fuelPriceUnit'>,
): Omit<EquipmentAsset, 'id' | 'createdAt' | 'updatedAt'> => ({
  name: value.name.trim(),
  type: value.type.trim(),
  status: existing?.status ?? 'available',
  costType: value.costType,
  serialNumber: existing?.serialNumber ?? '',
  purchaseDate: existing?.purchaseDate,
  hourlyCost: Number(value.fuelCostPerHour || 0),
  purchasePrice: existing?.purchasePrice,
  equipmentPayment: value.costType === 'owned' ? 0 : Number(value.equipmentPayment || 0),
  equipmentPaymentFrequencyPerYear: value.costType === 'owned' ? 0 : Number(value.equipmentPaymentFrequencyPerYear || 0),
  fuelPriceUnit: existing?.fuelPriceUnit ?? 'L',
  averageFuelPrice: Number(value.fuelCostPerHour || 0),
  averageFuelBurnPerHour: value.fuelCostPerHour > 0 ? 1 : 0,
  yearlyInsuranceCost: Number(value.yearlyInsuranceCost || 0),
  yearlyMaintenanceCost: Number(value.yearlyMaintenanceCost || 0),
  notes: value.notes.trim(),
});

interface EquipmentAssetFormProps {
  value: EquipmentAssetFormValue;
  onChange: (next: EquipmentAssetFormValue) => void;
}

export default function EquipmentAssetForm({ value, onChange }: EquipmentAssetFormProps) {
  const set = <K extends keyof EquipmentAssetFormValue>(key: K, nextValue: EquipmentAssetFormValue[K]) => {
    onChange({ ...value, [key]: nextValue });
  };

  return (
    <div className="space-y-4">
      <Input
        label="Equipment Name"
        required
        value={value.name}
        onChange={(event) => set('name', event.target.value)}
      />
      <Input
        label="Type"
        required
        value={value.type}
        onChange={(event) => set('type', event.target.value)}
        placeholder="Skid Steer"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Cost Type"
          value={value.costType}
          onChange={(event) => set('costType', event.target.value as EquipmentCostType)}
        >
          <option value="owned">Owned</option>
          <option value="leased">Leased</option>
          <option value="financed">Financed</option>
        </Select>
        <Input
          label="Fuel Cost / Hour"
          type="number"
          min="0"
          step="0.01"
          value={value.fuelCostPerHour}
          onChange={(event) => set('fuelCostPerHour', Number(event.target.value || 0))}
        />
      </div>
      {value.costType !== 'owned' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={value.costType === 'leased' ? 'Lease Payment' : 'Payment Amount'}
            type="number"
            min="0"
            step="0.01"
            value={value.equipmentPayment}
            onChange={(event) => set('equipmentPayment', Number(event.target.value || 0))}
          />
          <Input
            label="Payment Frequency (# per year)"
            type="number"
            min="0"
            step="1"
            value={value.equipmentPaymentFrequencyPerYear}
            onChange={(event) => set('equipmentPaymentFrequencyPerYear', Number(event.target.value || 0))}
          />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Annual Insurance Cost"
          type="number"
          min="0"
          step="0.01"
          value={value.yearlyInsuranceCost}
          onChange={(event) => set('yearlyInsuranceCost', Number(event.target.value || 0))}
        />
        <Input
          label="Annual Maintenance Cost"
          type="number"
          min="0"
          step="0.01"
          value={value.yearlyMaintenanceCost}
          onChange={(event) => set('yearlyMaintenanceCost', Number(event.target.value || 0))}
        />
      </div>
      <TextArea
        label="Notes"
        value={value.notes}
        onChange={(event) => set('notes', event.target.value)}
        placeholder="Maintenance note, special handling, or job notes"
      />
    </div>
  );
}
