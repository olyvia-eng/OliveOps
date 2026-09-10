import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

import { buildEstimateProposalProjection } from '../src/utils/estimateProposalModel.js';
import { buildProposalPresentation } from '../src/utils/proposalPresentationModel.js';

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
  .join(' ')
  .replace(/\s+/g, ' ');

const boxesOverlap = (left, right) => left.page === right.page
  && left.x < right.x + right.width
  && left.x + left.width > right.x
  && left.y < right.y + right.height
  && left.y + left.height > right.y;

function assertMeasuredLayout(doc) {
  const boxes = doc.__oliveOpsLayout ?? [];
  assert.ok(boxes.length > 0, 'renderer exposes measured layout boxes');
  for (const box of boxes) {
    const isFooter = box.kind.startsWith('footer-');
    assert.ok(box.x >= 42, `${box.kind} starts inside the printable margin`);
    assert.ok(box.x + box.width <= 570.01, `${box.kind} ends inside the printable margin`);
    assert.ok(box.y >= (isFooter ? 752 : 0), `${box.kind} starts in its page region`);
    assert.ok(box.y + box.height <= (isFooter ? 792 : 752), `${box.kind} ends in its page region`);
  }
  const verticallyStackedKinds = ['company-name', 'company-detail', 'information-label-customer', 'information-value-customer', 'information-detail-customer', 'information-label-property', 'information-value-property', 'information-detail-property'];
  const stacked = boxes.filter((box) => verticallyStackedKinds.includes(box.kind));
  for (let left = 0; left < stacked.length; left += 1) {
    for (let right = left + 1; right < stacked.length; right += 1) {
      assert.equal(boxesOverlap(stacked[left], stacked[right]), false, `${stacked[left].kind} does not overlap ${stacked[right].kind}`);
    }
  }
}

test('proposal PDF renders the compact customer-safe layout in the required order', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(), customer, business });
  const pdf = createEstimateProposalDocument(projection);
  const output = pdfText(pdf);
  const renderedText = pdfRenderedText(output);

  for (const visible of ['PROPOSAL', 'PREPARED FOR', 'PROPERTY', 'ISSUE DATE', 'VALID UNTIL', 'Introduction', 'Work Areas', 'SCOPE OF WORK', 'Payment Schedule', 'Deposit', 'Final Payment', 'TOTAL', 'Acceptance', 'Green Earth Contracting', 'PROP-2026-0042', '20 Project Road', 'September 1, 2026', 'October 1, 2026']) {
    assert.match(renderedText, new RegExp(visible), `missing customer-visible PDF text: ${visible}`);
  }
  assert.doesNotMatch(output, /DRAFT/);
  assert.ok(renderedText.indexOf('Introduction') < renderedText.indexOf('Work Areas'));
  assert.ok(renderedText.indexOf('Work Areas') < renderedText.indexOf('Tax (13%)'));
  assert.ok(renderedText.indexOf('Tax (13%)') < renderedText.indexOf('TOTAL'));
  assert.ok(renderedText.indexOf('TOTAL') < renderedText.indexOf('Payment Schedule'));
  for (const hidden of ['unitCost', 'sellPrice', 'overheadRecovery', 'estimatedProfit', 'margin', 'John Smith', 'Mike White', 'Bobcat e50', 'HPB Aggregate', 'Trade Partner Inc.', 'Equipment catalog record', 'Employee record', 'Generated:']) {
    assert.doesNotMatch(output, new RegExp(hidden, 'i'));
  }
  assert.doesNotMatch(output, /\((?:Download|Print)\)/i);
  assert.match(renderedText, /Complete customer scope item 1\.1/);
  assert.match(renderedText, /Complete customer scope item 1\.2/);
  assert.ok(renderedText.indexOf('Complete customer scope item 1.1') < renderedText.indexOf('Complete customer scope item 1.2'));
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
  assert.match(output, /Acceptance/);
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

