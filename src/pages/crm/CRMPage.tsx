import { useState } from 'react';
import { useStore } from '../../store';
import { PageHeader, Button, Card, Badge, Modal, Input, Select, TextArea, EmptyState } from '../../components/ui';
import { Plus, Pencil, Trash2, Search, Phone, Mail, MapPin, Users, FilterX } from 'lucide-react';
import { statusColor } from '../../utils';
import type { Address, Customer, CustomerStatus } from '../../types';

const STATUSES: CustomerStatus[] = ['lead', 'prospect', 'active', 'inactive'];

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

const emptyCustomer = (): Omit<Customer, 'id' | 'createdAt' | 'updatedAt'> => ({
  firstName: '',
  lastName: '',
  name: '',
  company: '',
  email: '',
  phone: '',
  properties: [emptyProperty()],
  status: 'lead',
  notes: '',
  tags: [],
});

export default function CRMPage() {
  const { customers, addCustomer, updateCustomer, deleteCustomer } = useStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | 'all'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyCustomer());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
    setModalOpen(true);
  };

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
      properties: normalizeProperties(c.properties, c.address), status: c.status, notes: c.notes, tags: c.tags,
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    const firstName = form.firstName?.trim() ?? '';
    const lastName = form.lastName?.trim() ?? '';
    if (!firstName || !lastName) return;

    const payload = {
      ...form,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
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
      <PageHeader
        title="CRM"
        subtitle="Manage your customers, leads, and contacts."
        action={<Button onClick={openNew}><Plus size={16} /> New Customer</Button>}
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
          {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
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
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            (() => {
              const properties = normalizeProperties(c.properties, c.address);
              const primaryProperty = properties[0];

              return (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{c.name}</p>
                  {c.company && <p className="text-sm text-gray-500 truncate">{c.company}</p>}
                </div>
                <Badge label={c.status} className={statusColor[c.status]} />
              </div>
              <div className="space-y-1 text-sm text-gray-600">
                {c.email && (
                  <div className="flex items-center gap-2">
                    <Mail size={13} className="text-gray-400" />
                    <a href={`mailto:${c.email}`} className="hover:text-brand-600 truncate">{c.email}</a>
                  </div>
                )}
                {c.phone && (
                  <div className="flex items-center gap-2">
                    <Phone size={13} className="text-gray-400" />
                    <a href={`tel:${c.phone}`} className="hover:text-brand-600">{c.phone}</a>
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
                <Button variant="secondary" size="sm" onClick={() => openEdit(c)}>
                  <Pencil size={13} /> Edit
                </Button>
                <Button variant="danger" size="sm" onClick={() => setConfirmDelete(c.id)}>
                  <Trash2 size={13} /> Delete
                </Button>
              </div>
            </Card>
              );
            })()
          ))}
        </div>
      )}

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
            {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </Select>
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
                    <Input label="Street" value={property.street} onChange={(e) => setProperty(index, 'street', e.target.value)} />
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
