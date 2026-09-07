export interface EstimateProposalProjection {
  company: { name: string; phone: string; email: string; website: string; address: string; logoDataUrl: string };
  proposal: { number: string; status: string; date: string; validUntil: string; title: string; introduction: string; projectAddress: string; taxRate: number; taxLabel: string; subtotal: number; taxAmount: number; total: number; notes: string; exclusions: string; terms: string };
  customer: { displayName: string; contactName: string; billingAddress: string; email: string; phone: string };
  workAreas: Array<{ name: string; scopeLines: string[]; subtotal: number }>;
  paymentSchedule: Array<{ id: string; label: string; type: 'percentage' | 'fixed'; percentage: number; due: string; amount: number; sortOrder: number }>;
}

export function formatProposalAddress(address: unknown): string;
export function buildEstimateProposalProjection(input: { estimate: unknown; customer: unknown; business: unknown }): EstimateProposalProjection;