import type { TrainingChecklistItem, TrainingSection } from "../types/training";

type LegacyTrainingContent = {
  trainingSections?: TrainingSection[];
  checklist?: TrainingChecklistItem[];
  instructions?: string;
  employeeInstructions?: string;
};

export function trainingSectionsFor(value: LegacyTrainingContent): TrainingSection[] {
  if (Array.isArray(value.trainingSections)) {
    return value.trainingSections.map((section, sectionIndex) => ({
      sectionId: section.sectionId,
      title: section.title ?? "",
      description: section.description ?? "",
      sortOrder: sectionIndex,
      checklistItems: (section.checklistItems ?? []).map((item, itemIndex) => ({
        ...item,
        required: true,
        sortOrder: itemIndex,
      })),
    }));
  }
  const checklistItems = Array.isArray(value.checklist) ? value.checklist : [];
  const description = value.instructions ?? value.employeeInstructions ?? "";
  if (!checklistItems.length && !description.trim()) return [];
  return [{
    sectionId: "legacy-training-section",
    title: "Training Checklist",
    description,
    sortOrder: 0,
    checklistItems: checklistItems.map((item, sortOrder) => ({ ...item, required: true, sortOrder })),
  }];
}

export function flattenedTrainingChecklist(sections: TrainingSection[]): TrainingChecklistItem[] {
  return sections.flatMap((section) => section.checklistItems);
}
