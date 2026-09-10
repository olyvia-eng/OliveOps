import type { EstimateProposalProjection } from './estimateProposalModel.js';
import type { RichTextDocument } from '../types/richText';

export interface ProposalTextBlock { kind: 'paragraph' | 'list-item'; marker?: string; text: string }
type ProposalService = NonNullable<EstimateProposalProjection['services']>[number];
type ProposalCustomerRate = ProposalService['customerRates'][number];
export interface ProposalPresentation {
  source: EstimateProposalProjection;
  workType: 'project' | 'service';
  company: { name: string; logoDataUrl: string; details: string[] };
  document: { label: string; number: string; title: string };
  information: Array<{ key: string; label: string; value: string; details?: string[] }>;
  introduction: string;
  workAreas: Array<{ name: string; subtotal: number; displayPrice: string; scopeRichText?: RichTextDocument; scopeLines: string[] }>;
  services: Array<Omit<ProposalService, 'customerRates'> & { displayPrice: string; displayOneTimeCharge: string; scheduleSummary: string; customerRates: Array<ProposalCustomerRate & { displayRate: string }> }>;
  totals: { rows: Array<{ key: string; label: string; value: number; displayValue: string }>; label: string; value: number; displayValue: string };
  paymentSchedule: Array<{ index: number; id: string; label: string; due: string; percentage: number | null; percentageLabel: string; amount: number; displayAmount: string }>;
  sections: Array<{ key: string; label: string; value: string; blocks: ProposalTextBlock[] }>;
}

export function proposalMoney(value: unknown): string;
export function proposalDisplayDate(value?: string, month?: 'long' | 'short'): string;
export function proposalTextBlocks(value: unknown): ProposalTextBlock[];
export function buildProposalPresentation(snapshot: EstimateProposalProjection): ProposalPresentation;