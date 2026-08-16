import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, FileDown, Mail, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useStore } from '../../store';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, TextArea } from '../../components/ui';
import { emitAppToast } from '../../toast';
import { formatCurrency, formatDate, formatDateTime, statusColor } from '../../utils';
import {
  computeWorkAreaCategoryCostTotals,
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
import type {
  Address,
  Estimate,
  EstimateStatus,
  EstimateWorkArea,
} from '../../types';

type EstimateTab = 'info' | 'work-areas' | 'proposal' | 'project-management' | 'analysis';

interface Props {
  currentUserRole: string;
}

type EstimateFormState = Omit<Estimate, 'id' | 'createdAt' | 'updatedAt' | 'lineItems' | 'workAreas'> & {
  workAreas: EstimateWorkArea[];
};

const STATUSES: EstimateStatus[] = ['draft', 'sent', 'accepted', 'declined', 'converted'];

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

const sanitizeFileNamePart = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const createProposalDocument = (estimate: Estimate, customerName: string, customerCompany?: string) => {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const workAreas = normalizeEstimateWorkAreas(estimate);
  const lineItems = flattenWorkAreaLineItems(workAreas);
  const subtotal = computeEstimateSubtotal(workAreas);
  const tax = computeEstimateTax(subtotal, estimate.taxRate);
  const total = computeEstimateTotal(subtotal, tax);
  const generatedAt = new Date().toLocaleString();

  doc.setFontSize(18);
  doc.text('Project Proposal', 40, 44);
  doc.setFontSize(10);
  const hasProposalNumber = Boolean(estimate.proposalNumber?.trim());
  if (hasProposalNumber) {
    doc.text(`Proposal #: ${estimate.proposalNumber?.trim()}`, 40, 64);
  }
  const estimateY = hasProposalNumber ? 78 : 64;
  const customerY = hasProposalNumber ? 92 : 78;
  const generatedY = hasProposalNumber ? 106 : 92;
  const validUntilY = hasProposalNumber ? 120 : 106;
  doc.text(`Estimate: ${estimate.title}`, 40, estimateY);
  doc.text(`Customer: ${customerName}${customerCompany ? ` (${customerCompany})` : ''}`, 40, customerY);
  doc.text(`Generated: ${generatedAt}`, 40, generatedY);
  doc.text(`Valid Until: ${estimate.validUntil ? formatDate(estimate.validUntil) : 'Not specified'}`, 40, validUntilY);

  if (estimate.description?.trim()) {
    doc.setFontSize(11);
    doc.text('Scope', 40, 130);
    doc.setFontSize(10);
    const scopeLines = doc.splitTextToSize(estimate.description.trim(), 530);
    doc.text(scopeLines, 40, 146);
  }

  autoTable(doc, {
    startY: 176,
    head: [['Category', 'Description', 'Qty', 'Unit', 'Unit Cost', 'Markup', 'Line Total']],
    body: lineItems.map((line) => [
      line.category,
      line.description,
      String(line.quantity),
      line.unit,
      formatCurrency(line.unitCost),
      `${line.markupPercent ?? line.markup ?? 0}%`,
      formatCurrency(line.total),
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [97, 110, 86] },
  });

  const tableBottomY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 176;

  autoTable(doc, {
    startY: tableBottomY + 16,
    head: [['Summary', 'Amount']],
    body: [
      ['Subtotal', formatCurrency(subtotal)],
      [`Tax (${estimate.taxRate}%)`, formatCurrency(tax)],
      ['Total', formatCurrency(total)],
    ],
    styles: { fontSize: 10 },
    headStyles: { fillColor: [134, 143, 122] },
  });

  autoTable(doc, {
    startY: ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? tableBottomY) + 16,
    head: [['Work Area', 'Subtotal']],
    body: workAreas.map((area) => [area.name, formatCurrency(computeWorkAreaSubtotal(area))]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [180, 186, 169] },
  });

  if (estimate.notes?.trim()) {
    const notesStartY = ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? tableBottomY) + 20;
    doc.setFontSize(11);
    doc.text('Notes', 40, notesStartY);
    doc.setFontSize(10);
    const noteLines = doc.splitTextToSize(estimate.notes.trim(), 530);
    doc.text(noteLines, 40, notesStartY + 16);
  }

  return doc;
};

