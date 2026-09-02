import { useState } from 'react';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Input, Modal, PageHeader, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import { formatDate } from '../../utils';
import { normalizeEstimateTemplate } from '../../utils/estimateTemplateModel.js';

interface Props {
  currentUserRole: string;
}

export default function TemplatesPage({ currentUserRole }: Props) {
  const navigate = useNavigate();
  const { templates, addTemplate, deleteTemplate } = useStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin';

  const openCreate = () => {
    setName('');
    setDescription('');
    setCreateOpen(true);
  };

  const createTemplate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    const templateId = await addTemplate({ name: name.trim(), description: description.trim() });
    setCreating(false);
    if (!templateId) return;
    setCreateOpen(false);
    navigate(`/estimates/templates/${templateId}`);
  };

  return (
    <div>
      <PageHeader
        title="Estimate Templates"
        subtitle="Reusable project scope and default quantities."
        action={canManage ? <Button onClick={openCreate}><Plus size={16} /> New Template</Button> : undefined}
      />

      {templates.length === 0 ? (
        <EmptyState title="No templates yet" action={canManage ? <Button onClick={openCreate}><Plus size={16} /> New Template</Button> : undefined} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => {
            const normalized = normalizeEstimateTemplate(template);
            const lineCount = normalized.workAreas.reduce((total, area) => total + area.lineItems.length, 0);
            return (
              <Card key={template.id} className="p-4">
                <button type="button" className="w-full text-left" onClick={() => navigate(`/estimates/templates/${template.id}`)}>
                  <p className="font-semibold text-gray-900 dark:text-brand-50">{template.name}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-brand-200">{template.description || 'No description'}</p>
                  <p className="mt-3 text-xs text-gray-400 dark:text-brand-300">{normalized.workAreas.length} work area{normalized.workAreas.length === 1 ? '' : 's'} · {lineCount} resource{lineCount === 1 ? '' : 's'}</p>
                  <p className="mt-1 text-xs text-gray-400 dark:text-brand-300">Updated {formatDate(normalized.updatedAt || normalized.createdAt)}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 dark:text-brand-200">Open Template <ArrowRight size={14} /></span>
                </button>
                {canManage ? <div className="mt-3 border-t border-gray-100 pt-3 dark:border-brand-600"><Button variant="danger" size="sm" onClick={() => setConfirmDelete(template.id)}><Trash2 size={13} /> Delete</Button></div> : null}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Template" footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={() => void createTemplate()} disabled={!name.trim() || creating}>{creating ? 'Creating...' : 'Create Template'}</Button></>}>
        <div className="space-y-4">
          <Input label="Template Name *" required value={name} onChange={(event) => setName(event.target.value)} />
          <TextArea label="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
      </Modal>

      <Modal open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} title="Delete Template" footer={<><Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="danger" onClick={() => { if (confirmDelete) deleteTemplate(confirmDelete); setConfirmDelete(null); }}>Delete</Button></>}>
        <p className="text-gray-600 dark:text-brand-200">Delete this Template? Existing Estimates will not be changed.</p>
      </Modal>
    </div>
  );
}
