import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ddb } from '../api/_lib/db.js';
import { reserveNextInvoiceNumberForBusiness } from '../api/_lib/authRepo.js';
import { calculateFixedMenuPosition } from '../src/utils/fixedMenuPosition.js';
import { getInvoiceBalance, getInvoiceFinancialStatus, isValidInvoiceStatusTransition } from '../src/utils/invoiceModel.js';

test('invoice numbers use one tenant-and-year scoped atomic ADD counter', async (context) => {
  const originalSend = ddb.send.bind(ddb);
  let sequence = 0;
  const commands = [];
  ddb.send = async (command) => {
    commands.push(command.input);
    sequence += 1;
    return { Attributes: { sequence } };
  };
  context.after(() => { ddb.send = originalSend; });

  const numbers = await Promise.all(Array.from({ length: 25 }, () => reserveNextInvoiceNumberForBusiness({
    businessId: 'business-a',
    year: '2027',
  })));

  assert.equal(new Set(numbers).size, 25);
  assert.equal(numbers[0], 'INV-2027-001');
  assert.equal(numbers.at(-1), 'INV-2027-025');
  assert.ok(commands.every((input) => input.Key.PK === 'BUSINESS#business-a'));
  assert.ok(commands.every((input) => input.Key.SK === 'INVOICE_COUNTER#2027'));
  assert.ok(commands.every((input) => input.UpdateExpression.includes('ADD #sequence :increment')));
  assert.ok(commands.every((input) => input.ReturnValues === 'UPDATED_NEW'));
});

test('invoice status transitions are forward-only and void is terminal', () => {
  assert.equal(isValidInvoiceStatusTransition('draft', 'sent'), true);
  assert.equal(isValidInvoiceStatusTransition('draft', 'paid'), false);
  assert.equal(isValidInvoiceStatusTransition('sent', 'partially_paid'), false);
  assert.equal(isValidInvoiceStatusTransition('sent', 'paid'), false);
  assert.equal(isValidInvoiceStatusTransition('sent', 'partially_paid', 'payment'), true);
  assert.equal(isValidInvoiceStatusTransition('sent', 'void'), true);
  assert.equal(isValidInvoiceStatusTransition('paid', 'void'), false);
  assert.equal(isValidInvoiceStatusTransition('void', 'sent'), false);
});

test('invoice balances preserve draft display but exclude paid and void balances', () => {
  assert.equal(getInvoiceBalance({ status: 'draft', amount: 113 }), 113);
  assert.equal(getInvoiceBalance({ status: 'sent', amount: 113 }), 113);
  assert.equal(getInvoiceBalance({ status: 'paid', amount: 113 }), 0);
  assert.equal(getInvoiceBalance({ status: 'void', amount: 113 }), 0);
});

test('invoice API owns numbers, totals, snapshots, lifecycle timestamps, and destructive restrictions', () => {
  const source = readFileSync('api/data.js', 'utf8');
  assert.match(source, /Invoice number is assigned by the server/);
  assert.match(source, /Invoice number cannot be changed/);
  assert.match(source, /normalizeInvoiceFinancials\(record\)/);
  assert.match(source, /customerNameSnapshot/);
  assert.match(source, /Invoice lifecycle timestamps are server-controlled/);
  assert.match(source, /Invoice exceeds the remaining contract amount/);
  assert.match(source, /Payment statuses can only be changed by the payment workflow/);
  assert.match(source, /Overdue is derived from the due date and is not set manually/);
  assert.match(source, /existing\.status === 'draft'/);
  assert.match(source, /issueInvoiceForBusiness/);
  assert.match(source, /voidInvoiceForBusiness/);
  assert.match(source, /QuickBooks-linked invoices are read-only/);
  assert.match(source, /Only draft invoices can be deleted/);
  const repository = readFileSync('api/_lib/authRepo.js', 'utf8');
  assert.match(repository, /action: 'invoice_voided'/);
});

test('invoice drawer awaits persistence, keeps errors visible, and does not expose manual numbers', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  const store = readFileSync('src/store/index.ts', 'utf8');
  assert.match(page, /Invoice number assigned when saved/);
  assert.match(page, /selected\?\.number \?\? 'Invoice number assigned when saved'/);
  assert.doesNotMatch(page, /label="Invoice Number"/);
  assert.match(page, /const result = selected \? await updateInvoice/);
  assert.match(page, /if \(!result\.ok\) return setError/);
  assert.match(page, /setOpen\(false\);\s*emitAppToast/);
  assert.match(page, /legacy \? 'Legacy price incl\. tax' : 'Unit Price'/);
  assert.match(store, /addInvoice: async/);
  assert.match(store, /payload\.invoice/);
});

