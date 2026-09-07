import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

import { buildEstimateProposalProjection } from '../src/utils/estimateProposalModel.js';

const tempDir = await mkdtemp(join(tmpdir(), 'oliveops-proposal-pdf-'));
const bundlePath = join(tempDir, 'proposal-pdf.mjs');
await build({ entryPoints: ['src/utils/estimateProposalPdf.ts'], outfile: bundlePath, bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const { createEstimateProposalDocument } = await import(pathToFileURL(bundlePath).href);
process.on('exit', () => { void rm(tempDir, { recursive: true, force: true }); });

const business = { name: 'Green Earth Contracting', phone: '905-555-0120', email: 'office@greenearth.ca', website: 'greenearth.ca', businessAddress: '1 Contractor Way', proposalTerms: 'Payment is due according to the accepted schedule.' };
const customer = { name: 'Jamie Smith', company: 'Smith Family', email: 'jamie@example.ca', phone: '416-555-0110', address: '10 Billing Street' };

function estimate(areaCount = 1, descriptionsPerArea = 3) {
  return {
    id: 'estimate-a', customerId: 'customer-a', proposalNumber: 'PROP-2026-0042', title: 'Smith Backyard Patio', description: 'A practical outdoor space designed for the Smith family.', propertyAddressSnapshot: '20 Project Road', status: 'draft', createdAt: '2026-09-01', validUntil: '2026-10-01', taxRate: 13, notes: 'Please provide access to the rear yard.',
    paymentSchedule: [
      { id: 'deposit', label: 'Deposit', type: 'percentage', percentage: 25, due: 'Upon acceptance', sortOrder: 0 },
      { id: 'final', label: 'Final Payment', type: 'percentage', percentage: 75, due: 'Upon substantial completion', sortOrder: 1 },
    ],
    workAreas: Array.from({ length: areaCount }, (_, areaIndex) => ({
      id: `area-${areaIndex}`, name: `Work Area ${areaIndex + 1}`, description: Array.from({ length: descriptionsPerArea }, (_, lineIndex) => `Complete customer scope item ${areaIndex + 1}.${lineIndex + 1} with a detailed description that wraps safely across the printable proposal page.`).join('\n'), sortOrder: areaIndex,
      lineItems: Array.from({ length: descriptionsPerArea }, (_, lineIndex) => ({
        category: lineIndex % 2 ? 'equipment' : 'labour',
        itemName: lineIndex % 2 ? 'Bobcat e50' : 'John Smith',
        description: lineIndex % 2 ? 'Equipment catalog record' : 'Employee record',
        employeeName: 'Mike White', equipmentName: 'Bobcat e50', materialName: 'HPB Aggregate', subcontractorName: 'Trade Partner Inc.',
        quantity: 10, unit: 'hr', unitCost: 27.5, sellPrice: 83.75, total: 100 + areaIndex + lineIndex,
        overheadRecoveryPerHour: 12, estimatedProfit: 50, margin: 20,
      })),
    })),
  };
}

const pdfText = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
const pdfRenderedText = (output) => (output.match(/\((?:\\.|[^)])*\) Tj/g) ?? [])
  .map((token) => token.slice(1, -4).replace(/\\([()\\])/g, '$1'))
  .join(' ');

test('proposal PDF renders the compact customer-safe layout in the required order', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(), customer, business });
  const pdf = createEstimateProposalDocument(projection);
  const output = pdfText(pdf);
  const renderedText = pdfRenderedText(output);

  for (const visible of ['PROPOSAL', 'PREPARED FOR', 'PROPERTY', 'ISSUE DATE', 'VALID UNTIL', 'INTRODUCTION', 'WORK AREAS', 'Scope of Work', 'PAYMENT SCHEDULE', 'Deposit', 'Final Payment', 'TOTAL', 'ACCEPTANCE', 'Green Earth Contracting', 'PROP-2026-0042', '20 Project Road', 'Sep 1, 2026', 'Oct 1, 2026', 'DRAFT']) {
    assert.match(output, new RegExp(visible));
  }
  assert.ok(renderedText.indexOf('INTRODUCTION') < renderedText.indexOf('WORK AREAS'));
  assert.ok(renderedText.indexOf('WORK AREAS') < renderedText.indexOf('PAYMENT SCHEDULE'));
  assert.ok(renderedText.indexOf('PAYMENT SCHEDULE') < renderedText.indexOf('Tax (13%)'));
  assert.ok(renderedText.indexOf('Tax (13%)') < renderedText.indexOf('TOTAL'));
  for (const hidden of ['unitCost', 'sellPrice', 'overheadRecovery', 'estimatedProfit', 'margin', 'John Smith', 'Mike White', 'Bobcat e50', 'HPB Aggregate', 'Trade Partner Inc.', 'Equipment catalog record', 'Employee record', 'Generated:']) {
    assert.doesNotMatch(output, new RegExp(hidden, 'i'));
  }
  assert.doesNotMatch(output, /\((?:Download|Print)\)/i);
  assert.match(output, /Complete customer scope item 1\.1/);
  assert.match(output, /Complete customer scope item 1\.2/);
  assert.ok(output.indexOf('Complete customer scope item 1.1') < output.indexOf('Complete customer scope item 1.2'));
  assert.match(output, /\$303\.00/);
  assert.match(output, /\$39\.39/);
  assert.match(output, /\$342\.39/);
  assert.ok(pdf.getNumberOfPages() >= 1);
});

