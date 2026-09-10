import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const invoiceSk = (invoiceId) => `INVOICE#${invoiceId}`;
const tokenPk = (tokenHash) => `INVOICE_TOKEN#${tokenHash}`;
const paymentPrefix = (invoiceId) => `INVOICE_PAYMENT#${invoiceId}#`;
const paymentSk = (invoiceId, paymentDate, paymentId) => `${paymentPrefix(invoiceId)}${paymentDate}#${paymentId}`;

const publicInvoice = (item) => item ? Object.fromEntries(Object.entries(item).filter(([key]) => !['PK', 'SK', 'entityType', 'businessId', 'invoiceId', 'tokenHash'].includes(key))) : null;

export async function prepareInvoiceDelivery({ businessId, invoiceId, snapshot, tokenHash, attemptedAt }) {
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: invoiceSk(invoiceId) }, UpdateExpression: 'SET customerDocumentSnapshot = :snapshot, deliveryStatus = :pending, deliveryAttemptedAt = :attemptedAt, tokenHash = :tokenHash', ConditionExpression: '#status = :draft AND attribute_not_exists(customerDocumentSnapshot)', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':draft': 'draft', ':pending': 'pending', ':snapshot': snapshot, ':attemptedAt': attemptedAt, ':tokenHash': tokenHash } } },
      { Put: { TableName: tableName, Item: { PK: tokenPk(tokenHash), SK: tokenPk(tokenHash), entityType: 'INVOICE_TOKEN', businessId, invoiceId, tokenHash, createdAt: attemptedAt }, ConditionExpression: 'attribute_not_exists(PK)' } },
    ] }));
    return { ok: true };
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') return { ok: false, error: 'Invoice delivery has already been prepared.' };
    throw error;
  }
}

export async function retryInvoiceDelivery({ businessId, invoiceId, attemptedAt }) {
  try {
    await ddb.send(new UpdateCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: invoiceSk(invoiceId) }, UpdateExpression: 'SET deliveryStatus = :pending, deliveryAttemptedAt = :attemptedAt REMOVE deliveryFailureReason', ConditionExpression: '#status = :sent AND deliveryStatus = :failed AND attribute_exists(customerDocumentSnapshot)', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':sent': 'sent', ':failed': 'failed', ':pending': 'pending', ':attemptedAt': attemptedAt } }));
    return { ok: true };
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return { ok: false, error: 'Invoice delivery cannot be retried.' };
    throw error;
  }
}

export async function failInvoiceDelivery({ businessId, invoiceId, reason }) {
  await ddb.send(new UpdateCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: invoiceSk(invoiceId) }, UpdateExpression: 'SET deliveryStatus = :failed, deliveryFailureReason = :reason', ConditionExpression: '#status = :sent AND deliveryStatus = :pending', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':sent': 'sent', ':pending': 'pending', ':failed': 'failed', ':reason': String(reason).slice(0, 500) } }));
}

export async function completeInvoiceDelivery({ businessId, invoiceId, recipient, providerMessageId, submittedAt }) {
  await ddb.send(new UpdateCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: invoiceSk(invoiceId) }, UpdateExpression: 'SET deliveryStatus = :sent, deliveryRecipient = :recipient, deliveryProviderMessageId = :providerMessageId, deliverySubmittedAt = :submittedAt REMOVE deliveryFailureReason', ConditionExpression: '#status = :sent AND deliveryStatus = :pending', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':sent': 'sent', ':pending': 'pending', ':recipient': recipient, ':providerMessageId': providerMessageId, ':submittedAt': submittedAt } }));
}

export async function getPublicInvoiceByTokenHash(tokenHash) {
  const tokenResult = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tokenPk(tokenHash), SK: tokenPk(tokenHash) } }));
  const token = tokenResult.Item;
  if (!token || token.revokedAt) return null;
  const invoiceResult = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(token.businessId), SK: invoiceSk(token.invoiceId) } }));
  if (!invoiceResult.Item?.customerDocumentSnapshot || !['sent', 'partially_paid', 'paid', 'overdue'].includes(invoiceResult.Item.status)) return null;
  return { token, invoice: publicInvoice(invoiceResult.Item) };
}

export async function markInvoiceViewed({ businessId, invoiceId, viewedAt }) {
  await ddb.send(new UpdateCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: invoiceSk(invoiceId) }, UpdateExpression: 'SET firstViewedAt = if_not_exists(firstViewedAt, :viewedAt), lastViewedAt = :viewedAt ADD viewCount :one', ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)', ExpressionAttributeValues: { ':viewedAt': viewedAt, ':one': 1 } }));
}

export async function listInvoicePayments({ businessId, invoiceId }) {
  const result = await ddb.send(new QueryCommand({ TableName: tableName, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)', ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': paymentPrefix(invoiceId) } }));
  return (result.Items ?? []).map((item) => publicInvoice(item)).sort((left, right) => right.paymentDate.localeCompare(left.paymentDate) || right.createdAt.localeCompare(left.createdAt));
}

export async function recordInvoicePayment({ businessId, invoice, payment, actor }) {
  const expectedPaid = Number(invoice.amountPaid) || 0;
  const nextPaid = Math.round((expectedPaid + payment.amount) * 100) / 100;
  const nextBalance = Math.round((invoice.amount - nextPaid) * 100) / 100;
  const nextStatus = nextBalance === 0 ? 'paid' : 'partially_paid';
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: invoiceSk(invoice.id) }, UpdateExpression: 'SET amountPaid = :nextPaid, balanceDue = :balance, #status = :status, updatedAt = :updatedAt', ConditionExpression: '(#status = :sent OR #status = :partial OR #status = :overdue) AND ((attribute_not_exists(amountPaid) AND :expectedPaid = :zero) OR amountPaid = :expectedPaid) AND :nextPaid <= amount', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':sent': 'sent', ':partial': 'partially_paid', ':overdue': 'overdue', ':status': nextStatus, ':zero': 0, ':expectedPaid': expectedPaid, ':nextPaid': nextPaid, ':balance': nextBalance, ':updatedAt': payment.createdAt } } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: paymentSk(invoice.id, payment.paymentDate, payment.id), entityType: 'INVOICE_PAYMENT', businessId, invoiceId: invoice.id, ...payment }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: `AUDIT_EVENT#${payment.id}`, entityType: 'AUDIT_EVENT', businessId, eventId: payment.id, action: 'invoice_payment_recorded', actorUserId: actor.id, actorName: actor.name, actorEmail: actor.email, affectedEntryCount: 1, createdAt: payment.createdAt, metadata: { invoiceId: invoice.id, paymentId: payment.id, amount: payment.amount, paymentMethod: payment.paymentMethod } }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
    ] }));
    return { ok: true, amountPaid: nextPaid, balanceDue: nextBalance, status: nextStatus };
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') return { ok: false, error: 'Payment exceeds the remaining balance or the invoice changed. Refresh and try again.' };
    throw error;
  }
}