test('invoice row Actions use a viewport-aware portal without changing table scroll geometry', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  const styles = readFileSync('src/index.css', 'utf8');
  const cardEnd = page.indexOf('</Card>');
  const portalMount = page.indexOf('{menuInvoice ? <InvoiceActionsMenu');

  assert.ok(portalMount > cardEnd, 'the live menu must render outside the Invoice Register card and table');
  assert.match(page, /return createPortal\([\s\S]*document\.body/);
  assert.match(page, /className="fixed z-\[80\][^"]*overflow-y-auto/);
  assert.match(styles, /table button\[aria-label\^='Actions for'\] \+ div \{\s*display: none;/);
  assert.match(page, /calculateFixedMenuPosition\(triggerRect, \{ width: 160, height: menuRect\.height \}/);
  assert.match(page, /window\.addEventListener\('scroll', closeOnViewportChange, true\)/);
  assert.match(page, /window\.addEventListener\('resize', closeOnViewportChange\)/);
  assert.match(page, /document\.addEventListener\('pointerdown', closeOnOutsidePointer\)/);
  assert.match(page, /document\.addEventListener\('keydown', closeOnEscape\)/);
  assert.match(page, /role="menu" aria-label=\{`Actions for \$\{invoice\.number\}`\}/);
  assert.equal((page.match(/type="button" role="menuitem"/g) ?? []).length, 4);
  for (const action of ['Open invoice', 'Send invoice', 'Retry email', 'Delete draft']) assert.match(page, new RegExp(`>\\s*${action}\\s*<`));
  assert.match(page, /trigger\.setAttribute\('aria-haspopup', 'menu'\)/);
  assert.match(page, /focus\(\{ preventScroll: true \}\)/);
});

test('invoice row Actions position below, flip above, and remain inside narrow viewports', () => {
  const firstRow = calculateFixedMenuPosition(
    { top: 100, right: 1000, bottom: 136 },
    { width: 160, height: 116 },
    { width: 1200, height: 800 },
  );
  assert.deepEqual(firstRow, { left: 840, top: 142, width: 160, maxHeight: 784 });

  const lastRow = calculateFixedMenuPosition(
    { top: 700, right: 1000, bottom: 736 },
    { width: 160, height: 116 },
    { width: 1200, height: 800 },
  );
  assert.equal(lastRow.top, 578);

  const narrowViewport = calculateFixedMenuPosition(
    { top: 200, right: 350, bottom: 236 },
    { width: 160, height: 116 },
    { width: 360, height: 640 },
  );
  assert.equal(narrowViewport.left, 190);
  assert.ok(narrowViewport.left >= 8 && narrowViewport.left + narrowViewport.width <= 352);

  const constrainedViewport = calculateFixedMenuPosition(
    { top: 40, right: 80, bottom: 76 },
    { width: 160, height: 116 },
    { width: 150, height: 100 },
  );
  assert.deepEqual(constrainedViewport, { left: 8, top: 8, width: 134, maxHeight: 84 });
});

test('invoice builder presents the requested compact section order and helper copy', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  const sections = [
    '1. Job and contract',
    '2. Invoice type and billing method',
    '3. Invoice lines',
    '4. Invoice details',
    '5. Notes',
  ].map((label) => page.indexOf(label));
  assert.ok(sections.every((position) => position >= 0));
  assert.deepEqual(sections, sections.slice().sort((left, right) => left - right));
  for (const copy of ['Collect an upfront payment', 'Bill part of the contract', 'Bill the remaining balance', 'Build an invoice manually', 'Percentage of contract', 'Full selected lines will be added']) {
    assert.match(page, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(page, /label="HST rate \(%\)"/);
  assert.match(page, /label="Notes"[\s\S]*?rows=\{3\}[\s\S]*?className="resize-y"/);
  assert.match(page, /grid gap-3 md:grid-cols-4/);
});

test('generated invoice lines preserve editable state while protecting calculated fields', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  assert.match(page, /const description = next\.lineItems\[0\]\?\.description\.trim\(\) \|\| defaultDescription/);
  assert.match(page, /const taxable = next\.lineItems\[0\]\?\.taxable \?\? true/);
  assert.match(page, /unitPrice: amount,[\s\S]*?unitPriceBeforeTax: amount/);
  assert.match(page, /category: 'contract_service'/);
  assert.match(page, /generatedLumpSum && !\['description', 'taxable'\]\.includes\(key\)/);
  assert.match(page, /financialEditable=\{editable && form\.invoiceType === 'custom' && !line\.sourceLineItemId\}/);
  assert.match(page, /label="Description"[\s\S]*?disabled=\{!editable\}/);
  assert.match(page, /label="Quantity"[\s\S]*?type="number"[\s\S]*?disabled=\{!financialEditable\}/);
  assert.match(page, /label=\{legacy \? 'Legacy price incl\. tax' : 'Unit Price'\}[\s\S]*?type="number"[\s\S]*?disabled=\{!financialEditable\}/);
  assert.match(page, /type="checkbox"[\s\S]*?disabled=\{!editable\}[\s\S]*?checked=\{line\.taxable\}/);
  assert.match(page, /form\.invoiceType === 'custom'/);
});

test('invoice due date remains independently editable and save availability mirrors server rules', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  assert.match(page, /label="Due date"[\s\S]*?onChange=\{\(event\) =>[\s\S]*?setForm\(\(current\) => \(\{[\s\S]*?\.\.\.current,[\s\S]*?dueDate: event\.target\.value,[\s\S]*?\}\)\)/);
  assert.match(page, /const lineValidationError = validateInvoiceLineItems/);
  assert.match(page, /disabled=\{saving \|\| Boolean\(saveDisabledReason\) \|\| Boolean\(selected && !draftDirty\)\}/);
  assert.match(page, /title=\{selected && !draftDirty \? 'No unsaved changes\.' : saveDisabledReason \|\| undefined\}/);
  assert.match(page, /Add a billable amount to save this draft\./);
  assert.match(page, /Confirm intentional over-contract billing to save this draft\./);
});

test('work-area selection is exclusive to Progress Work Areas and Final has one generated line', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  assert.match(page, /form\.invoiceType === 'progress' && form\.amountMode === 'work_areas'/);
  assert.match(page, /invoiceType === 'progress' && hasSourceLines \? 'work_areas' : 'fixed'/);
  assert.match(page, /lineItems: nextMode === 'work_areas' \|\| form\.amountMode === 'work_areas' \? \[\] : form\.lineItems/);
  assert.match(page, /const reset = \{[\s\S]*?\.\.\.form,[\s\S]*?invoiceType,[\s\S]*?amountMode: 'fixed' as const,[\s\S]*?billingAmount: 0,[\s\S]*?billingPercent: 0,[\s\S]*?lineItems: \[\],[\s\S]*?\};/);
  assert.match(page, /if \(invoiceType === 'custom'\) return setForm\(\{ \.\.\.reset, lineItems: \[emptyLine\(\)\] \}\);/);
  assert.match(page, /next\.invoiceType === 'final' \? nextPosition\.remainingAmount/);
  assert.match(page, /return \{[\s\S]*?\.\.\.next,[\s\S]*?lineItems: \[[\s\S]*?\.\.\.emptyLine\(\),[\s\S]*?description,[\s\S]*?taxable,[\s\S]*?unitPrice: amount,[\s\S]*?unitPriceBeforeTax: amount,[\s\S]*?\},[\s\S]*?\],[\s\S]*?\};/);
  assert.match(page, /Remaining pre-tax balance:/);
  assert.match(page, /window\.confirm\('Changing invoice type will clear the current invoice lines\. Continue\?'\)/);
});

