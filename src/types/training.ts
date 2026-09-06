export type TrainingRecurrenceType = 'one_time' | 'annual' | 'custom_months';
export type TrainingStatus = 'not_started' | 'due_soon' | 'overdue' | 'current' | 'revoked';
export type ContentMode = 'structured' | 'document';
export interface PdfDocumentMetadata { fileId: string; originalFileName: string; mimeType: 'application/pdf'; sizeBytes: number; uploadedAt: string; status: 'pending' | 'ready'; version: number | null }

export interface TrainingChecklistItem { itemId: string; text: string; required: true; sortOrder: number }
export interface TrainingSection { sectionId: string; title: string; description: string; sortOrder: number; checklistItems: TrainingChecklistItem[] }
export interface TrainingDefinition {
  id: string; contentMode?: ContentMode; title: string; category: string; shortDescription: string; instructions: string; attachmentFileId: string | null; document: PdfDocumentMetadata | null;
  trainingSections: TrainingSection[]; checklist: TrainingChecklistItem[]; acknowledgementStatement: string; recurrenceType: TrainingRecurrenceType;
  recurrenceMonths: number | null; dueSoonDays: number; active: boolean; status: 'draft' | 'published';
  currentVersion: number; createdAt: string; updatedAt: string;
}
export interface TrainingVersion extends Omit<TrainingDefinition, 'id' | 'active' | 'status' | 'currentVersion' | 'updatedAt'> {
  trainingId: string; version: number;
}
export interface TrainingAssignment {
  id: string; assignmentId: string; trainingId: string; trainingTitle: string; assignedVersion: number;
  employeeId: string; employeeName: string; assignedAt: string; initialDueDate: string; currentDueDate: string | null;
  recurrenceType: TrainingRecurrenceType; recurrenceMonths: number | null; dueSoonDays: number;
  latestCompletionId: string | null; latestCompletedAt: string | null; nextDueDate: string | null;
  revokedAt?: string; presentationStatus: TrainingStatus;
}
export interface TrainingCompletion {
  id: string; completionId: string; assignmentId: string; employeeId: string; trainingId: string;
  completedVersion: number; trainingTitle: string; checklistItems: Array<TrainingChecklistItem & { checked: true }>;
  contentMode?: ContentMode; trainingSections?: TrainingSection[]; document?: PdfDocumentMetadata | null; acknowledgementStatement: string; acknowledged: true; completedAt: string; nextDueDate: string | null;
}
export interface TrainingCompliance { current: number; total: number; dueSoon: number; overdue: number; percent: number | null }