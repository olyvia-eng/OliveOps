import { useMemo, useState } from 'react';
import { PageHeader, Card, Input, Button } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';

export default function UnbillableTimeCategoriesPage() {
  const {
    unbillableTimeCategories,
    addUnbillableTimeCategory,
    updateUnbillableTimeCategory,
    archiveUnbillableTimeCategory,
  } = useStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  const categories = useMemo(
    () => unbillableTimeCategories
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [unbillableTimeCategories]
  );

  const resetForm = () => {
    setName('');
    setDescription('');
    setActive(true);
    setEditingId(null);
  };

  const beginEdit = (categoryId: string) => {
    const category = categories.find((item) => item.id === categoryId);
    if (!category) return;

    setEditingId(category.id);
    setName(category.name);
    setDescription(category.description ?? '');
    setActive(category.active);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      emitAppToast({ tone: 'error', message: 'Category name is required.' });
      return;
    }

    if (editingId) {
      updateUnbillableTimeCategory(editingId, {
        name: trimmedName,
        description: description.trim(),
        active,
      });
      emitAppToast({ tone: 'success', message: 'Category updated.' });
      resetForm();
      return;
    }

    addUnbillableTimeCategory({
      name: trimmedName,
      description: description.trim(),
      sortOrder: categories.reduce((highest, category) => Math.max(highest, category.sortOrder), -1) + 1,
      active,
    });
    emitAppToast({ tone: 'success', message: 'Category created.' });
    resetForm();
  };

  return (
    <div>
      <PageHeader
        title="Unbillable Time Categories"
        subtitle="Define and maintain categories for non-billable clocking across your company."
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="p-4 xl:col-span-1">
          <h2 className="font-semibold text-gray-800 mb-3">
            {editingId ? 'Edit Category' : 'Add Category'}
          </h2>
          <form onSubmit={submit} className="space-y-3">
            <Input
              label="Name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
            />
            <Input
              label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={200}
            />
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              Active
            </label>

            <div className="flex gap-2">
              <Button type="submit" className="flex-1 justify-center">
                {editingId ? 'Save Changes' : 'Create Category'}
              </Button>
              {editingId && (
                <Button type="button" variant="secondary" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Card>

        <Card className="xl:col-span-2 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Configured Categories</h2>
          </div>

          {categories.length === 0 ? (
            <p className="text-sm text-gray-400 p-4">No categories configured yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-500 text-left text-xs">
                    <th className="w-1/4 px-4 py-2 font-medium">Name</th>
                    <th className="w-2/5 py-2 font-medium">Description</th>
                    <th className="w-1/6 py-2 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {categories.map((category) => (
                    <tr key={category.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-800">{category.name}</td>
                      <td className="py-2 text-gray-600">{category.description || '—'}</td>
                      <td className="py-2 text-gray-600">{category.active ? 'Active' : 'Archived'}</td>
                      <td className="py-2 pr-4">
                        <div className="inline-flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => beginEdit(category.id)}>
                            Edit
                          </Button>
                          {category.active && (
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                archiveUnbillableTimeCategory(category.id);
                                emitAppToast({ tone: 'success', message: 'Category archived.' });
                              }}
                            >
                              Archive
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
