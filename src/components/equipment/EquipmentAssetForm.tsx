import { Input, Select, TextArea } from '../ui';
import type { EquipmentAsset, EquipmentCostType, EquipmentStatus } from '../../types';

export interface EquipmentAssetFormValue {
  name: string;
  type: string;
  status: EquipmentStatus;
  costType: EquipmentCostType;
  serialNumber: string;
  purchaseDate: string;
  hourlyCost: number;
  purchasePrice: number;
  equipmentPayment: number;
  equipmentPaymentFrequencyPerYear: number;
  fuelPriceUnit: 'L' | 'gal';
  averageFuelPrice: number;
  averageFuelBurnPerHour: number;
  yearlyInsuranceCost: number;
  yearlyMaintenanceCost: number;
  notes: string;
}

export const emptyEquipmentAssetFormValue = (): EquipmentAssetFormValue => ({
  name: '',
  type: '',
  status: 'available',
  costType: 'owned',
  serialNumber: '',
  purchaseDate: '',
  hourlyCost: 0,
  purchasePrice: 0,
  equipmentPayment: 0,
  equipmentPaymentFrequencyPerYear: 12,
  fuelPriceUnit: 'L',
  averageFuelPrice: 0,
  averageFuelBurnPerHour: 0,
  yearlyInsuranceCost: 0,
  yearlyMaintenanceCost: 0,
  notes: '',
});

export const toEquipmentAssetPayload = (
  value: EquipmentAssetFormValue,
): Omit<EquipmentAsset, 'id' | 'createdAt' | 'updatedAt'> => ({
  name: value.name.trim(),
  type: value.type.trim(),
  status: value.status,
  costType: value.costType,
  serialNumber: value.serialNumber.trim(),
  purchaseDate: value.purchaseDate || undefined,
  hourlyCost: Number(value.hourlyCost || 0),
  purchasePrice: Number(value.purchasePrice || 0),
  equipmentPayment: Number(value.equipmentPayment || 0),
  equipmentPaymentFrequencyPerYear: Number(value.equipmentPaymentFrequencyPerYear || 0),
  fuelPriceUnit: value.fuelPriceUnit,
  averageFuelPrice: Number(value.averageFuelPrice || 0),
  averageFuelBurnPerHour: Number(value.averageFuelBurnPerHour || 0),
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
        placeholder="Excavator"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Status"
          value={value.status}
          onChange={(event) => set('status', event.target.value as EquipmentStatus)}
        >
          <option value="available">Available</option>
          <option value="in_use">In Use</option>
          <option value="maintenance">Maintenance</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Select
          label="Cost Type"
          value={value.costType}
          onChange={(event) => set('costType', event.target.value as EquipmentCostType)}
        >
          <option value="owned">Owned</option>
          <option value="leased">Leased</option>
          <option value="financed">Financed</option>
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Serial Number"
          value={value.serialNumber}
          onChange={(event) => set('serialNumber', event.target.value)}
        />
        <Input
          label="Purchase Date"
          type="date"
          value={value.purchaseDate}
          onChange={(event) => set('purchaseDate', event.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Operating Cost per Hour"
          type="number"
          min="0"
          step="0.01"
          value={value.hourlyCost}
          onChange={(event) => set('hourlyCost', Number(event.target.value || 0))}
        />
        <Input
          label="Purchase Price"
          type="number"
          min="0"
          step="0.01"
          value={value.purchasePrice}
          onChange={(event) => set('purchasePrice', Number(event.target.value || 0))}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Payment"
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
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          label="Fuel Price Unit"
          value={value.fuelPriceUnit}
          onChange={(event) => set('fuelPriceUnit', event.target.value === 'gal' ? 'gal' : 'L')}
        >
          <option value="L">L</option>
          <option value="gal">gal</option>
        </Select>
        <Input
          label="Average Fuel Price"
          type="number"
          min="0"
          step="0.01"
          value={value.averageFuelPrice}
          onChange={(event) => set('averageFuelPrice', Number(event.target.value || 0))}
        />
        <Input
          label="Fuel Burned per Hour"
          type="number"
          min="0"
          step="0.01"
          value={value.averageFuelBurnPerHour}
          onChange={(event) => set('averageFuelBurnPerHour', Number(event.target.value || 0))}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Yearly Insurance Cost"
          type="number"
          min="0"
          step="0.01"
          value={value.yearlyInsuranceCost}
          onChange={(event) => set('yearlyInsuranceCost', Number(event.target.value || 0))}
        />
        <Input
          label="Yearly Maintenance Cost"
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