test('PDF does not inject terms that are absent from the canonical Proposal', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(), customer, business: { ...business, proposalTerms: '' } });
  const output = pdfText(createEstimateProposalDocument(projection));
  assert.doesNotMatch(output, /Terms & Conditions|This proposal is valid until/);
  assert.match(output, /Acceptance/);
});

test('long proposal paginates without clipping and prints proposal/page footers on every page', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(8, 8), customer, business });
  const pdf = createEstimateProposalDocument(projection);
  const output = pdfText(pdf);
  const pageCount = pdf.getNumberOfPages();

  assert.ok(pageCount >= 3);
  for (let page = 1; page <= pageCount; page += 1) assert.match(output, new RegExp(`Page ${page} of ${pageCount}`));
  assert.equal((output.match(/PROP-2026-0042/g) ?? []).length >= pageCount, true);
  assert.equal((output.match(/PROPOSAL/g) ?? []).length >= pageCount, true);
  assert.doesNotMatch(output, /DRAFT/);
  assert.match(pdfRenderedText(output), /Complete customer scope item 8\.8/);
});

test('optional sections are omitted when empty and a non-taxable proposal preserves zero tax', () => {
  const source = estimate();
  source.taxRate = 0;
  source.notes = '';
  const projection = buildEstimateProposalProjection({ estimate: source, customer: { name: 'Client' }, business: { name: 'Contractor' } });
  const output = pdfText(createEstimateProposalDocument(projection));

  assert.match(output, /Tax \\\(0%\\\)/);
  assert.match(output, /\$0\.00/);
  assert.doesNotMatch(output, /\(Notes\)|\(Exclusions\)|Terms & Conditions/);
});

test('legacy proposal renders the safe scope fallback without resource names', () => {
  const source = estimate();
  source.workAreas[0].description = '';
  const output = pdfText(createEstimateProposalDocument(buildEstimateProposalProjection({ estimate: source, customer, business })));

  assert.match(pdfRenderedText(output), /Scope details to be confirmed\./);
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

test('proposal PDF preserves rich scope marks, lists, hard breaks, and safe multi-page flow', () => {
  const source = estimate();
  const repeatedItems = Array.from({ length: 90 }, (_, index) => ({
    type: 'listItem',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `Detailed scope item ${index + 1} remains above the page footer.` }] }],
  }));
  source.workAreas[0].scopeRichText = { type: 'doc', content: [
    { type: 'paragraph', content: [
      { type: 'text', text: 'Bold scope', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' italic scope', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' underlined scope', marks: [{ type: 'underline' }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'Second line' },
    ] },
    { type: 'bulletList', content: repeatedItems.slice(0, 45) },
    { type: 'orderedList', content: repeatedItems.slice(45) },
  ] };
  source.paymentSchedule = Array.from({ length: 18 }, (_, index) => ({ id: `stage-${index}`, label: `Milestone ${index + 1}`, type: 'fixed', amount: index === 17 ? 2.39 : 20, due: `Due after documented milestone ${index + 1} is complete.`, sortOrder: index }));

  const pdf = createEstimateProposalDocument(buildEstimateProposalProjection({ estimate: source, customer, business }));
  const output = pdfText(pdf);
  const renderedText = pdfRenderedText(output);
  assert.ok(pdf.getNumberOfPages() >= 3);
  for (const text of ['Bold scope', 'italic scope', 'underlined scope', 'Second line', 'Detailed scope item 90', 'Milestone 18']) assert.match(renderedText, new RegExp(text));
  assert.match(output, /\/F2 9\.5 Tf/, 'bold font is emitted');
  assert.match(output, /\/F3 9\.5 Tf/, 'italic font is emitted');
  assert.match(output, /0\.45 w/, 'underline stroke is emitted');
  assert.doesNotMatch(output, /DRAFT/);
});

