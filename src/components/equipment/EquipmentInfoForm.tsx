import { Input, Select } from '../ui';
import type { EquipmentClassification, EquipmentCostType } from '../../types';
import { formatCurrency } from '../../utils';

export interface EquipmentInfoFormValue {
  description: string;
  costCode: string;
  equipmentCostType: EquipmentCostType;
  equipmentClassification: EquipmentClassification;
  equipmentPayment: number;
  equipmentPaymentFrequencyPerYear: number;
  yearlyFuelCost: number;
  yearlyInsuranceCost: number;
  yearlyMaintenanceCost: number;
  sellableHoursPerYear: number;
  equipmentHoursPerDay: number;
}

interface EquipmentInfoFormProps {
  value: EquipmentInfoFormValue;
  onChange: (next: EquipmentInfoFormValue) => void;
  totalEquipmentCostPerYear: number;
  totalCostPerHour: number;
  totalCostPerDay: number;
  showCalculationDetails: boolean;
  onToggleCalculationDetails: () => void;
}

export const emptyEquipmentInfoFormValue = (): EquipmentInfoFormValue => ({
  description: '',
  costCode: '',
  equipmentCostType: 'financed',
  equipmentClassification: 'billable',
  equipmentPayment: 0,
  equipmentPaymentFrequencyPerYear: 12,
  yearlyFuelCost: 0,
  yearlyInsuranceCost: 0,
  yearlyMaintenanceCost: 0,
  sellableHoursPerYear: 0,
  equipmentHoursPerDay: 8,
});

export default function EquipmentInfoForm({
  value,
  onChange,
  totalEquipmentCostPerYear,
  totalCostPerHour,
  totalCostPerDay,
  showCalculationDetails,
  onToggleCalculationDetails,
}: EquipmentInfoFormProps) {
  const set = <K extends keyof EquipmentInfoFormValue>(key: K, nextValue: EquipmentInfoFormValue[K]) => {
    onChange({ ...value, [key]: nextValue });
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-gray-900">Equipment Details</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Input label="Name / Equipment *" required value={value.description} onChange={(event) => set('description', event.target.value)} />
          <Input label="Cost Code" value={value.costCode} onChange={(event) => set('costCode', event.target.value)} placeholder="e.g. 06-200" />
          <Select label="Classification" value={value.equipmentClassification} onChange={(event) => set('equipmentClassification', event.target.value as EquipmentClassification)}>
            <option value="billable">Billable Equipment</option>
            <option value="overhead">Overhead Equipment</option>
          </Select>
          <Select label="Ownership" value={value.equipmentCostType} onChange={(event) => set('equipmentCostType', event.target.value as EquipmentCostType)}>
            <option value="financed">Financed</option>
            <option value="leased">Leased</option>
            <option value="owned">Owned</option>
          </Select>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900">Annual Costs</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Yearly Fuel Cost</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={value.yearlyFuelCost}
                className="pl-7"
                onChange={(event) => set('yearlyFuelCost', Number(event.target.value || 0))}
              />
            </div>
            <p className="text-xs text-gray-500">Estimated total fuel cost for this equipment for the year.</p>
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

        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900">Utilization / Cost Calculation</h3>
        <p className="mt-1 text-xs text-gray-500">Utilization determines operating cost rates. It does not change the 12-month annual cost allocation.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Input
            label="Expected Operating Hours / Year"
            type="number"
            min={0}
            step={1}
            value={value.sellableHoursPerYear}
            onChange={(event) => set('sellableHoursPerYear', Number(event.target.value || 0))}
          />

          <Input
            label="Expected Operating Hours / Day"
            type="number"
            min={0}
            step={0.25}
            value={value.equipmentHoursPerDay}
            onChange={(event) => set('equipmentHoursPerDay', Number(event.target.value || 0))}
          />

          <Input label="Calculated Operating Days / Year" value={value.equipmentHoursPerDay > 0 ? (value.sellableHoursPerYear / value.equipmentHoursPerDay).toFixed(1) : '0'} disabled />
        </div>
      </section>

      <section>
      <h3 className="text-sm font-semibold text-gray-900">Calculated Results</h3>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ['Annual Equipment Cost', totalEquipmentCostPerYear],
          ['Cost per Operating Day', totalCostPerDay],
          ['Cost per Operating Hour', totalCostPerHour],
        ].map(([label, amount]) => (
          <div key={String(label)} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{formatCurrency(Number(amount))}</p>
          </div>
        ))}
      </div>
      </section>

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
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <h3 className="font-semibold text-gray-900">Equipment Cost Calculation</h3>
          <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
            <dt>Annual Payments</dt><dd>{formatCurrency(value.equipmentCostType === 'owned' ? 0 : Number(value.equipmentPayment || 0) * Number(value.equipmentPaymentFrequencyPerYear || 0))}</dd>
            <dt>Yearly Fuel Cost</dt><dd>{formatCurrency(Number(value.yearlyFuelCost || 0))}</dd>
            <dt>Insurance</dt><dd>{formatCurrency(Number(value.yearlyInsuranceCost || 0))}</dd>
            <dt>Maintenance</dt><dd>{formatCurrency(Number(value.yearlyMaintenanceCost || 0))}</dd>
            <dt className="border-t border-gray-200 pt-2 font-semibold text-gray-900">Annual Equipment Cost</dt><dd className="border-t border-gray-200 pt-2 font-semibold text-gray-900">{formatCurrency(totalEquipmentCostPerYear)}</dd>
            <dt className="pt-2">Expected Operating Days</dt><dd className="pt-2">{value.equipmentHoursPerDay > 0 ? (value.sellableHoursPerYear / value.equipmentHoursPerDay).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '0'}</dd>
            <dt>Expected Operating Hours</dt><dd>{Number(value.sellableHoursPerYear || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</dd>
            <dt className="font-semibold text-gray-900">Cost per Day</dt><dd className="font-semibold text-gray-900">{formatCurrency(totalCostPerDay)}</dd>
            <dt className="font-semibold text-gray-900">Cost per Hour</dt><dd className="font-semibold text-gray-900">{formatCurrency(totalCostPerHour)}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
