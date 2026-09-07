import { SCHEDULE_COLOUR_PALETTE } from '../../config/scheduleColours.js';

export const DEFAULT_SCHEDULING_COLOR = SCHEDULE_COLOUR_PALETTE[0].value;

export default function SchedulingColourPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div>
    <p className="mb-1.5 text-sm font-medium text-gray-700 dark:text-brand-200">Scheduling Colour</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Scheduling Colour">
      {SCHEDULE_COLOUR_PALETTE.map((colour) => <button key={colour.id} type="button" title={colour.id} aria-label={`Use ${colour.id}`} aria-pressed={value === colour.value} onClick={() => onChange(colour.value)} className={`h-8 w-8 rounded-md border-2 ${value === colour.value ? 'border-brand-900 ring-2 ring-brand-300 dark:border-white' : 'border-white dark:border-brand-700'}`} style={{ backgroundColor: colour.value }} />)}
    </div>
  </div>;
}
