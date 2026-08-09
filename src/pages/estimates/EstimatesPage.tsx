import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, FileDown, FilterX, Mail, Plus, RefreshCw, Search, Trash2, Users, Wallet, FileText } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useStore } from '../../store';
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select } from '../../components/ui';
import { emitAppToast } from '../../toast';
import { formatCurrency, formatDate, statusColor } from '../../utils';
import {
  computeEstimateSubtotal,
  computeEstimateTax,
  computeEstimateTotal,
  computeWorkAreaSubtotal,
  flattenWorkAreaLineItems,
  normalizeEstimateWorkAreas,
} from '../../utils/estimateModel';
import type { Address, Estimate, EstimateStatus, ID } from '../../types';

const STATUSES: EstimateStatus[] = ['draft', 'sent', 'accepted', 'declined', 'converted'];

const isEstimateStatusFilter = (value: string | null): value is EstimateStatus | 'all' => {
  return value === 'all' || STATUSES.includes(value as EstimateStatus);
};

interface CreateEstimateFormState {
  customerId: string;
  pricingBudgetId: string;
  propertyRef: string;
}

const defaultCreateForm = (): CreateEstimateFormState => ({
  customerId: '',
  pricingBudgetId: '',
  propertyRef: '',
});

const defaultValidUntil = () => {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
};

