import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEstimateProposalProjection } from '../src/utils/estimateProposalModel.js';

const tempDir = await mkdtemp(join(tmpdir(), 'oliveops-proposal-preview-'));
const bundlePath = join(tempDir, 'proposal-pdf.mjs');
await build({ entryPoints: ['src/utils/estimateProposalPdf.ts'], outfile: bundlePath, bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const { createEstimateProposalDocument } = await import(pathToFileURL(bundlePath).href);

const business = { name: 'Evergreen Site & Landscape', legalName: 'Evergreen Site & Landscape Ltd.', phone: '905-555-0142', email: 'proposals@evergreensite.ca', website: 'evergreensite.ca', businessAddress: '1450 Industry Lane, Burlington, ON L7L 5R8', proposalTerms: 'Work will be scheduled after written acceptance. Changes to the described scope require written approval before additional work begins.' };
const customer = { name: 'Alex Morgan', company: 'Morgan Residence', email: 'alex@example.ca', phone: '416-555-0198', address: { street: '18 Billing Crescent', city: 'Oakville', province: 'ON', postalCode: 'L6H 2R4', country: 'Canada' } };

function sample(areaCount, descriptionsPerArea, longNames = false) {
  return {
    id: 'preview-estimate', customerId: 'preview-customer', proposalNumber: areaCount === 1 ? 'PROP-2026-0108' : 'PROP-2026-0109', createdAt: '2026-09-03', validUntil: '2026-10-03', taxRate: 13,
    title: longNames ? 'Morgan Residence Complete Backyard Landscape, Drainage, Patio and Site Restoration Project' : 'Morgan Residence Interlock Patio',
    description: 'Thank you for the opportunity to provide this proposal for the improvements described below.',
    propertyAddressSnapshot: '72 Project Avenue, Burlington, ON L7M 3A1', notes: 'Please keep the driveway clear for material deliveries during scheduled work days.',
    workAreas: Array.from({ length: areaCount }, (_, areaIndex) => ({
      id: `area-${areaIndex}`, name: ['Patio', 'Excavation and Base Preparation', 'Drainage', 'Landscape Restoration', 'Front Walkway', 'Retaining Edge', 'Site Cleanup', 'Final Grading'][areaIndex] ?? `Work Area ${areaIndex + 1}`, description: '', sortOrder: areaIndex,
      lineItems: Array.from({ length: descriptionsPerArea }, (_, lineIndex) => ({
        category: ['labour', 'equipment', 'material', 'subcontractor'][lineIndex % 4], itemName: 'Internal resource',
        description: ['Excavate and prepare the work area to the required depth', 'Supply and install compacted granular base', 'Supply and install selected interlocking stone', 'Complete final grading and site cleanup'][lineIndex % 4] + (descriptionsPerArea > 4 ? ` for phase ${Math.floor(lineIndex / 4) + 1}, including careful coordination around existing site features and adjacent finished surfaces` : ''),
        quantity: 1, unit: 'job', unitCost: 1, sellPrice: 1, total: 1450 + areaIndex * 125 + lineIndex * 50,
      })),
    })),
  };
}

await mkdir('public/proposal-previews', { recursive: true });
const samples = [
  ['one-work-area.pdf', sample(1, 4), customer, business],
  ['multi-page.pdf', sample(8, 8, true), customer, business],
  ['missing-company-fields.pdf', sample(2, 4), { name: 'Client' }, { name: 'Evergreen Site & Landscape' }],
  ['non-taxable.pdf', { ...sample(2, 4), taxRate: 0 }, customer, business],
];
for (const [fileName, estimate, sampleCustomer, sampleBusiness] of samples) {
  const projection = buildEstimateProposalProjection({ estimate, customer: sampleCustomer, business: sampleBusiness });
  const doc = createEstimateProposalDocument(projection);
  await writeFile(`public/proposal-previews/${fileName}`, Buffer.from(doc.output('arraybuffer')));
  console.log(`${fileName}: ${doc.getNumberOfPages()} page(s)`);
}
await rm(tempDir, { recursive: true, force: true });
