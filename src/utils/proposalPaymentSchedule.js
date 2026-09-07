const text = (value) => typeof value === 'string' ? value.trim() : '';
const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const toCents = (value) => Math.round(finiteNumber(value) * 100);

export function calculateProposalPaymentSchedule(stages, proposalTotal) {
  const totalCents = Math.max(0, toCents(proposalTotal));
  const normalized = (Array.isArray(stages) ? stages : [])
    .filter((stage) => stage && typeof stage === 'object')
    .map((stage, index) => {
      const type = stage.type === 'fixed' ? 'fixed' : 'percentage';
      const percentage = type === 'percentage' ? Math.max(0, finiteNumber(stage.percentage)) : 0;
      const fixedAmountCents = type === 'fixed' ? Math.max(0, toCents(stage.amount)) : 0;
      return {
        id: text(stage.id) || `payment-${index + 1}`,
        label: text(stage.label) || `Payment ${index + 1}`,
        type,
        percentage,
        amount: fixedAmountCents / 100,
        due: text(stage.due),
        sortOrder: index,
        calculatedAmountCents: type === 'percentage'
          ? Math.round(totalCents * (percentage / 100))
          : fixedAmountCents,
      };
    });

  const percentageTotal = normalized.reduce((sum, stage) => sum + stage.percentage, 0);
  const fixedTotalCents = normalized.reduce((sum, stage) => sum + (stage.type === 'fixed' ? stage.calculatedAmountCents : 0), 0);
  const theoreticalTotalCents = fixedTotalCents + totalCents * (percentageTotal / 100);
  if (normalized.length > 0 && Math.abs(theoreticalTotalCents - totalCents) < 0.000001) {
    const allocatedCents = normalized.reduce((sum, stage) => sum + stage.calculatedAmountCents, 0);
    normalized[normalized.length - 1].calculatedAmountCents += totalCents - allocatedCents;
  }

  const scheduledTotalCents = normalized.reduce((sum, stage) => sum + stage.calculatedAmountCents, 0);
  const remainingCents = totalCents - scheduledTotalCents;
  const errors = [];
  if (normalized.some((stage) => !text(stage.label))) errors.push('Every payment requires a name.');
  if (normalized.some((stage) => !text(stage.due))) errors.push('Every payment requires a due description.');
  if (normalized.some((stage) => stage.type === 'percentage' && stage.percentage <= 0)) errors.push('Percentage payments must be greater than 0%.');
  if (normalized.some((stage) => stage.type === 'fixed' && stage.calculatedAmountCents <= 0)) errors.push('Fixed payments must be greater than $0.00.');
  if (percentageTotal > 100) errors.push('Percentage payments cannot total more than 100%.');
  if (scheduledTotalCents > totalCents) errors.push('Scheduled payments cannot exceed the Proposal total.');
  if (normalized.length > 0 && remainingCents !== 0 && scheduledTotalCents <= totalCents) errors.push('Payment Schedule must equal the Proposal total.');

  return {
    stages: normalized.map((stage) => ({ ...stage, calculatedAmount: stage.calculatedAmountCents / 100 })),
    proposalTotal: totalCents / 100,
    scheduledTotal: scheduledTotalCents / 100,
    remaining: remainingCents / 100,
    percentageTotal,
    valid: errors.length === 0,
    errors,
  };
}
