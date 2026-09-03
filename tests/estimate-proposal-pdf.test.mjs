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
    id: 'estimate-a', customerId: 'customer-a', proposalNumber: 'PROP-2026-0042', title: 'Smith Backyard Patio', description: 'A practical outdoor space designed for the Smith family.', propertyAddressSnapshot: '20 Project Road', createdAt: '2026-09-01', validUntil: '2026-10-01', taxRate: 13, notes: 'Please provide access to the rear yard.',
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

test('proposal PDF renders customer-safe scope, branding, exact projected totals, and acceptance', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(), customer, business });
  const pdf = createEstimateProposalDocument(projection);
  const output = pdfText(pdf);
  const renderedText = pdfRenderedText(output);

  for (const visible of ['PROPOSAL', 'Scope of Work', 'Proposal Total', 'Acceptance of Proposal', 'Green Earth Contracting', 'PROP-2026-0042', '10 Billing Street', '20 Project Road']) {
    assert.match(output, new RegExp(visible));
  }
  assert.doesNotMatch(output, /Work Area Total/);
  assert.match(renderedText, /This proposal is accepted, and the contractor is authorized to perform the work described above, subject to the stated terms and conditions\./);
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
  assert.equal(pdf.getNumberOfPages(), 1);
});

test('multiple Work Areas render every Work Area total without changing proposal totals', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(2, 2), customer, business });
  const output = pdfText(createEstimateProposalDocument(projection));

  assert.equal((output.match(/Work Area Total/g) ?? []).length, 2);
  assert.match(output, /\$201\.00/);
  assert.match(output, /\$203\.00/);
  assert.match(output, /\$404\.00/);
  assert.match(output, /\$52\.52/);
  assert.match(output, /\$456\.52/);
});

test('acceptance omits terms wording when no Terms and Conditions are displayed', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(), customer, business: { ...business, proposalTerms: '' } });
  const output = pdfText(createEstimateProposalDocument(projection));
  const renderedText = pdfRenderedText(output);

  assert.doesNotMatch(output, /\(Terms and Conditions\)/);
  assert.match(renderedText, /This proposal is accepted, and the contractor is authorized to perform the work described above\./);
  assert.doesNotMatch(renderedText, /subject to the stated terms and conditions\./);
});

test('long proposal paginates without clipping and prints proposal/page footers on every page', () => {
  const projection = buildEstimateProposalProjection({ estimate: estimate(8, 8), customer, business });
  const pdf = createEstimateProposalDocument(projection);
  const output = pdfText(pdf);
  const pageCount = pdf.getNumberOfPages();

  assert.ok(pageCount >= 3);
  for (let page = 1; page <= pageCount; page += 1) assert.match(output, new RegExp(`Page ${page} of ${pageCount}`));
  assert.equal((output.match(/PROP-2026-0042/g) ?? []).length >= pageCount, true);
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
  assert.doesNotMatch(output, /\(Notes\)|\(Exclusions\)|\(Terms and Conditions\)/);
  assert.doesNotMatch(output, /Phone:|Email:|Website:|Address:/);
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
