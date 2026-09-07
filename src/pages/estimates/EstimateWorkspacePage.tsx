import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, ExternalLink, FileDown, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useStore } from '../../store';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, TextArea } from '../../components/ui';
import { emitAppToast } from '../../toast';
import { formatCurrency, formatDate, formatDateTime, statusColor } from '../../utils';
import {
  computeWorkAreaCategoryCostTotals,
  computeWorkAreaCategorySellTotals,
  computeWorkAreaEstimatedCost,
  computeEstimateSubtotal,
  computeEstimateTax,
  computeEstimateTotal,
  computeWorkAreaSubtotal,
  createNewEstimateWorkArea,
  flattenWorkAreaLineItems,
  normalizeEstimateWorkAreas,
} from '../../utils/estimateModel';
import { formatNumericDisplayValue, parseNumericInputValue } from '../../utils/numberInput';
import { createEstimateProposalDocument, fetchEstimateProposal, proposalPdfFileName } from '../../utils/estimateProposalPdf';
import { calculateProposalPaymentSchedule } from '../../utils/proposalPaymentSchedule.js';
import type {
  Address,
  Estimate,
  EstimateStatus,
  EstimateWorkArea,
  LineItemCategory,
  ProposalPaymentStage,
} from '../../types';

type EstimateTab = 'info' | 'work-areas' | 'proposal' | 'analysis';

interface Props {
  currentUserRole: string;
}

type EstimateFormState = Omit<Estimate, 'id' | 'createdAt' | 'updatedAt' | 'lineItems' | 'workAreas'> & {
  workAreas: EstimateWorkArea[];
};

type ProposalVersionSummary = {
  id: string;
  versionNumber: number;
  status: 'sent' | 'viewed' | 'accepted';
  sentAt: string;
  firstViewedAt?: string;
  acceptedAt?: string;
  acceptedBy?: string;
  signedPdfFileId?: string;
};

const STATUSES: EstimateStatus[] = ['draft', 'sent', 'accepted', 'declined', 'converted'];
const CATEGORY_ORDER: LineItemCategory[] = ['labour', 'equipment', 'material', 'subcontractor'];
const CATEGORY_LABEL: Record<LineItemCategory, string> = {
  labour: 'Labour',
  equipment: 'Equipment',
  material: 'Materials',
  subcontractor: 'Subcontractors',
};

const defaultValidUntil = () => {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
};

