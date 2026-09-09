import { Input, TextArea } from '../ui';
import type { SubcontractorFormValue } from './subcontractorFormModel';

interface Props {
  value: SubcontractorFormValue;
  onChange: (value: SubcontractorFormValue) => void;
  disabled?: boolean;
}

export default function SubcontractorFormFields({ value, onChange, disabled = false }: Props) {
  const set = <K extends keyof SubcontractorFormValue>(field: K, fieldValue: SubcontractorFormValue[K]) => {
    onChange({ ...value, [field]: fieldValue });
  };

  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <Input label="Company Name" required value={value.name} disabled={disabled} onChange={(event) => set('name', event.target.value)} />
    <Input label="Trade / Service" value={value.trade} disabled={disabled} onChange={(event) => set('trade', event.target.value)} />
    <Input label="Contact Name" value={value.contactName} disabled={disabled} onChange={(event) => set('contactName', event.target.value)} />
    <Input label="Email" type="email" value={value.email} disabled={disabled} onChange={(event) => set('email', event.target.value)} />
    <Input label="Phone" value={value.phone} disabled={disabled} onChange={(event) => set('phone', event.target.value)} />
    <Input label="Unit" required value={value.unit} disabled={disabled} onChange={(event) => set('unit', event.target.value)} />
    <Input label="Default Cost" type="number" min={0} step={0.01} value={value.defaultUnitCost} disabled={disabled} onChange={(event) => set('defaultUnitCost', Number(event.target.value || 0))} />
    <div className="sm:col-span-2"><TextArea label="Notes" value={value.notes} disabled={disabled} onChange={(event) => set('notes', event.target.value)} /></div>
  </div>;
}