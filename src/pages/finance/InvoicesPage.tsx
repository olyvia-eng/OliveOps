import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { Ban, BookOpenCheck, Ellipsis, FilePlus2, Mail, Plus, ReceiptText, Search, Send, Trash2, Wallet, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, StatCard, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import { formatCurrency, generateId } from '../../utils';
import { calculateFixedMenuPosition } from '../../utils/fixedMenuPosition.js';
import { calculateInvoiceLineFinancials, calculateInvoiceSummary, calculateJobInvoicePosition, getCustomerBillingAddressSnapshot, getInvoiceBalance, getInvoiceContractAmount, getInvoiceFinancialStatus, normalizeInvoiceFinancials, validateInvoiceLineItems } from '../../utils/invoiceModel.js';
import { buildContractInvoiceLines, paymentScheduleItemState, remainingContractBillingItem } from '../../utils/contractBillingModel.js';
import type { CustomerPaymentMethod, ID, Invoice, InvoiceLineCategory, InvoiceLineItem, InvoicePayment, InvoiceStatus, InvoiceType, JobWorkAreaLineItem, QuickBooksIntegration, QuickBooksInvoiceStatus } from '../../types';

type Filter = 'all' | InvoiceStatus;
type Form = {
  jobId: ID;
  invoiceType: InvoiceType;
  paymentScheduleItemId?: ID;
  issueDate: string;
  dueDate: string;
  paymentTermsDays: number;
  taxRate: number;
  notes: string;
  lineItems: InvoiceLineItem[];
  amountMode: 'fixed' | 'percent' | 'work_areas';
  billingAmount: number;
  billingPercent: number;
  overContractConfirmed: boolean;
};
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
const emptyLine = (): InvoiceLineItem => ({
  id: generateId(),
  category: 'contract_service',
  description: '',
  quantity: 1,
  unit: 'job',
  unitPrice: 0,
  unitPriceBeforeTax: 0,
  amount: 0,
  taxable: true,
});
const emptyForm = (): Form => ({
  jobId: '',
  invoiceType: 'progress',
  issueDate: today(),
  dueDate: plusDays(today(), 30),
  paymentTermsDays: 30,
  taxRate: 13,
  notes: '',
  lineItems: [],
  amountMode: 'fixed',
  billingAmount: 0,
  billingPercent: 0,
  overContractConfirmed: false,
});
const filters: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'sent', label: 'Sent' },
  { value: 'partially_paid', label: 'Partially paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];
const invoiceTypeDescriptions: Record<InvoiceType, string> = {
  deposit: 'Collect an upfront payment',
  progress: 'Bill part of the contract',
  final: 'Bill the remaining balance',
  custom: 'Build an invoice manually',
};
const generatedDescription = (invoiceType: InvoiceType) => (invoiceType === 'deposit' ? 'Contract deposit' : invoiceType === 'final' ? 'Final contract billing' : 'Progress billing');
const badge: Record<InvoiceStatus, string> = {
  draft: 'bg-brand-100 text-brand-700',
  sent: 'bg-blue-100 text-blue-800',
  partially_paid: 'bg-amber-100 text-amber-800',
  overdue: 'bg-red-100 text-red-800',
  paid: 'bg-emerald-100 text-emerald-800',
  void: 'bg-gray-200 text-gray-700',
};
const displayStatus = (invoice: Invoice): InvoiceStatus => getInvoiceFinancialStatus(invoice) as InvoiceStatus;
const clientName = (customer?: { name?: string; company?: string }) => customer?.company || customer?.name || 'Unknown client';
const linePrice = (line: JobWorkAreaLineItem) => Number(line.sellPrice ?? line.contractRevenue ?? line.total ?? 0);
const sourceLine = (line: JobWorkAreaLineItem, workAreaId: ID): InvoiceLineItem => ({
  id: generateId(),
  sourceWorkAreaId: workAreaId,
  sourceLineItemId: line.id,
  category: line.category,
  description: line.description || line.itemName,
  quantity: line.quantity,
  unit: line.unit,
  unitPrice: linePrice(line),
  unitPriceBeforeTax: linePrice(line),
  amount: 0,
  taxable: true,
});
const draftFingerprint = (value: Pick<Form, 'jobId' | 'invoiceType' | 'paymentScheduleItemId' | 'issueDate' | 'dueDate' | 'paymentTermsDays' | 'taxRate' | 'notes' | 'lineItems' | 'overContractConfirmed'>) =>
  JSON.stringify({
    jobId: value.jobId,
    invoiceType: value.invoiceType,
    paymentScheduleItemId: value.paymentScheduleItemId,
    issueDate: value.issueDate,
    dueDate: value.dueDate,
    paymentTermsDays: value.paymentTermsDays,
    taxRate: value.taxRate,
    notes: value.notes.trim(),
    overContractConfirmed: value.overContractConfirmed,
    lineItems: value.lineItems.map((line) => ({
      id: line.id,
      category: line.category,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceBeforeTax: line.unitPriceBeforeTax,
      taxable: line.taxable,
      sourceWorkAreaId: line.sourceWorkAreaId,
      sourceLineItemId: line.sourceLineItemId,
    })),
  });

export default function InvoicesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { jobs, customers, invoices, addInvoice, updateInvoice, deleteInvoice } = useStore();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [form, setForm] = useState<Form>(emptyForm());
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [menu, setMenu] = useState<ID | null>(null);
  const [payments, setPayments] = useState<InvoicePayment[]>([]);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: 0, paymentDate: today(), paymentMethod: 'Other', reference: '', notes: '' });
  const [paymentMethods, setPaymentMethods] = useState<CustomerPaymentMethod[]>([]);
  const [invoiceDefaults, setInvoiceDefaults] = useState({ paymentTermsDays: 30, notes: '' });
  const [quickBooks, setQuickBooks] = useState<QuickBooksIntegration>({
    connected: false,
    environment: 'sandbox',
  });
  const [qbo, setQbo] = useState<Record<ID, QuickBooksInvoiceStatus | null>>({});
  const jobMap = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const customerMap = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);
  const job = jobMap.get(form.jobId);
  const position = useMemo(
    () =>
      calculateJobInvoicePosition(
        job,
        invoices.filter((invoice) => invoice.id !== selected?.id),
      ),
    [job, invoices, selected],
  );
  const normalized = useMemo(
    () =>
      normalizeInvoiceFinancials({
        schemaVersion: 2,
        taxRate: form.taxRate,
        lineItems: form.lineItems,
      }),
    [form.lineItems, form.taxRate],
  );
  const summary = calculateInvoiceSummary(normalized.lineItems, form.taxRate, 2);
  const contractSchedule = job?.contractBillingSchedule;
  const selectedScheduleItem = contractSchedule?.items.find((item) => item.id === form.paymentScheduleItemId);
  const exceeds = summary.subtotal > position.remainingAmount;
  const editable = !selected || (selected.schemaVersion === 2 && selected.status === 'draft' && !selected.quickBooksLinked && !qbo[selected.id]);
  const lineValidationError = validateInvoiceLineItems(normalized.lineItems, form.taxRate, 2);
  const requiredFieldError = !form.issueDate || !form.dueDate || form.dueDate < form.issueDate || !Number.isSafeInteger(form.paymentTermsDays) || form.paymentTermsDays < 0 || form.paymentTermsDays > 365 || !Number.isFinite(form.taxRate) || form.taxRate < 0 || form.taxRate > 100;
  const draftDirty = Boolean(
    selected?.status === 'draft' &&
      draftFingerprint(form) !==
        draftFingerprint({
          jobId: selected.jobId,
          invoiceType: selected.invoiceType ?? 'custom',
          paymentScheduleItemId: selected.paymentScheduleItemId,
          issueDate: selected.issueDate,
          dueDate: selected.dueDate,
          paymentTermsDays: selected.paymentTermsDays ?? 30,
          taxRate: selected.taxRate ?? 0,
          notes: selected.notes,
          lineItems: selected.lineItems ?? [],
          overContractConfirmed: Boolean(selected.overContract),
        }),
  );
  const saveDisabledReason = !job ? 'Select a Job to save this draft.' : lineValidationError || summary.subtotal <= 0 || summary.amount <= 0 ? 'Add a billable amount to save this draft.' : requiredFieldError ? 'Complete the required invoice details to save this draft.' : exceeds && form.invoiceType !== 'custom' ? 'This invoice exceeds the remaining contract amount.' : exceeds && !form.overContractConfirmed ? 'Confirm intentional over-contract billing to save this draft.' : '';

  useEffect(() => {
    void fetch('/api/business', { credentials: 'include' }).then((response) => response.json()).then((payload) => {
      if (!payload.ok) return;
      setPaymentMethods((payload.business.paymentMethods ?? []).filter((method: CustomerPaymentMethod) => method.enabled));
      setInvoiceDefaults({ paymentTermsDays: payload.business.defaultPaymentTermsDays ?? 30, notes: payload.business.defaultInvoiceNotes ?? '' });
    }).catch(() => undefined);
    void fetch('/api/integrations/quickbooks/status', {
      credentials: 'include',
    })
      .then((response) => response.json())
      .then((payload: { ok?: boolean; integration?: QuickBooksIntegration }) => {
        if (payload.ok && payload.integration) setQuickBooks(payload.integration);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!quickBooks.connected) return;
    void Promise.all(
      invoices.map(async (invoice) => {
        const response = await fetch(`/api/integrations/quickbooks/invoices?invoiceId=${encodeURIComponent(invoice.id)}`, { credentials: 'include' });
        const payload = (await response.json()) as {
          ok?: boolean;
          invoice?: QuickBooksInvoiceStatus | null;
        };
        return [invoice.id, response.ok && payload.ok ? (payload.invoice ?? null) : null] as const;
      }),
    )
      .then((entries) => setQbo(Object.fromEntries(entries)))
      .catch(() => undefined);
  }, [quickBooks.connected, invoices]);

  const metrics = useMemo(() => {
    const issued = invoices.filter((invoice) => !['draft', 'void'].includes(displayStatus(invoice)));
    return {
      ready: jobs.filter((item) => item.status !== 'cancelled').reduce((sum, item) => sum + calculateJobInvoicePosition(item, invoices).remainingAmount, 0),
      outstanding: issued.filter((invoice) => ['sent', 'partially_paid', 'overdue'].includes(displayStatus(invoice))).reduce((sum, invoice) => sum + getInvoiceBalance(invoice), 0),
      overdue: issued.filter((invoice) => displayStatus(invoice) === 'overdue').reduce((sum, invoice) => sum + getInvoiceBalance(invoice), 0),
      billed: issued.reduce((sum, invoice) => sum + invoice.amount, 0),
      drafts: invoices.filter((invoice) => invoice.status === 'draft').reduce((sum, invoice) => sum + invoice.amount, 0),
    };
  }, [invoices, jobs]);
  const rows = useMemo(
    () =>
      invoices
        .map((invoice) => ({ ...invoice, status: displayStatus(invoice) }))
        .filter((invoice) => filter === 'all' || invoice.status === filter)
        .filter((invoice) => {
          const query = search.trim().toLowerCase();
          return !query || [invoice.number, invoice.customerNameSnapshot, clientName(customerMap.get(invoice.customerId)), invoice.jobTitleSnapshot, jobMap.get(invoice.jobId)?.title].some((value) => value?.toLowerCase().includes(query));
        })
        .sort((left, right) => right.issueDate.localeCompare(left.issueDate) || right.createdAt.localeCompare(left.createdAt)),
    [invoices, filter, search, customerMap, jobMap],
  );
  const menuInvoice = menu ? rows.find((invoice) => invoice.id === menu) : undefined;

  const applyScheduleItem = (next: Form, selectedJob = jobMap.get(next.jobId), scheduleItemId = next.paymentScheduleItemId) => {
    const schedule = selectedJob?.contractBillingSchedule;
    const scheduleItem = schedule?.items.find((item) => item.id === scheduleItemId);
    if (!schedule || !scheduleItem) return next;
    const otherInvoices = invoices.filter((invoice) => invoice.id !== selected?.id);
    const allocation = scheduleItem.invoiceType === 'final' ? remainingContractBillingItem(schedule, scheduleItem, otherInvoices, selectedJob.id) : scheduleItem;
    const description = next.lineItems[0]?.description.trim() || `${scheduleItem.percentage ? `${scheduleItem.percentage}% ` : ''}${scheduleItem.label}${selectedJob.title ? ` - ${selectedJob.title}` : ''}`;
    return {
      ...next,
      invoiceType: scheduleItem.invoiceType,
      paymentScheduleItemId: scheduleItem.id,
      taxRate: schedule.taxRate,
      lineItems: buildContractInvoiceLines(allocation, description).map((line) => ({ ...line, id: generateId(), amount: 0 })),
    };
  };

  const applyAmount = (next: Form, nextPosition = position) => {
    if (next.invoiceType === 'custom' || next.amountMode === 'work_areas') return next;
    const amount = next.invoiceType === 'final' ? nextPosition.remainingAmount : next.amountMode === 'percent' ? (nextPosition.contractAmount * next.billingPercent) / 100 : next.billingAmount;
    const defaultDescription = generatedDescription(next.invoiceType);
    const description = next.lineItems[0]?.description.trim() || defaultDescription;
    const taxable = next.lineItems[0]?.taxable ?? true;
    return {
      ...next,
      lineItems: [
        {
          ...emptyLine(),
          description,
          taxable,
          unitPrice: amount,
          unitPriceBeforeTax: amount,
        },
      ],
    };
  };
  const start = (jobId?: ID, scheduleItemId?: ID) => {
    setSelected(null);
    const issueDate = today();
    const base = { ...emptyForm(), jobId: jobId ?? '', issueDate, paymentTermsDays: invoiceDefaults.paymentTermsDays, dueDate: plusDays(issueDate, invoiceDefaults.paymentTermsDays), notes: invoiceDefaults.notes };
    setForm(scheduleItemId ? applyScheduleItem({ ...base, paymentScheduleItemId: scheduleItemId }, jobMap.get(jobId ?? ''), scheduleItemId) : base);
    setError('');
    setOpen(true);
  };
  const view = (invoice: Invoice) => {
    const invoiceType = invoice.invoiceType ?? 'custom';
    const hasSourceLines = invoice.lineItems?.some((line) => line.sourceLineItemId) ?? false;
    setSelected(invoice);
    setError('');
    setVoidReason('');
    setForm({
      jobId: invoice.jobId,
      invoiceType,
      paymentScheduleItemId: invoice.paymentScheduleItemId,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      paymentTermsDays: invoice.paymentTermsDays ?? 30,
      taxRate: invoice.taxRate ?? 0,
      notes: invoice.notes,
      lineItems: invoice.lineItems?.map((line) => ({ ...line })) ?? [],
      amountMode: invoiceType === 'progress' && hasSourceLines ? 'work_areas' : 'fixed',
      billingAmount: invoice.subtotal ?? invoice.amount,
      billingPercent: 0,
      overContractConfirmed: Boolean(invoice.overContract),
    });
    setOpen(true);
    setPayments([]);
    if (invoice.status !== 'draft') void fetch(`/api/invoice-payments?invoiceId=${encodeURIComponent(invoice.id)}`, { credentials: 'include' }).then((response) => response.json()).then((payload) => { if (payload.ok) setPayments(payload.payments ?? []); }).catch(() => undefined);
  };
  const chooseJob = (jobId: ID) => {
    const selectedJob = jobMap.get(jobId);
    const next = {
      ...form,
      jobId,
      paymentScheduleItemId: undefined,
      taxRate: selectedJob?.contractBillingSchedule?.taxRate ?? selectedJob?.originalEstimateSnapshot?.taxRate ?? 13,
      lineItems: [],
    };
    const nextScheduleItem = selectedJob?.contractBillingSchedule?.items.find((item) => paymentScheduleItemState(item.id, invoices, selectedJob.id).status === 'not_invoiced');
    setForm(nextScheduleItem ? applyScheduleItem(next, selectedJob, nextScheduleItem.id) : next);
  };
  const chooseType = (invoiceType: InvoiceType) => {
    if (invoiceType === form.invoiceType) return;
    const hasSourceLines = form.lineItems.some((line) => line.sourceLineItemId);
    const hasCustomContent = form.invoiceType === 'custom' && form.lineItems.some((line) => line.description.trim() || Number(line.unitPriceBeforeTax) > 0);
    const hasEditedGeneratedDescription = form.invoiceType !== 'custom' && form.lineItems.some((line) => !line.sourceLineItemId && line.description.trim() && line.description.trim() !== generatedDescription(form.invoiceType));
    if ((hasSourceLines || hasCustomContent || hasEditedGeneratedDescription) && !window.confirm('Changing invoice type will clear the current invoice lines. Continue?')) return;
    const reset = {
      ...form,
      invoiceType,
      paymentScheduleItemId: undefined,
      amountMode: 'fixed' as const,
      billingAmount: 0,
      billingPercent: 0,
      lineItems: [],
    };
    if (invoiceType === 'custom') return setForm({ ...reset, lineItems: [emptyLine()] });
    const matchingScheduleItem = job?.contractBillingSchedule?.items.find((item) => item.invoiceType === invoiceType && paymentScheduleItemState(item.id, invoices, job.id).status === 'not_invoiced');
    if (job?.contractBillingSchedule?.items.length) {
      if (!matchingScheduleItem) {
        setError(`No uninvoiced ${invoiceType} payment remains on this contract.`);
        return;
      }
      setError('');
      return setForm(applyScheduleItem(reset, job, matchingScheduleItem.id));
    }
    setForm(applyAmount(reset));
  };
  const openInvoiceFromLink = useEffectEvent((invoice: Invoice) => view(invoice));
  const startInvoiceFromLink = useEffectEvent((jobId: ID, scheduleItemId: ID) => start(jobId, scheduleItemId));
  useEffect(() => {
    const invoiceId = searchParams.get('invoiceId');
    const linkedInvoice = invoiceId ? invoices.find((invoice) => invoice.id === invoiceId) : undefined;
    if (linkedInvoice) {
      openInvoiceFromLink(linkedInvoice);
      setSearchParams({}, { replace: true });
      return;
    }
    const jobId = searchParams.get('jobId');
    const scheduleItemId = searchParams.get('scheduleItemId');
    if (!jobId || !scheduleItemId || !jobMap.has(jobId)) return;
    startInvoiceFromLink(jobId, scheduleItemId);
    setSearchParams({}, { replace: true });
  }, [invoices, jobMap, searchParams, setSearchParams]);
  const updateLine = <K extends keyof InvoiceLineItem>(id: ID, key: K, value: InvoiceLineItem[K]) =>
    setForm((current) => {
      const generatedLumpSum = current.invoiceType !== 'custom' && current.amountMode !== 'work_areas';
      if (generatedLumpSum && !['description', 'taxable'].includes(key)) return current;
      return {
        ...current,
        lineItems: current.lineItems.map((line) => (line.id === id ? { ...line, [key]: value } : line)),
      };
    });
  const toggleSource = (line: JobWorkAreaLineItem, workAreaId: ID) =>
    setForm((current) => ({
      ...current,
      amountMode: 'work_areas',
      lineItems: current.lineItems.some((item) => item.sourceLineItemId === line.id) ? current.lineItems.filter((item) => item.sourceLineItemId !== line.id) : [...current.lineItems, sourceLine(line, workAreaId)],
    }));

  const save = async () => {
    setError('');
    if (!job) return setError('Select a job.');
    const lineError = validateInvoiceLineItems(normalized.lineItems, form.taxRate, 2);
    if (lineError) return setError(lineError);
    if (exceeds && form.invoiceType !== 'custom') return setError('This invoice exceeds the remaining contract amount.');
    if (exceeds && !form.overContractConfirmed) return setError('Confirm intentional over-contract billing.');
    setSaving(true);
    const data = {
      schemaVersion: 2 as const,
      invoiceType: form.invoiceType,
      paymentScheduleItemId: form.paymentScheduleItemId,
      jobId: job.id,
      customerId: job.customerId,
      estimateId: job.originalEstimateSnapshot?.estimateId ?? job.estimateId,
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      status: 'draft' as const,
      pricingMode: 'tax_exclusive' as const,
      paymentTermsDays: form.paymentTermsDays,
      taxRate: form.taxRate,
      lineItems: normalized.lineItems,
      subtotal: summary.subtotal,
      taxAmount: summary.taxAmount,
      amount: summary.amount,
      notes: form.notes.trim(),
      overContractConfirmed: form.overContractConfirmed,
    };
    const result = selected ? await updateInvoice(selected.id, data) : await addInvoice(data);
    setSaving(false);
    if (!result.ok) return setError(result.error ?? 'Invoice could not be saved.');
    setOpen(false);
    emitAppToast({
      tone: 'success',
      message: `Invoice ${result.invoice?.number ?? ''} saved as Draft.`,
    });
  };
  const status = async (invoice: Invoice, nextStatus: 'void') => {
    if (!voidReason.trim()) return setError('A void reason is required.');
    setSaving(true);
    const result = await updateInvoice(invoice.id, { status: nextStatus, voidReason: voidReason.trim() });
    setSaving(false);
    if (!result.ok) return setError(result.error ?? 'Status could not be updated.');
    if (result.invoice) view(result.invoice);
  };
  const sendInvoice = async (invoice: Invoice) => {
    if (draftDirty) return setError('Save draft changes before sending this invoice.');
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/invoice-delivery', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: invoice.id }) });
      const payload = await response.json() as { ok?: boolean; invoice?: Invoice; error?: string };
      if (payload.invoice) {
        useStore.setState((state) => ({ invoices: state.invoices.map((item) => item.id === invoice.id ? payload.invoice as Invoice : item) }));
        view(payload.invoice);
      }
      if (!response.ok || !payload.ok || !payload.invoice) throw new Error(payload.error || 'Invoice could not be sent.');
      emitAppToast({ tone: 'success', message: `${payload.invoice.number} sent to the customer.` });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invoice could not be sent.'); }
    finally { setSaving(false); }
  };
  const openRecordPayment = (invoice: Invoice) => {
    const firstMethod = paymentMethods[0]?.displayName || 'Other';
    setPaymentForm({ amount: getInvoiceBalance(invoice), paymentDate: today(), paymentMethod: firstMethod, reference: '', notes: '' });
    setRecordPaymentOpen(true);
  };
  const recordPayment = async () => {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/invoice-payments', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: selected.id, ...paymentForm }) });
      const payload = await response.json() as { ok?: boolean; invoice?: Invoice; payment?: InvoicePayment; error?: string };
      if (!response.ok || !payload.ok || !payload.invoice || !payload.payment) throw new Error(payload.error || 'Payment could not be recorded.');
      useStore.setState((state) => ({ invoices: state.invoices.map((item) => item.id === selected.id ? payload.invoice as Invoice : item) }));
      view(payload.invoice);
      setPayments((current) => [payload.payment as InvoicePayment, ...current]);
      setRecordPaymentOpen(false);
      emitAppToast({ tone: 'success', message: `Payment of ${formatCurrency(payload.payment.amount)} recorded.` });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Payment could not be recorded.'); }
    finally { setSaving(false); }
  };
  const remove = async (invoice: Invoice) => {
    if (!window.confirm(`Delete draft ${invoice.number}?`)) return;
    const result = await deleteInvoice(invoice.id);
    if (result.ok) setOpen(false);
  };
  const createInQbo = async (invoice: Invoice) => {
    try {
      const response = await fetch('/api/integrations/quickbooks/invoices', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        invoice?: QuickBooksInvoiceStatus;
        error?: string;
      };
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'QuickBooks request failed.');
      setQbo((current) => ({
        ...current,
        [invoice.id]: payload.invoice ?? null,
      }));
    } catch (cause) {
      emitAppToast({
        tone: 'error',
        message: cause instanceof Error ? cause.message : 'QuickBooks request failed.',
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="OliveOps is the invoice record. QuickBooks is an optional accounting destination."
        action={
          <Button onClick={() => start()}>
            <FilePlus2 /> New Invoice
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard label="Ready to Invoice" value={formatCurrency(metrics.ready)} sub="Drafts do not reserve availability" icon={<ReceiptText />} />
        <StatCard label="Outstanding" value={formatCurrency(metrics.outstanding)} sub="Issued unpaid balance" icon={<Mail />} />
        <StatCard label="Overdue" value={formatCurrency(metrics.overdue)} sub="Past due unpaid balance" icon={<Wallet />} color="text-red-700" />
        <StatCard label="Total Billed" value={formatCurrency(metrics.billed)} sub="Issued, non-void invoices" icon={<BookOpenCheck />} />
        <StatCard label="Drafts" value={formatCurrency(metrics.drafts)} sub="Not recognized as billed" icon={<FilePlus2 />} />
      </div>
      <Card className="overflow-visible">
        <div className="border-b border-brand-100 p-4 dark:border-brand-600">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative lg:w-96">
              <Search className="absolute left-3 top-3 h-4 w-4 text-brand-400" />
              <input aria-label="Search invoices" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoice, client or job" className="h-10 w-full rounded-xl border border-brand-100 bg-white pl-9 pr-3 text-sm dark:border-brand-600 dark:bg-brand-700" />
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {filters.map((item) => (
                <button key={item.value} onClick={() => setFilter(item.value)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${filter === item.value ? 'bg-brand-800 text-white dark:bg-brand-100 dark:text-brand-900' : 'text-brand-500 hover:bg-brand-50'}`}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title="No matching invoices"
            description="Create a draft from a job or adjust the current filters."
            action={
              <Button onClick={() => start()}>
                <FilePlus2 /> New Invoice
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-brand-100 bg-brand-50 text-left text-brand-500 dark:bg-brand-800">
                  <th className="px-4 py-3">Invoice</th>
                  <th>Client</th>
                  <th>Job</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Balance</th>
                  <th className="pl-4">Status</th>
                  <th>QuickBooks</th>
                  <th className="px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100">
                {rows.map((invoice) => {
                  const linked = invoice.quickBooksLinked || Boolean(qbo[invoice.id]);
                  return (
                    <tr key={invoice.id} onClick={() => view(invoice)} className="cursor-pointer hover:bg-brand-50">
                      <td className="px-4 py-3 font-semibold">{invoice.number}</td>
                      <td>{invoice.customerNameSnapshot || clientName(customerMap.get(invoice.customerId))}</td>
                      <td>{invoice.jobTitleSnapshot || jobMap.get(invoice.jobId)?.title || 'Unknown job'}</td>
                      <td>{invoice.issueDate}</td>
                      <td>{invoice.dueDate}</td>
                      <td className="text-right font-medium">{formatCurrency(invoice.amount)}</td>
                      <td className="text-right">{formatCurrency(getInvoiceBalance(invoice))}</td>
                      <td className="pl-4">
                        <Badge label={invoice.status} className={badge[invoice.status]} />
                      </td>
                      <td className="text-xs">{qbo[invoice.id]?.documentNumber || (linked ? 'Linked' : 'Not linked')}</td>
                      <td className="relative px-4 text-right" onClick={(event) => event.stopPropagation()}>
                        <button aria-label={`Actions for ${invoice.number}`} className="h-9 w-9 rounded-lg hover:bg-brand-100" onClick={() => setMenu(menu === invoice.id ? null : invoice.id)}>
                          <Ellipsis className="mx-auto" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {menuInvoice ? <InvoiceActionsMenu invoice={menuInvoice} linked={menuInvoice.quickBooksLinked || Boolean(qbo[menuInvoice.id])} onClose={() => setMenu(null)} onOpen={() => view(menuInvoice)} onSend={() => void sendInvoice(menuInvoice)} onDelete={() => void remove(menuInvoice)} /> : null}
      {open ? (
        <div className="fixed inset-0 z-50">
          <button aria-label="Close invoice drawer" className="absolute inset-0 bg-black/40" onClick={() => !saving && setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-7xl flex-col border-l border-brand-100 bg-brand-50 shadow-2xl dark:border-brand-600 dark:bg-brand-800">
            <header className="flex h-16 items-center justify-between border-b border-brand-100 bg-white px-5 dark:border-brand-600 dark:bg-brand-700">
              <div>
                <p className="text-xs font-semibold uppercase text-brand-400">{!selected ? 'New draft invoice' : selected.status === 'draft' ? 'Draft invoice' : 'Invoice'}</p>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{selected?.number ?? 'Invoice number assigned when saved'}</h2>
                  {selected ? <Badge label={displayStatus(selected)} className={badge[displayStatus(selected)]} /> : null}
                </div>
              </div>
              <button aria-label="Close" className="h-10 w-10 rounded-lg hover:bg-brand-100" onClick={() => setOpen(false)}>
                <X className="mx-auto" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto">
              <div className="grid min-h-full xl:grid-cols-[minmax(0,1fr)_340px]">
                <main className="space-y-6 p-5 lg:p-7">
                  {selected && !editable ? (
                    <div className="rounded-lg border border-brand-200 bg-white p-4 text-sm dark:bg-brand-700">
                      <strong>Read-only invoice.</strong> {selected.quickBooksLinked || qbo[selected.id] ? 'This invoice is linked to QuickBooks.' : selected.schemaVersion !== 2 ? 'Legacy calculations are preserved.' : 'Financial details lock when issued.'}
                    </div>
                  ) : null}
                  {selected?.deliveryStatus === 'failed' ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><strong>Email delivery failed.</strong> {selected.deliveryFailureReason || 'The provider did not accept this message.'}</div> : null}
                  <section>
                    <h3 className="mb-3 text-sm font-semibold">1. Job and contract</h3>
                    <Select label="Job" required disabled={Boolean(selected) || !editable} value={form.jobId} onChange={(event) => chooseJob(event.target.value)}>
                      <option value="">Select a job</option>
                      {jobs
                        .filter((item) => item.status !== 'cancelled')
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.jobNumber ? `${item.jobNumber} · ` : ''}
                            {item.title}
                          </option>
                        ))}
                    </Select>
                    {job ? (
                      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-brand-100 bg-white p-3 text-sm dark:bg-brand-700 lg:grid-cols-5">
                        <Info label="Client" value={selected ? selected.customerNameSnapshot || 'Unknown client' : clientName(customerMap.get(job.customerId))} />
                        <Info label="Job" value={selected ? selected.jobTitleSnapshot || 'Unknown job' : job.title} />
                        <Info label="Billing address" value={selected ? selected.billingAddressSnapshot || 'Not recorded' : getCustomerBillingAddressSnapshot(customerMap.get(job.customerId)) || 'Not recorded'} />
                        <Info label="Job address" value={selected ? selected.jobAddressSnapshot || 'Not recorded' : job.propertyAddressSnapshot || 'Not recorded'} />
                        <Info label="Proposal" value={job.originalEstimateSnapshot?.proposalNumber || 'Not recorded'} />
                      </div>
                    ) : null}
                  </section>
                  <section>
                    <h3 className="mb-3 text-sm font-semibold">2. Invoice type and billing method</h3>
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                      {(['deposit', 'progress', 'final', 'custom'] as InvoiceType[]).map((type) => (
                        <button disabled={!editable || !job} key={type} onClick={() => chooseType(type)} className={`rounded-lg border px-3 py-2 text-left ${form.invoiceType === type ? 'border-accent-500 bg-accent-50 ring-1 ring-accent-500/20 dark:bg-accent-950/20' : 'border-brand-100 bg-white dark:bg-brand-700'}`}>
                          <span className="block text-sm font-semibold capitalize">{type}</span>
                          <span className="mt-0.5 block text-xs text-brand-500 dark:text-brand-200">{invoiceTypeDescriptions[type]}</span>
                        </button>
                      ))}
                    </div>
                    {job && form.invoiceType !== 'custom' && contractSchedule?.items.length ? (
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {contractSchedule.items.map((item) => {
                          const linked = paymentScheduleItemState(item.id, invoices, job.id);
                          const active = item.id === form.paymentScheduleItemId;
                          return (
                            <button type="button" key={item.id} disabled={!editable || Boolean(linked.invoice && linked.invoice.id !== selected?.id)} onClick={() => setForm(applyScheduleItem(form, job, item.id))} className={`rounded-lg border p-3 text-left ${active ? 'border-accent-500 bg-accent-50' : 'border-brand-100 bg-white disabled:opacity-60'}`}>
                              <span className="flex items-center justify-between gap-3">
                                <strong className="text-sm">{item.label}</strong>
                                <Badge label={linked.status.replaceAll('_', ' ')} className="bg-gray-100 text-gray-700" />
                              </span>
                              <span className="mt-1 block text-xs text-brand-500">
                                {item.percentage ? `${item.percentage}% · ` : ''}
                                {item.due} · {formatCurrency(item.subtotal)} + tax
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {job && editable && !contractSchedule?.items.length && !['custom', 'final'].includes(form.invoiceType) ? (
                      <div className="mt-3 grid gap-3 rounded-lg border border-brand-100 bg-white p-3 dark:bg-brand-700 md:grid-cols-3">
                        <Select
                          label="Billing method"
                          value={form.amountMode}
                          onChange={(event) => {
                            const nextMode = event.target.value as Form['amountMode'];
                            const next = {
                              ...form,
                              amountMode: nextMode,
                              lineItems: nextMode === 'work_areas' || form.amountMode === 'work_areas' ? [] : form.lineItems,
                            };
                            setForm(applyAmount(next));
                          }}
                        >
                          <option value="fixed">Fixed pre-tax amount</option>
                          <option value="percent">Percentage</option>
                          {form.invoiceType === 'progress' ? <option value="work_areas">Select work-area lines</option> : null}
                        </Select>
                        {form.amountMode === 'fixed' ? (
                          <Input
                            label="Pre-tax amount"
                            type="number"
                            min={0.01}
                            value={form.billingAmount}
                            onChange={(event) => {
                              const next = {
                                ...form,
                                billingAmount: Number(event.target.value),
                              };
                              setForm(applyAmount(next));
                            }}
                          />
                        ) : form.amountMode === 'percent' ? (
                          <div>
                            <Input
                              label="Percentage of contract"
                              type="number"
                              min={0.01}
                              max={100}
                              value={form.billingPercent}
                              onChange={(event) => {
                                const next = {
                                  ...form,
                                  billingPercent: Number(event.target.value),
                                };
                                setForm(applyAmount(next));
                              }}
                            />
                            <p className="mt-1 text-xs font-medium text-brand-500">Calculated pre-tax amount: {formatCurrency(summary.subtotal)}</p>
                          </div>
                        ) : (
                          <p className="self-end pb-2 text-xs text-brand-400 md:col-span-2">Full selected lines will be added to this invoice.</p>
                        )}
                      </div>
                    ) : null}
                    {job && editable && form.invoiceType === 'final' ? <p className="mt-3 text-sm font-medium text-brand-600 dark:text-brand-100">Remaining pre-tax balance: {formatCurrency(position.remainingAmount)}</p> : null}
                    {job && editable && !contractSchedule?.items.length && form.invoiceType === 'progress' && form.amountMode === 'work_areas' ? (
                      <div className="mt-3 space-y-2">
                        {(job.originalEstimateSnapshot?.workAreas ?? job.operationalWorkAreas ?? []).map((area) => (
                          <div key={area.id} className="rounded-lg border bg-white dark:bg-brand-700">
                            <p className="border-b px-4 py-2 text-sm font-semibold">{area.name}</p>
                            {area.lineItems.map((line) => (
                              <label key={line.id} className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm">
                                <input type="checkbox" checked={form.lineItems.some((item) => item.sourceLineItemId === line.id)} onChange={() => toggleSource(line, area.id)} />
                                <span className="flex-1">{line.description || line.itemName}</span>
                                <span>
                                  {line.quantity} {line.unit}
                                </span>
                                <strong>{formatCurrency(linePrice(line) * line.quantity)}</strong>
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                  <section>
                    <div className="mb-3 flex items-end justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">{form.invoiceType === 'custom' ? '3. Invoice lines' : '3. Billing summary'}</h3>
                        {form.invoiceType !== 'custom' && form.amountMode !== 'work_areas' ? <p className="mt-1 text-xs text-brand-400">Calculated from the sold contract. Description remains editable while Draft.</p> : null}
                      </div>
                      {editable && form.invoiceType === 'custom' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              lineItems: [...current.lineItems, emptyLine()],
                            }))
                          }
                        >
                          <Plus /> Add line
                        </Button>
                      ) : null}
                    </div>
                    <div className="space-y-3">
                      {form.invoiceType !== 'custom' && form.lineItems.length ? (
                        <div className="rounded-lg border border-brand-100 bg-white p-4 dark:bg-brand-700">
                          <Input label="Description" disabled={!editable} value={form.lineItems[0].description} onChange={(event) => updateLine(form.lineItems[0].id, 'description', event.target.value)} />
                          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                            <Info label="Contract subtotal" value={formatCurrency(contractSchedule?.contractSubtotal ?? position.contractAmount)} />
                            <Info label={selectedScheduleItem?.label ?? 'Contract billing'} value={selectedScheduleItem?.percentage ? `${selectedScheduleItem.percentage}%` : formatCurrency(summary.subtotal)} />
                            <Money label="Invoice subtotal" value={summary.subtotal} />
                            <Money label={`HST (${form.taxRate}%)`} value={summary.taxAmount} />
                            <div className="border-t border-brand-100 pt-3 sm:col-span-2">
                              <Money label="Amount due" value={summary.amount} strong />
                            </div>
                          </dl>
                        </div>
                      ) : (
                        form.lineItems.map((line, index) => {
                          const generatedLumpSum = form.invoiceType !== 'custom' && form.amountMode !== 'work_areas' && !line.sourceLineItemId;
                          return (
                            <InvoiceLine
                              key={line.id}
                              line={line}
                              index={index}
                              taxRate={form.taxRate}
                              legacy={Boolean(selected && selected.schemaVersion !== 2)}
                              editable={editable && !line.sourceLineItemId}
                              financialEditable={editable && form.invoiceType === 'custom' && !line.sourceLineItemId}
                              generatedLumpSum={generatedLumpSum}
                              onChange={updateLine}
                              onRemove={() =>
                                setForm((current) => ({
                                  ...current,
                                  lineItems: current.lineItems.filter((item) => item.id !== line.id),
                                }))
                              }
                            />
                          );
                        })
                      )}
                      {!form.lineItems.length ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-brand-400">{contractSchedule?.items.length ? 'Select a payment schedule item.' : 'Choose a billing amount or select work-area lines.'}</p> : null}
                    </div>
                  </section>
                  <section>
                    <h3 className="mb-3 text-sm font-semibold">4. Invoice details</h3>
                    <div className="grid gap-3 md:grid-cols-4">
                      <Input
                        label="Issue date"
                        type="date"
                        disabled={!editable}
                        value={form.issueDate}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            issueDate: event.target.value,
                            dueDate: plusDays(event.target.value, current.paymentTermsDays),
                          }))
                        }
                      />
                      <Input
                        label="Payment terms (days)"
                        type="number"
                        disabled={!editable}
                        value={form.paymentTermsDays}
                        onChange={(event) => {
                          const days = Number(event.target.value);
                          setForm((current) => ({
                            ...current,
                            paymentTermsDays: days,
                            dueDate: plusDays(current.issueDate, days),
                          }));
                        }}
                      />
                      <Input
                        label="Due date"
                        type="date"
                        disabled={!editable}
                        value={form.dueDate}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            dueDate: event.target.value,
                          }))
                        }
                      />
                      {form.invoiceType === 'custom' ? (
                        <Input
                          label="HST rate (%)"
                          type="number"
                          disabled={!editable}
                          value={form.taxRate}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              taxRate: Number(event.target.value),
                            }))
                          }
                        />
                      ) : (
                        <Info label="Tax treatment" value={`Inherited from sold contract · ${form.taxRate}%`} />
                      )}
                    </div>
                  </section>
                  <section>
                    <h3 className="mb-3 text-sm font-semibold">5. Notes</h3>
                    <TextArea
                      label="Notes"
                      rows={3}
                      className="resize-y"
                      disabled={!editable}
                      value={form.notes}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                    />
                  </section>
                </main>
                <aside className="border-t bg-white p-5 dark:bg-brand-700 xl:border-l xl:border-t-0">
                  <div className="sticky top-5">
                    <h3 className="text-sm font-semibold">Financial summary</h3>
                    <dl className="mt-4 space-y-3 text-sm">
                      <Money label="Contract total" value={selected?.contractAmountSnapshot ?? position.contractAmount} />
                      <Money label="Previously invoiced" value={selected?.previouslyInvoicedSnapshot ?? position.previouslyInvoiced} />
                      <Money label="This invoice subtotal" value={selected ? getInvoiceContractAmount(selected) : summary.subtotal} border />
                      <Money label="HST" value={selected?.taxAmount ?? summary.taxAmount} />
                      <Money label="This invoice total" value={selected?.amount ?? summary.amount} strong />
                      {selected && selected.status !== 'draft' ? <><Money label="Amount paid" value={selected.amountPaid ?? 0} /><Money label="Balance due" value={getInvoiceBalance(selected)} strong /></> : null}
                      <Money label="Remaining after" value={Math.max(0, position.remainingAmount - summary.subtotal)} border />
                    </dl>
                    {selected?.sentAt ? <div className="mt-5 border-t border-brand-100 pt-4 text-sm"><h3 className="font-semibold">Customer activity</h3><dl className="mt-2 space-y-1 text-brand-500"><div className="flex justify-between"><dt>Sent</dt><dd>{new Date(selected.sentAt).toLocaleDateString()}</dd></div><div className="flex justify-between"><dt>Viewed</dt><dd>{selected.viewCount ?? 0} time{selected.viewCount === 1 ? '' : 's'}</dd></div>{selected.lastViewedAt ? <div className="flex justify-between gap-3"><dt>Last viewed</dt><dd className="text-right">{new Date(selected.lastViewedAt).toLocaleString()}</dd></div> : null}</dl></div> : null}
                    {selected && selected.status !== 'draft' ? <div className="mt-5 border-t border-brand-100 pt-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Payments</h3>{!['paid', 'void'].includes(displayStatus(selected)) ? <Button size="sm" variant="secondary" onClick={() => openRecordPayment(selected)}><Wallet /> Record Payment</Button> : null}</div>{payments.length ? <div className="mt-3 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-brand-400"><th className="py-1">Date</th><th>Method</th><th>Reference</th><th className="text-right">Amount</th></tr></thead><tbody className="divide-y divide-brand-100">{payments.map((payment) => <tr key={payment.id}><td className="py-2">{payment.paymentDate}</td><td>{payment.paymentMethod}</td><td>{payment.reference || '-'}</td><td className="text-right font-semibold">{formatCurrency(payment.amount)}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-xs text-brand-400">No payments recorded.</p>}</div> : null}
                    {exceeds ? (
                      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        Exceeds remaining contract by {formatCurrency(summary.subtotal - position.remainingAmount)}.
                        {form.invoiceType === 'custom' && editable ? (
                          <label className="mt-3 flex gap-2 font-medium">
                            <input
                              type="checkbox"
                              checked={form.overContractConfirmed}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  overContractConfirmed: event.target.checked,
                                }))
                              }
                            />{' '}
                            Confirm intentional over-contract billing
                          </label>
                        ) : null}
                      </div>
                    ) : null}
                    {error ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
                    <div className="mt-6 space-y-2">
                      {editable ? (
                        <>
                          <Button className="w-full" disabled={saving || Boolean(saveDisabledReason) || Boolean(selected && !draftDirty)} title={selected && !draftDirty ? 'No unsaved changes.' : saveDisabledReason || undefined} onClick={() => void save()}>
                            {saving ? 'Saving...' : 'Save draft invoice'}
                          </Button>
                          {saveDisabledReason && !saving ? (
                            <p className="text-xs text-brand-400" role="status">
                              {saveDisabledReason}
                            </p>
                          ) : null}
                        </>
                      ) : null}
                      {selected?.status === 'draft' && !selected.quickBooksLinked && !qbo[selected.id] ? (
                        <>
                          <Button className="w-full" variant="secondary" disabled={saving || draftDirty} title={draftDirty ? 'Save draft changes before sending.' : undefined} onClick={() => void sendInvoice(selected)}>
                            <Send /> Send Invoice
                          </Button>
                          {draftDirty ? <p className="text-xs text-brand-400">Save draft changes before sending.</p> : null}
                          <Button className="w-full" variant="ghost" onClick={() => void remove(selected)}>
                            <Trash2 /> Delete draft
                          </Button>
                        </>
                      ) : null}
                      {selected?.status === 'sent' && selected.deliveryStatus === 'failed' ? <Button className="w-full" variant="secondary" disabled={saving} onClick={() => void sendInvoice(selected)}><Send /> Retry Email</Button> : null}
                      {selected && !selected.quickBooksLinked && !qbo[selected.id] && ['sent', 'partially_paid', 'overdue'].includes(selected.status) ? (
                        <>
                          <Input label="Void reason" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} />
                          <Button className="w-full" variant="danger" disabled={saving} onClick={() => void status(selected, 'void')}>
                            <Ban /> Void invoice
                          </Button>
                        </>
                      ) : null}
                      {selected && !selected.quickBooksLinked && selected.status !== 'draft' && selected.status !== 'void' && !qbo[selected.id] ? (
                        <Button className="w-full" variant="secondary" disabled={!quickBooks.connected} onClick={() => void createInQbo(selected)}>
                          <BookOpenCheck /> Create in QuickBooks
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
      {recordPaymentOpen && selected ? <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl dark:bg-brand-700"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Record Payment</h2><p className="text-sm text-brand-500">Record money received outside OliveOps. Balance due: {formatCurrency(getInvoiceBalance(selected))}</p></div><button aria-label="Close" className="h-9 w-9 rounded-lg hover:bg-brand-100" onClick={() => setRecordPaymentOpen(false)}><X className="mx-auto" /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><Input label="Amount" type="number" min={0.01} max={getInvoiceBalance(selected)} step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: Number(event.target.value) }))} /><Input label="Payment Date" type="date" value={paymentForm.paymentDate} onChange={(event) => setPaymentForm((current) => ({ ...current, paymentDate: event.target.value }))} /><Select label="Payment Method" value={paymentForm.paymentMethod} onChange={(event) => setPaymentForm((current) => ({ ...current, paymentMethod: event.target.value }))}>{paymentMethods.map((method) => <option key={method.type} value={method.displayName}>{method.displayName}</option>)}<option value="Other">Other</option></Select><Input label="Reference / Confirmation #" value={paymentForm.reference} onChange={(event) => setPaymentForm((current) => ({ ...current, reference: event.target.value }))} /><div className="sm:col-span-2"><TextArea label="Notes" rows={3} value={paymentForm.notes} onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))} /></div></div>{error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}<div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setRecordPaymentOpen(false)}>Cancel</Button><Button disabled={saving || paymentForm.amount <= 0 || paymentForm.amount > getInvoiceBalance(selected)} onClick={() => void recordPayment()}><Wallet /> {saving ? 'Recording...' : 'Record Payment'}</Button></div></div></div> : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-brand-400">{label}</p>
      <p className="mt-0.5 break-words font-medium leading-snug">{value}</p>
    </div>
  );
}
function Money({ label, value, border, strong }: { label: string; value: number; border?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${border ? 'border-t border-brand-100 pt-3' : ''} ${strong ? 'text-base font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd>{formatCurrency(value)}</dd>
    </div>
  );
}

function InvoiceActionsMenu({ invoice, linked, onClose, onOpen, onSend, onDelete }: { invoice: Invoice; linked: boolean; onClose: () => void; onOpen: () => void; onSend: () => void; onDelete: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({
    left: 8,
    top: 8,
    visibility: 'hidden',
  });

  useLayoutEffect(() => {
    const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label]')).find((button) => button.getAttribute('aria-label') === `Actions for ${invoice.number}`) ?? null;
    const menuElement = menuRef.current;
    if (!trigger || !menuElement) return;

    triggerRef.current = trigger;
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', `invoice-actions-${invoice.id}`);

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menuElement.getBoundingClientRect();
    setStyle({
      ...calculateFixedMenuPosition(triggerRect, { width: 160, height: menuRect.height }, { width: window.innerWidth, height: window.innerHeight }),
      visibility: 'visible',
    });
    menuElement.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });

    return () => {
      trigger.removeAttribute('aria-haspopup');
      trigger.removeAttribute('aria-expanded');
      trigger.removeAttribute('aria-controls');
    };
  }, [invoice.id, invoice.number]);

  useEffect(() => {
    const closeAndRestoreFocus = () => {
      const trigger = triggerRef.current;
      onClose();
      window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAndRestoreFocus();
    };
    const closeOnViewportChange = () => onClose();

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', closeOnViewportChange, true);
    window.addEventListener('resize', closeOnViewportChange);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', closeOnViewportChange, true);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [onClose]);

  const select = (action: () => void) => {
    onClose();
    action();
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (currentIndex + 1) % items.length : (currentIndex <= 0 ? items.length : currentIndex) - 1;
    items[nextIndex]?.focus();
  };

  return createPortal(
    <div ref={menuRef} id={`invoice-actions-${invoice.id}`} role="menu" aria-label={`Actions for ${invoice.number}`} className="fixed z-[80] w-40 overflow-y-auto rounded-lg border border-brand-100 bg-white p-1 text-left shadow-xl dark:border-brand-600 dark:bg-brand-700" style={style} onKeyDown={handleKeyDown}>
      <button type="button" role="menuitem" className="w-full px-3 py-2 text-sm hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:hover:bg-brand-600" onClick={() => select(onOpen)}>
        Open invoice
      </button>
      {invoice.status === 'draft' && !linked ? (
        <button type="button" role="menuitem" className="w-full px-3 py-2 text-sm hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:hover:bg-brand-600" onClick={() => select(onSend)}>
          Send invoice
        </button>
      ) : null}
      {invoice.status === 'sent' && invoice.deliveryStatus === 'failed' ? <button type="button" role="menuitem" className="w-full px-3 py-2 text-sm hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:hover:bg-brand-600" onClick={() => select(onSend)}>Retry email</button> : null}
      {invoice.status === 'draft' && !linked ? (
        <button type="button" role="menuitem" className="w-full px-3 py-2 text-sm text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40" onClick={() => select(onDelete)}>
          Delete draft
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

function InvoiceLine({ line, index, taxRate, legacy, editable, financialEditable, generatedLumpSum, onChange, onRemove }: { line: InvoiceLineItem; index: number; taxRate: number; legacy: boolean; editable: boolean; financialEditable: boolean; generatedLumpSum: boolean; onChange: <K extends keyof InvoiceLineItem>(id: ID, key: K, value: InvoiceLineItem[K]) => void; onRemove: () => void }) {
  const financials = calculateInvoiceLineFinancials(line, taxRate, legacy ? undefined : 2);
  return (
    <div className="rounded-lg border border-brand-100 bg-white p-4 dark:bg-brand-700">
      <div className="mb-3 flex justify-between">
        <span className="text-xs font-semibold text-brand-400">LINE {index + 1}</span>
        {editable && !generatedLumpSum ? (
          <button aria-label={`Remove line ${index + 1}`} onClick={onRemove}>
            <Trash2 className="h-4 w-4 text-red-600" />
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(80px,0.75fr)_minmax(90px,0.85fr)_minmax(120px,1fr)_minmax(150px,1.25fr)]">
        <div className="col-span-2">
          <Input label="Description" disabled={!editable} value={line.description} onChange={(event) => onChange(line.id, 'description', event.target.value)} />
        </div>
        <Input label="Quantity" type="number" disabled={!financialEditable} value={line.quantity} onChange={(event) => onChange(line.id, 'quantity', Number(event.target.value))} />
        <Input label="Unit" disabled={!financialEditable} value={line.unit} onChange={(event) => onChange(line.id, 'unit', event.target.value)} />
        <Input className={!financialEditable ? 'disabled:bg-brand-50 disabled:text-brand-700 dark:disabled:bg-brand-800 dark:disabled:text-brand-100' : ''} label={legacy ? 'Legacy price incl. tax' : 'Unit Price'} type="number" disabled={!financialEditable} value={legacy ? line.unitPrice : (line.unitPriceBeforeTax ?? 0)} onChange={(event) => onChange(line.id, 'unitPriceBeforeTax', Number(event.target.value))} />
        {generatedLumpSum ? (
          <div>
            <p className="mb-1.5 text-sm font-medium text-brand-700 dark:text-brand-100">Category</p>
            <p className="min-h-10 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:border-brand-600 dark:bg-brand-800 dark:text-brand-100" title="Contract Services">
              Contract Services
            </p>
          </div>
        ) : (
          <Select label="Category" disabled={!financialEditable} value={line.category} onChange={(event) => onChange(line.id, 'category', event.target.value as InvoiceLineCategory)}>
            <option value="contract_service">Contract Services</option>
            <option value="labour">Labour</option>
            <option value="material">Material</option>
            <option value="equipment">Equipment</option>
            <option value="subcontractor">Subcontractor</option>
          </Select>
        )}
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-3 text-sm">
        <label className="flex gap-2">
          <input type="checkbox" disabled={!editable} checked={line.taxable} onChange={(event) => onChange(line.id, 'taxable', event.target.checked)} /> Taxable
        </label>
        <div className="flex gap-5">
          <span>
            Subtotal <strong>{formatCurrency(financials.subtotal)}</strong>
          </span>
          <span>
            Tax <strong>{formatCurrency(financials.taxAmount)}</strong>
          </span>
          <span>
            Total <strong>{formatCurrency(financials.total)}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
