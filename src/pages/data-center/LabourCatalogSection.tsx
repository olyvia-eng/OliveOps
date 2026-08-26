import { useMemo, useState } from "react";
import {
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
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

const WORKSPACE_QUERY = {
  recordParam: "labourClass",
  tabParam: "labourClassTab",
  defaultTab: "overview",
} as const;
type LabourTab = "overview" | "pricing" | "employees";
const DETAIL_TABS = [
  { key: "overview" as const, label: "Overview" },
  { key: "pricing" as const, label: "Pricing" },
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
  onSaveRate,
}: {
  row: LabourClassCatalogRow;
  tab: LabourTab;
  expanded: boolean;
  onTabChange: (tab: LabourTab) => void;
  onEdit: () => void;
  onArchive: () => void;
  onClose: () => void;
  onModeChange: () => void;
  onSaveRate: (divisionId: string, value: number | null) => Promise<void>;
}) {
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});
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
        {tab === "pricing" ? (
          <section className="space-y-5">
            {row.pricing.length ? (
              row.pricing.map((pricing) => {
                const draft =
                  rateDrafts[pricing.divisionId] ??
                  (pricing.customRate === null
                    ? ""
                    : String(pricing.customRate));
                return (
                  <div
                    key={`${pricing.budgetId}:${pricing.divisionId}`}
                    className="border-b border-brand-100 pb-5 last:border-0 dark:border-brand-600"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-brand-50">
                          {pricing.divisionName}
                        </h3>
                        <p className="text-xs text-gray-500">
                          {pricing.budgetName}
                        </p>
                      </div>
                      <Badge
                        label={
                          pricing.pricingAvailable
                            ? "Calculated"
                            : "Unavailable"
                        }
                        className={
                          pricing.pricingAvailable
                            ? "bg-green-50 text-green-700"
                            : "bg-amber-50 text-amber-700"
                        }
                      />
                    </div>
                    {pricing.pricingAvailable ? (
                      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div>
                          <dt className="text-gray-500">Weighted Labour Cost</dt>
                          <dd className="font-medium">
                            {rate(pricing.averageLabourCost)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Overhead Recovery</dt>
                          <dd className="font-medium">
                            {rate(pricing.overheadRecovery)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Breakeven</dt>
                          <dd className="font-medium">
                            {rate(pricing.breakeven)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Target Profit</dt>
                          <dd className="font-medium">
                            {pricing.targetMarginPct === null
                              ? "Not calculated"
                              : `${pricing.targetMarginPct.toFixed(2)}%`}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Profit</dt>
                          <dd className="font-medium">
                            {rate(pricing.profit)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Calculated Rate</dt>
                          <dd className="font-medium">
                            {rate(pricing.calculatedRate)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Estimate Rate</dt>
                          <dd className="font-semibold">
                            {rate(pricing.estimateRate)}
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="mt-3 text-sm text-gray-500">
                        {pricing.unavailableReason ||
                          "Pricing is not calculated."}
                      </p>
                    )}
                    <div className="mt-4 flex items-end gap-2">
                      <Input
                        label="Custom Rate"
                        type="number"
                        min={0}
                        step={0.01}
                        value={draft}
                        placeholder="Calculated rate"
                        onChange={(event) =>
                          setRateDrafts((current) => ({
                            ...current,
                            [pricing.divisionId]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void onSaveRate(
                            pricing.divisionId,
                            draft.trim() ? Number(draft) : null,
                          )
                        }
                      >
                        Save
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Overrides the calculated rate used when adding this Labour
                      Class to an Estimate.
                    </p>
                  </div>
                );
              })
            ) : (
              <EmptyState
                title="Pricing not calculated"
                description="Create an active Budget with Division labour plans to calculate class pricing."
              />
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

export default function LabourCatalogSection() {
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
  } = useStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LabourClass | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
  const unassignedEmployees = employees
    .filter((employee) => employee.active && !employee.labourClassId)
    .sort((left, right) => left.name.localeCompare(right.name));
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
  const close = () =>
    setSearchParams(closeDetailWorkspace(searchParams, WORKSPACE_QUERY));
  const list = (
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
              <Button onClick={() => openForm()}>Add Labour Class</Button>
            }
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
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500 dark:border-brand-600 dark:bg-brand-600">
                <th className="px-4 py-3 font-medium">Labour Class</th>
                <th className="px-4 py-3 text-right font-medium">Employees</th>
                <th className="px-4 py-3 text-right font-medium">
                  Weighted Labour Cost
                </th>
                <th className="px-4 py-3 font-medium">Divisions</th>
                <th className="px-4 py-3 font-medium">Status</th>
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
                  <td className="px-4 py-3">
                    {row.divisionCount === 0
                      ? "Not planned"
                      : row.divisionCount === 1
                        ? row.pricing.find(
                            (item) => item.plannedBillableHours > 0,
                          )?.divisionName
                        : `${row.divisionCount} divisions`}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      label={row.active ? "Active" : "Inactive"}
                      className={
                        row.active
                          ? "bg-green-50 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }
                    />
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
      onSaveRate={async (divisionId, value) => {
        await updateLabourClass(selected.id, {
          customRates: { ...(selected.customRates ?? {}), [divisionId]: value },
        });
      }}
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
    </>
  );
}
