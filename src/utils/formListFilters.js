export const DEFAULT_FORM_STATUS_FILTER = 'operational';

export function filterFormsForList(forms, { search = '', category = 'all', status = DEFAULT_FORM_STATUS_FILTER } = {}) {
  const normalizedSearch = String(search).trim().toLowerCase();
  return forms.filter((form) => {
    if (category !== 'all' && form.category !== category) return false;
    if (status === 'operational' && form.status === 'archived') return false;
    if (status !== 'all' && status !== 'operational' && form.status !== status) return false;
    if (!normalizedSearch) return true;
    return form.name.toLowerCase().includes(normalizedSearch)
      || form.description.toLowerCase().includes(normalizedSearch);
  });
}
