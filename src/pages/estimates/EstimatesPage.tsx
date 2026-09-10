import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, FileDown, FilterX, Plus, RefreshCw, Search, Send, Trash2, Users, Wallet, FileText } from 'lucide-react';
import { useStore } from '../../store';
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select } from '../../components/ui';
import { emitAppToast } from '../../toast';
import { formatCurrency, formatDate, statusColor } from '../../utils';
import {
  computeEstimateSubtotal,
  computeEstimateTax,
  computeEstimateTotal,
  createDefaultEstimateWorkArea,
  normalizeEstimateWorkAreas,
} from '../../utils/estimateModel';
import type { Address, Estimate, EstimateStatus, ID } from '../../types';
import { activeDivisionsForBudget, resolveEstimateDivisionId } from './estimateSetupModel.js';
import { createEstimateProposalDocument, fetchEstimateProposal, proposalPdfFileName } from '../../utils/estimateProposalPdf';
import { resolveWorkType } from '../../utils/workTypeModel.js';

const STATUSES: EstimateStatus[] = ['draft', 'sent', 'accepted', 'declined', 'converted'];

const isEstimateStatusFilter = (value: string | null): value is EstimateStatus | 'all' => {
  return value === 'all' || STATUSES.includes(value as EstimateStatus);
};

interface CreateEstimateFormState {
  startMode: 'blank' | 'template';
  templateId: string;
  customerId: string;
  pricingBudgetId: string;
  divisionId: string;
  propertyRef: string;
}

