import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, FilePlus2, Mail, Pencil, Plus, ReceiptText, RefreshCw, Trash2, Wallet } from 'lucide-react';
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select, StatCard } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import { formatCurrency, generateId } from '../../utils';
import {
  calculateInvoiceLineAmount,
  calculateInvoiceSummary,
  normalizeInvoiceFinancials,
  validateInvoiceLineItems,
} from '../../utils/invoiceModel.js';
import type { ID, Invoice, InvoiceLineItem, InvoiceStatus, LineItemCategory, QuickBooksIntegration, QuickBooksInvoiceStatus } from '../../types';

type StatusFilter = 'all' | InvoiceStatus;

const statusBadgeClass: Record<InvoiceStatus, string> = {
  draft: 'bg-brand-100 text-brand-700',
  sent: 'bg-accent-50 text-accent-600',
  paid: 'bg-brand-200 text-brand-800',
  overdue: 'bg-accent-100 text-accent-700',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const defaultDueDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
};

const createEmptyLineItem = (): InvoiceLineItem => ({
  id: generateId(),
  category: 'labour',
  description: '',
  quantity: 1,
  unit: 'job',
  unitPrice: 0,
  amount: 0,
  taxable: true,
});

const emptyInvoiceForm = () => ({
  jobId: '',
  number: '',
  issueDate: todayIso(),
  dueDate: defaultDueDate(),
  status: 'draft' as InvoiceStatus,
  amount: 0,
  lineMode: true,
  lineItems: [createEmptyLineItem()],
  taxRate: 0,
  notes: '',
});

function normalizeStatus(invoice: Invoice): InvoiceStatus {
  if (invoice.status === 'paid') return 'paid';
  if (invoice.status === 'draft') return 'draft';

  const due = new Date(invoice.dueDate);
  const now = new Date();
  if (invoice.status === 'sent' && due < now) return 'overdue';
  return invoice.status;
}