const nextProposalNumber = (estimates: Estimate[]): string => {
  const year = new Date().getFullYear();
  const prefix = `PROP-${year}-`;

  const used = new Set(
    estimates
      .map((estimate) => estimate.proposalNumber?.trim().toUpperCase() ?? '')
      .filter((proposalNumber) => proposalNumber.startsWith(prefix))
      .map((proposalNumber) => {
        const sequence = Number(proposalNumber.slice(prefix.length));
        return Number.isFinite(sequence) ? sequence : NaN;
      })
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  let next = 1;
  while (used.has(next)) next += 1;

  return `${prefix}${String(next).padStart(4, '0')}`;
};

const sanitizeFileNamePart = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

const parsePropertyRef = (value: string): number | null => {
  if (!value.startsWith('idx:')) return null;
  const index = Number(value.slice(4));
  if (!Number.isInteger(index) || index < 0) return null;
  return index;
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

export default function EstimatesPage() {
  const {
    estimates,
    customers,
    budgets,
    addEstimate,
    deleteEstimate,
    convertEstimateToJob,
  } = useStore();
  const navigate = useNavigate();
  const location = useLocation();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EstimateStatus | 'all'>('all');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateEstimateFormState>(defaultCreateForm());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmConvert, setConfirmConvert] = useState<string | null>(null);
  const [convertForm, setConvertForm] = useState({
    title: '',
    startDate: '',
    endDate: '',
  });
  const [convertingEstimateId, setConvertingEstimateId] = useState<string | null>(null);
  const [proposalEstimateId, setProposalEstimateId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get('status');
    if (isEstimateStatusFilter(status)) {
      setStatusFilter(status);
    }
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('create') !== 'estimate') return;

    openNew();
    params.delete('create');
    navigate({
      pathname: location.pathname,
      search: params.toString() ? `?${params.toString()}` : '',
    }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const proposalEstimate = proposalEstimateId
    ? estimates.find((estimate) => estimate.id === proposalEstimateId) ?? null
    : null;
  const proposalCustomer = proposalEstimate
    ? customers.find((customer) => customer.id === proposalEstimate.customerId) ?? null
    : null;
  const convertEstimate = confirmConvert
    ? estimates.find((estimate) => estimate.id === confirmConvert) ?? null
    : null;

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === createForm.customerId) ?? null,
    [createForm.customerId, customers]
  );
  const customerProperties = useMemo(
    () => normalizeProperties(selectedCustomer?.properties, selectedCustomer?.address),
    [selectedCustomer]
  );
  const hasFilters = search.trim().length > 0 || statusFilter !== 'all';
  const hasCustomers = customers.length > 0;
  const hasBudgets = budgets.length > 0;
  const hasPricingRates = budgets.length > 0;

  const filtered = estimates.filter((estimate) => {
    const customer = customers.find((item) => item.id === estimate.customerId);
    const matchSearch =
      estimate.title.toLowerCase().includes(search.toLowerCase())
      || (customer?.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || estimate.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const openNew = () => {
    if (!hasCustomers) {
      emitAppToast({ tone: 'error', message: 'Add a client before creating an estimate.' });
      navigate('/crm');
      return;
    }

    if (!hasBudgets || !hasPricingRates) {
      emitAppToast({ tone: 'error', message: 'Set up pricing before creating an estimate.' });
      navigate('/budgets');
      return;
    }

    setCreateForm({
      ...defaultCreateForm(),
      pricingBudgetId: budgets.find((budget) => budget.status === 'active')?.id ?? budgets[0]?.id ?? '',
    });
    setCreateModalOpen(true);
  };

  const createEstimate = () => {
    if (!createForm.customerId || !createForm.pricingBudgetId) {
      emitAppToast({ tone: 'error', message: 'Customer and pricing budget are required to start an estimate.' });
      return;
    }

    const proposalNumber = nextProposalNumber(estimates);
    const draftTitle = `Draft Estimate ${proposalNumber}`;

    const propertyIndex = parsePropertyRef(createForm.propertyRef);
    const selectedProperty = propertyIndex !== null ? customerProperties[propertyIndex] : undefined;

    const estimateId = addEstimate({
      customerId: createForm.customerId,
      pricingBudgetId: createForm.pricingBudgetId,
      propertyLabel: selectedProperty?.nickname?.trim() || '',
      propertyAddressSnapshot: selectedProperty ? formatPropertyAddress(selectedProperty) : '',
      proposalNumber,
      title: draftTitle,
      description: '',
      workAreas: [],
      lineItems: [],
      status: 'draft',
      taxRate: 13,
      notes: '',
      validUntil: defaultValidUntil(),
      templateId: undefined,
    });

    setCreateModalOpen(false);
    navigate(`/estimates/${estimateId}`);
  };

  const openConvertModal = (estimate: Estimate) => {
    setConfirmConvert(estimate.id);
    setConvertForm({
      title: estimate.title ?? '',
      startDate: '',
      endDate: '',
    });
  };

  const handleConvertEstimate = async (estimateId: string) => {
    setConvertingEstimateId(estimateId);
    const result = await convertEstimateToJob(estimateId, {
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

    setConfirmConvert(null);
    setConvertForm({ title: '', startDate: '', endDate: '' });
    emitAppToast({ tone: 'success', message: 'Estimate converted to job successfully.' });
  };

  const createProposalPdf = (estimate: Estimate) => {
    const customer = customers.find((value) => value.id === estimate.customerId);
    const customerName = customer?.name?.trim() || 'Client';
    const safeTitle = sanitizeFileNamePart(estimate.title) || 'estimate';
    const safeProposalNumber = sanitizeFileNamePart(estimate.proposalNumber ?? '');
    const fileName = safeProposalNumber
      ? `proposal-${safeProposalNumber}-${safeTitle}.pdf`
      : `proposal-${safeTitle}-${estimate.id.slice(0, 8)}.pdf`;

    const doc = createProposalDocument(estimate, customerName, customer?.company);
    doc.save(fileName);
    emitAppToast({ tone: 'success', message: `Proposal PDF generated: ${fileName}` });
  };

  const sendProposalToClient = (estimate: Estimate) => {
    const customer = customers.find((value) => value.id === estimate.customerId);
    if (!customer?.email?.trim()) {
      emitAppToast({ tone: 'error', message: 'Customer email is missing. Add an email before sending.' });
      return;
    }

    createProposalPdf(estimate);

    const estimateWorkAreas = normalizeEstimateWorkAreas(estimate);
    const subtotalValue = computeEstimateSubtotal(estimateWorkAreas);
    const totalValue = computeEstimateTotal(subtotalValue, computeEstimateTax(subtotalValue, estimate.taxRate));
    const proposalRef = estimate.proposalNumber?.trim();
    const subject = encodeURIComponent(proposalRef ? `Proposal ${proposalRef}: ${estimate.title}` : `Proposal: ${estimate.title}`);
    const body = encodeURIComponent(
      [
        `Hi ${customer.name},`,
        '',
        `Please find attached our proposal for ${estimate.title}.`,
        proposalRef ? `Proposal reference: ${proposalRef}.` : '',
        `Total proposed amount: ${formatCurrency(totalValue)}.`,
        estimate.validUntil ? `This proposal is valid until ${formatDate(estimate.validUntil)}.` : 'This proposal does not have an expiry date listed.',
        '',
        'Thank you,',
      ].join('\n')
    );

    if (typeof window !== 'undefined') {
      window.location.href = `mailto:${encodeURIComponent(customer.email)}?subject=${subject}&body=${body}`;
    }
  };

  return (
    <div>
      <PageHeader
        title="Estimates"
        subtitle="Create and manage estimates for your customers."
        action={<Button onClick={openNew}><Plus size={16} /> New Estimate</Button>}
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search estimates…"
            className="w-full h-10 pl-9 pr-3 text-sm border border-gray-300 rounded-xl shadow-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as EstimateStatus | 'all')}
          className="h-10 border border-gray-300 rounded-xl px-3 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
        >
          <option value="all">All Statuses</option>
          {STATUSES.map((status) => <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        estimates.length === 0 ? (
          !hasCustomers ? (
            <EmptyState
              icon={<Users aria-hidden="true" />}
              title="Add a client before creating an estimate"
              description="Estimates start with a client, property, and pricing budget."
              action={<Button onClick={() => navigate('/crm')}><Plus size={16} /> Add Client</Button>}
              helpText="Choose the client and property first, then return here to build the estimate scope in Work Areas."
            />
          ) : (!hasBudgets || !hasPricingRates) ? (
            <EmptyState
              icon={<Wallet aria-hidden="true" />}
              title="Set up your pricing before creating an estimate"
              description="Pricing budgets supply your standard labour, equipment, material, and subcontractor rates."
              action={<Button onClick={() => navigate('/budgets')}><Plus size={16} /> Set Up Pricing</Button>}
              helpText="Create a budget and add pricing rates so estimate line items can use your company pricing." 
            />
          ) : (
            <EmptyState
              icon={<FileText aria-hidden="true" />}
              title="Create your first estimate"
              description="Build estimates using your company pricing and organize the scope into Work Areas."
              action={<Button onClick={openNew}><Plus size={16} /> Create Estimate</Button>}
              helpText="Start with a client, property, and pricing budget."
            />
          )
        ) : (
          <EmptyState
            icon={<FilterX aria-hidden="true" />}
            title="No estimates match your search"
            description="Try a different search or clear your current filters."
            action={hasFilters ? <Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter('all'); }}>Clear Filters</Button> : undefined}
          />
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500 text-left">
                <th className="pb-2 font-medium">Title</th>
                <th className="pb-2 font-medium">Customer</th>
                <th className="pb-2 font-medium">Work Areas</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium text-right">Total</th>
                <th className="pb-2 font-medium">Valid Until</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((estimate) => {
                const customer = customers.find((item) => item.id === estimate.customerId);
                const estimateWorkAreas = normalizeEstimateWorkAreas(estimate);
                const subtotal = computeEstimateSubtotal(estimateWorkAreas);
                const total = computeEstimateTotal(subtotal, computeEstimateTax(subtotal, estimate.taxRate));

                return (
                  <tr key={estimate.id} className="hover:bg-gray-50">
                    <td className="py-3 font-medium text-gray-900">
                      <button className="hover:text-brand-700" onClick={() => navigate(`/estimates/${estimate.id}`)}>
                        {estimate.title}
                      </button>
                    </td>
                    <td className="py-3 text-gray-600">{customer?.name ?? '—'}</td>
                    <td className="py-3 text-gray-600">{estimateWorkAreas.length ? estimateWorkAreas.map((area) => area.name).join(', ') : '—'}</td>
                    <td className="py-3">
                      <Badge label={estimate.status} className={statusColor[estimate.status]} />
                    </td>
                    <td className="py-3 text-right font-semibold">{formatCurrency(total)}</td>
                    <td className="py-3 text-gray-500">{estimate.validUntil ? formatDate(estimate.validUntil) : '—'}</td>
                    <td className="py-3">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/estimates/${estimate.id}`)} title="Open Workspace">
                          <ChevronRight size={13} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setProposalEstimateId(estimate.id)} title="Create Proposal PDF">
                          <FileDown size={13} />
                        </Button>
                        {estimate.status === 'converted' && estimate.convertedToJobId && (
                          <Link to={`/jobs/${estimate.convertedToJobId}`}>
                            <Button variant="ghost" size="sm" title="Open Job">
                              <ChevronRight size={13} />
                            </Button>
                          </Link>
                        )}
                        {estimate.status === 'accepted' && (
                          <Button variant="ghost" size="sm" onClick={() => openConvertModal(estimate)} title="Convert to Job">
                            <RefreshCw size={13} />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(estimate.id)} title="Delete">
                          <Trash2 size={13} className="text-accent-700" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="New Estimate Setup"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setCreateModalOpen(false)}>Cancel</Button>
            <Button onClick={createEstimate}>Create Estimate</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Start with the essentials. You will complete scope, pricing, and proposal details in the estimate workspace.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Customer"
              required
              value={createForm.customerId}
              onChange={(event) => setCreateForm((current) => ({ ...current, customerId: event.target.value, propertyRef: '' }))}
            >
              <option value="">Select customer</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.company ? ` (${customer.company})` : ''}</option>)}
            </Select>
            <Select
              label="Pricing Budget"
              required
              value={createForm.pricingBudgetId}
              onChange={(event) => setCreateForm((current) => ({ ...current, pricingBudgetId: event.target.value }))}
            >
              <option value="">Select budget</option>
              {budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}
            </Select>
          </div>

          <Select
            label="Property (optional)"
            value={createForm.propertyRef}
            onChange={(event) => setCreateForm((current) => ({ ...current, propertyRef: event.target.value }))}
            disabled={!selectedCustomer}
          >
            <option value="">No property selected</option>
            {customerProperties.map((property, index) => (
              <option key={`${property.nickname ?? 'property'}-${index}`} value={`idx:${index}`}>
                {(property.nickname?.trim() || `Property ${index + 1}`)}{formatPropertyAddress(property) ? ` - ${formatPropertyAddress(property)}` : ''}
              </option>
            ))}
          </Select>

          <Input label="Proposal Number" value={nextProposalNumber(estimates)} disabled />
        </div>
      </Modal>

      <Modal
        open={!!proposalEstimate}
        onClose={() => setProposalEstimateId(null)}
        title="Create Proposal"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setProposalEstimateId(null)}>Close</Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!proposalEstimate) return;
                createProposalPdf(proposalEstimate);
              }}
            >
              <FileDown size={14} /> Download PDF
            </Button>
            <Button
              onClick={() => {
                if (!proposalEstimate) return;
                sendProposalToClient(proposalEstimate);
              }}
            >
              <Mail size={14} /> Open Email Draft
            </Button>
          </>
        )}
      >
        {proposalEstimate ? (
          <div className="space-y-3 text-sm text-gray-700">
            <p className="text-gray-600">Generate a client-ready proposal PDF for this estimate.</p>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1">
              <p><span className="font-medium text-gray-900">Proposal #:</span> {proposalEstimate.proposalNumber?.trim() || 'Not set'}</p>
              <p><span className="font-medium text-gray-900">Estimate:</span> {proposalEstimate.title}</p>
              <p><span className="font-medium text-gray-900">Customer:</span> {proposalCustomer?.name ?? 'Unknown Customer'}</p>
              <p><span className="font-medium text-gray-900">Valid Until:</span> {proposalEstimate.validUntil ? formatDate(proposalEstimate.validUntil) : 'Not specified'}</p>
              <p><span className="font-medium text-gray-900">Total:</span> {formatCurrency(computeEstimateTotal(computeEstimateSubtotal(normalizeEstimateWorkAreas(proposalEstimate)), computeEstimateTax(computeEstimateSubtotal(normalizeEstimateWorkAreas(proposalEstimate)), proposalEstimate.taxRate)))}</p>
            </div>
            <p className="text-xs text-gray-500">Open Email Draft uses your local email app only. Attach the downloaded PDF and send it manually.</p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete Estimate"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!confirmDelete) return;
                deleteEstimate(confirmDelete as ID);
                setConfirmDelete(null);
              }}
            >
              Delete
            </Button>
          </>
        )}
      >
        <p className="text-gray-600">Delete this estimate? This cannot be undone.</p>
      </Modal>

      <Modal
        open={!!confirmConvert}
        onClose={() => setConfirmConvert(null)}
        title="Convert to Job"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmConvert(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!confirmConvert || convertingEstimateId) return;
                void handleConvertEstimate(confirmConvert);
              }}
            >
              {convertingEstimateId ? 'Converting...' : 'Convert'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-gray-600">Create a job from this accepted estimate. Leave any field blank to use the estimate default.</p>
          {convertEstimate ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              <p><span className="font-medium text-gray-900">Estimate:</span> {convertEstimate.title}</p>
              <p><span className="font-medium text-gray-900">Customer:</span> {customers.find((customer) => customer.id === convertEstimate.customerId)?.name ?? 'Unknown Customer'}</p>
            </div>
          ) : null}
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