test('accepted PDF renders the immutable customer signature, accepted name, and authoritative date', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(), customer, business });
  const output = pdfText(createEstimateProposalDocument(projection, { acceptance: {
    customerName: 'Barbara Bartholomew',
    acceptedAt: '2026-09-08T14:30:00.000Z',
    signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    acceptanceStatementVersion: 1,
  } }));
  assert.match(output, /ACCEPTANCE/);
  assert.match(output, /ACCEPTED/);
  assert.match(output, /Barbara Bartholomew/);
  assert.match(output, /September 8, 2026/);
  assert.match(output, /Electronic acceptance statement version 1/);
  assert.match(output, /\/Subtype \/Image/);
  assert.doesNotMatch(output, /Customer name|Signature\)/);
});

test('multiple Work Areas render each sell price without exposing an internal total label', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(2, 2), customer, business });
  const output = pdfText(createEstimateProposalDocument(projection));

  assert.doesNotMatch(output, /Work Area Total/);
  assert.match(output, /Work Area 1/);
  assert.match(output, /Work Area 2/);
  assert.match(output, /\$201\.00/);
  assert.match(output, /\$203\.00/);
  assert.match(output, /\$52\.52/);
  assert.match(output, /\$456\.52/);
});

test('Terms retain the validity statement when no custom terms are configured', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(), customer, business: { ...business, proposalTerms: '' } });
  const output = pdfText(createEstimateProposalDocument(projection));
  assert.match(output, /\(TERMS\)/);
  assert.match(output, /This proposal is valid until October 1, 2026\./);
  assert.match(output, /ACCEPTANCE/);
});

test('long proposal paginates without clipping and prints proposal/page footers on every page', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(8, 8), customer, business });
  const pdf = createEstimateProposalDocument(projection);
  const output = pdfText(pdf);
  const pageCount = pdf.getNumberOfPages();

  assert.ok(pageCount >= 3);
  for (let page = 1; page <= pageCount; page += 1) assert.match(output, new RegExp(`Page ${page} of ${pageCount}`));
  assert.equal((output.match(/PROP-2026-0042/g) ?? []).length >= pageCount, true);
  assert.equal((output.match(/DRAFT/g) ?? []).length, pageCount);
  assert.match(output, /Complete customer scope item 8\.8/);
});

test('optional sections are omitted when empty and a non-taxable proposal preserves zero tax', () => {
  const source = estimate();
  source.taxRate = 0;
  source.notes = '';
  const projection = buildEstimateProposalProjection({ estimate: source, customer: { name: 'Client' }, business: { name: 'Contractor' } });
  const output = pdfText(createEstimateProposalDocument(projection));

  assert.match(output, /Tax \\\(0%\\\)/);
  assert.match(output, /\$0\.00/);
  assert.doesNotMatch(output, /\(NOTES\)|\(EXCLUSIONS\)/);
  assert.match(output, /\(TERMS\)/);
});

