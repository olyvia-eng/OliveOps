import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import DetailWorkspace from "../../components/detail-workspace/DetailWorkspace";
import DetailWorkspaceTabs from "../../components/detail-workspace/DetailWorkspaceTabs";
import {
  closeDetailWorkspace,
  openDetailWorkspace,
  readDetailWorkspaceQuery,
  setDetailWorkspaceMode,
  setDetailWorkspaceTab,
} from "../../components/detail-workspace/detailWorkspaceQuery";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
} from "../../components/ui";
import { useStore } from "../../store";
import type { LabourClass } from "../../types";
import { formatCurrency } from "../../utils";
import {
  buildLabourClassCatalog,
  type LabourClassCatalogRow,
} from "./labourClassPricingModel.js";
import {
  buildLabourClassSetupDraft,
  shouldOfferLabourClassSetup,
  type LabourClassSetupDraft,
} from "./labourClassSetupModel.js";

const WORKSPACE_QUERY = {
  recordParam: "labourClass",
  tabParam: "labourClassTab",
  defaultTab: "overview",
} as const;
type LabourTab = "overview" | "employees";
const DETAIL_TABS = [
  { key: "overview" as const, label: "Overview" },
  { key: "employees" as const, label: "Employees" },
];

function rate(value: number | null) {
  return value === null ? "Not calculated" : `${formatCurrency(value)}/hr`;
}

