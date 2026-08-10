import { Input, Select } from '../ui';
import type { EquipmentCostType } from '../../types';

export interface EquipmentInfoFormValue {
  description: string;
  costCode: string;
  equipmentCostType: EquipmentCostType;
  equipmentPayment: number;
  equipmentPaymentFrequencyPerYear: number;
  fuelPriceUnit: 'L' | 'gal';
  averageFuelPrice: number;
  averageFuelBurnPerHour: number;
  yearlyInsuranceCost: number;
  yearlyMaintenanceCost: number;
  sellableHoursPerYear: number;
  equipmentHoursPerDay: number;
  monthsUsedPerYear: number;
}

interface EquipmentInfoFormProps {
  value: EquipmentInfoFormValue;
  onChange: (next: EquipmentInfoFormValue) => void;
  fuelCostPerHour: number;
  totalEquipmentCostPerYear: number;
  totalCostPerHour: number;
  totalCostPerDay: number;
  budgetSellRate?: number;
  onBudgetSellRateChange?: (nextValue: number) => void;
  showCalculationDetails: boolean;
  onToggleCalculationDetails: () => void;
  showBudgetSellRate?: boolean;
  editableBudgetSellRate?: boolean;
}

export const emptyEquipmentInfoFormValue = (): EquipmentInfoFormValue => ({
  description: '',
  costCode: '',
  equipmentCostType: 'financed',
  equipmentPayment: 0,
  equipmentPaymentFrequencyPerYear: 12,
  fuelPriceUnit: 'L',
  averageFuelPrice: 0,
  averageFuelBurnPerHour: 0,
  yearlyInsuranceCost: 0,
  yearlyMaintenanceCost: 0,
  sellableHoursPerYear: 0,
  equipmentHoursPerDay: 8,
  monthsUsedPerYear: 12,
});

