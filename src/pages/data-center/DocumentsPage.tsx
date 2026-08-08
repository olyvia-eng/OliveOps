import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Card, PageHeader, Button, EmptyState, Input, Select } from '../../components/ui';
import { parseStorageApiResponse, uploadFileToStorage } from '../../utils/fileUpload';
import {
  buildDocumentUploadContext,
  DOCUMENT_ACTIONS,
  DOCUMENT_CATEGORIES,
  DOCUMENT_TABLE_COLUMNS,
  DOCUMENT_TABS,
  filterDocuments,
} from './documentsConfig';

interface StoredFileRecord {
  id: string;
  fileName: string;
  originalFileName?: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  category?: string;
  entityType?: string;
  entityId?: string;
  uploadStatus?: string;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export default function DocumentsPage() {
  const [activeTab, setActiveTab] = useState<'library' | 'upload'>('library');
  const [fileName, setFileName] = useState('');
  const [category, setCategory] = useState('contracts');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [files, setFiles] = useState<StoredFileRecord[]>([]);
  const [status, setStatus] = useState('Ready to manage project documents.');
  const [busy, setBusy] = useState(false);
  const hasFilters = searchQuery.trim().length > 0 || categoryFilter !== 'all';

  const loadFiles = async () => {
    try {
      const response = await fetch('/api/storage?view=files&entityType=document', { credentials: 'include' });
      const data = await parseStorageApiResponse(response, 'Could not load files.') as { ok?: boolean; files?: StoredFileRecord[] };
      if (data.ok) {
        setFiles(data.files ?? []);
      }
    } catch {
      // Ignore refresh errors; the page will keep the latest local state.
    }
  };

  useEffect(() => {
    void loadFiles();
  }, []);

  const filteredFiles = useMemo(() => {
    return filterDocuments(files, { search: searchQuery, category: categoryFilter });
  }, [categoryFilter, files, searchQuery]);

  const totalBytes = useMemo(() => {
    return filteredFiles.reduce((sum, file) => sum + (Number.isFinite(file.sizeBytes) ? file.sizeBytes : 0), 0);
  }, [filteredFiles]);

  const latestUploadLabel = useMemo(() => {
    if (filteredFiles.length === 0) return 'No uploads yet';
    const latest = [...filteredFiles]
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
    return latest?.uploadedAt ? new Date(latest.uploadedAt).toLocaleString() : 'No uploads yet';
  }, [filteredFiles]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) {
      setStatus('Choose a file before uploading.');
      return;
    }

    setBusy(true);
    setStatus('Preparing secure upload...');

    try {
      const uploadContext = buildDocumentUploadContext(category);
      await uploadFileToStorage({
        file: selectedFile,
        entityType: uploadContext.entityType,
        entityId: uploadContext.entityId,
        category: uploadContext.category,
      });

      setStatus(`Uploaded ${selectedFile.name} successfully.`);
      setSelectedFile(null);
      setFileName('');
      setActiveTab('library');
      await loadFiles();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload could not be prepared.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (file: StoredFileRecord) => {
    try {
      const response = await fetch('/api/storage', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepare-download', fileId: file.id }),
      });
      const data = await parseStorageApiResponse(response, 'Download could not be prepared.') as { ok?: boolean; error?: string; downloadUrl?: string };
      if (!data?.ok || !data.downloadUrl) {
        throw new Error(data?.error || 'Download could not be prepared.');
      }
      window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Download could not be prepared.');
    }
  };

  const handleDelete = async (file: StoredFileRecord) => {
    try {
      const response = await fetch('/api/storage', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', fileId: file.id }),
      });
      const data = await parseStorageApiResponse(response, 'Delete failed.') as { ok?: boolean; error?: string };
      if (!data?.ok) {
        throw new Error(data?.error || 'Delete failed.');
      }
      await loadFiles();
      setStatus(`Removed ${file.fileName}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Delete failed.');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        subtitle="Organize company documents by category, securely upload to private storage, and control access through signed links."
      />

      <Card className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          {DOCUMENT_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as 'library' | 'upload')}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-brand-600 text-white'
                    : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-brand-100 bg-brand-50 p-3">
            <p className="text-xs uppercase tracking-wide text-brand-700">Visible files</p>
            <p className="mt-1 text-lg font-semibold text-brand-900">{filteredFiles.length}</p>
          </div>
          <div className="rounded-xl border border-brand-100 bg-brand-50 p-3">
            <p className="text-xs uppercase tracking-wide text-brand-700">Storage in view</p>
            <p className="mt-1 text-lg font-semibold text-brand-900">{formatBytes(totalBytes)}</p>
          </div>
          <div className="rounded-xl border border-brand-100 bg-brand-50 p-3">
            <p className="text-xs uppercase tracking-wide text-brand-700">Latest upload</p>
            <p className="mt-1 text-sm font-semibold text-brand-900">{latestUploadLabel}</p>
          </div>
        </div>

        {activeTab === 'upload' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Suggested file name"
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                placeholder="Quarterly-Estimate.pdf"
              />
              <Select label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
                {DOCUMENT_CATEGORIES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </Select>
            </div>
            <input
              type="file"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              className="block w-full rounded-xl border border-brand-100 bg-white px-3 py-2 text-sm text-gray-700"
            />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy || !selectedFile}>{busy ? 'Uploading...' : 'Upload Document'}</Button>
              <Button type="button" variant="secondary" onClick={() => setActiveTab('library')}>Back to Library</Button>
            </div>
            <p className="text-sm text-gray-600">{status}</p>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_220px]">
              <Input
                label="Search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by file name or type"
              />
              <Select
                label="Category Filter"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="all">All categories</option>
                {DOCUMENT_CATEGORIES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </Select>
            </div>

            {filteredFiles.length === 0 ? (
              files.length === 0 ? (
                <EmptyState
                  title="No documents yet"
                  description="Upload documents related to your company, customers, jobs, and estimating workflow."
                  action={<Button onClick={() => setActiveTab('upload')}>Upload Document</Button>}
                />
              ) : (
                <EmptyState
                  title="No documents match your filters"
                  description="Try a different search or clear your category filter."
                  action={hasFilters ? <Button variant="secondary" onClick={() => { setSearchQuery(''); setCategoryFilter('all'); }}>Clear Filters</Button> : undefined}
                />
              )
            ) : (
              <div className="overflow-x-auto rounded-xl border border-brand-100">
                <table className="min-w-full divide-y divide-brand-100 text-sm">
                  <thead className="bg-brand-50">
                    <tr>
                      {DOCUMENT_TABLE_COLUMNS.map((column) => (
                        <th key={column} className="px-3 py-2 text-left font-semibold text-brand-800">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {filteredFiles.map((file) => (
                      <tr key={file.id}>
                        <td className="px-3 py-2 font-medium text-gray-900">{file.fileName}</td>
                        <td className="px-3 py-2 text-gray-700">{file.category || 'misc'}</td>
                        <td className="px-3 py-2 text-gray-700">{file.mimeType}</td>
                        <td className="px-3 py-2 text-gray-700">{formatBytes(file.sizeBytes)}</td>
                        <td className="px-3 py-2 text-gray-700">{new Date(file.uploadedAt).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            {DOCUMENT_ACTIONS.includes('view') && (
                              <Button type="button" variant="secondary" size="sm" onClick={() => void handleDownload(file)}>View</Button>
                            )}
                            {DOCUMENT_ACTIONS.includes('download') && (
                              <Button type="button" variant="secondary" size="sm" onClick={() => void handleDownload(file)}>Download</Button>
                            )}
                            {DOCUMENT_ACTIONS.includes('delete') && (
                              <Button type="button" variant="danger" size="sm" onClick={() => void handleDelete(file)}>Delete</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-sm text-gray-600">{status}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