test('opening a saved Draft hydrates its amount without invoice-type reset logic', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  const view = page.match(/const view = \(invoice: Invoice\) => \{[\s\S]*?\n  \};\n  const chooseJob/)?.[0] ?? '';
  assert.match(view, /lineItems: invoice\.lineItems\?\.map\(\(line\) => \(\{ \.\.\.line \}\)\) \?\? \[\]/);
  assert.match(view, /billingAmount: invoice\.subtotal \?\? invoice\.amount/);
  assert.doesNotMatch(view, /chooseType|applyAmount/);
});

test('source lines retain Job categories and custom lines expose Contract Services', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  assert.match(page, /category: line\.category/);
  assert.match(page, /<option value="contract_service">Contract Services<\/option>/);
  assert.match(page, /financialEditable=\{editable && form\.invoiceType === 'custom' && !line\.sourceLineItemId\}/);
});

test('generated lump-sum lines cannot be removed and lock Category to Contract Services', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  assert.match(page, /const generatedLumpSum = form\.invoiceType !== 'custom' && form\.amountMode !== 'work_areas' && !line\.sourceLineItemId/);
  assert.match(page, /generatedLumpSum=\{generatedLumpSum\}/);
  assert.match(page, /editable && !generatedLumpSum \? \(\s*<button aria-label=\{`Remove line/);
  assert.match(page, /generatedLumpSum \? \([\s\S]*title="Contract Services"/);
  assert.match(page, /<Select[\s\S]*label="Category"/);
  assert.match(page, /minmax\(150px,1\.25fr\)/);
  assert.doesNotMatch(page, /Contract Serv\./);
});

test('custom and Work Area line removal paths remain available', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  assert.match(page, /form\.invoiceType === 'custom'[\s\S]*<Plus \/> Add line/);
  assert.match(page, /onRemove=\{\(\) =>\s*setForm\(\(current\) => \(\{[\s\S]*lineItems: current\.lineItems\.filter/);
  assert.match(page, /toggleSource =[\s\S]*current\.lineItems\.filter\(\(item\) => item\.sourceLineItemId !== line\.id\)/);
  assert.match(page, /generatedLumpSum = .*form\.amountMode !== 'work_areas'/);
});

test('saved Draft and issued headers are explicit and dirty Drafts cannot be sent', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  assert.match(page, /!selected \? 'New draft invoice' : selected\.status === 'draft' \? 'Draft invoice' : 'Invoice'/);
  assert.match(page, /selected \? <Badge label=\{displayStatus\(selected\)\}/);
  assert.match(page, /const draftDirty = Boolean\(\s*selected\?\.status === 'draft'/);
  assert.match(page, /disabled=\{saving \|\| draftDirty\}/);
  assert.match(page, /Save draft changes before sending this invoice\./);
  assert.match(page, /deliveryStatus === 'failed'[\s\S]*Retry Email/);
  assert.match(page, /selected && !draftDirty/);
});

test('QuickBooks settings expose and accept an invoice-only Contract Services mapping', () => {
  const page = readFileSync('src/pages/settings/IntegrationsPage.tsx', 'utf8');
  const endpoint = readFileSync('api/integrations/quickbooks/settings.js', 'utf8');
  const types = readFileSync('src/types/index.ts', 'utf8');
  assert.match(types, /InvoiceLineCategory = 'contract_service' \| LineItemCategory/);
  assert.match(page, /value: 'contract_service', label: 'Contract Services'/);
  assert.match(endpoint, /buildQuickBooksConfigurationSelection/);
});

test('QuickBooks settings keep OliveOps authoritative and expose explicit tax-code setup', () => {
  const page = readFileSync('src/pages/settings/IntegrationsPage.tsx', 'utf8');
  const endpoint = readFileSync('api/integrations/quickbooks/settings.js', 'utf8');
  assert.match(page, /Sandbox connection\. OliveOps remains the invoice record\. QuickBooks is an optional accounting destination\./);
  assert.match(page, /Non-taxable Sales Tax Code/);
  assert.match(page, /validNonTaxableCodes\.length === 1 \? validNonTaxableCodes\[0\]\.id : ''/);
  assert.match(page, /nonTaxableId: configured\?\.nonTaxableTaxCode\?\.id \?\? ''/);
  assert.match(page, /This QuickBooks company is not configured for Canada\. Ontario HST invoices cannot be fully validated in this sandbox\./);
  assert.match(page, /This limitation applies only to QuickBooks synchronization; OliveOps invoicing remains available\./);
  assert.match(endpoint, /nonTaxableTaxCodeId/);
  assert.doesNotMatch(endpoint, /one unambiguous non-taxable tax code/);
  assert.match(page, /QuickBooks sync readiness/);
  assert.match(page, /Country\/tax mismatch/);
  assert.match(page, /Setup incomplete/);
  assert.match(page, /label: 'Ready'/);
  assert.match(page, /text-amber-700.*nonTaxableTaxCodeWarning/);
  assert.match(page, /quickBooksConfigurationValid = !Object\.values\(mappingErrors\)\.some\(Boolean\)/);
});

test('QuickBooks-only mapping failures do not alter local invoice creation or sending', () => {
  const invoicePage = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  const projection = readFileSync('api/_lib/quickBooksSync.js', 'utf8');
  const syncEndpoint = readFileSync('api/integrations/quickbooks/invoices.js', 'utf8');
  assert.match(projection, /Map Contract Services to a QuickBooks Product\/Service before syncing this invoice\./);
  assert.match(invoicePage, /selected\s*\? await updateInvoice\(selected\.id, data\)\s*: await addInvoice\(data\)/);
  assert.match(invoicePage, /fetch\('\/api\/invoice-delivery'/);
  assert.match(invoicePage, /await updateInvoice\(invoice\.id, \{ status: nextStatus, voidReason:/);
  assert.doesNotMatch(invoicePage, /status\(invoice, 'sent'\)/);
  assert.match(syncEndpoint, /const payload = buildQuickBooksInvoicePayload[\s\S]*createQuickBooksInvoice/);
});

test('QuickBooks refuses draft invoice creation and supports both tax modes', () => {
  const endpoint = readFileSync('api/integrations/quickbooks/invoices.js', 'utf8');
  const projection = readFileSync('api/_lib/quickBooksSync.js', 'utf8');
  assert.match(endpoint, /invoice\.status === 'draft'/);
  assert.match(projection, /'TaxExcluded' : 'TaxInclusive'/);
});

test('issued snapshot fields are not refreshed during lifecycle-only updates', () => {
  const source = readFileSync('api/data.js', 'utf8');
  assert.match(source, /if \(existing\.status !== 'draft'\)/);
  assert.match(source, /Issued invoices only allow lifecycle changes/);
  assert.match(source, /if \(existing\.status === 'draft'\) \{\s*const authorization = await authorizeInvoiceRecord/);
  assert.match(source, /billingAddressSnapshot: getCustomerBillingAddressSnapshot\(customer\)/);
  assert.match(source, /jobAddressSnapshot: job\.propertyAddressSnapshot \|\| ''/);
});

test('historical payment statuses remain readable while generic transitions stay closed', () => {
  assert.equal(getInvoiceBalance({ status: 'paid', amount: 113 }), 0);
  assert.equal(getInvoiceBalance({ status: 'partially_paid', amount: 113 }), 113);
  assert.equal(isValidInvoiceStatusTransition('paid', 'paid'), true);
  assert.equal(isValidInvoiceStatusTransition('partially_paid', 'partially_paid'), true);
  assert.equal(isValidInvoiceStatusTransition('sent', 'paid'), false);
});

test('contract invoices use the sold payment schedule while Custom retains manual lines', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  assert.match(page, /paymentScheduleItemId/);
  assert.match(page, /Calculated from the sold contract/);
  assert.match(page, /Inherited from sold contract/);
  assert.match(page, /Contract subtotal/);
  assert.match(page, /Amount due/);
  assert.match(page, /form\.invoiceType === 'custom'[\s\S]*label="HST rate \(%\)"/);
  assert.match(page, /financialEditable=\{editable && form\.invoiceType === 'custom'/);
  assert.match(page, /<InvoiceLine[\s\S]*form\.invoiceType === 'custom'/);
});

test('Job invoices tab derives Payment Schedule state from linked invoices', () => {
  const page = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
  assert.match(page, />Payment Schedule</);
  assert.match(page, /paymentScheduleItemState\(item\.id, jobInvoices\)/);
  assert.match(page, /scheduleItemId=/);
  assert.match(page, /View Draft/);
  assert.match(page, /View Invoice/);
  assert.match(page, /Create Invoice/);
});

test('invoice balances and financial status derive from canonical payments and due date', () => {
  const invoice = { status: 'sent', amount: 3136.86, amountPaid: 1500, dueDate: '2026-10-10' };
  assert.equal(getInvoiceBalance(invoice), 1636.86);
  assert.equal(getInvoiceFinancialStatus(invoice, new Date('2026-09-10T12:00:00.000Z')), 'partially_paid');
  assert.equal(getInvoiceFinancialStatus({ ...invoice, amountPaid: 3136.86 }, new Date('2026-09-10T12:00:00.000Z')), 'paid');
  assert.equal(getInvoiceFinancialStatus({ ...invoice, amountPaid: 0 }, new Date('2026-10-11T12:00:00.000Z')), 'overdue');
});