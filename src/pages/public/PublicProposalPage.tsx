import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, RotateCcw } from 'lucide-react';
import { useParams } from 'react-router-dom';
import type { EstimateProposalProjection } from '../../utils/estimateProposalModel.js';

type PublicProposal = {
  id: string;
  versionNumber: number;
  status: 'sent' | 'viewed' | 'accepted';
  snapshot: EstimateProposalProjection;
  expiresAt: string;
  acceptedAt?: string;
  acceptedBy?: string;
};

const money = (value: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value);
const displayDate = (value?: string) => value ? new Date(value).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';

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
  const { snapshot } = proposal;

  return (
    <main className="min-h-screen bg-brand-50 px-3 py-4 text-brand-800 sm:px-6 sm:py-8 print:bg-white print:p-0">
      <article className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.12)] print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <header className="bg-accent-700 px-5 py-6 text-white sm:px-10 sm:py-7 print:bg-accent-700 print:text-white print:[print-color-adjust:exact]">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
            <div className="flex items-start gap-4">{snapshot.company.logoDataUrl ? <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-xl bg-white p-2"><img src={snapshot.company.logoDataUrl} alt={`${snapshot.company.name} logo`} className="max-h-full max-w-full object-contain" /></div> : null}<div><p className="font-serif text-2xl font-semibold">{snapshot.company.name}</p><div className="mt-2 space-y-0.5 text-sm text-white/85">{[snapshot.company.address, [snapshot.company.phone, snapshot.company.email].filter(Boolean).join(' | '), snapshot.company.website].filter(Boolean).map((value) => <p key={value}>{value}</p>)}</div></div></div>
            <div className="sm:text-right"><h1 className="font-serif text-4xl text-white">Proposal</h1><p className="mt-2 text-sm font-semibold text-white">{snapshot.proposal.number}</p></div>
          </div>
        </header>
        <div className="px-5 py-7 sm:px-10 sm:py-9">
          <section className="grid gap-5 rounded-xl border border-accent-200 bg-accent-50 p-5 sm:grid-cols-2 lg:grid-cols-[1.25fr_1.25fr_.75fr_.75fr] print:[print-color-adjust:exact]"><div><p className="text-xs font-bold uppercase text-accent-700">Prepared for</p><p className="mt-2 font-serif text-lg text-brand-900">{snapshot.customer.displayName}</p><p className="mt-1 whitespace-pre-line text-sm text-brand-500">{[snapshot.customer.billingAddress, snapshot.customer.email, snapshot.customer.phone].filter(Boolean).join('\n')}</p></div><div><p className="text-xs font-bold uppercase text-accent-700">Property</p><p className="mt-2 font-serif text-lg text-brand-900">{snapshot.proposal.title}</p><p className="mt-1 text-sm text-brand-500">{snapshot.proposal.projectAddress}</p></div><div><p className="text-xs font-bold uppercase text-accent-700">Issue date</p><p className="mt-2 text-sm font-semibold text-brand-900">{displayDate(snapshot.proposal.date)}</p></div><div><p className="text-xs font-bold uppercase text-accent-700">Valid until</p><p className="mt-2 text-sm font-semibold text-brand-900">{displayDate(snapshot.proposal.validUntil)}</p></div></section>
          {snapshot.workType === 'service' ? <section className="py-8"><h2 className="border-b-2 border-accent-500 pb-2 font-serif text-2xl text-accent-800">Services</h2><div className="mt-5 divide-y divide-brand-100">{snapshot.services?.map((service) => <div key={service.id} className="py-5 first:pt-0"><div className="flex flex-wrap items-baseline justify-between gap-3"><h3 className="font-serif text-lg font-semibold text-accent-800">{service.name}</h3><p className="font-semibold text-brand-900">{service.billingType === 'contract' ? money(service.contractPrice) : service.billingType === 'per_visit' ? `${money(service.effectivePricePerVisit)} / visit` : 'Time & Material'}</p></div><p className="mt-1 text-sm text-brand-400">{service.scheduleLabel} · {service.estimatedVisits} estimated visit{service.estimatedVisits === 1 ? '' : 's'}</p>{service.description ? <p className="mt-3 whitespace-pre-line text-sm leading-6 text-brand-700">{service.description}</p> : null}{service.billingType === 'per_visit' && service.oneTimeCharge > 0 ? <p className="mt-2 text-sm text-brand-500">One-time charge: {money(service.oneTimeCharge)}</p> : null}{service.billingType === 'time_and_material' ? <div className="mt-3 space-y-1 text-sm text-brand-700">{service.customerRates.map((rate, index) => <div key={`${rate.category}-${rate.name}-${index}`} className="flex justify-between gap-4"><span>{rate.name || rate.category}</span><span>{money(rate.sellRate)} / {rate.unit}</span></div>)}{service.timeAndMaterialNotes ? <p className="pt-2 text-brand-500">{service.timeAndMaterialNotes}</p> : null}</div> : null}</div>)}</div></section> : <section className="py-8"><h2 className="border-b-2 border-accent-500 pb-2 font-serif text-2xl text-accent-800">Work Areas</h2><div className="mt-5 space-y-4">{snapshot.workAreas.map((area) => <div key={area.name} className="break-inside-avoid rounded-xl border border-brand-100 p-5"><div className="flex items-baseline justify-between gap-4"><h3 className="font-serif text-lg font-semibold text-accent-800">{area.name}</h3><p className="font-semibold text-brand-900">{money(area.subtotal)}</p></div><p className="mt-4 text-xs font-bold uppercase text-accent-700">Scope of Work</p><ul className="mt-2 space-y-2 text-sm leading-6 text-brand-700">{area.scopeLines.map((line) => <li key={line} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-600" />{line}</li>)}</ul></div>)}</div></section>}
          <section className="break-inside-avoid border-y border-brand-100 py-7"><div className="ml-auto max-w-sm rounded-xl border border-accent-200 bg-accent-50 p-5 text-sm print:[print-color-adjust:exact]"><div className="space-y-2">{snapshot.workType === 'service' && snapshot.servicePricingSummary ? <><div className="flex justify-between"><span>Contracted services</span><span>{money(snapshot.servicePricingSummary.contractedRevenue)}</span></div><div className="flex justify-between"><span>Projected per-visit services</span><span>{money(snapshot.servicePricingSummary.projectedPerVisitRevenue)}</span></div><div className="flex justify-between"><span>Projected time & material</span><span>{money(snapshot.servicePricingSummary.projectedTimeAndMaterialRevenue)}</span></div></> : <div className="flex justify-between"><span>Subtotal</span><span>{money(snapshot.proposal.subtotal)}</span></div>}<div className="flex justify-between"><span>{snapshot.workType === 'service' ? 'Estimated ' : ''}{snapshot.proposal.taxLabel} ({snapshot.proposal.taxRate}%)</span><span>{money(snapshot.proposal.taxAmount)}</span></div></div><div className="mt-4 flex justify-between border-t-2 border-accent-500 pt-3 font-serif text-xl font-semibold text-accent-800"><span>{snapshot.workType === 'service' ? 'Estimated Total' : 'Total'}</span><span>{money(snapshot.proposal.total)}</span></div></div></section>
          {snapshot.paymentSchedule.length ? <section className="py-8"><h2 className="border-b-2 border-accent-500 pb-2 font-serif text-2xl text-accent-800">Payment Schedule</h2><div className="mt-4 divide-y divide-brand-100">{snapshot.paymentSchedule.map((payment, index) => <div key={payment.id} className="grid gap-1 py-4 sm:grid-cols-[2rem_1fr_auto_auto] sm:items-center sm:gap-5"><span className="text-sm font-semibold text-accent-600">{index + 1}.</span><div><p className="font-semibold text-brand-900">{payment.label}</p><p className="text-sm text-brand-500">{payment.due}</p></div>{payment.type === 'percentage' ? <span className="text-sm text-brand-500">{payment.percentage}%</span> : <span /> }<span className="font-semibold">{money(payment.amount)}</span></div>)}</div></section> : null}
          {[['Notes', snapshot.proposal.notes], ['Exclusions', snapshot.proposal.exclusions], ['Terms & Conditions', snapshot.proposal.terms]].filter(([, value]) => value).map(([title, value]) => <section key={title} className="border-t border-brand-100 py-7"><h2 className="font-serif text-xl text-accent-800">{title}</h2><p className="mt-3 whitespace-pre-line text-sm leading-6 text-brand-700">{value}</p></section>)}
          <section className="border-t-2 border-accent-500 pt-8">
            {accepted ? <div className="rounded-xl bg-accent-50 p-6"><CheckCircle2 className="text-accent-600" size={32} /><h2 className="mt-3 font-serif text-2xl text-accent-900">Proposal accepted</h2><p className="mt-2 text-sm text-accent-800">Accepted by {accepted.customerName} on {displayDate(accepted.acceptedAt)}.</p><a href={`/api/public-proposal?token=${encodeURIComponent(token)}&artifact=pdf`} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent-700 px-4 py-2.5 text-sm font-semibold text-white"><Download size={16} /> View accepted Proposal</a></div> : <div><h2 className="font-serif text-2xl text-accent-800">Accept Proposal</h2><label className="mt-5 flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="mt-1 h-4 w-4 accent-accent-600" /><span>I have reviewed and agree to this Proposal and its terms.</span></label><label className="mt-5 block text-sm font-semibold">Full Name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 block w-full rounded-xl border border-brand-200 px-3 py-2.5 font-normal outline-none focus:border-accent-600" /></label><div className="mt-5"><p className="mb-2 text-sm font-semibold">Signature</p><SignaturePad onChange={setSignature} /></div><p className="mt-4 text-sm text-brand-400">Acceptance date will be recorded securely when you submit.</p>{error ? <p className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}<button type="button" disabled={!agreed || !name.trim() || !signature || submitting} onClick={() => void accept()} className="mt-5 w-full rounded-xl bg-accent-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{submitting ? 'Accepting...' : 'Accept Proposal'}</button></div>}
          </section>
        </div>
      </article>
    </main>
  );
}
