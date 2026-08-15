export interface DetailWorkspaceTab<T extends string> {
  key: T;
  label: string;
}

interface DetailWorkspaceTabsProps<T extends string> {
  tabs: Array<DetailWorkspaceTab<T>>;
  activeTab: T;
  onChange: (tab: T) => void;
}

export default function DetailWorkspaceTabs<T extends string>({ tabs, activeTab, onChange }: DetailWorkspaceTabsProps<T>) {
  return (
    <div className="sticky top-[73px] z-[9] overflow-x-auto border-b border-brand-100 bg-white px-3 dark:border-brand-600 dark:bg-brand-700 sm:px-4" role="tablist">
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => onChange(tab.key)}
            className={`border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'border-brand-600 text-brand-700 dark:border-brand-300 dark:text-brand-100'
                : 'border-transparent text-gray-500 hover:text-brand-600 dark:text-brand-200 dark:hover:text-brand-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}