function LabourClassDetail({
  row,
  tab,
  expanded,
  onTabChange,
  onEdit,
  onArchive,
  onClose,
  onModeChange,
}: {
  row: LabourClassCatalogRow;
  tab: LabourTab;
  expanded: boolean;
  onTabChange: (tab: LabourTab) => void;
  onEdit: () => void;
  onArchive: () => void;
  onClose: () => void;
  onModeChange: () => void;
}) {
  return (
    <div className="min-h-full bg-white dark:bg-brand-700">
      <div className="flex items-start justify-between gap-3 border-b border-brand-100 p-5 dark:border-brand-600">
        <div>
          <div className="flex items-center gap-2">
            <Users size={18} className="text-brand-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">
              {row.name}
            </h2>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-brand-200">
            Reusable labour pricing resource
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            title={expanded ? "Show panel" : "Expand"}
            onClick={onModeChange}
            className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-brand-600"
          >
            {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-brand-600"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      <DetailWorkspaceTabs
        tabs={DETAIL_TABS}
        activeTab={tab}
        onChange={onTabChange}
      />
      <div className="space-y-6 p-5">
        {tab === "overview" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge
                label={row.active ? "Active" : "Inactive"}
                className={
                  row.active
                    ? "bg-green-50 text-green-700"
                    : "bg-gray-100 text-gray-600"
                }
              />
              <Button size="sm" variant="secondary" onClick={onEdit}>
                <Pencil size={14} /> Edit
              </Button>
            </div>
            <section>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-brand-50">
                Description
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-brand-100">
                {row.description || "No description provided."}
              </p>
            </section>
            <section className="grid grid-cols-2 gap-4 border-y border-brand-100 py-4 dark:border-brand-600">
              <div>
                <p className="text-xs text-gray-500">Employees in class</p>
                <p className="mt-1 text-xl font-semibold">
                  {row.employeeCount}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Divisions represented</p>
                <p className="mt-1 text-xl font-semibold">
                  {row.divisionCount}
                </p>
              </div>
            </section>
            <section>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-brand-50">
                Used in
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-brand-100">
                {[
                  ...new Set(
                    row.pricing
                      .filter((item) => item.plannedBillableHours > 0)
                      .map((item) => item.divisionName),
                  ),
                ].join(", ") ||
                  "No Division has planned billable hours for this class."}
              </p>
            </section>
            {row.active ? (
              <Button variant="danger" onClick={onArchive}>
                Archive Labour Class
              </Button>
            ) : null}
          </>
        ) : null}
        {tab === "employees" ? (
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-brand-50">
              Assigned Employees
            </h3>
            {row.employees.length ? (
              <div className="mt-3 divide-y divide-gray-100 dark:divide-brand-600">
                {row.employees.map((employee) => (
                  <div
                    key={employee.id}
                    className="flex items-center justify-between gap-3 py-3 text-sm"
                  >
                    <div>
                      <p className="font-medium text-gray-900 dark:text-brand-50">
                        {employee.name}
                      </p>
                      <p className="text-gray-500">
                        {employee.role.replaceAll("_", " ")}
                      </p>
                    </div>
                    <Badge
                      label={employee.active ? "Active" : "Inactive"}
                      className={
                        employee.active
                          ? "bg-green-50 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500">
                No employees are assigned to this Labour Class.
              </p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

export default function LabourCatalogSection() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    labourClasses,
    employees,
    budgets,
    budgetDivisions,
    budgetDivisionPlanningItems,
    budgetRates,
    addLabourClass,
    updateLabourClass,
    archiveLabourClass,
    updateEmployee,
    applyLabourClassSetup,
  } = useStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LabourClass | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<1 | 2 | 3 | 4>(1);
  const [setupDraft, setSetupDraft] = useState<LabourClassSetupDraft>({ classes: [], assignments: {} });
  const [setupError, setSetupError] = useState("");
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const setupLaunchHandled = useRef(false);
  const workspace = readDetailWorkspaceQuery(searchParams, WORKSPACE_QUERY);
  const rows = useMemo(
    () =>
      buildLabourClassCatalog({
        labourClasses,
        employees,
        budgets,
        divisions: budgetDivisions,
        planningItems: budgetDivisionPlanningItems,
        budgetRates,
      }).sort((left, right) => left.name.localeCompare(right.name)),
    [
      budgetDivisionPlanningItems,
      budgetDivisions,
      budgetRates,
      budgets,
      employees,
      labourClasses,
    ],
  );
  const visibleRows = rows.filter(
    (row) =>
      (!query.trim() ||
        row.name.toLowerCase().includes(query.trim().toLowerCase())) &&
      (status === "all" || (status === "active" ? row.active : !row.active)),
  );
  const activeLabourClassIds = new Set(labourClasses.filter((labourClass) => labourClass.active).map((labourClass) => labourClass.id));
  const unassignedEmployees = employees
    .filter((employee) => employee.active && (!employee.labourClassId || !activeLabourClassIds.has(employee.labourClassId)))
    .sort((left, right) => left.name.localeCompare(right.name));
  const setupNeeded = shouldOfferLabourClassSetup({
    employees,
    labourClasses,
    planningItems: budgetDivisionPlanningItems,
  });
  const suggestedClassFor = (role: string) => {
    const roleWords = role.replaceAll("_", " ").toLowerCase();
    return labourClasses.find((labourClass) => {
      const className = labourClass.name.toLowerCase();
      return labourClass.active && (className === roleWords || roleWords.includes(className) || className.includes(roleWords));
    });
  };
  const selected = rows.find((row) => row.id === workspace.recordId) ?? null;
  const activeTab = DETAIL_TABS.some((item) => item.key === workspace.tab)
    ? (workspace.tab as LabourTab)
    : "overview";
  const openForm = (labourClass?: LabourClass) => {
    setEditing(labourClass ?? null);
    setName(labourClass?.name ?? "");
    setDescription(labourClass?.description ?? "");
    setError("");
    setModalOpen(true);
  };
  const save = async () => {
    if (!name.trim()) {
      setError("Labour Class name is required.");
      return;
    }
    setSaving(true);
    const result = editing
      ? await updateLabourClass(editing.id, {
          name: name.trim(),
          description: description.trim(),
        })
      : await addLabourClass({ name, description });
    setSaving(false);
    if (result) setModalOpen(false);
  };
  const openSetup = () => {
    setSetupDraft(buildLabourClassSetupDraft({ employees, labourClasses }));
    setSetupStep(1);
    setSetupError("");
    setSetupOpen(true);
  };
  useEffect(() => {
    if (searchParams.get("setup") !== "1" || setupLaunchHandled.current) return;
    setupLaunchHandled.current = true;
    setSetupDraft(buildLabourClassSetupDraft({ employees, labourClasses }));
    setSetupStep(1);
    setSetupError("");
    setSetupOpen(true);
  }, [employees, labourClasses, searchParams]);
  const setupEmployees = unassignedEmployees;
  const setupGroups = [
    ...setupDraft.classes.map((labourClass) => ({ key: labourClass.key, name: labourClass.name })),
    { key: "", name: "Unassigned" },
  ].map((group) => ({
    ...group,
    employees: setupEmployees.filter((employee) => (setupDraft.assignments[employee.id] ?? "") === group.key),
  }));
  const addSetupClass = () => {
    const key = `new:${Date.now()}-${setupDraft.classes.length}`;
    setSetupDraft((current) => ({ ...current, classes: [...current.classes, { key, id: null, name: "New Labour Class" }] }));
  };
  const removeSetupClass = (key: string) => setSetupDraft((current) => ({
    classes: current.classes.filter((item) => item.key !== key),
    assignments: Object.fromEntries(Object.entries(current.assignments).map(([employeeId, classKey]) => [employeeId, classKey === key ? null : classKey])),
  }));
  const confirmSetup = async () => {
    const names = setupDraft.classes.map((item) => item.name.trim().replace(/\s+/g, " "));
    if (names.some((name) => !name)) return setSetupError("Every Labour Class needs a name.");
    if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length) return setSetupError("Labour Class names must be unique.");
    setSetupSaving(true);
    setSetupError("");
    const result = await applyLabourClassSetup({
      classes: setupDraft.classes.map((item, index) => ({ key: item.key, name: names[index] })),
      assignments: setupEmployees.map((employee) => ({ employeeId: employee.id, classKey: setupDraft.assignments[employee.id] ?? null })),
    });
    setSetupSaving(false);
    if (result.ok) setSetupStep(4);
    else setSetupError(result.error ?? "Labour Class setup could not be saved.");
  };
  const close = () =>
    setSearchParams(closeDetailWorkspace(searchParams, WORKSPACE_QUERY));
  const list = (
    <div className="space-y-4">
      {setupNeeded && !setupDismissed ? (
        <div className="flex flex-col gap-3 border border-amber-200 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between" role="status">
          <div>
            <p className="font-semibold">Set up Labour Classes for estimating</p>
            <p className="mt-1 text-sm">Review suggested classes for your field Employees. Nothing changes until you confirm.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" onClick={() => setSetupDismissed(true)}>Not now</Button>
            <Button onClick={openSetup}>Set Up Labour Classes</Button>
          </div>
        </div>
      ) : null}
      <Card className="overflow-hidden">
      <div className="border-b border-brand-100 p-4 dark:border-brand-600 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">
              Labour Catalog
            </h2>
            <p className="text-sm text-gray-500 dark:text-brand-200">
              {visibleRows.length} of {rows.length} Labour Classes
            </p>
          </div>
          <Button onClick={() => openForm()}>
            <Plus size={16} /> Add Labour Class
          </Button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_12rem]">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Labour Classes..."
              aria-label="Search Labour Classes"
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm dark:border-brand-500 dark:bg-brand-700"
            />
          </div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter Labour Classes by status"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-brand-500 dark:bg-brand-700"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All Statuses</option>
          </select>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="p-5">
          <EmptyState
            title="No Labour Classes yet"
            description="Create Labour Classes such as Labourer, Foreman, or Operator, then assign employees to calculate estimating rates."
            action={
              setupNeeded ? <Button onClick={openSetup}>Set Up Labour Classes</Button> : <Button onClick={() => openForm()}>Add Labour Class</Button>
            }
            secondaryAction={setupNeeded ? <Button variant="secondary" onClick={() => openForm()}>Add Manually</Button> : undefined}
          />
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="p-5">
          <EmptyState
            title="No Labour Classes match"
            description="Try a different search or status."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500 dark:border-brand-600 dark:bg-brand-600">
                <th className="px-4 py-3 font-medium">Labour Class</th>
                <th className="px-4 py-3 text-right font-medium">Employees</th>
                <th className="px-4 py-3 text-right font-medium">
                  Avg Labour Cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-brand-600">
              {visibleRows.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  onClick={() =>
                    setSearchParams(
                      openDetailWorkspace(
                        searchParams,
                        WORKSPACE_QUERY,
                        row.id,
                      ),
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ")
                      setSearchParams(
                        openDetailWorkspace(
                          searchParams,
                          WORKSPACE_QUERY,
                          row.id,
                        ),
                      );
                  }}
                  className={`cursor-pointer ${workspace.recordId === row.id ? "bg-brand-50 dark:bg-brand-600" : "hover:bg-gray-50 dark:hover:bg-brand-600/60"}`}
                >
                  <td className="px-4 py-3 font-semibold text-gray-900 dark:text-brand-50">
                    {row.name}
                  </td>
                  <td className="px-4 py-3 text-right">{row.employeeCount}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {rate(row.averageLabourCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && unassignedEmployees.length > 0 ? (
        <div className="border-t border-brand-100 p-5 dark:border-brand-600">
          <h3 className="font-semibold text-gray-900 dark:text-brand-50">
            Employees needing a Labour Class
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-brand-200">
            Assign existing Employees explicitly. Role-based suggestions are never saved automatically.
          </p>
          <div className="mt-3 divide-y divide-gray-100 dark:divide-brand-600">
            {unassignedEmployees.map((employee) => {
              const suggestion = suggestedClassFor(employee.role);
              return (
                <div key={employee.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-brand-50">{employee.name}</p>
                    <p className="text-xs text-gray-500">
                      {employee.role.replaceAll("_", " ")}
                      {suggestion ? ` · Suggested: ${suggestion.name}` : ""}
                    </p>
                  </div>
                  <select
                    aria-label={`Assign Labour Class to ${employee.name}`}
                    defaultValue=""
                    onChange={(event) => {
                      if (event.target.value) updateEmployee(employee.id, { labourClassId: event.target.value });
                    }}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-brand-500 dark:bg-brand-700"
                  >
                    <option value="">Select Labour Class</option>
                    {labourClasses.filter((labourClass) => labourClass.active).map((labourClass) => (
                      <option key={labourClass.id} value={labourClass.id}>{labourClass.name}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      </Card>
    </div>
  );
  const detail = selected ? (
    <LabourClassDetail
      row={selected}
      tab={activeTab}
      expanded={workspace.mode === "expanded"}
      onTabChange={(tab) =>
        setSearchParams(
          setDetailWorkspaceTab(searchParams, WORKSPACE_QUERY, tab),
        )
      }
      onEdit={() => openForm(selected)}
      onArchive={() => void archiveLabourClass(selected.id)}
      onClose={close}
      onModeChange={() =>
        setSearchParams(
          setDetailWorkspaceMode(
            searchParams,
            WORKSPACE_QUERY,
            workspace.mode === "expanded" ? "panel" : "expanded",
          ),
        )
      }
    />
  ) : (
    <div className="p-6">
      <p className="text-sm text-gray-500">Labour Class not found.</p>
      <Button className="mt-4" variant="secondary" onClick={close}>
        Close
      </Button>
    </div>
  );
  return (
    <>
      <DetailWorkspace
        open={Boolean(workspace.recordId)}
        expanded={workspace.mode === "expanded"}
        detailKey={workspace.recordId}
        list={list}
        detail={detail}
      />
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit Labour Class" : "Add Labour Class"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Labour Class"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Crew Lead"
          />
          <label className="block text-sm font-medium text-gray-700">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-sm"
            />
          </label>
          {error ? <p className="text-sm text-accent-700">{error}</p> : null}
        </div>
      </Modal>
      <Modal
        open={setupOpen}
        onClose={() => { if (!setupSaving) setSetupOpen(false); }}
        title={setupStep === 4 ? "Labour Classes are ready" : `Set Up Labour Classes · Step ${setupStep} of 3`}
        size="large"
        footer={setupStep === 4 ? undefined : (
          <>
            <Button variant="secondary" onClick={() => setupStep === 1 ? setSetupOpen(false) : setSetupStep((setupStep - 1) as 1 | 2)} disabled={setupSaving}>
              {setupStep === 1 ? "Not now" : "Back"}
            </Button>
            {setupStep < 3 ? (
              <Button onClick={() => setSetupStep((setupStep + 1) as 2 | 3)}>Continue <ArrowRight size={15} /></Button>
            ) : (
              <Button onClick={() => void confirmSetup()} disabled={setupSaving}>{setupSaving ? "Saving..." : "Confirm Setup"}</Button>
            )}
          </>
        )}
      >
        {setupStep === 1 ? (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-brand-50">Turn your team into reusable estimating rates</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600 dark:text-brand-200">Labour Classes group Employees who perform similar work. OliveOps uses their current costs and Budget hours to calculate rates for Estimates.</p>
            </div>
            <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
              {[
                ["Employees", "Current compensation and planned hours"],
                ["Labour Classes", "Reusable groups such as Labourer or Foreman"],
                ["Estimates", "Calculated rates by Division"],
              ].map(([title, description], index) => (
                <div key={title} className="contents">
                  <div className="border border-brand-100 bg-brand-50 p-4 dark:border-brand-600 dark:bg-brand-800">
                    <p className="font-semibold">{title}</p><p className="mt-1 text-xs text-gray-500 dark:text-brand-200">{description}</p>
                  </div>
                  {index < 2 ? <ArrowRight className="mx-auto text-brand-500" size={20} /> : null}
                </div>
              ))}
            </div>
            <p className="text-sm font-medium text-gray-700 dark:text-brand-100">Employee roles, OliveOps permissions, compensation, Budget plans, and existing Estimates will not change.</p>
          </div>
        ) : null}
        {setupStep === 2 ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-semibold text-gray-900 dark:text-brand-50">Review suggested classes</h3><p className="mt-1 text-sm text-gray-500">Rename, add, remove, or leave any Employee unassigned. Suggestions have not been saved.</p></div>
              <Button variant="secondary" onClick={addSetupClass}><Plus size={15} /> Add Class</Button>
            </div>
            {setupGroups.map((group) => (
              <section key={group.key || "unassigned"} className="border-t border-brand-100 pt-4 dark:border-brand-600">
                <div className="flex items-center gap-2">
                  {group.key ? (
                    <input
                      aria-label="Labour Class name"
                      value={group.name}
                      onChange={(event) => setSetupDraft((current) => ({ ...current, classes: current.classes.map((item) => item.key === group.key ? { ...item, name: event.target.value } : item) }))}
                      className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 font-semibold dark:border-brand-500 dark:bg-brand-700"
                    />
                  ) : <h4 className="flex-1 font-semibold">Unassigned</h4>}
                  {group.key ? <button type="button" title={`Remove ${group.name}`} onClick={() => removeSetupClass(group.key)} className="rounded p-2 text-gray-500 hover:bg-gray-100"><Trash2 size={16} /></button> : null}
                </div>
                {group.employees.length ? <div className="mt-2 divide-y divide-gray-100 dark:divide-brand-600">{group.employees.map((employee) => (
                  <div key={employee.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div><p className="text-sm font-medium">{employee.name}</p><p className="text-xs capitalize text-gray-500">{employee.role.replaceAll("_", " ")}</p></div>
                    <select aria-label={`Labour Class for ${employee.name}`} value={setupDraft.assignments[employee.id] ?? ""} onChange={(event) => setSetupDraft((current) => ({ ...current, assignments: { ...current.assignments, [employee.id]: event.target.value || null } }))} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-brand-500 dark:bg-brand-700">
                      <option value="">Unassigned</option>
                      {setupDraft.classes.map((item) => <option key={item.key} value={item.key}>{item.name || "Unnamed class"}</option>)}
                    </select>
                  </div>
                ))}</div> : <p className="mt-2 text-sm text-gray-400">No Employees in this class.</p>}
              </section>
            ))}
            <p className="border-t border-brand-100 pt-4 text-sm text-gray-600 dark:border-brand-600 dark:text-brand-200">Labour Class controls estimating and pricing only. It does not change an Employee's OliveOps permissions.</p>
          </div>
        ) : null}
        {setupStep === 3 ? (
          <div className="space-y-5">
            <div><h3 className="font-semibold text-gray-900 dark:text-brand-50">Review and confirm</h3><p className="mt-1 text-sm text-gray-500">These changes are saved together when you confirm.</p></div>
            {setupGroups.filter((group) => group.employees.length > 0).map((group) => (
              <section key={group.key || "unassigned-summary"} className="border-t border-brand-100 pt-4 dark:border-brand-600">
                <div className="flex items-center justify-between gap-3"><h4 className="font-semibold">{group.name}</h4><span className="text-sm text-gray-500">{group.employees.length} {group.employees.length === 1 ? "Employee" : "Employees"}</span></div>
                <p className="mt-2 text-sm text-gray-600 dark:text-brand-200">{group.employees.map((employee) => employee.name).join(", ")}</p>
              </section>
            ))}
            {setupError ? <p className="text-sm text-red-600">{setupError}</p> : null}
          </div>
        ) : null}
        {setupStep === 4 ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto text-green-600" size={42} />
            <h3 className="mt-4 text-xl font-semibold">Your Labour Catalog is ready</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500">Assigned Employees now contribute to Labour Class pricing. Existing Budget plans and Estimates were preserved.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={() => { setSetupOpen(false); setSetupDismissed(true); }}>View Labour Catalog</Button>
              {searchParams.get("returnTo")?.startsWith("/") ? <Button onClick={() => navigate(searchParams.get("returnTo")!)}>View Pricing</Button> : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
