export type ProposalPaymentType = 'percentage' | 'fixed';

export interface ProposalPaymentStageInput {
  id?: string;
  label?: string;
  type?: ProposalPaymentType;
  percentage?: number;
  amount?: number;
  due?: string;
  sortOrder?: number;
}

export interface CalculatedProposalPaymentStage {
  id: string;
  label: string;
  type: ProposalPaymentType;
  percentage: number;
  amount: number;
  due: string;
  sortOrder: number;
  calculatedAmountCents: number;
  calculatedAmount: number;
}

export interface ProposalPaymentScheduleCalculation {
  stages: CalculatedProposalPaymentStage[];
  proposalTotal: number;
  scheduledTotal: number;
  remaining: number;
  percentageTotal: number;
  valid: boolean;
  errors: string[];
}

export function calculateProposalPaymentSchedule(stages: ProposalPaymentStageInput[] | undefined, proposalTotal: number): ProposalPaymentScheduleCalculation;
