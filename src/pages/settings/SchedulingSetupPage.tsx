import { useState } from 'react';
import { Pencil, Plus, Users } from 'lucide-react';
import { Button, Card, Input, Modal, PageHeader, Select } from '../../components/ui';
import { SCHEDULE_COLOUR_PALETTE } from '../../config/scheduleColours.js';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import { generateId } from '../../utils';

const defaultColour = SCHEDULE_COLOUR_PALETTE[0].value;

function ColourPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-gray-700 dark:text-brand-200">Colour</p>
      <div className="flex flex-wrap gap-2">
        {SCHEDULE_COLOUR_PALETTE.map((colour) => (
          <button key={colour.id} type="button" title={colour.id} aria-label={`Use ${colour.id}`} onClick={() => onChange(colour.value)} className={`h-8 w-8 rounded-lg border-2 ${value === colour.value ? 'border-brand-900 ring-2 ring-brand-300 dark:border-white' : 'border-white dark:border-brand-700'}`} style={{ backgroundColor: colour.value }} />
        ))}
      </div>
    </div>
  );
}

export default function SchedulingSetupPage() {
  const { crews, divisions, employees, saveCrew, saveDivision } = useStore();
  const [divisionId, setDivisionId] = useState<string | null>(null);
  const [divisionName, setDivisionName] = useState('');
  const [divisionColour, setDivisionColour] = useState(defaultColour);
  const [divisionOrder, setDivisionOrder] = useState('0');
  const [divisionActive, setDivisionActive] = useState(true);
  const [crewId, setCrewId] = useState<string | null>(null);
  const [crewName, setCrewName] = useState('');
  const [crewColour, setCrewColour] = useState(defaultColour);
  const [crewLeadId, setCrewLeadId] = useState('');
  const [crewDivisionId, setCrewDivisionId] = useState('');
  const [crewMemberIds, setCrewMemberIds] = useState<string[]>([]);
  const [crewActive, setCrewActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const sortedDivisions = divisions.slice().sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
  const sortedCrews = crews.slice().sort((left, right) => left.name.localeCompare(right.name));
  const employeeName = (id?: string) => employees.find((employee) => employee.id === id)?.name ?? 'None';
  const divisionLabel = (id?: string) => divisions.find((division) => division.id === id)?.name ?? 'None';

  const resetDivision = () => {
    setDivisionId(null);
    setDivisionName('');
    setDivisionColour(defaultColour);
    setDivisionOrder('0');
    setDivisionActive(true);
  };

  const editDivision = (id: string) => {
    const division = divisions.find((item) => item.id === id);
    if (!division) return;
    setDivisionId(division.id);
    setDivisionName(division.name);
    setDivisionColour(division.colour);
    setDivisionOrder(String(division.sortOrder));
    setDivisionActive(division.active);
  };

  const submitDivision = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!divisionName.trim()) return emitAppToast({ tone: 'error', message: 'Division name is required.' });
    setSaving(true);
    const result = await saveDivision({ id: divisionId ?? generateId(), name: divisionName.trim(), colour: divisionColour, sortOrder: Math.max(0, Number(divisionOrder) || 0), active: divisionActive });
    setSaving(false);
    if (!result.ok) return emitAppToast({ tone: 'error', message: result.error ?? 'Division could not be saved.' });
    emitAppToast({ tone: 'success', message: divisionId ? 'Division updated.' : 'Division created.' });
    resetDivision();
  };

  const resetCrew = () => {
    setCrewId(null);
    setCrewName('');
    setCrewColour(defaultColour);
    setCrewLeadId('');
    setCrewDivisionId('');
    setCrewMemberIds([]);
    setCrewActive(true);
  };

  const editCrew = (id: string) => {
    const crew = crews.find((item) => item.id === id);
    if (!crew) return;
    setCrewId(crew.id);
    setCrewName(crew.name);
    setCrewColour(crew.colour);
    setCrewLeadId(crew.leadEmployeeId ?? '');
    setCrewDivisionId(crew.defaultDivisionId ?? '');
    setCrewMemberIds(crew.memberIds);
    setCrewActive(crew.active);
  };

  const submitCrew = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!crewName.trim()) return emitAppToast({ tone: 'error', message: 'Crew name is required.' });
    setSaving(true);
    const result = await saveCrew({ id: crewId ?? generateId(), name: crewName.trim(), colour: crewColour, leadEmployeeId: crewLeadId || undefined, defaultDivisionId: crewDivisionId || undefined, memberIds: crewMemberIds, active: crewActive });
    setSaving(false);
    if (!result.ok) return emitAppToast({ tone: 'error', message: result.error ?? 'Crew could not be saved.' });
    emitAppToast({ tone: 'success', message: crewId ? 'Crew updated.' : 'Crew created.' });
    resetCrew();
  };

  const divisionFields = (
    <>
      <Input label="Name" required maxLength={80} value={divisionName} onChange={(event) => setDivisionName(event.target.value)} />
      <Input label="Sort order" type="number" min={0} value={divisionOrder} onChange={(event) => setDivisionOrder(event.target.value)} />
      <ColourPicker value={divisionColour} onChange={setDivisionColour} />
      <label className="flex items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-100"><input type="checkbox" checked={divisionActive} onChange={(event) => setDivisionActive(event.target.checked)} /> Active</label>
    </>
  );

  const crewFields = (
    <>
      <Input label="Name" required maxLength={80} value={crewName} onChange={(event) => setCrewName(event.target.value)} />
      <Select label="Crew lead" value={crewLeadId} onChange={(event) => setCrewLeadId(event.target.value)}><option value="">No crew lead</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</Select>
      <Select label="Default division" value={crewDivisionId} onChange={(event) => setCrewDivisionId(event.target.value)}><option value="">No default division</option>{sortedDivisions.filter((division) => division.active).map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</Select>
      <ColourPicker value={crewColour} onChange={setCrewColour} />
      <div><p className="mb-2 text-sm font-medium text-gray-700 dark:text-brand-200">Members</p><div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-brand-100 p-2 dark:border-brand-600">{employees.length === 0 ? <p className="p-1 text-sm text-brand-500">No employees available.</p> : employees.map((employee) => <label key={employee.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-brand-700 hover:bg-brand-50 dark:text-brand-100 dark:hover:bg-brand-600"><input type="checkbox" checked={crewMemberIds.includes(employee.id)} onChange={() => setCrewMemberIds((current) => current.includes(employee.id) ? current.filter((id) => id !== employee.id) : [...current, employee.id])} />{employee.name}</label>)}</div></div>
      <label className="flex items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-100"><input type="checkbox" checked={crewActive} onChange={(event) => setCrewActive(event.target.checked)} /> Active</label>
    </>
  );

  return (
    <div>
      <PageHeader title="Scheduling Setup" subtitle="Define the divisions and primary crews used to organize company work." />

      <section className="mb-8">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50">Divisions</h2>
          <p className="text-sm text-brand-500 dark:text-brand-200">Group jobs by the part of the business responsible for the work.</p>
        </div>
        <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <Card className="p-4">
            <form onSubmit={(event) => void submitDivision(event)} className="space-y-4">
              <h3 className="font-semibold text-brand-900 dark:text-brand-50">Add division</h3>
              {divisionFields}
              <Button type="submit" disabled={saving}>Create division</Button>
            </form>
          </Card>
          <Card className="overflow-hidden">
            {sortedDivisions.length === 0 ? <p className="p-5 text-sm text-brand-500">No divisions configured.</p> : sortedDivisions.map((division) => (
              <div key={division.id} className="flex items-center justify-between gap-4 border-b border-brand-100 p-4 last:border-0 dark:border-brand-600">
                <div className="flex min-w-0 items-center gap-3"><span className="h-4 w-4 shrink-0 rounded-sm" style={{ backgroundColor: division.colour }} /><div><p className="font-semibold text-brand-900 dark:text-brand-50">{division.name}</p><p className="text-xs text-brand-500 dark:text-brand-200">Order {division.sortOrder} · {division.active ? 'Active' : 'Inactive'}</p></div></div>
                <Button type="button" size="sm" variant="secondary" onClick={() => editDivision(division.id)}><Pencil /> Edit</Button>
              </div>
            ))}
          </Card>
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50">Crews</h2>
          <p className="text-sm text-brand-500 dark:text-brand-200">Set each job's primary team while keeping employee assignments flexible.</p>
        </div>
        <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <Card className="p-4">
            <form onSubmit={(event) => void submitCrew(event)} className="space-y-4">
              <h3 className="font-semibold text-brand-900 dark:text-brand-50">Add crew</h3>
              {crewFields}
              <Button type="submit" disabled={saving}><Plus /> Create crew</Button>
            </form>
          </Card>
          <Card className="overflow-hidden">
            {sortedCrews.length === 0 ? <p className="p-5 text-sm text-brand-500">No crews configured.</p> : sortedCrews.map((crew) => (
              <div key={crew.id} className="flex flex-col gap-3 border-b border-brand-100 p-4 last:border-0 dark:border-brand-600 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3"><span className="mt-1 h-4 w-4 shrink-0 rounded-sm" style={{ backgroundColor: crew.colour }} /><div><p className="font-semibold text-brand-900 dark:text-brand-50">{crew.name}</p><p className="mt-0.5 text-xs text-brand-500 dark:text-brand-200">Lead: {employeeName(crew.leadEmployeeId)} · Division: {divisionLabel(crew.defaultDivisionId)}</p><p className="mt-1 flex items-center gap-1 text-xs text-brand-500 dark:text-brand-200"><Users size={13} /> {crew.memberIds.length} members · {crew.active ? 'Active' : 'Inactive'}</p></div></div>
                <Button type="button" size="sm" variant="secondary" onClick={() => editCrew(crew.id)}><Pencil /> Edit</Button>
              </div>
            ))}
          </Card>
        </div>
      </section>

      <Modal
        open={divisionId !== null}
        onClose={() => { if (!saving) resetDivision(); }}
        title={`Edit Division${divisionName ? ` - ${divisionName}` : ''}`}
        footer={(
          <>
            <Button variant="secondary" onClick={resetDivision} disabled={saving}>Cancel</Button>
            <Button type="submit" form="edit-division-form" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
          </>
        )}
      >
        <form id="edit-division-form" onSubmit={(event) => void submitDivision(event)} className="space-y-4">
          {divisionFields}
        </form>
      </Modal>

      <Modal
        open={crewId !== null}
        onClose={() => { if (!saving) resetCrew(); }}
        title={`Edit Crew${crewName ? ` - ${crewName}` : ''}`}
        footer={(
          <>
            <Button variant="secondary" onClick={resetCrew} disabled={saving}>Cancel</Button>
            <Button type="submit" form="edit-crew-form" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
          </>
        )}
      >
        <form id="edit-crew-form" onSubmit={(event) => void submitCrew(event)} className="space-y-4">
          {crewFields}
        </form>
      </Modal>
    </div>
  );
}