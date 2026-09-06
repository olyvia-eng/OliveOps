import type { TrainingSection } from "../../types/training";

export default function TrainingSectionsViewer({ sections, emptyMessage = "No Training Sections provided." }: { sections: TrainingSection[]; emptyMessage?: string }) {
  if (!sections.length) return <p className="text-sm text-gray-500">{emptyMessage}</p>;
  return (
    <div className="space-y-7">
      {[...sections].sort((left, right) => left.sortOrder - right.sortOrder).map((section) => (
        <section key={section.sectionId}>
          <h2 className="text-base font-semibold text-gray-900 dark:text-brand-50">{section.title}</h2>
          {section.description ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700 dark:text-brand-200">{section.description}</p> : null}
          {section.checklistItems.length ? (
            <ul className="mt-3 space-y-2">
              {[...section.checklistItems].sort((left, right) => left.sortOrder - right.sortOrder).map((item) => (
                <li key={item.itemId} className="flex items-start gap-2 text-sm text-gray-700 dark:text-brand-200">
                  <span aria-hidden="true" className="mt-0.5 text-brand-500">□</span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}
