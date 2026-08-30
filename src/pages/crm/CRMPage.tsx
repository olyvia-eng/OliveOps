import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../../store';
import { PageHeader, Button, Card, Badge, Modal, Input, Select, TextArea, EmptyState } from '../../components/ui';
import { Plus, Pencil, Trash2, Search, Phone, Mail, MapPin, Users, FilterX } from 'lucide-react';
import { statusColor } from '../../utils';
import type { Address, Customer, CustomerStatus } from '../../types';
import DetailWorkspace from '../../components/detail-workspace/DetailWorkspace';
import {
  closeDetailWorkspace,
  openDetailWorkspace,
  readDetailWorkspaceQuery,
  setDetailWorkspaceMode,
  setDetailWorkspaceTab,
} from '../../components/detail-workspace/detailWorkspaceQuery';
import ClientDetailPanel, { type ClientDetailTab } from './ClientDetailPanel';
import { selectClientDetailSummary } from './clientDetailSelectors';
import AddressAutocomplete from '../../components/address/AddressAutocomplete';
import { CUSTOMER_LEAD_SOURCES, CUSTOMER_STATUSES, customerStatusLabel } from '../../config/customer.js';
import type { CustomerLeadSource } from '../../config/customer.js';

const CRM_VIEW_MODE_STORAGE_KEY = 'oliveops.crm.viewMode';
type CRMViewMode = 'card' | 'list';
const CLIENT_WORKSPACE_QUERY = { recordParam: 'client', tabParam: 'clientTab', defaultTab: 'overview' } as const;
const CLIENT_DETAIL_TABS: ClientDetailTab[] = ['overview', 'estimates', 'jobs', 'notes'];
type CustomerForm = Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status: CustomerStatus | '' };

const emptyProperty = (): Address => ({
  nickname: '',
  street: '',
  city: '',
  province: '',
  postalCode: '',
  country: 'Canada',
});

const normalizeProperties = (properties?: Address[], legacyAddress?: Address): Address[] => {
  if (Array.isArray(properties) && properties.length > 0) {
    return properties.map((property) => ({ ...emptyProperty(), ...property }));
  }
  if (legacyAddress) {
    return [{ ...emptyProperty(), ...legacyAddress }];
  }
  return [emptyProperty()];
};

const deriveNameParts = (customer: Customer): { firstName: string; lastName: string } => {
  const firstName = customer.firstName?.trim() ?? '';
  const lastName = customer.lastName?.trim() ?? '';
  if (firstName || lastName) {
    return { firstName, lastName };
  }

  const fallback = customer.name.trim();
  if (!fallback) {
    return { firstName: '', lastName: '' };
  }

  const parts = fallback.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
};

const emptyCustomer = (): CustomerForm => ({
  firstName: '',
  lastName: '',
  name: '',
  company: '',
  email: '',
  phone: '',
  properties: [emptyProperty()],
  status: 'lead',
  leadSource: undefined,
  leadSourceOther: undefined,
  notes: '',
  tags: [],
});

interface CRMPageProps {
  currentUserRole: string;
}

