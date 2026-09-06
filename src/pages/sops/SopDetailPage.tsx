import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, Pencil } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import { AuthorizedPdfPreview } from '../../components/documents/PdfDocumentControls';
import RichTextViewer from '../../components/rich-text/RichTextViewer';
import type { SopDefinition, SopVersion } from '../../types/sop';
import { resolveAttachmentUrl } from '../../utils/fileUpload';
import { sopRichTextContent } from '../../utils/richText';
import { getSop } from './sopApi';

function AttachmentList({ fileIds }: { fileIds: string[] }) {
  const [openingId, setOpeningId] = useState('');
  const open = async (fileId: string) => {
    setOpeningId(fileId);
    const url = await resolveAttachmentUrl({ fileId });
    setOpeningId('');
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };
  if (fileIds.length === 0) return <p className="mt-2 text-sm text-gray-500">No attachments.</p>;
  return <ul className="mt-2 space-y-2">{fileIds.map((fileId, index) => <li key={fileId}><Button variant="secondary" size="sm" disabled={openingId === fileId} onClick={() => void open(fileId)}><Download size={14} /> {openingId === fileId ? 'Opening...' : `Attachment ${index + 1}`}</Button></li>)}</ul>;
}

export default function SopDetailPage() {
  const { sopId = '' } = useParams();
  const navigate = useNavigate();
  const [definition, setDefinition] = useState<SopDefinition | null>(null);
  const [versions, setVersions] = useState<SopVersion[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const payload = await getSop(sopId);
      setDefinition(payload.definition);
      setVersions(payload.versions);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'SOP could not be loaded.');
    }
  }, [sopId]);
  useEffect(() => { void load(); }, [load]);

  if (!definition) return <Card className="p-6"><p role={error ? 'alert' : undefined} className={error ? 'text-sm text-red-700' : 'text-sm text-gray-500'}>{error || 'Loading SOP...'}</p></Card>;
  const status = definition.status === 'draft' ? 'Draft' : definition.active ? 'Published' : 'Archived';
  const badgeClass = definition.status === 'draft' ? 'bg-amber-50 text-amber-700' : definition.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600';

  return <div className="space-y-5">
    <Link to="/sops" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700"><ArrowLeft size={15} /> SOP Library</Link>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold text-gray-900">{definition.title}</h1><Badge label={status} className={badgeClass} /></div><p className="mt-1 text-sm text-gray-500">{definition.category || 'Uncategorized'} · {definition.shortDescription || 'No description'}</p></div><Button variant="secondary" onClick={() => navigate(`/sops/${definition.id}/edit`)}><Pencil size={15} /> Edit SOP</Button></header>
    {error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {(definition.contentMode ?? 'structured') === 'document' && definition.document ? <AuthorizedPdfPreview document={definition.document} title={definition.title} /> : <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]"><Card className="p-5"><RichTextViewer document={sopRichTextContent(definition)} emptyMessage="No procedure content has been provided." /></Card><Card className="p-5"><dl className="space-y-4 text-sm"><div><dt className="text-gray-500">Current version</dt><dd className="font-semibold">{definition.currentVersion ? `v${definition.currentVersion}` : 'Not published'}</dd></div><div><dt className="text-gray-500">Last updated</dt><dd className="font-semibold">{new Date(definition.updatedAt).toLocaleString()}</dd></div><div><dt className="text-gray-500">Attachments</dt><dd><AttachmentList fileIds={definition.attachmentFileIds} /></dd></div></dl></Card></div>}
    <section className="space-y-3"><h2 className="text-lg font-semibold text-gray-900">Version history</h2>{versions.length === 0 ? <Card className="p-5"><EmptyState title="No published versions" description="Publish this SOP to create its first immutable version." /></Card> : <div className="space-y-3">{[...versions].sort((a, b) => b.version - a.version).map((version) => <Card key={version.version} className="p-5"><details><summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">Version {version.version}</span><span className="text-sm text-gray-500">Published {new Date(version.publishedAt).toLocaleString()}</span></div><p className="mt-1 text-sm text-gray-500">{version.title} · {version.category || 'Uncategorized'}</p></summary><div className="mt-5 space-y-5 border-t pt-5"><p className="text-sm text-gray-600">{version.shortDescription || 'No description.'}</p>{(version.contentMode ?? 'structured') === 'document' && version.document ? <AuthorizedPdfPreview document={version.document} title={version.title} /> : <RichTextViewer document={sopRichTextContent(version)} emptyMessage="No procedure content." />}<div><h3 className="font-semibold text-gray-900">Attachments</h3><AttachmentList fileIds={version.attachmentFileIds} /></div></div></details></Card>)}</div>}</section>
  </div>;
}