const formatPropertyAddress = (property: Address): string => {
  const parts = [
    property.street,
    property.city,
    property.province,
    property.postalCode,
    property.country,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  return parts.join(', ');
};

const normalizeProperties = (properties?: Address[], legacyAddress?: Address): Address[] => {
  if (Array.isArray(properties) && properties.length > 0) {
    return properties;
  }
  if (legacyAddress) {
    return [legacyAddress];
  }
  return [];
};

const loadFormState = (estimate: Estimate): EstimateFormState => ({
  customerId: estimate.customerId,
  pricingBudgetId: estimate.pricingBudgetId,
  divisionId: estimate.divisionId ?? normalizeEstimateWorkAreas(estimate).find((area) => area.divisionId)?.divisionId,
  propertyLabel: estimate.propertyLabel ?? '',
  propertyAddressSnapshot: estimate.propertyAddressSnapshot ?? '',
  proposalNumber: estimate.proposalNumber ?? '',
  title: estimate.title,
  description: estimate.description,
  workAreas: normalizeEstimateWorkAreas(estimate),
  status: estimate.status,
  taxRate: estimate.taxRate,
  notes: estimate.notes,
  exclusions: estimate.exclusions ?? '',
  proposalTerms: estimate.proposalTerms ?? '',
  paymentSchedule: (estimate.paymentSchedule ?? []).slice().sort((left, right) => left.sortOrder - right.sortOrder),
  validUntil: estimate.validUntil ? estimate.validUntil.slice(0, 10) : defaultValidUntil(),
  convertedToJobId: estimate.convertedToJobId,
  convertedAt: estimate.convertedAt,
  sentAt: estimate.sentAt,
  templateId: estimate.templateId,
});

const serializeEstimateForm = (form: EstimateFormState) => JSON.stringify(form);

const validateEstimateForm = (form: EstimateFormState) => (
  form.title.trim() && form.customerId && form.pricingBudgetId && form.validUntil
    ? null
    : 'Title, customer, pricing budget, and valid-until date are required.'
);

export default function EstimateWorkspacePage({ currentUserRole }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    estimates,
    customers,
    budgets,
    updateEstimate,
    deleteEstimate,
    convertEstimateToJob,
  } = useStore();

  const estimate = estimates.find((item) => item.id === id);
  const customer = customers.find((item) => item.id === estimate?.customerId);
  const canViewAnalysis = currentUserRole === 'owner' || currentUserRole === 'admin';

  const [form, setForm] = useState<EstimateFormState | null>(estimate ? loadFormState(estimate) : null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [convertingEstimateId, setConvertingEstimateId] = useState<string | null>(null);
  const [savingEstimate, setSavingEstimate] = useState(false);
  const [sendingProposal, setSendingProposal] = useState(false);
  const [proposalVersions, setProposalVersions] = useState<ProposalVersionSummary[]>([]);
  const [latestProposalUrl, setLatestProposalUrl] = useState('');
  const saveInFlight = useRef(false);
  const hydratedEstimateId = useRef(id);
  const persistedFormBaseline = useRef<EstimateFormState | null>(estimate ? loadFormState(estimate) : null);
  const [convertForm, setConvertForm] = useState({
    title: '',
    startDate: '',
    endDate: '',
  });

  const activeTab = (searchParams.get('tab') ?? 'info') as EstimateTab;
  const persistedEstimateUpdatedAt = estimate?.updatedAt;

  useEffect(() => {
    const persistedEstimate = useStore.getState().estimates.find((item) => item.id === id);
    if (!persistedEstimate) {
      persistedFormBaseline.current = null;
      setForm(null);
      return;
    }
    const nextPersistedForm = loadFormState(persistedEstimate);
    setForm((current) => {
      const estimateChanged = hydratedEstimateId.current !== id;
      const hasLocalChanges = Boolean(
        current
        && persistedFormBaseline.current
        && serializeEstimateForm(current) !== serializeEstimateForm(persistedFormBaseline.current),
      );
      if (!estimateChanged && hasLocalChanges) return current;
      hydratedEstimateId.current = id;
      persistedFormBaseline.current = nextPersistedForm;
      return nextPersistedForm;
    });
  }, [id, persistedEstimateUpdatedAt]);

  useEffect(() => {
    const validTabs: EstimateTab[] = ['info', 'work-areas', 'proposal', 'analysis'];
    const isAllowed = canViewAnalysis || activeTab !== 'analysis';
    if (!validTabs.includes(activeTab) || !isAllowed) {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('tab', 'info');
        return next;
      });
    }
  }, [activeTab, canViewAnalysis, setSearchParams]);

  useEffect(() => {
    if (activeTab !== 'proposal' || !estimate) return;
    void fetch(`/api/proposal-delivery?estimateId=${encodeURIComponent(estimate.id)}`, { credentials: 'include' }).then(async (response) => {
      const payload = await response.json();
      if (response.ok && payload.ok && Array.isArray(payload.versions)) setProposalVersions(payload.versions);
    });
  }, [activeTab, estimate]);

  const setField = (key: keyof EstimateFormState, value: unknown) => {
    setForm((current) => {
      if (!current) return current;
      return { ...current, [key]: value };
    });
  };

  const persistEstimateForm = async (nextForm: EstimateFormState) => {
    if (!estimate) return null;

    const normalizedWorkAreas = nextForm.workAreas.map((area, index) => ({
      ...area,
      name: area.name.trim() || `Work Area ${index + 1}`,
      sortOrder: index,
    }));

    const payload: Omit<Estimate, 'id' | 'createdAt' | 'updatedAt'> = {
      ...nextForm,
      proposalNumber: nextForm.proposalNumber?.trim() || '',
      title: nextForm.title.trim(),
      description: nextForm.description ?? '',
      workAreas: normalizedWorkAreas,
      lineItems: flattenWorkAreaLineItems(normalizedWorkAreas),
      notes: nextForm.notes ?? '',
      validUntil: nextForm.validUntil,
    };

    return updateEstimate(estimate.id, payload);
  };

  const saveIfDirty = async ({ force = false, showSuccess = false } = {}) => {
    if (!estimate || !form || saveInFlight.current) return false;
    const isDirty = !persistedFormBaseline.current
      || serializeEstimateForm(form) !== serializeEstimateForm(persistedFormBaseline.current);
    if (!force && !isDirty) return true;

    const validationError = validateEstimateForm(form);
    if (validationError) {
      emitAppToast({ tone: 'error', message: validationError });
      return false;
    }

    saveInFlight.current = true;
    setSavingEstimate(true);
    try {
      const saved = await persistEstimateForm(form);
      if (!saved) return false;
      const savedForm = loadFormState(saved);
      persistedFormBaseline.current = savedForm;
      setForm(savedForm);
      if (showSuccess) emitAppToast({ tone: 'success', message: 'Estimate saved.' });
      return true;
    } finally {
      saveInFlight.current = false;
      setSavingEstimate(false);
    }
  };

  const setTab = async (tab: EstimateTab) => {
    if (tab === activeTab || (tab === 'analysis' && !canViewAnalysis) || saveInFlight.current) return;
    const saved = await saveIfDirty();
    if (!saved) return;
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('tab', tab);
      return next;
    });
  };

  const addWorkArea = async () => {
    if (!estimate || !form || savingEstimate || saveInFlight.current) return;

    saveInFlight.current = true;
    setSavingEstimate(true);
    const nextWorkArea = createNewEstimateWorkArea(form.workAreas, estimate.divisionId);
    const nextForm: EstimateFormState = {
      ...form,
      workAreas: [
        ...form.workAreas,
        nextWorkArea,
      ],
    };

    setForm(nextForm);
    let saved: Estimate | null = null;
    try {
      saved = await persistEstimateForm(nextForm);
    } finally {
      saveInFlight.current = false;
      setSavingEstimate(false);
    }

    if (saved) {
      navigate(`/estimates/${estimate.id}/work-areas/${nextWorkArea.id}`);
    }
  };

  const save = async () => {
    await saveIfDirty({ force: true, showSuccess: true });
  };

  const createProposalPdf = async (estimateId: string) => {
    try {
      const proposal = await fetchEstimateProposal(estimateId);
      const fileName = proposalPdfFileName(proposal);
      createEstimateProposalDocument(proposal).save(fileName);
      emitAppToast({ tone: 'success', message: `Proposal PDF generated: ${fileName}` });
    } catch (error) {
      emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Proposal could not be generated.' });
    }
  };

  const sendProposalToClient = async (item: Estimate) => {
    const paymentCalculation = calculateProposalPaymentSchedule(item.paymentSchedule, analysis.total);
    if (!paymentCalculation.valid) {
      emitAppToast({ tone: 'error', message: paymentCalculation.errors[0] ?? 'Complete the Payment Schedule before sending.' });
      return false;
    }
    const proposalCustomer = customers.find((value) => value.id === item.customerId);
    if (!proposalCustomer?.email?.trim()) {
      emitAppToast({ tone: 'error', message: 'Customer email is missing. Add an email before sending.' });
      return false;
    }
    const saved = await saveIfDirty({ force: true });
    if (!saved) return false;
    setSendingProposal(true);
    try {
      const response = await fetch(`/api/proposal-delivery?action=send&estimateId=${encodeURIComponent(item.id)}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estimateId: item.id, email: proposalCustomer.email }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Proposal could not be sent.');
      setLatestProposalUrl(payload.viewUrl ?? '');
      const versionResponse = await fetch(`/api/proposal-delivery?estimateId=${encodeURIComponent(item.id)}`, { credentials: 'include' });
      const versionPayload = await versionResponse.json();
      if (versionResponse.ok && versionPayload.ok) setProposalVersions(versionPayload.versions ?? []);
      setForm((current) => current ? { ...current, status: 'sent', sentAt: payload.version.sentAt } : current);
      emitAppToast({ tone: payload.emailSent ? 'success' : 'error', message: payload.emailSent ? 'Proposal sent securely.' : 'Proposal version created, but email delivery is not configured. Use the secure link.' });
      return true;
    } catch (error) {
      emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Proposal could not be sent.' });
      return false;
    } finally {
      setSendingProposal(false);
    }
  };

  const openConvertModal = () => {
    if (!estimate) return;
    setConfirmConvert(true);
    setConvertForm({
      title: estimate.title ?? '',
      startDate: '',
      endDate: '',
    });
  };

  const handleConvertEstimate = async () => {
    if (!estimate) return;
    setConvertingEstimateId(estimate.id);
    const result = await convertEstimateToJob(estimate.id, {
      title: convertForm.title.trim() || undefined,
      startDate: convertForm.startDate || undefined,
      endDate: convertForm.endDate || undefined,
    });
    setConvertingEstimateId(null);

    if (!result.ok) {
      emitAppToast({
        tone: 'error',
        message: result.error ?? 'Estimate could not be converted to a job.',
      });
      return;
    }

    setConfirmConvert(false);
    setConvertForm({ title: '', startDate: '', endDate: '' });
    emitAppToast({ tone: 'success', message: 'Estimate converted to job successfully.' });
    if (result.jobId) {
      navigate(`/jobs/${result.jobId}`);
    }
  };

  const analysis = useMemo(() => {
    if (!form) {
      return {
        subtotal: 0,
        tax: 0,
        total: 0,
        estimatedCost: 0,
        grossProfit: 0,
        grossMargin: 0,
        itemCount: 0,
        byCategory: {
          labour: 0,
          material: 0,
          equipment: 0,
          subcontractor: 0,
        },
        costByCategory: {
          labour: 0,
          material: 0,
          equipment: 0,
          subcontractor: 0,
        },
      };
    }

    const subtotal = computeEstimateSubtotal(form.workAreas);
    const tax = computeEstimateTax(subtotal, form.taxRate);
    const total = computeEstimateTotal(subtotal, tax);
    const items = flattenWorkAreaLineItems(form.workAreas);
    const estimatedCost = form.workAreas.reduce((sum, workArea) => sum + computeWorkAreaEstimatedCost(workArea), 0);
    const grossProfit = subtotal - estimatedCost;
    const grossMargin = subtotal > 0 ? (grossProfit / subtotal) * 100 : 0;

    const byCategory = items.reduce(
      (acc, item) => {
        acc[item.category] += item.total;
        return acc;
      },
      {
        labour: 0,
        material: 0,
        equipment: 0,
        subcontractor: 0,
      }
    );
    const costByCategory = form.workAreas.reduce((totals, workArea) => {
      const workAreaCosts = computeWorkAreaCategoryCostTotals(workArea);
      totals.labour += workAreaCosts.labour;
      totals.material += workAreaCosts.material;
      totals.equipment += workAreaCosts.equipment;
      totals.subcontractor += workAreaCosts.subcontractor;
      return totals;
    }, { labour: 0, material: 0, equipment: 0, subcontractor: 0 });

    return {
      subtotal,
      tax,
      total,
      estimatedCost,
      grossProfit,
      grossMargin,
      itemCount: items.length,
      byCategory,
      costByCategory,
    };
  }, [form]);
  const paymentCalculation = useMemo(() => calculateProposalPaymentSchedule(form?.paymentSchedule, analysis.total), [analysis.total, form?.paymentSchedule]);
  const latestProposalVersion = proposalVersions[0];

  const updatePayment = (paymentId: string, changes: Partial<ProposalPaymentStage>) => {
    setForm((current) => current ? {
      ...current,
      paymentSchedule: (current.paymentSchedule ?? []).map((payment) => payment.id === paymentId ? { ...payment, ...changes } : payment),
    } : current);
  };

  const addPayment = () => {
    setForm((current) => {
      if (!current) return current;
      const payments = current.paymentSchedule ?? [];
      return {
        ...current,
        paymentSchedule: [...payments, {
          id: crypto.randomUUID(),
          label: '',
          type: 'percentage',
          percentage: 0,
          due: '',
          sortOrder: payments.length,
        }],
      };
    });
  };

  const removePayment = (paymentId: string) => {
    setForm((current) => current ? {
      ...current,
      paymentSchedule: (current.paymentSchedule ?? []).filter((payment) => payment.id !== paymentId).map((payment, index) => ({ ...payment, sortOrder: index })),
    } : current);
  };

  const movePayment = (paymentId: string, direction: -1 | 1) => {
    setForm((current) => {
      if (!current) return current;
      const payments = [...(current.paymentSchedule ?? [])];
      const index = payments.findIndex((payment) => payment.id === paymentId);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= payments.length) return current;
      [payments[index], payments[destination]] = [payments[destination], payments[index]];
      return { ...current, paymentSchedule: payments.map((payment, sortOrder) => ({ ...payment, sortOrder })) };
    });
  };

  if (!estimate || !form) {
    return (
      <div className="space-y-4">
        <Button variant="secondary" onClick={() => navigate('/estimates')}>
          <ArrowLeft size={15} /> Back to Estimates
        </Button>
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900">Estimate not found</h2>
          <p className="mt-2 text-sm text-gray-500">This estimate may have been deleted or is still syncing.</p>
        </Card>
      </div>
    );
  }

  const isConverted = form.status === 'converted';

  const hasWorkAreas = form.workAreas.length > 0;
  const hasPricedWorkAreas = analysis.itemCount > 0 && analysis.subtotal > 0;

  const tabs: Array<{ key: EstimateTab; label: string; visible: boolean }> = [
    { key: 'info', label: 'Info', visible: true },
    { key: 'work-areas', label: 'Work Areas', visible: true },
    { key: 'proposal', label: 'Proposal', visible: true },
    { key: 'analysis', label: 'Analysis', visible: canViewAnalysis },
  ];

  return (
    <div>
      <PageHeader
        title={form.title}
        subtitle={`Workspace for ${customer?.name ?? 'Unknown Customer'}`}
        action={(
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/estimates')}>
              <ArrowLeft size={15} /> Back
            </Button>
            {!isConverted ? <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} /> Delete
            </Button> : null}
            {!isConverted ? <Button onClick={() => void save()} disabled={savingEstimate}>
              {savingEstimate ? 'Saving...' : 'Save Changes'}
            </Button> : null}
          </div>
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Badge label={form.status} className={statusColor[form.status]} />
        {form.proposalNumber ? <Badge label={form.proposalNumber} className="bg-gray-100 text-gray-700" /> : null}
        {form.convertedToJobId ? (
          <Link to={`/jobs/${form.convertedToJobId}`} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 font-medium text-brand-700 hover:bg-brand-100">
            Open Job <ChevronRight size={12} />
          </Link>
        ) : null}
        {form.sentAt ? <span className="text-gray-500">Sent {formatDateTime(form.sentAt)}</span> : null}
      </div>

      {isConverted ? <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800"><strong>Converted Estimate</strong><span className="ml-2">This sold commercial record is read-only. Operational changes belong on the linked Job.</span></div> : null}

      <div className="mb-6 overflow-x-auto">
        <div className="inline-flex border border-gray-200 rounded-xl p-1 bg-white min-w-max" role="tablist" aria-label="Estimate workspace sections">
          {tabs.filter((tab) => tab.visible).map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => void setTab(tab.key)}
              disabled={savingEstimate}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'info' && (
        <fieldset disabled={isConverted} className="space-y-4">
          <Card className="p-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Customer"
                value={form.customerId}
                onChange={(event) => {
                  const customerId = event.target.value;
                  const selected = customers.find((item) => item.id === customerId);
                  const properties = normalizeProperties(selected?.properties, selected?.address);
                  const first = properties[0];

                  setForm((current) => {
                    if (!current) return current;
                    return {
                      ...current,
                      customerId,
                      propertyLabel: first?.nickname?.trim() || '',
                      propertyAddressSnapshot: first ? formatPropertyAddress(first) : '',
                    };
                  });
                }}
              >
                <option value="">Select customer</option>
                {customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.company ? ` (${item.company})` : ''}
                  </option>
                ))}
              </Select>
              <Select
                label="Pricing Budget"
                value={form.pricingBudgetId}
                onChange={(event) => setField('pricingBudgetId', event.target.value)}
              >
                <option value="">Select budget</option>
                {budgets.map((budget) => (
                  <option key={budget.id} value={budget.id}>{budget.name}</option>
                ))}
              </Select>
            </div>
            <p className="text-xs text-gray-500">Pricing budgets supply your standard labour, equipment, material, and subcontractor rates.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Proposal Number" value={form.proposalNumber ?? ''} onChange={(event) => setField('proposalNumber', event.target.value)} />
              <Input label="Valid Until" type="date" value={form.validUntil ? form.validUntil.slice(0, 10) : ''} onChange={(event) => setField('validUntil', event.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Property Label" value={form.propertyLabel ?? ''} onChange={(event) => setField('propertyLabel', event.target.value)} />
              <Input label="Property Address Snapshot" value={form.propertyAddressSnapshot ?? ''} onChange={(event) => setField('propertyAddressSnapshot', event.target.value)} />
            </div>
            <Input label="Title" required value={form.title} onChange={(event) => setField('title', event.target.value)} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Status" value={form.status} onChange={(event) => setField('status', event.target.value as EstimateStatus)}>
                {STATUSES.map((status) => <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>)}
              </Select>
            </div>
            <TextArea label="Notes" value={form.notes} onChange={(event) => setField('notes', event.target.value)} />
          </Card>
        </fieldset>
      )}

      {activeTab === 'work-areas' && (
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Work Areas</h2>
              {!isConverted ? <Button variant="secondary" size="sm" onClick={() => void addWorkArea()} disabled={savingEstimate}>
                <Plus size={14} /> {savingEstimate ? 'Saving...' : 'Add Work Area'}
              </Button> : null}
            </div>
            <p className="text-xs text-gray-500">Use Work Areas to break an estimate into sections of the project.</p>

            {form.workAreas.length === 0 ? (
              <EmptyState
                title="No work areas yet"
                description="Break the project into sections of work such as Excavation, Backfilling, or Interlock Patio."
                action={!isConverted ? <Button variant="secondary" size="sm" onClick={() => void addWorkArea()} disabled={savingEstimate}><Plus size={14} /> Add Work Area</Button> : undefined}
              />
            ) : (
              <div className="space-y-3">
                {form.workAreas
                  .slice()
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((workArea) => {
                    const estimatedCost = computeWorkAreaEstimatedCost(workArea);
                    const sellPrice = computeWorkAreaSubtotal(workArea);
                    const categoryTotals = computeWorkAreaCategorySellTotals(workArea);
                    const lineItemCount = workArea.lineItems.length;

                    return (
                      <button
                        key={workArea.id}
                        type="button"
                        onClick={() => navigate(`/estimates/${estimate.id}/work-areas/${workArea.id}`)}
                        className="w-full rounded-xl border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-800 p-4 text-left transition-colors hover:bg-brand-50/60 dark:hover:bg-brand-700"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-base font-semibold text-gray-900 dark:text-brand-50">{workArea.name}</h3>
                            {workArea.description?.trim() ? (
                              <p className="mt-1 text-sm text-gray-600 dark:text-brand-200">{workArea.description}</p>
                            ) : null}
                            <p className="mt-3 text-xs text-gray-500 dark:text-brand-300">{lineItemCount} line item{lineItemCount === 1 ? '' : 's'}</p>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:min-w-[260px]">
                            <div>
                              <p className="text-xs text-gray-500 dark:text-brand-300">Estimated Cost</p>
                              <p className="text-base font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(estimatedCost)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 dark:text-brand-300">Sell Price</p>
                              <p className="text-base font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(sellPrice)}</p>
                            </div>
                          </div>
                        </div>

                        <p className="mt-4 text-xs font-medium text-gray-500 dark:text-brand-300">Sell Price by Category</p>
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                          <p className="text-gray-700 dark:text-brand-100">Labour <span className="ml-2 font-semibold">{formatCurrency(categoryTotals.labour)}</span></p>
                          <p className="text-gray-700 dark:text-brand-100">Equipment <span className="ml-2 font-semibold">{formatCurrency(categoryTotals.equipment)}</span></p>
                          <p className="text-gray-700 dark:text-brand-100">Materials <span className="ml-2 font-semibold">{formatCurrency(categoryTotals.material)}</span></p>
                          <p className="text-gray-700 dark:text-brand-100">Subcontractors <span className="ml-2 font-semibold">{formatCurrency(categoryTotals.subcontractor)}</span></p>
                        </div>

                        <div className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 dark:text-brand-300">
                          Open Work Area <ChevronRight size={14} />
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}
          </Card>

          {hasWorkAreas ? (
            <Card className="p-4 text-sm space-y-2">
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(analysis.subtotal)}</span></div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-gray-500">Tax Rate (%)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  value={formatNumericDisplayValue(form.taxRate)}
                  onChange={(event) => setField('taxRate', parseNumericInputValue(event.target.value))}
                  onFocus={(event) => event.currentTarget.select()}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-right text-sm"
                />
              </div>
              <div className="flex justify-between"><span className="text-gray-500">Tax</span><span>{formatCurrency(analysis.tax)}</span></div>
              <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2 mt-2"><span>Total</span><span>{formatCurrency(analysis.total)}</span></div>
            </Card>
          ) : null}
        </div>
      )}

      {activeTab === 'proposal' && (
        !hasPricedWorkAreas ? (
          <Card className="p-4">
            <EmptyState
              title="Your proposal isn't ready yet"
              description="Add Work Areas and pricing before preparing the customer proposal."
              action={<Button variant="secondary" onClick={() => setTab('work-areas')}>Go to Work Areas</Button>}
            />
          </Card>
        ) : (
          <div className="space-y-4">
          <Card className="p-4 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Proposal</h2>
            <p className="text-sm text-gray-600">Preview the customer document, then send an immutable version for secure review and electronic acceptance.</p>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1 text-sm text-gray-700">
              <p><span className="font-medium text-gray-900">Proposal #:</span> {form.proposalNumber?.trim() || 'Not set'}</p>
              <p><span className="font-medium text-gray-900">Estimate:</span> {form.title}</p>
              <p><span className="font-medium text-gray-900">Customer:</span> {customer?.name ?? 'Unknown Customer'}</p>
              <p><span className="font-medium text-gray-900">Valid Until:</span> {form.validUntil ? formatDate(form.validUntil) : 'Not specified'}</p>
              <p><span className="font-medium text-gray-900">Total:</span> {formatCurrency(analysis.total)}</p>
            </div>
            {latestProposalVersion ? <div className="grid gap-3 border-y border-gray-200 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-xs font-semibold uppercase text-gray-500">Status</p><p className="mt-1 font-semibold capitalize text-gray-900">{latestProposalVersion.status}</p></div><div><p className="text-xs font-semibold uppercase text-gray-500">Sent</p><p className="mt-1 text-gray-900">{formatDateTime(latestProposalVersion.sentAt)}</p></div><div><p className="text-xs font-semibold uppercase text-gray-500">Viewed</p><p className="mt-1 text-gray-900">{latestProposalVersion.firstViewedAt ? formatDateTime(latestProposalVersion.firstViewedAt) : 'Not yet'}</p></div><div><p className="text-xs font-semibold uppercase text-gray-500">Accepted</p><p className="mt-1 text-gray-900">{latestProposalVersion.acceptedAt ? `${formatDateTime(latestProposalVersion.acceptedAt)}${latestProposalVersion.acceptedBy ? ` by ${latestProposalVersion.acceptedBy}` : ''}` : 'Not yet'}</p></div></div> : null}
            <div>
              <TextArea label="Introduction (optional)" rows={4} value={form.description} onChange={(event) => setField('description', event.target.value)} />
              <p className="mt-1.5 text-xs text-gray-500">Use separate lines for paragraphs. This appears before Work Areas in the proposal.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <TextArea label="Proposal-specific Terms and Conditions" rows={5} value={form.proposalTerms ?? ''} onChange={(event) => setField('proposalTerms', event.target.value)} />
              <TextArea label="Customer-facing Exclusions" rows={5} value={form.exclusions ?? ''} onChange={(event) => setField('exclusions', event.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void createProposalPdf(estimate.id)}>
                <FileDown size={14} /> Download PDF
              </Button>
              <Button disabled={!paymentCalculation.valid || sendingProposal} onClick={() => void sendProposalToClient({ ...estimate, ...form, lineItems: flattenWorkAreaLineItems(form.workAreas) })}>
                <Send size={14} /> {sendingProposal ? 'Sending...' : latestProposalVersion ? 'Send New Version' : 'Send to Customer'}
              </Button>
              {latestProposalUrl ? <a href={latestProposalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700"><ExternalLink size={14} /> Open secure Proposal</a> : null}
              {latestProposalVersion?.status === 'accepted' && latestProposalVersion.signedPdfFileId ? <a href={`/api/proposal-delivery?action=artifact&estimateId=${encodeURIComponent(estimate.id)}&versionNumber=${latestProposalVersion.versionNumber}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700"><FileDown size={14} /> View Accepted Proposal</a> : null}
              {form.status === 'accepted' && !form.convertedToJobId ? (
                <Button onClick={openConvertModal}>
                  <RefreshCw size={14} /> Convert to Job
                </Button>
              ) : null}
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-lg font-semibold text-gray-900">Payment Schedule</h2><p className="text-sm text-gray-600">Define how the customer will pay the Proposal total.</p></div>
              <Button variant="secondary" onClick={addPayment}><Plus size={14} /> Add Payment</Button>
            </div>
            <div className="mt-4 space-y-3">
              {(form.paymentSchedule ?? []).map((payment, index) => {
                const calculated = paymentCalculation.stages.find((stage) => stage.id === payment.id);
                return (
                  <div key={payment.id} className="grid gap-3 rounded-lg border border-gray-200 p-3 lg:grid-cols-[1.1fr_0.8fr_0.7fr_1.5fr_auto] lg:items-end">
                    <Input label="Payment name" value={payment.label} onChange={(event) => updatePayment(payment.id, { label: event.target.value })} />
                    <Select label="Amount type" value={payment.type} onChange={(event) => updatePayment(payment.id, { type: event.target.value as ProposalPaymentStage['type'], percentage: event.target.value === 'percentage' ? payment.percentage ?? 0 : undefined, amount: event.target.value === 'fixed' ? payment.amount ?? 0 : undefined })}><option value="percentage">Percentage</option><option value="fixed">Fixed Amount</option></Select>
                    <Input label={payment.type === 'percentage' ? 'Percentage' : 'Amount'} type="number" min="0" step={payment.type === 'percentage' ? '0.01' : '0.01'} value={payment.type === 'percentage' ? payment.percentage ?? 0 : payment.amount ?? 0} onChange={(event) => updatePayment(payment.id, payment.type === 'percentage' ? { percentage: Number(event.target.value) } : { amount: Number(event.target.value) })} />
                    <div><Input label="Due" value={payment.due} onChange={(event) => updatePayment(payment.id, { due: event.target.value })} /><p className="mt-1 text-xs text-gray-500">{payment.type === 'percentage' ? `${payment.percentage ?? 0}% (${formatCurrency(calculated?.calculatedAmount ?? 0)})` : formatCurrency(calculated?.calculatedAmount ?? 0)}</p></div>
                    <div className="flex gap-1">
                      <Button variant="secondary" aria-label={`Move ${payment.label || `payment ${index + 1}`} up`} disabled={index === 0} onClick={() => movePayment(payment.id, -1)}><ArrowUp size={14} /></Button>
                      <Button variant="secondary" aria-label={`Move ${payment.label || `payment ${index + 1}`} down`} disabled={index === (form.paymentSchedule?.length ?? 0) - 1} onClick={() => movePayment(payment.id, 1)}><ArrowDown size={14} /></Button>
                      <Button variant="danger" aria-label={`Delete ${payment.label || `payment ${index + 1}`}`} onClick={() => removePayment(payment.id)}><Trash2 size={14} /></Button>
                    </div>
                  </div>
                );
              })}
              {(form.paymentSchedule ?? []).length === 0 ? <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">No payment structure has been added.</p> : null}
            </div>
            <div className="mt-4 ml-auto max-w-sm space-y-2 border-t border-gray-200 pt-4 text-sm">
              <div className="flex justify-between"><span className="text-gray-600">Proposal Total</span><span className="font-medium">{formatCurrency(paymentCalculation.proposalTotal)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Scheduled Payments</span><span className="font-medium">{formatCurrency(paymentCalculation.scheduledTotal)}</span></div>
              <div className={`flex justify-between font-semibold ${paymentCalculation.valid ? 'text-emerald-700' : 'text-rose-700'}`}><span>Remaining</span><span>{formatCurrency(paymentCalculation.remaining)}</span></div>
              {!paymentCalculation.valid ? <p className="text-xs text-rose-700">{paymentCalculation.errors[0]}</p> : null}
            </div>
          </Card>
          </div>
        )
      )}

      {activeTab === 'analysis' && canViewAnalysis && (
        !hasPricedWorkAreas ? (
          <Card className="p-4">
            <EmptyState
              title="Nothing to analyze yet"
              description="Add estimated costs and pricing to see revenue, cost, and margin analysis."
              action={<Button variant="secondary" onClick={() => setTab('work-areas')}>Go to Work Areas</Button>}
            />
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="p-4">
                <p className="text-xs text-gray-500">Revenue</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(analysis.subtotal)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500">Estimated Cost</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(analysis.estimatedCost)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500">Gross Profit</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(analysis.grossProfit)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500">Gross Margin</p>
                <p className="text-xl font-bold text-gray-900">{analysis.grossMargin.toFixed(1)}%</p>
              </Card>
            </div>

            <Card className="p-4">
              <h3 className="font-semibold text-gray-900">Category Breakdown</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead><tr className="border-b border-gray-200 text-left text-gray-500"><th className="py-2 font-medium">Category</th><th className="py-2 text-right font-medium">Revenue</th><th className="py-2 text-right font-medium">Cost</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {CATEGORY_ORDER.map((category) => <tr key={category}><td className="py-2 text-gray-700">{CATEGORY_LABEL[category]}</td><td className="py-2 text-right font-semibold text-gray-900">{formatCurrency(analysis.byCategory[category])}</td><td className="py-2 text-right text-gray-700">{formatCurrency(analysis.costByCategory[category])}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold text-gray-900">Work Area Breakdown</h3>
              <div className="mt-3 space-y-2 text-sm">
                {form.workAreas
                  .slice()
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((workArea) => (
                    <div key={workArea.id} className="flex items-center justify-between rounded border border-gray-200 p-2">
                      <span className="text-gray-700">{workArea.name}</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(computeWorkAreaSubtotal(workArea))}</span>
                    </div>
                  ))}
              </div>
            </Card>
          </div>
        )
      )}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete Estimate"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                deleteEstimate(estimate.id);
                setConfirmDelete(false);
                navigate('/estimates');
              }}
            >
              Delete
            </Button>
          </>
        )}
      >
        <p className="text-sm text-gray-600">Delete this estimate? This cannot be undone.</p>
      </Modal>

      <Modal
        open={confirmConvert}
        onClose={() => setConfirmConvert(false)}
        title="Convert to Job"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmConvert(false)}>Cancel</Button>
            <Button onClick={() => void handleConvertEstimate()}>
              {convertingEstimateId ? 'Converting...' : 'Convert'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-gray-600">Create a job from this accepted estimate. Leave any field blank to use defaults.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Job Title Override"
              value={convertForm.title}
              onChange={(event) => setConvertForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Leave blank to use the estimate title"
            />
            <Input
              label="Start Date Override"
              type="date"
              value={convertForm.startDate}
              onChange={(event) => setConvertForm((current) => ({ ...current, startDate: event.target.value }))}
            />
          </div>
          <Input
            label="End Date Override"
            type="date"
            value={convertForm.endDate}
            onChange={(event) => setConvertForm((current) => ({ ...current, endDate: event.target.value }))}
          />
        </div>
      </Modal>
    </div>
  );
}