export default function EquipmentInfoForm({
  value,
  onChange,
  fuelCostPerHour,
  totalEquipmentCostPerYear,
  totalCostPerHour,
  totalCostPerDay,
  budgetSellRate = 0,
  onBudgetSellRateChange,
  showCalculationDetails,
  onToggleCalculationDetails,
  showBudgetSellRate = true,
  editableBudgetSellRate = true,
}: EquipmentInfoFormProps) {
  const set = <K extends keyof EquipmentInfoFormValue>(key: K, nextValue: EquipmentInfoFormValue[K]) => {
    onChange({ ...value, [key]: nextValue });
  };

  return (
    <div className="space-y-4">
      <Input
        label="Description *"
        required
        value={value.description}
        onChange={(event) => set('description', event.target.value)}
      />
      <Input
        label="Cost Code"
        value={value.costCode}
        onChange={(event) => set('costCode', event.target.value)}
        placeholder="e.g. 06-200"
      />
      <Select
        label="Equipment Cost Type"
        value={value.equipmentCostType}
        onChange={(event) => set('equipmentCostType', event.target.value as EquipmentCostType)}
      >
        <option value="financed">Financed</option>
        <option value="leased">Leased</option>
        <option value="owned">Owned</option>
      </Select>

      <fieldset className="border border-gray-200 rounded-lg p-3">
        <legend className="text-sm font-medium text-gray-700 px-1">Equipment Info</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
          {value.equipmentCostType !== 'owned' && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">Payment</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={value.equipmentPayment}
                    className="pl-7"
                    onChange={(event) => set('equipmentPayment', Number(event.target.value || 0))}
                  />
                </div>
              </div>
              <Input
                label="Payment Frequency (# per year)"
                type="number"
                min={0}
                step={1}
                value={value.equipmentPaymentFrequencyPerYear}
                onChange={(event) => set('equipmentPaymentFrequencyPerYear', Number(event.target.value || 0))}
              />
            </>
          )}

          <div className="space-y-2 sm:col-span-2">
            <p className="text-sm font-medium text-gray-700">Fuel Price Unit</p>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-white">
              {(['L', 'gal'] as const).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => set('fuelPriceUnit', unit)}
                  className={`px-3 py-1 text-xs rounded ${
                    value.fuelPriceUnit === unit
                      ? 'bg-brand-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {unit}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Fuel Price (/{value.fuelPriceUnit})</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={value.averageFuelPrice}
                className="pl-7"
                onChange={(event) => set('averageFuelPrice', Number(event.target.value || 0))}
              />
            </div>
          </div>

          <Input
            label={`Fuel Burned per Hour (${value.fuelPriceUnit}/hr)`}
            type="number"
            min={0}
            step={0.01}
            value={value.averageFuelBurnPerHour}
            onChange={(event) => set('averageFuelBurnPerHour', Number(event.target.value || 0))}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Fuel Cost per Hour</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={fuelCostPerHour}
                className="pl-7"
                disabled
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Yearly Insurance Cost</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={value.yearlyInsuranceCost}
                className="pl-7"
                onChange={(event) => set('yearlyInsuranceCost', Number(event.target.value || 0))}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Yearly Maintenance Cost</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={value.yearlyMaintenanceCost}
                className="pl-7"
                onChange={(event) => set('yearlyMaintenanceCost', Number(event.target.value || 0))}
              />
            </div>
          </div>

          <Input
            label="Billable Hours per Year"
            type="number"
            min={0}
            step={1}
            value={value.sellableHoursPerYear}
            onChange={(event) => set('sellableHoursPerYear', Number(event.target.value || 0))}
          />

          <Input
            label="Hours per Day"
            type="number"
            min={0}
            step={0.25}
            value={value.equipmentHoursPerDay}
            onChange={(event) => set('equipmentHoursPerDay', Number(event.target.value || 0))}
          />

          <Input
            label="Months Used Per Year"
            type="number"
            min={1}
            max={12}
            step={1}
            value={value.monthsUsedPerYear}
            onChange={(event) => set('monthsUsedPerYear', Number(event.target.value || 0))}
          />
        </div>
      </fieldset>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-sm font-medium text-gray-700">Total Equipment Cost per Year</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={totalEquipmentCostPerYear}
              className="pl-7"
              disabled
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Total Cost per Hour</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={totalCostPerHour}
              className="pl-7"
              disabled
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Total Cost per Day</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={totalCostPerDay}
              className="pl-7"
              disabled
            />
          </div>
        </div>

        {showBudgetSellRate && (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-sm font-medium text-gray-700">Budget Sell Rate / Charge-Out Rate</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={budgetSellRate}
                className="pl-7"
                onChange={(event) => onBudgetSellRateChange?.(Number(event.target.value || 0))}
                disabled={!editableBudgetSellRate}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-1">
        <button
          type="button"
          className="text-xs font-medium text-brand-600 hover:text-brand-700"
          onClick={onToggleCalculationDetails}
        >
          {showCalculationDetails ? 'Hide Calculation Details' : 'Show Calculation Details'}
        </button>
      </div>

      {showCalculationDetails && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
          <p>
            Annual Payments: {value.equipmentCostType === 'owned' ? '$0.00' : `$${Number(value.equipmentPayment || 0).toFixed(2)}`} x {value.equipmentCostType === 'owned' ? '0' : Number(value.equipmentPaymentFrequencyPerYear || 0).toFixed(0)} = ${value.equipmentCostType === 'owned' ? '0.00' : (Number(value.equipmentPayment || 0) * Number(value.equipmentPaymentFrequencyPerYear || 0)).toFixed(2)}
          </p>
          <p>
            Variable Operating Cost: ${Number(fuelCostPerHour || 0).toFixed(2)} x {Number(value.sellableHoursPerYear || 0).toFixed(0)} hrs = ${(Number(fuelCostPerHour || 0) * Number(value.sellableHoursPerYear || 0)).toFixed(2)}
          </p>
          <p>
            Yearly Insurance Cost: ${Number(value.yearlyInsuranceCost || 0).toFixed(2)}
          </p>
          <p>
            Yearly Maintenance Cost: ${Number(value.yearlyMaintenanceCost || 0).toFixed(2)}
          </p>
          <p className="pt-1 border-t border-gray-200 font-semibold text-gray-900">
            Total Equipment Cost per Year: ${Number(totalEquipmentCostPerYear || 0).toFixed(2)}
          </p>
          <p>
            Total Cost per Hour: ${Number(totalCostPerHour || 0).toFixed(2)}
          </p>
          <p>
            Total Cost per Day: ${Number(totalCostPerDay || 0).toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}