test('legacy proposal renders the safe scope fallback without resource names', () => {
  const source = estimate();
  source.workAreas[0].description = '';
  const output = pdfText(createEstimateProposalDocument(buildEstimateProposalProjection({ estimate: source, customer, business })));

  assert.match(output, /Scope details to be confirmed\./);
  assert.doesNotMatch(output, /John Smith|Bobcat e50|Employee record|Equipment catalog record/i);
  assert.match(output, /\$303\.00/);
  assert.match(output, /\$39\.39/);
  assert.match(output, /\$342\.39/);
});

test('company logo is rendered when snapshotted and company name remains the fallback', () => {
  const logoDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const withLogo = pdfText(createEstimateProposalDocument(buildEstimateProposalProjection({ estimate: estimate(), customer, business: { ...business, logoDataUrl } })));
  const withoutLogo = pdfText(createEstimateProposalDocument(buildEstimateProposalProjection({ estimate: estimate(), customer, business: { ...business, logoDataUrl: '' } })));

  assert.match(withLogo, /\/Subtype \/Image/);
  assert.match(withLogo, /Green Earth Contracting/);
  assert.doesNotMatch(withoutLogo, /\/Subtype \/Image/);
  assert.match(withoutLogo, /Green Earth Contracting/);
});

test('sent proposal footer uses PROPOSAL without changing totals', () => {
  const source = estimate();
  source.status = 'sent';
  const output = pdfText(createEstimateProposalDocument(buildEstimateProposalProjection({ estimate: source, customer, business })));

  assert.match(output, /PROPOSAL/);
  assert.doesNotMatch(output, /\(DRAFT\)/);
  assert.match(output, /\$342\.39/);
});

test('Service proposal PDF distinguishes contracted and projected pricing', () => {
  const source = { ...estimate(), workType: 'service', workAreas: [], services: [
    { id: 'contract', name: 'Seasonal Lawn Care', description: 'Weekly mowing and trimming.', sortOrder: 0, scheduleType: 'recurring', billingType: 'contract', frequency: { interval: 1, unit: 'week' }, estimatedVisits: 20, lineItems: [{ category: 'labour', itemName: 'Crew rate', quantity: 1, unit: 'hr', unitCost: 40, sellPrice: 100, costScope: 'per_visit' }], contractPricing: { customContractPrice: 1800 } },
    { id: 'visit', name: 'Spring Cleanup', description: 'Cleanup as requested.', sortOrder: 1, scheduleType: 'as_needed', billingType: 'per_visit', estimatedVisits: 2, lineItems: [{ category: 'labour', itemName: 'Cleanup crew', quantity: 2, unit: 'hr', unitCost: 40, sellPrice: 100, costScope: 'per_visit' }], perVisitPricing: { customPricePerVisit: 250, oneTimeCharge: 50 } },
    { id: 'tm', name: 'Storm Response', description: 'Emergency response.', sortOrder: 2, scheduleType: 'as_needed', billingType: 'time_and_material', estimatedVisits: 1, lineItems: [{ category: 'equipment', itemName: 'Loader', quantity: 2, unit: 'hr', unitCost: 50, sellPrice: 125, costScope: 'per_visit' }], timeAndMaterialPricing: { notes: 'Materials billed as used.' } },
  ] };
  const output = pdfText(createEstimateProposalDocument(buildEstimateProposalProjection({ estimate: source, customer, business })));

  for (const visible of ['SERVICES', 'Seasonal Lawn Care', 'Every week', 'Spring Cleanup', '$250.00 / visit', 'One-time charge: $50.00', 'Storm Response', 'Time & Material', 'Contracted services', 'Projected per-visit services', 'Projected time & material', 'Estimated Tax', 'ESTIMATED TOTAL']) assert.match(output, new RegExp(visible.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(output, /unitCost|recoveredCost|estimatedProfit|marginPercent/);
});
