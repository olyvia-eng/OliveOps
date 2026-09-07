import type { jsPDF } from 'jspdf';
import type { EstimateProposalProjection } from './estimateProposalModel.js';
import { createEstimateProposalDocument as createDocument, fetchEstimateProposal as fetchProposal, proposalPdfFileName as buildFileName } from './estimateProposalPdf.js';

export interface ProposalPdfAcceptance {
  customerName: string;
  acceptedAt: string;
  signatureDataUrl: string;
  acceptanceStatementVersion: number;
}

export const createEstimateProposalDocument = (projection: EstimateProposalProjection, options?: { acceptance?: ProposalPdfAcceptance }): jsPDF => createDocument(projection, options);
export const proposalPdfFileName = (projection: EstimateProposalProjection, accepted = false): string => buildFileName(projection, accepted);
export const fetchEstimateProposal = (estimateId: string): Promise<EstimateProposalProjection> => fetchProposal(estimateId);