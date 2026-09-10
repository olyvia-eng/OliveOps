import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, RotateCcw } from 'lucide-react';
import { useParams } from 'react-router-dom';
import type { EstimateProposalProjection } from '../../utils/estimateProposalModel.js';
import RichTextViewer from '../../components/rich-text/RichTextViewer';
import { proposalScopeRichText } from '../../utils/richText';
import { buildProposalPresentation, proposalDisplayDate } from '../../utils/proposalPresentationModel.js';

type PublicProposal = {
  id: string;
  versionNumber: number;
  status: 'sent' | 'viewed' | 'accepted';
  snapshot: EstimateProposalProjection;
  expiresAt: string;
  acceptedAt?: string;
  acceptedBy?: string;
};

function SignaturePad({ onChange }: { onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const data = canvas.toDataURL();
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      canvas.width = width * ratio;
      canvas.height = 180 * ratio;
      const context = canvas.getContext('2d');
      context?.scale(ratio, ratio);
      context?.drawImage(Object.assign(new Image(), { src: data }), 0, 0, width, 180);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext('2d');
    const position = point(event);
    if (context) { context.beginPath(); context.moveTo(position.x, position.y); context.strokeStyle = '#172b35'; context.lineWidth = 2.2; context.lineCap = 'round'; context.lineJoin = 'round'; }
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    hasDrawn.current = true;
    const context = event.currentTarget.getContext('2d');
    const position = point(event);
    if (context) { context.lineTo(position.x, position.y); context.stroke(); }
  };
  const finish = () => {
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas && hasDrawn.current) onChange(canvas.toDataURL('image/png'));
  };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn.current = false;
    onChange('');
  };

  return <div><div className="overflow-hidden rounded-xl border border-brand-200 bg-white"><canvas ref={canvasRef} className="block h-[180px] w-full touch-none cursor-crosshair" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} aria-label="Draw your signature" /></div><button type="button" onClick={clear} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent-700"><RotateCcw size={14} /> Clear signature</button></div>;
}