export default function InvoicesPage() {
  const { jobs, customers, invoices, addInvoice, updateInvoice, deleteInvoice } = useStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [form, setForm] = useState(emptyInvoiceForm());
  const [quickBooks, setQuickBooks] = useState<QuickBooksIntegration>({ connected: false, environment: 'sandbox' });
  const [quickBooksInvoices, setQuickBooksInvoices] = useState<Record<ID, QuickBooksInvoiceStatus | null>>({});
  const [quickBooksInFlight, setQuickBooksInFlight] = useState<ID[]>([]);

  const jobLookup = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const customerLookup = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);
  const invoiceSummary = useMemo(
    () => calculateInvoiceSummary(form.lineItems, form.taxRate),
    [form.lineItems, form.taxRate]
  );

  useEffect(() => {
    const loadQuickBooksStatus = async () => {
      try {
        const response = await fetch('/api/integrations/quickbooks/status', { credentials: 'include' });
        const payload = await response.json() as { ok: boolean; integration?: QuickBooksIntegration };
        if (response.ok && payload.ok && payload.integration) setQuickBooks(payload.integration);
      } catch {
        setQuickBooks({ connected: false, environment: 'sandbox' });
      }
    };
    void loadQuickBooksStatus();
  }, []);

  const invoicesWithComputedStatus = useMemo(() => {
    return invoices.map((invoice) => ({
      ...invoice,
      status: normalizeStatus(invoice),
    }));
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    if (statusFilter === 'all') return invoicesWithComputedStatus;
    return invoicesWithComputedStatus.filter((invoice) => invoice.status === statusFilter);
  }, [invoicesWithComputedStatus, statusFilter]);

  const totals = useMemo(() => {
    const totalBilled = invoicesWithComputedStatus.reduce((sum, invoice) => sum + invoice.amount, 0);
    const outstanding = invoicesWithComputedStatus
      .filter((invoice) => invoice.status === 'sent' || invoice.status === 'overdue')
      .reduce((sum, invoice) => sum + invoice.amount, 0);
    const overdue = invoicesWithComputedStatus
      .filter((invoice) => invoice.status === 'overdue')
      .reduce((sum, invoice) => sum + invoice.amount, 0);

    const invoicedByJob = new Map<ID, number>();
    for (const invoice of invoicesWithComputedStatus) {
      invoicedByJob.set(invoice.jobId, (invoicedByJob.get(invoice.jobId) ?? 0) + invoice.amount);
    }

    const completedJobs = jobs.filter((job) => job.status === 'completed');
    const readyToInvoice = completedJobs.reduce((sum, job) => {
      const alreadyInvoiced = invoicedByJob.get(job.id) ?? 0;
      const remaining = Math.max(0, job.contractValue - alreadyInvoiced);
      return sum + remaining;
    }, 0);

    return {
      totalBilled,
      outstanding,
      overdue,
      readyToInvoice,
    };
  }, [invoicesWithComputedStatus, jobs]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyInvoiceForm());
    setModalOpen(true);
  };

  const openEdit = (invoice: Invoice) => {
    setEditing(invoice);
    setForm({
      jobId: invoice.jobId,
      number: invoice.number,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      amount: invoice.amount,
      lineMode: Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0,
      lineItems: invoice.lineItems?.map((lineItem) => ({ ...lineItem })) ?? [],
      taxRate: invoice.taxRate ?? 0,
      notes: invoice.notes,
    });
    setModalOpen(true);
  };

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const setLineItem = <K extends keyof InvoiceLineItem>(lineItemId: ID, key: K, value: InvoiceLineItem[K]) => {
    setForm((current) => ({
      ...current,
      lineItems: current.lineItems.map((lineItem) => {
        if (lineItem.id !== lineItemId) return lineItem;
        const next = { ...lineItem, [key]: value };
        return { ...next, amount: calculateInvoiceLineAmount(next) };
      }),
    }));
  };

  const selectJob = (jobId: ID) => {
    const selectedJob = jobLookup.get(jobId);
    setForm((current) => ({
      ...current,
      jobId,
      taxRate: current.taxRate > 0 ? current.taxRate : (selectedJob?.originalEstimateSnapshot?.taxRate ?? 0),
    }));
  };

  const saveInvoice = () => {
    if (!form.jobId || !form.number.trim()) return;
    if (form.lineMode) {
      const lineError = validateInvoiceLineItems(form.lineItems, form.taxRate);
      if (lineError) {
        emitAppToast({ tone: 'error', message: lineError });
        return;
      }
    } else if (form.amount <= 0) {
      return;
    }
    const normalizedNumber = form.number.trim().toLowerCase();
    const duplicate = invoices.some((invoice) => {
      if (editing && invoice.id === editing.id) return false;
      return invoice.number.trim().toLowerCase() === normalizedNumber;
    });
    if (duplicate) {
      emitAppToast({ tone: 'error', message: 'Invoice number already exists.' });
      return;
    }

    const selectedJob = jobLookup.get(form.jobId);
    if (!selectedJob) return;

    const financials = form.lineMode
      ? normalizeInvoiceFinancials({ lineItems: form.lineItems, taxRate: form.taxRate })
      : { amount: Number(form.amount) };

    if (editing) {
      updateInvoice(editing.id, {
        jobId: form.jobId,
        customerId: selectedJob.customerId,
        number: form.number.trim(),
        issueDate: form.issueDate,
        dueDate: form.dueDate,
        status: form.status,
        ...financials,
        notes: form.notes.trim(),
      });
    } else {
      addInvoice({
        jobId: form.jobId,
        customerId: selectedJob.customerId,
        number: form.number.trim(),
        issueDate: form.issueDate,
        dueDate: form.dueDate,
        status: form.status,
        ...financials,
        notes: form.notes.trim(),
      });
    }

    setModalOpen(false);
  };

  const syncQuickBooksInvoice = async (invoice: Invoice, create: boolean) => {
    setQuickBooksInFlight((current) => [...current, invoice.id]);
    try {
      const response = await fetch(create
        ? '/api/integrations/quickbooks/invoices'
        : `/api/integrations/quickbooks/invoices?invoiceId=${encodeURIComponent(invoice.id)}`, {
        method: create ? 'POST' : 'GET',
        credentials: 'include',
        ...(create ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceId: invoice.id }),
        } : {}),
      });
      const payload = await response.json() as { ok: boolean; invoice?: QuickBooksInvoiceStatus | null; error?: string };
      if (!response.ok || !payload.ok) {
        emitAppToast({ tone: 'error', message: payload.error ?? 'QuickBooks invoice synchronization failed.' });
        return;
      }
      setQuickBooksInvoices((current) => ({ ...current, [invoice.id]: payload.invoice ?? null }));
      emitAppToast({
        tone: 'success',
        message: payload.invoice
          ? (create ? 'Invoice created in QuickBooks.' : 'QuickBooks invoice status refreshed.')
          : 'This invoice has not been created in QuickBooks.',
      });
    } catch {
      emitAppToast({ tone: 'error', message: 'QuickBooks invoice synchronization failed.' });
    } finally {
      setQuickBooksInFlight((current) => current.filter((invoiceId) => invoiceId !== invoice.id));
    }
  };

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Track what has been billed, what is outstanding, and what should be invoiced next."
        action={<Button onClick={openNew}><FilePlus2 size={16} /> New Invoice</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard label="Ready to Invoice" value={formatCurrency(totals.readyToInvoice)} icon={<ReceiptText size={28} />} color="text-brand-700" sub="Completed jobs not fully billed" />
        <StatCard label="Outstanding" value={formatCurrency(totals.outstanding)} icon={<Mail size={28} />} color="text-accent-600" sub="Sent or overdue" />
        <StatCard label="Overdue" value={formatCurrency(totals.overdue)} icon={<Wallet size={28} />} color="text-accent-700" sub="Past due date" />
        <StatCard label="Total Billed" value={formatCurrency(totals.totalBilled)} icon={<ReceiptText size={28} />} color="text-brand-700" sub={`${invoices.length} invoices`} />
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Invoice Register</h2>
            <p className="text-sm text-gray-500 mt-1">Create, edit, and track invoice status from one place.</p>
          </div>
          <div className="w-full sm:w-56">
            <Select label="Status Filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
            </Select>
          </div>
        </div>

        {filteredInvoices.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            description="Create your first invoice to start tracking cash collection."
            action={<Button onClick={openNew}><FilePlus2 size={16} /> New Invoice</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1160px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">Invoice #</th>
                  <th className="px-4 py-3 font-medium">Job</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Issue</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">QuickBooks</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredInvoices.map((invoice) => {
                  const job = jobLookup.get(invoice.jobId);
                  const customer = customerLookup.get(invoice.customerId);
                  const quickBooksInvoice = quickBooksInvoices[invoice.id];
                  const quickBooksBusy = quickBooksInFlight.includes(invoice.id);
                  const hasLineDetails = Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0;
                  return (
                    <tr key={invoice.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{invoice.number}</td>
                      <td className="px-4 py-2 text-gray-700">{job?.title ?? 'Unknown Job'}</td>
                      <td className="px-4 py-2 text-gray-700">{customer?.name ?? 'Unknown Customer'}</td>
                      <td className="px-4 py-2 text-gray-700">{invoice.issueDate}</td>
                      <td className="px-4 py-2 text-gray-700">{invoice.dueDate}</td>
                      <td className="px-4 py-2 text-right text-gray-900">{formatCurrency(invoice.amount)}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusBadgeClass[invoice.status]}`}>
                          {invoice.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {quickBooksInvoice ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-brand-900 dark:text-brand-50">{quickBooksInvoice.documentNumber || 'QuickBooks Invoice'}</span>
                              <span className="text-xs capitalize text-brand-500 dark:text-brand-200">{quickBooksInvoice.status}</span>
                            </div>
                            <div className="text-xs text-brand-500 dark:text-brand-200">Balance {formatCurrency(quickBooksInvoice.balance)}</div>
                            {quickBooksInvoice.localChangesNotSynced ? <div className="text-xs font-medium text-amber-700">Local changes not synced</div> : null}
                          </div>
                        ) : (
                          <span className="text-xs text-brand-500 dark:text-brand-200">
                            {!hasLineDetails ? 'Line details required' : quickBooks.connected ? 'Not checked' : 'Sandbox not connected'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {quickBooksInvoice ? (
                            <Button variant="ghost" size="sm" disabled={quickBooksBusy} title="Refresh QuickBooks status" onClick={() => void syncQuickBooksInvoice(invoice, false)}><RefreshCw size={13} /></Button>
                          ) : (
                            <Button variant="secondary" size="sm" disabled={!quickBooks.connected || !hasLineDetails || quickBooksBusy} onClick={() => void syncQuickBooksInvoice(invoice, true)}><BookOpenCheck size={13} /> Create in QBO</Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => openEdit(invoice)}><Pencil size={13} /></Button>
                          <Button variant="ghost" size="sm" onClick={() => deleteInvoice(invoice.id as ID)}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Invoice' : 'New Invoice'}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={saveInvoice}>{editing ? 'Save Changes' : 'Create Invoice'}</Button>
          </>
        )}
      >
        <div className="space-y-3">
          <Select
            label="Job"
            required
            value={form.jobId}
            onChange={(event) => selectJob(event.target.value)}
          >
            <option value="">Select a job</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>{job.title}</option>
            ))}
          </Select>
          <Input label="Invoice Number" required value={form.number} onChange={(event) => setField('number', event.target.value)} placeholder="e.g. INV-2026-001" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Issue Date" type="date" required value={form.issueDate} onChange={(event) => setField('issueDate', event.target.value)} />
            <Input label="Due Date" type="date" required value={form.dueDate} onChange={(event) => setField('dueDate', event.target.value)} />
          </div>
          {form.lineMode ? (
            <section className="space-y-3 border-y border-brand-100 py-4 dark:border-brand-600">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-brand-900 dark:text-brand-50">Invoice lines</h3>
                  <p className="mt-1 text-xs text-brand-500 dark:text-brand-200">Enter tax-inclusive prices. Tax is extracted from taxable lines.</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setForm((current) => ({ ...current, lineItems: [...current.lineItems, createEmptyLineItem()] }))}
                >
                  <Plus size={14} /> Add Line
                </Button>
              </div>

              {form.lineItems.map((lineItem, index) => (
                <div key={lineItem.id} className="space-y-3 rounded-lg border border-brand-100 p-3 dark:border-brand-600">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase text-brand-500 dark:text-brand-200">Line {index + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove line ${index + 1}`}
                      disabled={form.lineItems.length === 1}
                      onClick={() => setForm((current) => ({ ...current, lineItems: current.lineItems.filter((item) => item.id !== lineItem.id) }))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                  <Input
                    label="Description"
                    required
                    value={lineItem.description}
                    onChange={(event) => setLineItem(lineItem.id, 'description', event.target.value)}
                    placeholder="Work completed"
                  />
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Select
                      label="Category"
                      value={lineItem.category}
                      onChange={(event) => setLineItem(lineItem.id, 'category', event.target.value as LineItemCategory)}
                    >
                      <option value="labour">Labour</option>
                      <option value="material">Material</option>
                      <option value="equipment">Equipment</option>
                      <option value="subcontractor">Subcontractor</option>
                    </Select>
                    <Input label="Quantity" type="number" min={0.01} step="any" required value={lineItem.quantity} onChange={(event) => setLineItem(lineItem.id, 'quantity', Number(event.target.value))} />
                    <Input label="Unit" required value={lineItem.unit} onChange={(event) => setLineItem(lineItem.id, 'unit', event.target.value)} />
                    <Input label="Price incl. tax" type="number" min={0} step="0.01" required value={lineItem.unitPrice} onChange={(event) => setLineItem(lineItem.id, 'unitPrice', Number(event.target.value))} />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="flex items-center gap-2 text-sm font-medium text-brand-800 dark:text-brand-100">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-700"
                        checked={lineItem.taxable}
                        onChange={(event) => setLineItem(lineItem.id, 'taxable', event.target.checked)}
                      />
                      Taxable
                    </label>
                    <span className="text-sm font-semibold text-brand-900 dark:text-brand-50">{formatCurrency(calculateInvoiceLineAmount(lineItem))}</span>
                  </div>
                </div>
              ))}

              {form.lineItems.some((lineItem) => lineItem.taxable) ? (
                <Input label="Tax Rate (%)" type="number" min={0.01} max={100} step="0.01" required value={form.taxRate} onChange={(event) => setField('taxRate', Number(event.target.value))} />
              ) : null}

              <dl className="grid grid-cols-3 gap-3 rounded-lg bg-brand-50 p-3 text-sm dark:bg-brand-800">
                <div><dt className="text-brand-500 dark:text-brand-200">Net subtotal</dt><dd className="mt-1 font-semibold text-brand-900 dark:text-brand-50">{formatCurrency(invoiceSummary.subtotal)}</dd></div>
                <div><dt className="text-brand-500 dark:text-brand-200">Included tax</dt><dd className="mt-1 font-semibold text-brand-900 dark:text-brand-50">{formatCurrency(invoiceSummary.taxAmount)}</dd></div>
                <div><dt className="text-brand-500 dark:text-brand-200">Invoice total</dt><dd className="mt-1 font-semibold text-brand-900 dark:text-brand-50">{formatCurrency(invoiceSummary.amount)}</dd></div>
              </dl>
            </section>
          ) : (
            <section className="space-y-3 border-y border-brand-100 py-4 dark:border-brand-600">
              <Input label="Legacy Invoice Amount" type="number" min={0} required value={form.amount} onChange={(event) => setField('amount', Number(event.target.value))} />
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-brand-500 dark:text-brand-200">This historical invoice has no line or tax details and cannot be sent to QuickBooks.</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setForm((current) => ({ ...current, lineMode: true, lineItems: [createEmptyLineItem()] }))}
                >
                  <Plus size={14} /> Add Line Details
                </Button>
              </div>
            </section>
          )}
          <Select label="Status" required value={form.status} onChange={(event) => setField('status', event.target.value as InvoiceStatus)}>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </Select>
          <Input label="Notes" value={form.notes} onChange={(event) => setField('notes', event.target.value)} placeholder="Optional notes" />
        </div>
      </Modal>
    </div>
  );
}
