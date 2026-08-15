import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CalendarColourBy, CalendarView, Crew, Division, Employee, EquipmentAsset, Job } from '../../types';
import type { ScheduleColour } from '../../config/scheduleColours.js';
import { GOOGLE_SCHEDULE_COLOUR, OUTLOOK_SCHEDULE_COLOUR } from '../../config/scheduleColours.js';
import { Button, Select } from '../ui';

export function CalendarToolbar({ title, view, onNavigate, onViewChange }: {
  title: string;
  view: CalendarView;
  onNavigate: (action: 'today' | 'prev' | 'next') => void;
  onViewChange: (view: CalendarView) => void;
}) {
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onNavigate('today')}>Today</Button>
        <Button variant="secondary" size="sm" onClick={() => onNavigate('prev')} aria-label="Previous date range"><ChevronLeft /></Button>
        <h2 className="inline-flex min-w-44 items-center gap-2 px-2 text-base font-semibold text-brand-900 dark:text-brand-50">
          <CalendarDays size={18} className="text-brand-600 dark:text-brand-200" />
          {title}
        </h2>
        <Button variant="secondary" size="sm" onClick={() => onNavigate('next')} aria-label="Next date range"><ChevronRight /></Button>
      </div>
      <div className="inline-flex w-fit rounded-xl border border-brand-100 bg-brand-50 p-1 dark:border-brand-600 dark:bg-brand-800" aria-label="Calendar view">
        {(['month', 'week', 'day'] as CalendarView[]).map((option) => (
          <button key={option} type="button" onClick={() => onViewChange(option)} className={`h-8 min-w-16 rounded-lg px-3 text-sm font-semibold capitalize transition-colors ${view === option ? 'bg-white text-brand-900 shadow-sm dark:bg-brand-600 dark:text-brand-50' : 'text-brand-500 hover:text-brand-900 dark:text-brand-200 dark:hover:text-brand-50'}`}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CalendarFilters({ divisions, crews, employees, jobs, equipment, divisionId, crewId, employeeId, status, jobId, equipmentId, showGoogleEvents, showOutlookEvents, onDivisionChange, onCrewChange, onEmployeeChange, onStatusChange, onJobChange, onEquipmentChange, onGoogleChange, onOutlookChange }: {
  divisions: Array<Pick<Division, 'id' | 'name'>>;
  crews: Crew[];
  employees: Employee[];
  jobs: Job[];
  equipment: EquipmentAsset[];
  divisionId: string;
  crewId: string;
  employeeId: string;
  status: string;
  jobId: string;
  equipmentId: string;
  showGoogleEvents?: boolean;
  showOutlookEvents?: boolean;
  onDivisionChange: (value: string) => void;
  onCrewChange: (value: string) => void;
  onEmployeeChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onJobChange: (value: string) => void;
  onEquipmentChange: (value: string) => void;
  onGoogleChange?: (value: boolean) => void;
  onOutlookChange?: (value: boolean) => void;
}) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <Select value={divisionId} onChange={(event) => onDivisionChange(event.target.value)} aria-label="Filter by division">
        <option value="all">All divisions</option>
        {divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
      </Select>
      <Select value={crewId} onChange={(event) => onCrewChange(event.target.value)} aria-label="Filter by crew">
        <option value="all">All crews</option>
        {crews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
      </Select>
      <Select value={employeeId} onChange={(event) => onEmployeeChange(event.target.value)} aria-label="Filter by employee">
        <option value="all">All employees</option>
        {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
      </Select>
      <Select value={status} onChange={(event) => onStatusChange(event.target.value)} aria-label="Filter by status">
        <option value="all">All statuses</option>
        <option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="on_hold">On hold</option><option value="completed">Completed</option>
      </Select>
      <Select value={jobId} onChange={(event) => onJobChange(event.target.value)} aria-label="Filter by job">
        <option value="all">All jobs</option>
        {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
      </Select>
      <Select value={equipmentId} onChange={(event) => onEquipmentChange(event.target.value)} aria-label="Filter by equipment">
        <option value="all">All equipment</option>
        {equipment.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
      </Select>
      {onGoogleChange ? <label className="flex h-10 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl border border-brand-100 bg-white px-3 text-sm font-medium text-brand-700 shadow-sm dark:border-brand-600 dark:bg-brand-700 dark:text-brand-100">
        <input type="checkbox" checked={showGoogleEvents} onChange={(event) => onGoogleChange(event.target.checked)} className="h-4 w-4 accent-accent-500" />
        Google
      </label> : null}
      {onOutlookChange ? <label className="flex h-10 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl border border-brand-100 bg-white px-3 text-sm font-medium text-brand-700 shadow-sm dark:border-brand-600 dark:bg-brand-700 dark:text-brand-100">
        <input type="checkbox" checked={showOutlookEvents} onChange={(event) => onOutlookChange(event.target.checked)} className="h-4 w-4 accent-accent-500" />
        Outlook
      </label> : null}
    </div>
  );
}

export function ColourBySelector({ value, onChange }: { value: CalendarColourBy; onChange: (value: CalendarColourBy) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs text-brand-500 dark:text-brand-200">
      <span className="font-semibold uppercase tracking-[0.08em]">Colour by</span>
      <div className="inline-flex rounded-lg border border-brand-100 p-0.5 dark:border-brand-600">
        {(['crew', 'division', 'status'] as CalendarColourBy[]).map((option) => (
          <button key={option} type="button" onClick={() => onChange(option)} className={`h-7 rounded-md px-2.5 font-semibold capitalize ${value === option ? 'bg-brand-100 text-brand-900 dark:bg-brand-600 dark:text-brand-50' : 'hover:text-brand-900 dark:hover:text-brand-50'}`}>{option}</button>
        ))}
      </div>
    </div>
  );
}

export function CalendarLegend({ items, showGoogleEvents = false, showOutlookEvents = false }: { items: Array<{ id: string; label: string; colour: ScheduleColour }>; showGoogleEvents?: boolean; showOutlookEvents?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Calendar colour legend">
      {items.map((item) => <span key={item.id} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-100"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.colour.value }} />{item.label}</span>)}
      {showGoogleEvents ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-100"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: GOOGLE_SCHEDULE_COLOUR.value }} />Google</span> : null}
      {showOutlookEvents ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-100"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: OUTLOOK_SCHEDULE_COLOUR.value }} />Outlook</span> : null}
    </div>
  );
}

export function ScheduleEventCard({ title, summary, detail, colour, compact, selected = false, source = 'oliveops' }: {
  title: string;
  summary: string;
  detail: string;
  colour: ScheduleColour;
  compact: boolean;
  selected?: boolean;
  source?: 'oliveops' | 'google' | 'microsoft';
}) {
  return (
    <div className={`min-w-0 overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left ${selected ? 'ring-2 ring-brand-400' : ''}`} style={{ backgroundColor: colour.tint, borderColor: colour.value, color: colour.value }}>
      <p className="truncate text-xs font-semibold">{title}</p>
      {!compact ? <p className="truncate text-[11px] opacity-90">{summary}</p> : null}
      <p className="truncate text-[10px] opacity-80">{source === 'google' ? 'Google Calendar' : source === 'microsoft' ? 'Outlook Calendar' : detail}</p>
    </div>
  );
}