export default function CRMPage({ currentUserRole }: CRMPageProps) {
  const { customers, estimates, jobs, invoices, addCustomer, updateCustomer, deleteCustomer } = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | 'all'>('all');
  const [crmViewMode, setCrmViewMode] = useState<CRMViewMode>(() => {
    if (typeof window === 'undefined') return 'card';
    return window.localStorage.getItem(CRM_VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'card';
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyCustomer());
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const workspace = readDetailWorkspaceQuery(searchParams, CLIENT_WORKSPACE_QUERY);
  const selectedCustomer = customers.find((customer) => customer.id === workspace.recordId) ?? null;
  const clientDetailTab = CLIENT_DETAIL_TABS.includes(workspace.tab as ClientDetailTab)
    ? workspace.tab as ClientDetailTab
    : 'overview';
  const clientSummary = useMemo(
    () => selectedCustomer
      ? selectClientDetailSummary(selectedCustomer.id, estimates, jobs, invoices)
      : null,
    [estimates, invoices, jobs, selectedCustomer]
  );
  const canViewFinancials = currentUserRole === 'owner' || currentUserRole === 'admin';

  const selectCustomer = (customerId: string) => setSearchParams(openDetailWorkspace(searchParams, CLIENT_WORKSPACE_QUERY, customerId));
  const closeCustomer = () => setSearchParams(closeDetailWorkspace(searchParams, CLIENT_WORKSPACE_QUERY));
  const setWorkspaceMode = (mode: 'panel' | 'expanded') => setSearchParams(setDetailWorkspaceMode(searchParams, CLIENT_WORKSPACE_QUERY, mode));
  const setClientTab = (tab: ClientDetailTab) => setSearchParams(setDetailWorkspaceTab(searchParams, CLIENT_WORKSPACE_QUERY, tab));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CRM_VIEW_MODE_STORAGE_KEY, crmViewMode);
  }, [crmViewMode]);

  const hasFilters = search.trim().length > 0 || statusFilter !== 'all';

  const filtered = customers.filter((c) => {
    const matchSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.company.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const openNew = () => {
    setEditing(null);
    setForm(emptyCustomer());
    setFormError('');
    setModalOpen(true);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('create') !== 'customer') return;

    openNew();
    params.delete('create');
    navigate({
      pathname: location.pathname,
      search: params.toString() ? `?${params.toString()}` : '',
    }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const openEdit = (c: Customer) => {
    const { firstName, lastName } = deriveNameParts(c);
    setEditing(c);
    setForm({
      firstName,
      lastName,
      name: c.name,
      company: c.company,
      email: c.email,
      phone: c.phone,
      properties: normalizeProperties(c.properties, c.address), status: c.status === 'inactive' ? '' : c.status, leadSource: c.leadSource, leadSourceOther: c.leadSourceOther, notes: c.notes, tags: c.tags,
    });
    setFormError('');
    setModalOpen(true);
  };

  const handleSave = () => {
    const firstName = form.firstName?.trim() ?? '';
    const lastName = form.lastName?.trim() ?? '';
    if (!firstName || !lastName) return setFormError('First and last name are required.');
    const status = form.status;
    if (!status) return setFormError('Choose Lead or Client before saving.');

    const payload = {
      ...form,
      status,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      leadSource: form.leadSource || undefined,
      leadSourceOther: form.leadSource === 'other' ? form.leadSourceOther?.trim() || undefined : undefined,
    };

    if (editing) {
      updateCustomer(editing.id, payload);
    } else {
      addCustomer(payload);
    }
    setModalOpen(false);
  };

  const set = (key: keyof typeof form, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setProperty = (index: number, key: keyof Address, value: string) =>
    setForm((current) => ({
      ...current,
      properties: current.properties.map((property, propertyIndex) => (
        propertyIndex === index ? { ...property, [key]: value } : property
      )),
    }));
  const setPropertyAddress = (index: number, address: Address) =>
    setForm((current) => ({
      ...current,
      properties: current.properties.map((property, propertyIndex) => (
        propertyIndex === index ? { ...property, ...address } : property
      )),
    }));

  const addProperty = () => {
    setForm((current) => ({
      ...current,
      properties: [...current.properties, emptyProperty()],
    }));
  };

  const removeProperty = (index: number) => {
    setForm((current) => {
      if (current.properties.length <= 1) {
        return {
          ...current,
          properties: [emptyProperty()],
        };
      }

      return {
        ...current,
        properties: current.properties.filter((_, propertyIndex) => propertyIndex !== index),
      };
    });
  };

  return (
    <div>
      <DetailWorkspace
        open={Boolean(workspace.recordId)}
        expanded={workspace.mode === 'expanded'}
        detailKey={workspace.recordId}
        list={(
          <div>
      <PageHeader
        title="CRM"
        subtitle="Manage your customers, leads, and contacts."
        action={(
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setCrmViewMode('card')}
                className={`px-3 py-1 text-xs font-medium rounded ${crmViewMode === 'card' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                Card View
              </button>
              <button
                type="button"
                onClick={() => setCrmViewMode('list')}
                className={`px-3 py-1 text-xs font-medium rounded ${crmViewMode === 'list' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                List View
              </button>
            </div>
            <Button onClick={openNew}><Plus size={16} /> New Customer</Button>
          </div>
        )}
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as CustomerStatus | 'all')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All Statuses</option>
          {CUSTOMER_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        customers.length === 0 ? (
          <EmptyState
            icon={<Users aria-hidden="true" />}
            title="No clients yet"
            description="Add your first client to start building estimates, tracking properties, and managing jobs."
            action={<Button onClick={openNew}><Plus size={16} /> Add Your First Client</Button>}
          />
        ) : (
          <EmptyState
            icon={<FilterX aria-hidden="true" />}
            title="No clients match your search"
            description="Try a different search or clear your current filters."
            action={hasFilters ? <Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter('all'); }}>Clear Filters</Button> : undefined}
          />
        )
      ) : crmViewMode === 'card' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            (() => {
              const properties = normalizeProperties(c.properties, c.address);
              const primaryProperty = properties[0];

              return (
            <Card
              key={c.id}
              className={`cursor-pointer p-4 transition-colors ${workspace.recordId === c.id ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-300 dark:border-brand-400 dark:bg-brand-600' : ''}`}
              onClick={() => selectCustomer(c.id)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectCustomer(c.id); }}
              role="button"
              tabIndex={0}
              aria-selected={workspace.recordId === c.id}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{c.name}</p>
                  {c.company && <p className="text-sm text-gray-500 truncate">{c.company}</p>}
                </div>
                <Badge label={customerStatusLabel(c.status)} className={statusColor[c.status]} />
              </div>
              <div className="space-y-1 text-sm text-gray-600">
                {c.email && (
                  <div className="flex items-center gap-2">
                    <Mail size={13} className="text-gray-400" />
                    <a href={`mailto:${c.email}`} onClick={(event) => event.stopPropagation()} className="hover:text-brand-600 truncate">{c.email}</a>
                  </div>
                )}
                {c.phone && (
                  <div className="flex items-center gap-2">
                    <Phone size={13} className="text-gray-400" />
                    <a href={`tel:${c.phone}`} onClick={(event) => event.stopPropagation()} className="hover:text-brand-600">{c.phone}</a>
                  </div>
                )}
                {primaryProperty.city && (
                  <div className="flex items-center gap-2">
                    <MapPin size={13} className="text-gray-400" />
                    <span>
                      {primaryProperty.nickname?.trim() ? `${primaryProperty.nickname} - ` : ''}
                      {primaryProperty.city}, {primaryProperty.province}
                    </span>
                  </div>
                )}
                <p className="text-xs text-gray-500">{properties.length} {properties.length === 1 ? 'property' : 'properties'}</p>
              </div>
              {c.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {c.tags.map((t) => (
                    <span key={t} className="text-xs bg-gray-100 text-gray-600 rounded px-2 py-0.5">{t}</span>
                  ))}
                </div>
              )}
              {c.notes && <p className="text-xs text-gray-400 mt-2 line-clamp-2">{c.notes}</p>}
              <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                <Button variant="secondary" size="sm" onClick={(event) => { event.stopPropagation(); openEdit(c); }}>
                  <Pencil size={13} /> Edit
                </Button>
                <Button variant="danger" size="sm" onClick={(event) => { event.stopPropagation(); setConfirmDelete(c.id); }}>
                  <Trash2 size={13} /> Delete
                </Button>
              </div>
            </Card>
              );
            })()
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Primary Property</th>
                  <th className="px-4 py-3 font-medium text-right">Properties</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((customer) => {
                  const properties = normalizeProperties(customer.properties, customer.address);
                  const primaryProperty = properties[0];
                  return (
                    <tr
                      key={customer.id}
                      className={`cursor-pointer transition-colors ${workspace.recordId === customer.id ? 'bg-brand-50 dark:bg-brand-600' : 'hover:bg-gray-50 dark:hover:bg-brand-600/60'}`}
                      onClick={() => selectCustomer(customer.id)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectCustomer(customer.id); }}
                      tabIndex={0}
                      aria-selected={workspace.recordId === customer.id}
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900">{customer.name}</p>
                        {customer.company && <p className="text-sm text-gray-500">{customer.company}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge label={customerStatusLabel(customer.status)} className={statusColor[customer.status]} />
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {customer.email && <p className="truncate">{customer.email}</p>}
                        {customer.phone && <p>{customer.phone}</p>}
                        {!customer.email && !customer.phone && <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {primaryProperty.city ? (
                          <span>
                            {primaryProperty.nickname?.trim() ? `${primaryProperty.nickname} - ` : ''}
                            {primaryProperty.city}, {primaryProperty.province}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {properties.length}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" size="sm" onClick={(event) => { event.stopPropagation(); openEdit(customer); }}><Pencil size={13} /> Edit</Button>
                          <Button variant="danger" size="sm" onClick={(event) => { event.stopPropagation(); setConfirmDelete(customer.id); }}><Trash2 size={13} /> Delete</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

          </div>
        )}
        detail={selectedCustomer && clientSummary ? (
          <ClientDetailPanel
            customer={selectedCustomer}
            summary={clientSummary}
            activeTab={clientDetailTab}
            expanded={workspace.mode === 'expanded'}
            canViewFinancials={canViewFinancials}
            onTabChange={setClientTab}
            onEdit={() => openEdit(selectedCustomer)}
            onNewEstimate={() => navigate(`/estimates?create=estimate&customer=${encodeURIComponent(selectedCustomer.id)}`)}
            onSelectEstimate={(estimateId) => navigate(`/estimates?estimate=${encodeURIComponent(estimateId)}&workspace=panel`)}
            onSelectJob={(jobId) => navigate(`/jobs?job=${encodeURIComponent(jobId)}&workspace=panel`)}
            onExpand={() => setWorkspaceMode('expanded')}
            onCollapse={() => setWorkspaceMode('panel')}
            onClose={closeCustomer}
          />
        ) : (
          <div className="p-6"><p className="text-sm text-gray-500 dark:text-brand-200">Client not found or no longer available.</p><Button className="mt-4" variant="secondary" onClick={closeCustomer}>Close</Button></div>
        )}
      />

      {/* Form Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Customer' : 'New Customer'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="First Name *" required value={form.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} />
            <Input label="Last Name *" required value={form.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Company" value={form.company} onChange={(e) => set('company', e.target.value)} />
            <Input label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <Input label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          <Select label="Status" value={form.status} onChange={(e) => set('status', e.target.value as CustomerStatus)}>
            {!form.status ? <option value="" disabled>Choose Lead or Client</option> : null}
            {CUSTOMER_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </Select>
          <Select label="Lead Source (optional)" value={form.leadSource ?? ''} onChange={(event) => setForm((current) => ({ ...current, leadSource: event.target.value ? event.target.value as CustomerLeadSource : undefined, leadSourceOther: event.target.value === 'other' ? current.leadSourceOther : undefined }))}>
            <option value="">Not specified</option>
            {CUSTOMER_LEAD_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
          </Select>
          {form.leadSource === 'other' ? <Input label="Specify Lead Source (optional)" maxLength={120} value={form.leadSourceOther ?? ''} onChange={(event) => set('leadSourceOther', event.target.value)} placeholder="Home Show" /> : null}
          <fieldset className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between px-1">
              <legend className="text-sm font-medium text-gray-700">Properties</legend>
              <Button type="button" variant="secondary" size="sm" onClick={addProperty}>
                <Plus size={13} /> Add Property
              </Button>
            </div>
            <div className="space-y-4 mt-3">
              {form.properties.map((property, index) => (
                <div key={`property-${index}`} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Property {index + 1}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeProperty(index)}
                      className="text-accent-700 hover:bg-accent-50"
                    >
                      <Trash2 size={12} /> Remove
                    </Button>
                  </div>
                  <div className="space-y-3">
                    <Input
                      label="Property Nickname (optional)"
                      value={property.nickname ?? ''}
                      onChange={(e) => setProperty(index, 'nickname', e.target.value)}
                      placeholder="e.g. Main Office"
                    />
                    <AddressAutocomplete
                      value={property.street}
                      onChange={(value) => setProperty(index, 'street', value)}
                      onAddressSelect={(address) => setPropertyAddress(index, address)}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input label="City" value={property.city} onChange={(e) => setProperty(index, 'city', e.target.value)} />
                      <Input label="Province" value={property.province} onChange={(e) => setProperty(index, 'province', e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input label="Postal Code" value={property.postalCode} onChange={(e) => setProperty(index, 'postalCode', e.target.value)} />
                      <Input label="Country" value={property.country} onChange={(e) => setProperty(index, 'country', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
          <Input
            label="Tags (comma-separated)"
            value={form.tags.join(', ')}
            onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
          />
          <TextArea label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
        </div>
      </Modal>

      {/* Delete Confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete Customer"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => { deleteCustomer(confirmDelete!); setConfirmDelete(null); }}>Delete</Button>
          </>
        }
      >
        <p className="text-gray-600">Are you sure you want to delete this customer? This cannot be undone.</p>
      </Modal>
    </div>
  );
}