export default function PublicProposalPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [proposal, setProposal] = useState<PublicProposal | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [signature, setSignature] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState<{ customerName: string; acceptedAt: string } | null>(null);
  const requestId = useRef(crypto.randomUUID());

  useEffect(() => {
    void fetch(`/api/public-proposal?token=${encodeURIComponent(token)}`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'This Proposal is unavailable.');
      setProposal(payload.proposal);
      setName(payload.proposal.acceptedBy || payload.proposal.snapshot.customer.displayName || '');
      if (payload.proposal.status === 'accepted') setAccepted({ customerName: payload.proposal.acceptedBy, acceptedAt: payload.proposal.acceptedAt });
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'This Proposal is unavailable.')).finally(() => setLoading(false));
  }, [token]);

  const accept = async () => {
    if (!proposal || !agreed || !name.trim() || !signature) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/public-proposal?action=accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, requestId: requestId.current, agreed, customerName: name.trim(), signatureDataUrl: signature }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Proposal acceptance could not be completed.');
      setAccepted(payload.acceptance);
      setProposal((current) => current ? { ...current, status: 'accepted', acceptedAt: payload.acceptance.acceptedAt, acceptedBy: payload.acceptance.customerName } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Proposal acceptance could not be completed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <main className="min-h-screen bg-brand-50 px-5 py-16 text-center font-serif text-brand-500">Loading Proposal...</main>;
  if (!proposal) return <main className="min-h-screen bg-brand-50 px-5 py-16 text-center"><h1 className="font-serif text-3xl text-brand-900">Proposal unavailable</h1><p className="mt-3 text-brand-500">{error}</p></main>;
  const presentation = buildProposalPresentation(proposal.snapshot);

  return (
    <main className="min-h-screen bg-brand-50 px-3 py-4 text-brand-800 sm:px-6 sm:py-8 print:bg-white print:p-0">
      <article className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.12)] print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <header className="bg-accent-700 px-5 py-6 text-white sm:px-10 sm:py-7 print:bg-accent-700 print:text-white print:[print-color-adjust:exact]">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
            <div className="flex items-start gap-4">{presentation.company.logoDataUrl ? <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-xl bg-white p-2"><img src={presentation.company.logoDataUrl} alt={`${presentation.company.name} logo`} className="max-h-full max-w-full object-contain" /></div> : null}<div><p className="font-serif text-2xl font-semibold">{presentation.company.name}</p><div className="mt-2 space-y-0.5 text-sm text-white/85">{presentation.company.details.map((value) => <p key={value}>{value}</p>)}</div></div></div>
            <div className="sm:text-right"><h1 className="font-serif text-4xl text-white">{presentation.document.label}</h1><p className="mt-2 text-sm font-semibold text-white">{presentation.document.number}</p></div>
          </div>
        </header>
        <div className="px-5 py-7 sm:px-10 sm:py-9">
          <section className="grid gap-5 rounded-xl border border-accent-200 bg-accent-50 p-5 sm:grid-cols-2 lg:grid-cols-[1.25fr_1.25fr_.75fr_.75fr] print:[print-color-adjust:exact]">{presentation.information.map((item) => <div key={item.key}><p className="text-xs font-bold uppercase text-accent-700">{item.label}</p><p className="mt-2 font-serif text-lg text-brand-900">{item.value}</p>{item.details?.length ? <p className="mt-1 whitespace-pre-line text-sm text-brand-500">{item.details.join('\n')}</p> : null}</div>)}</section>
          {presentation.introduction ? <section className="border-b border-brand-100 py-7"><h2 className="font-serif text-xl text-accent-800">Introduction</h2><p className="mt-3 whitespace-pre-line text-sm leading-6 text-brand-700">{presentation.introduction}</p></section> : null}
          {presentation.workType === 'service' ? <section className="py-8"><h2 className="border-b-2 border-accent-500 pb-2 font-serif text-2xl text-accent-800">Services</h2><div className="mt-5 divide-y divide-brand-100">{presentation.services.map((service) => <div key={service.id} className="py-5 first:pt-0"><div className="flex flex-wrap items-baseline justify-between gap-3"><h3 className="font-serif text-lg font-semibold text-accent-800">{service.name}</h3><p className="font-semibold text-brand-900">{service.displayPrice}</p></div><p className="mt-1 text-sm text-brand-400">{service.scheduleSummary}</p>{service.description ? <p className="mt-3 whitespace-pre-line text-sm leading-6 text-brand-700">{service.description}</p> : null}{service.billingType === 'per_visit' && service.oneTimeCharge > 0 ? <p className="mt-2 text-sm text-brand-500">One-time charge: {service.displayOneTimeCharge}</p> : null}{service.billingType === 'time_and_material' ? <div className="mt-3 space-y-1 text-sm text-brand-700">{service.customerRates.map((rate, index) => <div key={`${rate.category}-${rate.name}-${index}`} className="flex justify-between gap-4"><span>{rate.name || rate.category}</span><span>{rate.displayRate} / {rate.unit}</span></div>)}{service.timeAndMaterialNotes ? <p className="pt-2 text-brand-500">{service.timeAndMaterialNotes}</p> : null}</div> : null}</div>)}</div></section> : <section className="py-8"><h2 className="border-b-2 border-accent-500 pb-2 font-serif text-2xl text-accent-800">Work Areas</h2><div className="mt-5 space-y-4">{presentation.workAreas.map((area) => <div key={area.name} className="break-inside-avoid rounded-xl border border-brand-100 p-5"><div className="flex items-baseline justify-between gap-4"><h3 className="font-serif text-lg font-semibold text-accent-800">{area.name}</h3><p className="font-semibold text-brand-900">{area.displayPrice}</p></div><p className="mt-4 text-xs font-bold uppercase text-accent-700">Scope of Work</p><div className="mt-2 text-sm leading-6 text-brand-700"><RichTextViewer document={area.scopeRichText ?? proposalScopeRichText(null, area.scopeLines.join('\n'))} /></div></div>)}</div></section>}
          <section className="break-inside-avoid border-y border-brand-100 py-7"><div className="ml-auto max-w-sm rounded-xl border border-accent-200 bg-accent-50 p-5 text-sm print:[print-color-adjust:exact]"><div className="space-y-2">{presentation.totals.rows.map((row) => <div key={row.key} className="flex justify-between"><span>{row.label}</span><span>{row.displayValue}</span></div>)}</div><div className="mt-4 flex justify-between border-t-2 border-accent-500 pt-3 font-serif text-xl font-semibold text-accent-800"><span>{presentation.totals.label}</span><span>{presentation.totals.displayValue}</span></div></div></section>
          {presentation.paymentSchedule.length ? <section className="py-8"><h2 className="border-b-2 border-accent-500 pb-2 font-serif text-2xl text-accent-800">Payment Schedule</h2><div className="mt-4 divide-y divide-brand-100">{presentation.paymentSchedule.map((payment) => <div key={payment.id} className="grid gap-1 py-4 sm:grid-cols-[2rem_1fr_auto_auto] sm:items-center sm:gap-5"><span className="text-sm font-semibold text-accent-600">{payment.index}.</span><div><p className="font-semibold text-brand-900">{payment.label}</p><p className="text-sm text-brand-500">{payment.due}</p></div><span className="text-sm text-brand-500">{payment.percentageLabel}</span><span className="font-semibold">{payment.displayAmount}</span></div>)}</div></section> : null}
          {presentation.sections.map((section) => <section key={section.key} className="border-t border-brand-100 py-7"><h2 className="font-serif text-xl text-accent-800">{section.label}</h2><div className="mt-3 space-y-2 text-sm leading-6 text-brand-700">{section.blocks.map((block, index) => block.kind === 'list-item' ? <p key={index} className="grid grid-cols-[1.25rem_1fr] gap-1"><span>{block.marker}</span><span>{block.text}</span></p> : <p key={index}>{block.text}</p>)}</div></section>)}
          <section className="border-t-2 border-accent-500 pt-8">
            {accepted ? <div className="rounded-xl bg-accent-50 p-6"><CheckCircle2 className="text-accent-600" size={32} /><h2 className="mt-3 font-serif text-2xl text-accent-900">Proposal accepted</h2><p className="mt-2 text-sm text-accent-800">Accepted by {accepted.customerName} on {proposalDisplayDate(accepted.acceptedAt)}.</p><a href={`/api/public-proposal?token=${encodeURIComponent(token)}&artifact=pdf`} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent-700 px-4 py-2.5 text-sm font-semibold text-white"><Download size={16} /> View accepted Proposal</a></div> : <div><h2 className="font-serif text-2xl text-accent-800">Accept Proposal</h2><label className="mt-5 flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="mt-1 h-4 w-4 accent-accent-600" /><span>I have reviewed and agree to this Proposal and its terms.</span></label><label className="mt-5 block text-sm font-semibold">Full Name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 block w-full rounded-xl border border-brand-200 px-3 py-2.5 font-normal outline-none focus:border-accent-600" /></label><div className="mt-5"><p className="mb-2 text-sm font-semibold">Signature</p><SignaturePad onChange={setSignature} /></div><p className="mt-4 text-sm text-brand-400">Acceptance date will be recorded securely when you submit.</p>{error ? <p className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}<button type="button" disabled={!agreed || !name.trim() || !signature || submitting} onClick={() => void accept()} className="mt-5 w-full rounded-xl bg-accent-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{submitting ? 'Accepting...' : 'Accept Proposal'}</button></div>}
          </section>
        </div>
      </article>
    </main>
  );
}
