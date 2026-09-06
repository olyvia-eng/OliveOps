import type { ContentMode, PdfDocumentMetadata } from './training';

export type SopStatus = 'draft' | 'published';

export interface SopContent {
  contentMode?: ContentMode;
  title: string;
  category: string;
  shortDescription: string;
  purpose: string;
  instructions: string;
  safetyInformation: string;
  attachmentFileIds: string[];
  document: PdfDocumentMetadata | null;
}

export interface SopDefinition extends SopContent {
  id: string;
  status: SopStatus;
  active: boolean;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface SopVersion extends SopContent {
  sopId: string;
  version: number;
  publishedAt: string;
}