const defaultCreateForm = (): CreateEstimateFormState => ({
  startMode: 'blank',
  templateId: '',
  customerId: '',
  pricingBudgetId: '',
  divisionId: '',
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

interface EstimatesPageProps {
  currentUserRole: string;
}

export default function EstimatesPage({ currentUserRole }: EstimatesPageProps) {
  const {
    estimates,
    customers,
    budgets,
    budgetDivisions,
    templates,
    addEstimate,
    createEstimateFromTemplate,
    deleteEstimate,
    convertEstimateToJob,
  } = useStore();
  const navigate = useNavigate();
  const location = useLocation();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EstimateStatus | 'all'>('all');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creatingEstimate, setCreatingEstimate] = useState(false);
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
  const canViewFinancials = currentUserRole === 'owner' || currentUserRole === 'admin';
  const projectEstimates = estimates.filter((estimate) => resolveWorkType(estimate) === 'project');

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

    const requestedCustomerId = params.get('customer');
    openNew(requestedCustomerId && customers.some((customer) => customer.id === requestedCustomerId)
      ? requestedCustomerId
      : undefined);
    params.delete('create');
    params.delete('customer');
    navigate({
      pathname: location.pathname,
      search: params.toString() ? `?${params.toString()}` : '',
    }, { replace: true });
  }, [customers, location.pathname, location.search, navigate]);

  const proposalEstimate = proposalEstimateId
    ? estimates.find((estimate) => estimate.id === proposalEstimateId) ?? null
    : null;
  const proposalCustomer = proposalEstimate
    ? customers.find((customer) => customer.id === proposalEstimate.customerId) ?? null
    : null;
  const convertEstimate = confirmConvert
    ? estimates.find((estimate) => estimate.id === confirmConvert) ?? null
    : null;
  const convertDateError = convertForm.startDate && convertForm.endDate && convertForm.startDate > convertForm.endDate
    ? 'Start Date must be on or before End Date.'
    : '';

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
  const pricingDivisions = useMemo(
    () => activeDivisionsForBudget(budgetDivisions, createForm.pricingBudgetId),
    [budgetDivisions, createForm.pricingBudgetId],
  );
  const selectedDivisionIsValid = pricingDivisions.some((division) => division.id === createForm.divisionId);
  const canCreateEstimate = Boolean(
    createForm.customerId
    && createForm.pricingBudgetId
    && selectedDivisionIsValid
    && (createForm.startMode === 'blank' || createForm.templateId),
  );

  useEffect(() => {
    setCreateForm((current) => {
      const divisionId = resolveEstimateDivisionId(current.divisionId, pricingDivisions);
      return divisionId === current.divisionId ? current : { ...current, divisionId };
    });
  }, [pricingDivisions]);

  const filtered = projectEstimates.filter((estimate) => {
    const customer = customers.find((item) => item.id === estimate.customerId);
    const matchSearch =
      estimate.title.toLowerCase().includes(search.toLowerCase())
      || (customer?.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || estimate.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const openNew = (customerId?: string) => {
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
      customerId: customerId ?? '',
    });
    setCreateModalOpen(true);
  };

  const createEstimate = async () => {
    if (creatingEstimate) return;
    if (!createForm.customerId || !createForm.pricingBudgetId || !selectedDivisionIsValid) {
      emitAppToast({ tone: 'error', message: 'Customer, pricing budget, and Division are required to start an estimate.' });
      return;
    }

    const proposalNumber = nextProposalNumber(estimates);
    const draftTitle = `Draft Estimate ${proposalNumber}`;

    const propertyIndex = parsePropertyRef(createForm.propertyRef);
    const selectedProperty = propertyIndex !== null ? customerProperties[propertyIndex] : undefined;

    const generalWorkArea = { ...createDefaultEstimateWorkArea(), divisionId: createForm.divisionId };
    setCreatingEstimate(true);
    const estimateId = createForm.startMode === 'template'
      ? await createEstimateFromTemplate({
        templateId: createForm.templateId,
        customerId: createForm.customerId,
        pricingBudgetId: createForm.pricingBudgetId,
        divisionId: createForm.divisionId,
        propertyLabel: selectedProperty?.nickname?.trim() || '',
        propertyAddressSnapshot: selectedProperty ? formatPropertyAddress(selectedProperty) : '',
        proposalNumber,
        title: draftTitle,
        validUntil: defaultValidUntil(),
      })
      : await addEstimate({
        workType: 'project',
        customerId: createForm.customerId,
        pricingBudgetId: createForm.pricingBudgetId,
        divisionId: createForm.divisionId,
        propertyLabel: selectedProperty?.nickname?.trim() || '',
        propertyAddressSnapshot: selectedProperty ? formatPropertyAddress(selectedProperty) : '',
        proposalNumber,
        title: draftTitle,
        description: '',
        workAreas: [generalWorkArea],
        lineItems: [],
        status: 'draft',
        taxRate: 13,
        notes: '',
        validUntil: defaultValidUntil(),
        templateId: undefined,
      });
    setCreatingEstimate(false);

    if (!estimateId) return;
    setCreateModalOpen(false);
    navigate(`/estimates/${estimateId}`);
  };

  const openConvertModal = (estimate: Estimate) => {
    setConfirmConvert(estimate.id);
    setConvertForm({
      title: estimate.title ?? '',
      startDate: estimate.serviceStartDate?.slice(0, 10) ?? '',
      endDate: estimate.serviceEndDate?.slice(0, 10) ?? '',
    });
  };

  const handleConvertEstimate = async (estimateId: string) => {
    if (convertDateError) return;
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
    if (result.jobId) {
      navigate(`/jobs/${result.jobId}`);
    }
  };

  const createProposalPdf = async (estimateId: ID) => {
    try {
      const proposalVersionNumber = estimates.find((item) => item.id === estimateId)?.proposalVersionNumber;
      const proposal = await fetchEstimateProposal(estimateId, proposalVersionNumber);
      const fileName = proposalPdfFileName(proposal);
      createEstimateProposalDocument(proposal).save(fileName);
      emitAppToast({ tone: 'success', message: `Proposal PDF generated: ${fileName}` });
    } catch (error) {
      emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Proposal could not be generated.' });
    }
  };

  return (
    <div>
      <PageHeader
        title="Project Estimates"
        subtitle="Price defined scopes of work and prepare customer proposals."
        action={<Button onClick={() => openNew()}><Plus size={16} /> New Estimate</Button>}
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
        projectEstimates.length === 0 ? (
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
              action={<Button onClick={() => openNew()}><Plus size={16} /> Create Estimate</Button>}
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
                {canViewFinancials ? <th className="pb-2 font-medium text-right">Total</th> : null}
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
                  <tr
                    key={estimate.id}
                    className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-brand-600/60"
                    onClick={() => navigate(`/estimates/${estimate.id}`)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') navigate(`/estimates/${estimate.id}`); }}
                    tabIndex={0}
                  >
                    <td className="py-3 font-medium text-gray-900">
                      <Link to={`/estimates/${estimate.id}`} onClick={(event) => event.stopPropagation()} className="hover:text-brand-700">
                        {estimate.title}
                      </Link>
                    </td>
                    <td className="py-3 text-gray-600">{customer?.name ?? '—'}</td>
                    <td className="py-3 text-gray-600">{estimateWorkAreas.length ? estimateWorkAreas.map((area) => area.name).join(', ') : '—'}</td>
                    <td className="py-3">
                      <Badge label={estimate.status} className={statusColor[estimate.status]} />
                    </td>
                    {canViewFinancials ? <td className="py-3 text-right font-semibold">{formatCurrency(total)}</td> : null}
                    <td className="py-3 text-gray-500">{estimate.validUntil ? formatDate(estimate.validUntil) : '—'}</td>
                    <td className="py-3">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); navigate(`/estimates/${estimate.id}`); }} title="Open Estimate">
                          <ChevronRight size={13} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setProposalEstimateId(estimate.id); }} title="Create Proposal PDF">
                          <FileDown size={13} />
                        </Button>
                        {estimate.status === 'converted' && estimate.convertedToJobId && (
                          <Link to={`/jobs/${estimate.convertedToJobId}`} onClick={(event) => event.stopPropagation()}>
                            <Button variant="ghost" size="sm" title="Open Job">
                              <ChevronRight size={13} />
                            </Button>
                          </Link>
                        )}
                        {estimate.status === 'accepted' && (
                          <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); openConvertModal(estimate); }} title="Convert to Job">
                            <RefreshCw size={13} />
                          </Button>
                        )}
                        {estimate.status !== 'converted' ? <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setConfirmDelete(estimate.id); }} title="Delete">
                          <Trash2 size={13} className="text-accent-700" />
                        </Button> : null}
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
            <Button variant="secondary" onClick={() => setCreateModalOpen(false)} disabled={creatingEstimate}>Cancel</Button>
            <Button onClick={() => void createEstimate()} disabled={creatingEstimate || !canCreateEstimate}>{creatingEstimate ? 'Creating...' : 'Create Estimate'}</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Start with the essentials. You will complete scope, pricing, and proposal details in the estimate workspace.</p>
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">Starting Point</p>
            <div className="grid grid-cols-2 rounded-xl border border-gray-200 bg-gray-50 p-1" role="radiogroup" aria-label="Estimate starting point">
              <button
                type="button"
                role="radio"
                aria-checked={createForm.startMode === 'blank'}
                onClick={() => setCreateForm((current) => ({ ...current, startMode: 'blank', templateId: '' }))}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${createForm.startMode === 'blank' ? 'bg-white text-brand-800 shadow-sm' : 'text-gray-500'}`}
              >
                Start Blank
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={createForm.startMode === 'template'}
                disabled={templates.length === 0}
                onClick={() => setCreateForm((current) => ({ ...current, startMode: 'template' }))}
                className={`rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${createForm.startMode === 'template' ? 'bg-white text-brand-800 shadow-sm' : 'text-gray-500'}`}
              >
                Use Template
              </button>
            </div>
            {templates.length === 0 ? <p className="mt-2 text-xs text-gray-500">Create an Estimate Template to reuse scope here.</p> : null}
          </div>
          {createForm.startMode === 'template' ? (
            <Select
              label="Estimate Template"
              required
              value={createForm.templateId}
              onChange={(event) => setCreateForm((current) => ({ ...current, templateId: event.target.value }))}
            >
              <option value="">Select template</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </Select>
          ) : null}
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
              onChange={(event) => setCreateForm((current) => ({ ...current, pricingBudgetId: event.target.value, divisionId: '' }))}
            >
              <option value="">Select budget</option>
              {budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}
            </Select>
          </div>

          {createForm.pricingBudgetId && pricingDivisions.length > 0 ? (
            <Select
              label="Division"
              required
              value={createForm.divisionId}
              onChange={(event) => setCreateForm((current) => ({ ...current, divisionId: event.target.value }))}
              disabled={pricingDivisions.length === 1}
            >
              <option value="">Select division</option>
              {pricingDivisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
            </Select>
          ) : createForm.pricingBudgetId ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">This Budget has no active Divisions.</p>
          ) : null}

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
                void createProposalPdf(proposalEstimate.id);
              }}
            >
              <FileDown size={14} /> Download PDF
            </Button>
            <Button
              onClick={() => {
                if (!proposalEstimate) return;
                setProposalEstimateId(null);
                navigate(`/estimates/${proposalEstimate.id}?tab=proposal`);
              }}
            >
              <Send size={14} /> Prepare and Send
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
            <p className="text-xs text-gray-500">Open the Proposal workspace to configure payments, preview, and send a secure version for customer acceptance.</p>
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
              disabled={!!convertingEstimateId || !!convertDateError}
              onClick={() => {
                if (!confirmConvert || convertingEstimateId) return;
                void handleConvertEstimate(confirmConvert);
              }}
            >
              {convertingEstimateId ? 'Creating Job...' : 'Create Job'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-gray-600">Create a job from this accepted estimate. Review the job details below before converting.</p>
          {convertEstimate ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              <p><span className="font-medium text-gray-900">Estimate:</span> {convertEstimate.title}</p>
              <p><span className="font-medium text-gray-900">Customer:</span> {customers.find((customer) => customer.id === convertEstimate.customerId)?.name ?? 'Unknown Customer'}</p>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Job Title"
              value={convertForm.title}
              onChange={(event) => setConvertForm((current) => ({ ...current, title: event.target.value }))}
            />
            <Input
              label="Start Date"
              type="date"
              value={convertForm.startDate}
              max={convertForm.endDate || undefined}
              onChange={(event) => setConvertForm((current) => ({ ...current, startDate: event.target.value }))}
            />
          </div>
          <Input
            label="End Date"
            type="date"
            value={convertForm.endDate}
            min={convertForm.startDate || undefined}
            onChange={(event) => setConvertForm((current) => ({ ...current, endDate: event.target.value }))}
          />
          {convertDateError ? <p className="text-sm font-medium text-rose-700" role="alert">{convertDateError}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