test('Service proposal PDF distinguishes contracted and projected pricing', () => {
  const source = { ...estimate(), workType: 'service', workAreas: [], services: [
    { id: 'contract', name: 'Seasonal Lawn Care', description: 'Weekly mowing and trimming.', sortOrder: 0, scheduleType: 'recurring', billingType: 'contract', frequency: { interval: 1, unit: 'week' }, estimatedVisits: 20, lineItems: [{ category: 'labour', itemName: 'Crew rate', quantity: 1, unit: 'hr', unitCost: 40, sellPrice: 100, costScope: 'per_visit' }], contractPricing: { customContractPrice: 1800 } },
    { id: 'visit', name: 'Spring Cleanup', description: 'Cleanup as requested.', sortOrder: 1, scheduleType: 'as_needed', billingType: 'per_visit', estimatedVisits: 2, lineItems: [{ category: 'labour', itemName: 'Cleanup crew', quantity: 2, unit: 'hr', unitCost: 40, sellPrice: 100, costScope: 'per_visit' }], perVisitPricing: { customPricePerVisit: 250, oneTimeCharge: 50 } },
    { id: 'tm', name: 'Storm Response', description: 'Emergency response.', sortOrder: 2, scheduleType: 'as_needed', billingType: 'time_and_material', estimatedVisits: 1, lineItems: [{ category: 'equipment', itemName: 'Loader', quantity: 2, unit: 'hr', unitCost: 50, sellPrice: 125, costScope: 'per_visit' }], timeAndMaterialPricing: { notes: 'Materials billed as used.' } },
  ] };
  const output = pdfText(createEstimateProposalDocument(buildEstimateProposalProjection({ estimate: source, customer, business })));

  for (const visible of ['Services', 'Seasonal Lawn Care', 'Every week', 'Spring Cleanup', '$250.00 / visit', 'One-time charge: $50.00', 'Storm Response', 'Time & Material', 'Contracted services', 'Projected per-visit services', 'Projected time & material', 'Estimated Tax', 'ESTIMATED TOTAL']) assert.match(output, new RegExp(visible.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(output, /unitCost|recoveredCost|estimatedProfit|marginPercent/);
});

test('PDF customer-visible values match the canonical secure Proposal presentation', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(2, 2), customer, business });
  const presentation = buildProposalPresentation(projection);
  const renderedText = pdfRenderedText(pdfText(createEstimateProposalDocument(projection)));
  const visibleValues = [
    presentation.document.number,
    presentation.document.title,
    ...presentation.information.flatMap((item) => [item.value, ...(item.details ?? [])]),
    ...presentation.workAreas.flatMap((area) => [area.name, area.displayPrice, ...area.scopeLines]),
    ...presentation.totals.rows.flatMap((row) => [row.label, row.displayValue]),
    presentation.totals.displayValue,
    ...presentation.paymentSchedule.flatMap((payment) => [payment.label, payment.due, payment.displayAmount]),
    ...presentation.sections.flatMap((section) => [section.label, ...section.blocks.map((block) => block.text)]),
  ].filter(Boolean);

  for (const value of visibleValues) assert.match(renderedText, new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Greendale proposal header and information grid use measured non-overlapping layout', () => {
  const greendaleBusiness = {
    name: 'Greendale Landscaping',
    businessAddress: '1245 Main St.\nToronto, ON K9K 2R3\nCanada',
    phone: '705-111-2345',
    email: 'admin@greendalelandscaping.ca',
    website: 'greendalelandscaping.ca',
    proposalTerms: 'Payment is due according to the accepted schedule.',
  };
  const greendaleCustomer = {
    name: 'Karen Sullivan',
    email: 'karen.sullivan.with.a.long.address@customer-example.ca',
    phone: '705-555-0188',
    address: '9867 County Road 42, Peterborough, Ontario K9J 8N8',
  };
  const source = estimate(2, 5);
  source.proposalNumber = 'PROP-2026-0001';
  source.title = 'Patio and Retaining Wall';
  source.createdAt = '2026-09-09';
  source.validUntil = '2026-10-09';
  const projection = buildEstimateProposalProjection({ estimate: source, customer: greendaleCustomer, business: greendaleBusiness });
  const pdf = createEstimateProposalDocument(projection);
  const rendered = pdfRenderedText(pdfText(pdf));

  for (const value of ['Greendale Landscaping', '1245 Main St.', 'Toronto, ON K9K 2R3', 'Canada', '705-111-2345 | admin@greendalelandscaping.ca', 'greendalelandscaping.ca', 'September 9, 2026']) {
    assert.match(rendered, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assertMeasuredLayout(pdf);
  const proposalLabel = pdf.__oliveOpsLayout.find((box) => box.kind === 'proposal-label');
  assert.equal(proposalLabel.text, 'PROPOSAL');
  assert.equal(proposalLabel.height, 28, 'Proposal label remains on one fitted line');
  assert.equal(pdf.__oliveOpsLayout.filter((box) => box.kind === 'footer-company').length, pdf.getNumberOfPages());
  assert.equal(pdf.__oliveOpsLayout.filter((box) => box.kind === 'footer-email').length, pdf.getNumberOfPages());
  assert.equal(pdf.__oliveOpsLayout.filter((box) => box.kind === 'continuation-company').length, pdf.getNumberOfPages() - 1);
  assert.equal(pdf.__oliveOpsLayout.filter((box) => box.kind === 'continuation-number').length, pdf.getNumberOfPages() - 1);
  const issueDate = pdf.__oliveOpsLayout.find((box) => box.kind === 'information-value-issued');
  assert.equal(issueDate.text, 'September 9, 2026');
  assert.equal(issueDate.height, 13, 'issue date remains on one fitted line');
});

test('adversarial proposal content remains complete and inside printable page bounds', () => {
  const source = estimate(10, 12);
  source.title = 'Complete Landscape Redevelopment for the North Residential Courtyard and Shared Outdoor Amenity';
  source.propertyAddressSnapshot = 'Building 14, 987654 Regional Highway 17, Township of Otonabee-South Monaghan, Ontario K9J 6X7';
  source.proposalTerms = Array.from({ length: 140 }, (_, index) => `${index + 1}. Extended term ${index + 1} describes responsibilities, scheduling, access, warranty limitations, and project administration without clipping at the page footer.`).join('\n');
  source.exclusions = Array.from({ length: 20 }, (_, index) => `- Exclusion ${index + 1} remains explicitly outside the contracted scope.`).join('\n');
  const longBusiness = {
    name: 'Greendale Landscaping and Comprehensive Exterior Construction Services Incorporated',
    businessAddress: '1245 Main Street, Building C, Suite 240\nToronto, Ontario K9K 2R3\nCanada',
    phone: '705-111-2345',
    email: 'administration-and-proposals@greendalelandscaping.ca',
    website: 'https://www.greendalelandscaping.ca/commercial-landscape-construction',
  };
  const longCustomer = {
    company: 'The North Residential Community and Property Management Corporation',
    name: 'Alexandria Montgomery-Wellington',
    email: 'alexandria.montgomery-wellington@north-residential-community.example.ca',
    phone: '416-555-0199',
    billingAddress: 'Suite 1800, 100 Extremely Long Corporate Boulevard, Toronto, Ontario M5V 3A8, Canada',
  };
  const projection = buildEstimateProposalProjection({ estimate: source, customer: longCustomer, business: longBusiness });
  const pdf = createEstimateProposalDocument(projection);
  const rendered = pdfRenderedText(pdfText(pdf));

  assert.ok(pdf.getNumberOfPages() >= 5);
  for (const value of ['Extended term 140', 'Exclusion 20', 'Complete customer scope item 10.12', 'Final Payment']) assert.match(rendered, new RegExp(value));
  assertMeasuredLayout(pdf);
});
