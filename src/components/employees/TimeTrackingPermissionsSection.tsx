type Props = {
  adjustClockInTime: boolean;
  editShiftWorkAreas: boolean;
  onAdjustClockInTimeChange: (value: boolean) => void;
  onEditShiftWorkAreasChange: (value: boolean) => void;
};

export default function TimeTrackingPermissionsSection({
  adjustClockInTime,
  editShiftWorkAreas,
  onAdjustClockInTimeChange,
  onEditShiftWorkAreasChange,
}: Props) {
  return (
    <section className="space-y-3 border-t border-gray-200 pt-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Time Tracking Permissions</h3>
        <p className="mt-1 text-xs text-gray-500">Controls employee-specific mobile time capabilities.</p>
      </div>
      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-gray-200 p-3">
        <span>
          <span className="block text-sm font-medium text-gray-800">Allow clock-in time adjustment</span>
          <span className="mt-1 block text-xs text-gray-500">Allows this employee to choose an earlier start time when clocking in from the mobile app.</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Allow clock-in time adjustment"
          checked={adjustClockInTime}
          onChange={(event) => onAdjustClockInTimeChange(event.target.checked)}
          className="relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-gray-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform checked:bg-brand-600 checked:after:translate-x-4 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        />
      </label>
      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-gray-200 p-3">
        <span>
          <span className="block text-sm font-medium text-gray-800">Allow shift/work-area editing</span>
          <span className="mt-1 block text-xs text-gray-500">Allows this employee to adjust how their current shift was divided between Work Areas before clocking out.</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Allow shift/work-area editing"
          checked={editShiftWorkAreas}
          onChange={(event) => onEditShiftWorkAreasChange(event.target.checked)}
          className="relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-gray-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform checked:bg-brand-600 checked:after:translate-x-4 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        />
      </label>
    </section>
  );
}