const loadFormState = (estimate: Estimate): EstimateFormState => ({
  customerId: estimate.customerId,
  pricingBudgetId: estimate.pricingBudgetId,
  propertyLabel: estimate.propertyLabel ?? '',
  propertyAddressSnapshot: estimate.propertyAddressSnapshot ?? '',
  proposalNumber: estimate.proposalNumber ?? '',
  title: estimate.title,
  description: estimate.description,
  workAreas: normalizeEstimateWorkAreas(estimate),
  status: estimate.status,
  taxRate: estimate.taxRate,
  notes: estimate.notes,
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
    sendEstimate,
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
    const validTabs: EstimateTab[] = ['info', 'work-areas', 'proposal', 'project-management', 'analysis'];
    const isAllowed = canViewAnalysis || activeTab !== 'analysis';
    if (!validTabs.includes(activeTab) || !isAllowed) {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('tab', 'info');
        return next;
      });
    }
  }, [activeTab, canViewAnalysis, setSearchParams]);

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
    const nextWorkArea = createNewEstimateWorkArea(form.workAreas);
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

  const createProposalPdf = (item: Estimate) => {
    const proposalCustomer = customers.find((value) => value.id === item.customerId);
    const customerName = proposalCustomer?.name?.trim() || 'Client';
    const safeTitle = sanitizeFileNamePart(item.title) || 'estimate';
    const safeProposalNumber = sanitizeFileNamePart(item.proposalNumber ?? '');
    const fileName = safeProposalNumber
      ? `proposal-${safeProposalNumber}-${safeTitle}.pdf`
      : `proposal-${safeTitle}-${item.id.slice(0, 8)}.pdf`;

    const doc = createProposalDocument(item, customerName, proposalCustomer?.company);
    doc.save(fileName);
    emitAppToast({ tone: 'success', message: `Proposal PDF generated: ${fileName}` });
  };

  const sendProposalToClient = (item: Estimate) => {
    const proposalCustomer = customers.find((value) => value.id === item.customerId);
    if (!proposalCustomer?.email?.trim()) {
      emitAppToast({ tone: 'error', message: 'Customer email is missing. Add an email before sending.' });
      return;
    }

    createProposalPdf(item);

    const estimateWorkAreas = normalizeEstimateWorkAreas(item);
    const subtotalValue = computeEstimateSubtotal(estimateWorkAreas);
    const totalValue = computeEstimateTotal(subtotalValue, computeEstimateTax(subtotalValue, item.taxRate));
    const proposalRef = item.proposalNumber?.trim();
    const subject = encodeURIComponent(proposalRef ? `Proposal ${proposalRef}: ${item.title}` : `Proposal: ${item.title}`);
    const body = encodeURIComponent(
      [
        `Hi ${proposalCustomer.name},`,
        '',
        `Please find attached our proposal for ${item.title}.`,
        proposalRef ? `Proposal reference: ${proposalRef}.` : '',
        `Total proposed amount: ${formatCurrency(totalValue)}.`,
        item.validUntil ? `This proposal is valid until ${formatDate(item.validUntil)}.` : 'This proposal does not have an expiry date listed.',
        '',
        'Thank you,',
      ].join('\n')
    );

    if (typeof window !== 'undefined') {
      window.location.href = `mailto:${encodeURIComponent(proposalCustomer.email)}?subject=${subject}&body=${body}`;
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
        itemCount: 0,
        byCategory: {
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

    return {
      subtotal,
      tax,
      total,
      itemCount: items.length,
      byCategory,
    };
  }, [form]);

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

  const hasWorkAreas = form.workAreas.length > 0;
  const hasPricedWorkAreas = analysis.itemCount > 0 && analysis.subtotal > 0;

  const tabs: Array<{ key: EstimateTab; label: string; visible: boolean }> = [
    { key: 'info', label: 'Info', visible: true },
    { key: 'work-areas', label: 'Work Areas', visible: true },
    { key: 'proposal', label: 'Proposal', visible: true },
    { key: 'project-management', label: 'Project Management', visible: true },
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
            <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} /> Delete
            </Button>
            <Button onClick={() => void save()} disabled={savingEstimate}>
              {savingEstimate ? 'Saving...' : 'Save Changes'}
            </Button>
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
        <div className="space-y-4">
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
            <TextArea label="Description" value={form.description} onChange={(event) => setField('description', event.target.value)} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Status" value={form.status} onChange={(event) => setField('status', event.target.value as EstimateStatus)}>
                {STATUSES.map((status) => <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>)}
              </Select>
            </div>
            <TextArea label="Notes" value={form.notes} onChange={(event) => setField('notes', event.target.value)} />
          </Card>
        </div>
      )}

      {activeTab === 'work-areas' && (
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Work Areas</h2>
              <Button variant="secondary" size="sm" onClick={() => void addWorkArea()} disabled={savingEstimate}>
                <Plus size={14} /> {savingEstimate ? 'Saving...' : 'Add Work Area'}
              </Button>
            </div>
            <p className="text-xs text-gray-500">Use Work Areas to break an estimate into sections of the project.</p>

            {form.workAreas.length === 0 ? (
              <EmptyState
                title="No work areas yet"
                description="Break the project into sections of work such as Excavation, Backfilling, or Interlock Patio."
                action={<Button variant="secondary" size="sm" onClick={() => void addWorkArea()} disabled={savingEstimate}><Plus size={14} /> Add Work Area</Button>}
              />
            ) : (
              <div className="space-y-3">
                {form.workAreas
                  .slice()
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((workArea) => {
                    const estimatedCost = computeWorkAreaEstimatedCost(workArea);
                    const sellPrice = computeWorkAreaSubtotal(workArea);
                    const categoryTotals = computeWorkAreaCategoryCostTotals(workArea);
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

                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                          {categoryTotals.labour > 0 ? <p className="text-gray-700 dark:text-brand-100">Labour <span className="ml-2 font-semibold">{formatCurrency(categoryTotals.labour)}</span></p> : null}
                          {categoryTotals.equipment > 0 ? <p className="text-gray-700 dark:text-brand-100">Equipment <span className="ml-2 font-semibold">{formatCurrency(categoryTotals.equipment)}</span></p> : null}
                          {categoryTotals.material > 0 ? <p className="text-gray-700 dark:text-brand-100">Materials <span className="ml-2 font-semibold">{formatCurrency(categoryTotals.material)}</span></p> : null}
                          {categoryTotals.subcontractor > 0 ? <p className="text-gray-700 dark:text-brand-100">Subcontractors <span className="ml-2 font-semibold">{formatCurrency(categoryTotals.subcontractor)}</span></p> : null}
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
          <Card className="p-4 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Proposal</h2>
            <p className="text-sm text-gray-600">Generate a client-ready proposal and open a draft in your mail client. OliveOps does not send proposal email directly yet.</p>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1 text-sm text-gray-700">
              <p><span className="font-medium text-gray-900">Proposal #:</span> {form.proposalNumber?.trim() || 'Not set'}</p>
              <p><span className="font-medium text-gray-900">Estimate:</span> {form.title}</p>
              <p><span className="font-medium text-gray-900">Customer:</span> {customer?.name ?? 'Unknown Customer'}</p>
              <p><span className="font-medium text-gray-900">Valid Until:</span> {form.validUntil ? formatDate(form.validUntil) : 'Not specified'}</p>
              <p><span className="font-medium text-gray-900">Total:</span> {formatCurrency(analysis.total)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => createProposalPdf({ ...estimate, ...form, lineItems: flattenWorkAreaLineItems(form.workAreas) })}>
                <FileDown size={14} /> Download PDF
              </Button>
              <Button onClick={() => sendProposalToClient({ ...estimate, ...form, lineItems: flattenWorkAreaLineItems(form.workAreas) })}>
                <Mail size={14} /> Open Email Draft
              </Button>
              {form.status === 'draft' ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    sendEstimate(estimate.id);
                    setForm({ ...form, status: 'sent', sentAt: new Date().toISOString() });
                  }}
                >
                  <Send size={14} /> Mark as Sent
                </Button>
              ) : null}
            </div>
          </Card>
        )
      )}

      {activeTab === 'project-management' && (
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-lg font-semibold text-gray-900">Project Management</h2>
            {!hasWorkAreas && !form.convertedToJobId && form.status !== 'accepted' ? (
              <EmptyState
                title="No project planning information yet"
                description="Add internal planning details as the estimate develops."
              />
            ) : (
              <>
                <p className="mt-1 text-sm text-gray-600">Estimates stay in sales/proposal mode until converted. Jobs remain separate operational records.</p>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
                  <p className="text-gray-600">Status: <span className="font-semibold text-gray-900 capitalize">{form.status}</span></p>
                  <p className="text-gray-600">Converted Job: <span className="font-semibold text-gray-900">{form.convertedToJobId ?? 'Not converted'}</span></p>
                  <p className="text-gray-600">Converted At: <span className="font-semibold text-gray-900">{form.convertedAt ? formatDateTime(form.convertedAt) : 'N/A'}</span></p>
                  <p className="text-gray-600">Work Areas: <span className="font-semibold text-gray-900">{form.workAreas.length}</span></p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {form.status === 'accepted' ? (
                    <Button onClick={openConvertModal}>
                      <RefreshCw size={14} /> Convert to Job
                    </Button>
                  ) : null}
                  {form.convertedToJobId ? (
                    <Link to={`/jobs/${form.convertedToJobId}`}>
                      <Button variant="secondary">
                        <ChevronRight size={14} /> Open Linked Job
                      </Button>
                    </Link>
                  ) : null}
                </div>
              </>
            )}
          </Card>
        </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <Card className="p-4">
                <p className="text-xs text-gray-500">Subtotal</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(analysis.subtotal)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500">Tax</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(analysis.tax)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(analysis.total)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500">Line Items</p>
                <p className="text-xl font-bold text-gray-900">{analysis.itemCount}</p>
              </Card>
            </div>

            <Card className="p-4">
              <h3 className="font-semibold text-gray-900">Category Breakdown</h3>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <p className="text-gray-700">Labour: <span className="font-semibold">{formatCurrency(analysis.byCategory.labour)}</span></p>
                <p className="text-gray-700">Material: <span className="font-semibold">{formatCurrency(analysis.byCategory.material)}</span></p>
                <p className="text-gray-700">Equipment: <span className="font-semibold">{formatCurrency(analysis.byCategory.equipment)}</span></p>
                <p className="text-gray-700">Subcontractor: <span className="font-semibold">{formatCurrency(analysis.byCategory.subcontractor)}</span></p>
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
