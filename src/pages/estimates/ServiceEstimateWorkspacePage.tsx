import { useEffect, useState } from 'react';
import { ArrowLeft, Download, Plus, RefreshCw, Save, Send, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import EstimateLinePricingEditor from '../../components/estimates/EstimateLinePricingEditor';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import type { Estimate, EstimateLineItem, EstimatePricingCatalog, EstimatePricingCatalogItem, EstimateService, EstimateStatus, LineItemCategory, ServiceEstimateLineItem } from '../../types';
import { formatCurrency, statusColor } from '../../utils';
import { applyEstimatePricingToLineItem, calculateEstimateLineItem, createEmptyEstimateLineItem } from '../../utils/estimateModel';
import { createEstimateProposalDocument, fetchEstimateProposal, proposalPdfFileName } from '../../utils/estimateProposalPdf';
import { calculateServiceEconomics, calculateServiceEstimateTotals, formatServiceFrequency } from '../../utils/servicePricingModel.js';
import { calculateSuggestedServiceVisits, normalizeEstimateServices } from '../../utils/workTypeModel.js';

const STATUSES: EstimateStatus[] = ['draft', 'sent', 'accepted', 'declined', 'converted'];
const CATEGORIES: Array<{ value: LineItemCategory; label: string }> = [{ value: 'labour', label: 'Labour' }, { value: 'equipment', label: 'Equipment' }, { value: 'material', label: 'Materials' }, { value: 'subcontractor', label: 'Subcontractors' }];
const TABS = [{ id: 'info', label: 'Info' }, { id: 'services', label: 'Services' }, { id: 'proposal', label: 'Proposal' }, { id: 'analysis', label: 'Analysis' }] as const;
const newService = (sortOrder: number): EstimateService => ({ id: crypto.randomUUID(), name: '', description: '', sortOrder, scheduleType: 'recurring', billingType: 'contract', frequency: { interval: 1, unit: 'week' }, lineItems: [] });

export default function ServiceEstimateWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { estimates, customers, budgets, budgetDivisions, updateEstimate, convertEstimateToJob } = useStore();
  const estimate = estimates.find((item) => item.id === id);
  const [form, setForm] = useState<Estimate | null>(estimate ?? null);
  const [catalog, setCatalog] = useState<EstimatePricingCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogServiceId, setCatalogServiceId] = useState<string | null>(null);
  const [catalogCategory, setCatalogCategory] = useState<LineItemCategory>('labour');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [pricingTarget, setPricingTarget] = useState<{ serviceId: string; lineId: string } | null>(null);
  const [analysisServiceId, setAnalysisServiceId] = useState('all');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [converting, setConverting] = useState(false);

  useEffect(() => setForm(estimate ?? null), [estimate]);
  useEffect(() => {
    if (!estimate) return;
    const controller = new AbortController();
    setCatalogError('');
    void fetch(`/api/estimate-pricing-catalog?estimateId=${encodeURIComponent(estimate.id)}`, { credentials: 'include', signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as { ok?: boolean; catalog?: EstimatePricingCatalog; error?: string };
      if (!response.ok || !payload.catalog) throw new Error(payload.error || 'Could not load pricing resources.');
      setCatalog(payload.catalog);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setCatalogError(reason instanceof Error ? reason.message : 'Could not load pricing resources.'); });
    return () => controller.abort();
  }, [estimate]);

  if (!estimate || !form) return <EmptyState title="Service Estimate not found" description="It may have been removed or you may not have access." action={<Button onClick={() => navigate('/estimates/services')}><ArrowLeft /> Service Estimates</Button>} />;
  const services = form.services ?? [];
  const activeTab = TABS.some((tab) => tab.id === searchParams.get('tab')) ? searchParams.get('tab')! : 'info';
  const customer = customers.find((item) => item.id === form.customerId);
  const divisions = budgetDivisions.filter((division) => division.budgetId === form.pricingBudgetId && division.status === 'active').sort((left, right) => left.name.localeCompare(right.name));
  const totals = calculateServiceEstimateTotals(services, form.taxRate);
  const setField = <K extends keyof Estimate>(key: K, value: Estimate[K]) => setForm((current) => current ? { ...current, [key]: value } : current);
  const updateService = (serviceId: string, patch: Partial<EstimateService>) => setField('services', services.map((service) => service.id === serviceId ? { ...service, ...patch } : service));
  const updateLine = (serviceId: string, lineId: string, patch: Partial<ServiceEstimateLineItem>) => {
    const service = services.find((item) => item.id === serviceId);
    if (!service) return;
    updateService(serviceId, { lineItems: (service.lineItems ?? []).map((line) => line.id === lineId ? { ...calculateEstimateLineItem({ ...line, ...patch }), costScope: patch.costScope ?? line.costScope } : line) });
  };
  const save = async () => {
    if (!form.title.trim() || !form.customerId || !form.pricingBudgetId || saving) return false;
    setSaving(true);
    const saved = await updateEstimate(estimate.id, { ...form, workType: 'service', title: form.title.trim(), services: normalizeEstimateServices(form.services) });
    setSaving(false);
    emitAppToast({ tone: saved ? 'success' : 'error', message: saved ? 'Service Estimate saved.' : 'Service Estimate could not be saved.' });
    return Boolean(saved);
  };
  const sendProposal = async () => {
    if (sending || !(await save())) return;
    setSending(true);
    try {
      const response = await fetch(`/api/proposal-delivery?action=send&estimateId=${encodeURIComponent(estimate.id)}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estimateId: estimate.id, email: customer?.email }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Proposal could not be sent.');
      emitAppToast({ tone: 'success', message: 'Service Proposal sent.' });
    } catch (reason) { emitAppToast({ tone: 'error', message: reason instanceof Error ? reason.message : 'Proposal could not be sent.' }); } finally { setSending(false); }
  };
  const downloadProposal = async () => {
    if (!(await save())) return;
    try { const projection = await fetchEstimateProposal(estimate.id); createEstimateProposalDocument(projection).save(proposalPdfFileName(projection)); } catch { emitAppToast({ tone: 'error', message: 'Proposal PDF could not be created.' }); }
  };
  const convert = async () => {
    setConverting(true);
    const result = await convertEstimateToJob(estimate.id, {});
    setConverting(false);
    if (!result.ok) return emitAppToast({ tone: 'error', message: result.error ?? 'Service Estimate could not be converted.' });
    if (result.jobId) navigate(`/jobs/${result.jobId}`);
  };

  const catalogService = services.find((service) => service.id === catalogServiceId);
  const groupedCatalog = catalog ? { labour: catalog.labour, equipment: catalog.equipment, material: catalog.materials, subcontractor: catalog.subcontractors } : null;
  const catalogItems = (groupedCatalog?.[catalogCategory] ?? []).filter((item) => (!catalogService?.divisionId || !item.divisionId || item.divisionId === catalogService.divisionId) && `${item.name} ${item.description} ${item.costCode ?? ''}`.toLowerCase().includes(catalogSearch.toLowerCase()));
  const addCatalogItem = (item: EstimatePricingCatalogItem) => {
    if (!catalogService || (!item.pricingAvailable && item.pricingReadiness !== 'needs_review')) return;
    const line = { ...applyEstimatePricingToLineItem(createEmptyEstimateLineItem(catalogCategory), form.pricingBudgetId, item), costScope: 'per_visit' as const };
    updateService(catalogService.id, { lineItems: [...(catalogService.lineItems ?? []), line] });
  };
  const pricingLine = pricingTarget ? services.find((service) => service.id === pricingTarget.serviceId)?.lineItems?.find((line) => line.id === pricingTarget.lineId) : null;

  return <div>
    <button type="button" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600" onClick={() => navigate('/estimates/services')}><ArrowLeft size={16} /> Service Estimates</button>
    <PageHeader title={form.title} subtitle={form.proposalNumber ? `Service Estimate ${form.proposalNumber}` : 'Service Estimate'} action={<div className="flex gap-2"><Badge label={form.status} className={statusColor[form.status]} /><Button onClick={() => void save()} disabled={saving}><Save /> {saving ? 'Saving...' : 'Save'}</Button></div>} />
    <div className="mb-6 flex border-b border-brand-100 dark:border-brand-700">{TABS.map((tab) => <button key={tab.id} type="button" onClick={() => setSearchParams(tab.id === 'info' ? {} : { tab: tab.id })} className={`px-4 py-3 text-sm font-semibold ${activeTab === tab.id ? 'border-b-2 border-brand-600 text-brand-700 dark:text-brand-100' : 'text-brand-400'}`}>{tab.label}</button>)}</div>

    {activeTab === 'info' ? <Card className="p-5"><h2 className="mb-4 font-semibold">Agreement</h2><div className="grid gap-4 sm:grid-cols-2"><Input label="Title" required value={form.title} onChange={(event) => setField('title', event.target.value)} /><Select label="Customer" required value={form.customerId} onChange={(event) => setField('customerId', event.target.value)}>{customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Select label="Pricing Budget" required value={form.pricingBudgetId} onChange={(event) => setField('pricingBudgetId', event.target.value)}>{budgets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Select label="Status" value={form.status} onChange={(event) => setField('status', event.target.value as EstimateStatus)}>{STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</Select><Input label="Service start" type="date" value={form.serviceStartDate ?? ''} onChange={(event) => setField('serviceStartDate', event.target.value || undefined)} /><Input label="Service end" type="date" value={form.serviceEndDate ?? ''} onChange={(event) => setField('serviceEndDate', event.target.value || undefined)} /><Input label="Tax rate (%)" type="number" min={0} value={form.taxRate} onChange={(event) => setField('taxRate', Number(event.target.value))} /></div><div className="mt-4"><TextArea label="Agreement notes" value={form.notes ?? ''} onChange={(event) => setField('notes', event.target.value)} /></div></Card> : null}

    {activeTab === 'services' ? <section className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Services and pricing</h2><p className="text-sm text-brand-400">Build the expected cost and customer price for each commitment. This does not generate Visits.</p></div><Button variant="secondary" onClick={() => setField('services', [...services, newService(services.length)])}><Plus /> Add Service</Button></div>{services.length === 0 ? <EmptyState title="No services defined" description="Add the first service included in this agreement." /> : services.map((service, index) => <ServiceEditor key={service.id} service={service} index={index} divisions={divisions} updateService={updateService} updateLine={updateLine} remove={() => setField('services', services.filter((item) => item.id !== service.id))} openCatalog={() => setCatalogServiceId(service.id)} openPricing={(lineId) => setPricingTarget({ serviceId: service.id, lineId })} />)}</section> : null}

    {activeTab === 'proposal' ? <div className="space-y-4"><Card className="p-5"><h2 className="font-semibold">Customer pricing</h2><div className="mt-4 grid gap-4 sm:grid-cols-3"><Summary label="Contracted" value={totals.contractedRevenue} /><Summary label="Projected per visit" value={totals.projectedPerVisitRevenue} /><Summary label="Projected T&M" value={totals.projectedTimeAndMaterialRevenue} /></div><div className="mt-5 flex flex-wrap gap-2"><Button onClick={() => void sendProposal()} disabled={sending}><Send /> {sending ? 'Sending...' : 'Send Proposal'}</Button><Button variant="secondary" onClick={() => void downloadProposal()}><Download /> Download PDF</Button></div></Card><Card className="p-5"><TextArea label="Proposal terms" value={form.proposalTerms ?? ''} onChange={(event) => setField('proposalTerms', event.target.value)} /><div className="mt-4"><TextArea label="Exclusions" value={form.exclusions ?? ''} onChange={(event) => setField('exclusions', event.target.value)} /></div></Card></div> : null}

    {activeTab === 'analysis' ? <Analysis services={services} selected={analysisServiceId} onSelect={setAnalysisServiceId} taxRate={form.taxRate} /> : null}
    {form.status === 'accepted' ? <div className="mt-6 flex justify-end"><Button onClick={() => void convert()} disabled={converting || services.length === 0}><RefreshCw /> {converting ? 'Converting...' : 'Convert to Service Job'}</Button></div> : null}

    {catalogServiceId ? <div className="fixed inset-0 z-50"><button aria-label="Close catalog" className="absolute inset-0 bg-black/50" onClick={() => setCatalogServiceId(null)} /><aside className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto bg-white p-5 shadow-xl dark:bg-brand-900"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Add resource</h2><Button variant="ghost" size="sm" title="Close" onClick={() => setCatalogServiceId(null)}><X /></Button></div><div className="mt-4"><Input label="Search" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} /></div><div className="mt-4 flex gap-2 overflow-x-auto">{CATEGORIES.map((category) => <Button key={category.value} size="sm" variant={catalogCategory === category.value ? 'primary' : 'secondary'} onClick={() => setCatalogCategory(category.value)}>{category.label}</Button>)}</div>{catalogError ? <p className="mt-4 text-sm text-red-600">{catalogError}</p> : null}<div className="mt-4 divide-y divide-brand-100 dark:divide-brand-700">{catalogItems.map((item) => <button key={`${item.budgetItemId}-${item.materialCatalogItemId}-${item.divisionId}`} type="button" disabled={!item.pricingAvailable && item.pricingReadiness !== 'needs_review'} onClick={() => addCatalogItem(item)} className="flex w-full items-center justify-between gap-4 py-4 text-left disabled:opacity-40"><div><p className="font-medium">{item.name}</p><p className="text-xs text-brand-400">{item.divisionName ?? 'All divisions'} · {item.description}</p></div><span className="shrink-0 font-semibold">{item.sellRate ? `${formatCurrency(item.sellRate)}/${item.unit}` : 'Review'}</span></button>)}</div></aside></div> : null}
    {pricingLine && pricingTarget ? <EstimateLinePricingEditor lineItem={pricingLine} onChange={(line: EstimateLineItem) => updateLine(pricingTarget.serviceId, pricingTarget.lineId, line)} onClose={() => setPricingTarget(null)} /> : null}
  </div>;
}

function ServiceEditor({ service, index, divisions, updateService, updateLine, remove, openCatalog, openPricing }: { service: EstimateService; index: number; divisions: Array<{ id: string; name: string }>; updateService: (id: string, patch: Partial<EstimateService>) => void; updateLine: (serviceId: string, lineId: string, patch: Partial<ServiceEstimateLineItem>) => void; remove: () => void; openCatalog: () => void; openPricing: (lineId: string) => void }) {
  const economics = calculateServiceEconomics(service);
  const lines = service.lineItems ?? [];
  return <Card className="p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold">{service.name || `Service ${index + 1}`}</h3><p className="text-xs text-brand-400">{formatServiceFrequency(service)} · {economics.estimatedVisits} estimated visits</p></div><Button variant="ghost" size="sm" title="Remove Service" onClick={remove}><Trash2 /></Button></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Input label="Service name" value={service.name} onChange={(event) => updateService(service.id, { name: event.target.value })} /><Select label="Division" value={service.divisionId ?? ''} onChange={(event) => updateService(service.id, { divisionId: event.target.value || undefined })}><option value="">No division</option>{divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Select label="Schedule" value={service.scheduleType} onChange={(event) => updateService(service.id, { scheduleType: event.target.value as EstimateService['scheduleType'] })}><option value="recurring">Recurring</option><option value="one_time">One time</option><option value="as_needed">As needed</option></Select><Select label="Billing" value={service.billingType} onChange={(event) => updateService(service.id, { billingType: event.target.value as EstimateService['billingType'] })}><option value="contract">Contract</option><option value="per_visit">Per visit</option><option value="time_and_material">Time & material</option></Select><Input label="Start date" type="date" value={service.startDate ?? ''} onChange={(event) => updateService(service.id, { startDate: event.target.value || undefined })} /><Input label="End date" type="date" value={service.endDate ?? ''} onChange={(event) => updateService(service.id, { endDate: event.target.value || undefined })} /><Input label="Estimated visits" type="number" min={0} value={service.scheduleType === 'one_time' ? 1 : service.estimatedVisits ?? calculateSuggestedServiceVisits(service) ?? 0} onChange={(event) => updateService(service.id, { estimatedVisits: Number(event.target.value) })} />{service.scheduleType === 'recurring' ? <Input label="Every (weeks)" type="number" min={1} value={service.frequency?.interval ?? 1} onChange={(event) => updateService(service.id, { frequency: { interval: Number(event.target.value), unit: 'week' } })} /> : null}</div><div className="mt-4"><TextArea label="Customer scope" value={service.description} onChange={(event) => updateService(service.id, { description: event.target.value })} /></div>
    <div className="mt-5 flex items-center justify-between border-t border-brand-100 pt-4 dark:border-brand-700"><div><p className="font-semibold">Resources</p><p className="text-xs text-brand-400">Loaded cost {formatCurrency(economics.estimatedCost)} · Recommended {formatCurrency(economics.recommendedContractValue)}</p></div><Button variant="secondary" size="sm" onClick={openCatalog}><Plus /> Add resource</Button></div><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="text-left text-xs text-brand-400"><tr><th className="py-2">Resource</th><th>Qty</th><th>Unit</th><th>Applied</th><th>Sell rate</th><th /></tr></thead><tbody>{lines.map((line) => <tr key={line.id} className="border-t border-brand-100 dark:border-brand-700"><td className="py-2 font-medium">{line.itemName}</td><td><input className="w-20 bg-transparent" type="number" min={0} value={line.quantity} onChange={(event) => updateLine(service.id, line.id, { quantity: Number(event.target.value) })} /></td><td>{line.unit}</td><td><select className="bg-transparent" value={line.costScope} onChange={(event) => updateLine(service.id, line.id, { costScope: event.target.value as ServiceEstimateLineItem['costScope'] })}><option value="per_visit">Per visit</option><option value="service_period">Once</option></select></td><td>{formatCurrency(line.sellPrice)}/{line.unit}</td><td><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" title="Edit pricing" onClick={() => openPricing(line.id)}><SlidersHorizontal /></Button><Button variant="ghost" size="sm" title="Remove resource" onClick={() => updateService(service.id, { lineItems: lines.filter((item) => item.id !== line.id) })}><Trash2 /></Button></div></td></tr>)}</tbody></table></div>
    <div className="mt-5 grid gap-4 border-t border-brand-100 pt-4 sm:grid-cols-3 dark:border-brand-700">{service.billingType === 'contract' ? <><Input label="Recommended contract" value={formatCurrency(economics.recommendedContractValue)} disabled /><Input label="Contract price" type="number" min={0} value={service.contractPricing?.customContractPrice ?? economics.calculatedServiceValue} onChange={(event) => updateService(service.id, { contractPricing: { customContractPrice: Number(event.target.value) } })} /><Button variant="secondary" onClick={() => updateService(service.id, { contractPricing: { customContractPrice: null } })}>Reset recommended</Button></> : service.billingType === 'per_visit' ? <><Input label="Price per visit" type="number" min={0} value={service.perVisitPricing?.customPricePerVisit ?? economics.recommendedPricePerVisit} onChange={(event) => updateService(service.id, { perVisitPricing: { ...service.perVisitPricing, customPricePerVisit: Number(event.target.value) } })} /><Input label="One-time charge" type="number" min={0} value={service.perVisitPricing?.oneTimeCharge ?? economics.servicePeriodEffectiveSell} onChange={(event) => updateService(service.id, { perVisitPricing: { ...service.perVisitPricing, oneTimeCharge: Number(event.target.value) } })} /><Button variant="secondary" onClick={() => updateService(service.id, { perVisitPricing: { customPricePerVisit: null, oneTimeCharge: null } })}>Reset recommended</Button></> : <TextArea label="T&M customer terms" value={service.timeAndMaterialPricing?.notes ?? ''} onChange={(event) => updateService(service.id, { timeAndMaterialPricing: { notes: event.target.value } })} />}</div>
  </Card>;
}

function Summary({ label, value }: { label: string; value: number }) { return <div><p className="text-xs font-semibold uppercase text-brand-400">{label}</p><p className="mt-1 text-xl font-semibold">{formatCurrency(value)}</p></div>; }
function Analysis({ services, selected, onSelect, taxRate }: { services: EstimateService[]; selected: string; onSelect: (value: string) => void; taxRate: number }) {
  const selectedServices = selected === 'all' ? services : services.filter((service) => service.id === selected);
  const totals = calculateServiceEstimateTotals(selectedServices, taxRate);
  return <Card className="p-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-semibold">Service Estimate Analysis</h2><p className="text-sm text-brand-400">Expected economics based on planned visits and current resource snapshots.</p></div><Select label="Scope" value={selected} onChange={(event) => onSelect(event.target.value)}><option value="all">Entire Estimate</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name || 'Unnamed Service'}</option>)}</Select></div><div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"><Summary label="Estimated revenue" value={totals.estimatedRevenue} /><Summary label="Loaded cost" value={totals.estimatedCost} /><Summary label="Estimated profit" value={totals.estimatedProfit} /><div><p className="text-xs font-semibold uppercase text-brand-400">Estimated margin</p><p className="mt-1 text-xl font-semibold">{totals.estimatedMarginPercent.toFixed(1)}%</p></div></div><div className="mt-6 grid gap-4 border-t border-brand-100 pt-5 sm:grid-cols-4 dark:border-brand-700">{Object.entries(totals.categories).map(([category, value]) => <Summary key={category} label={`${category} cost`} value={value} />)}</div></Card>;
}
