import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui';
import { formatClockedInElapsed, type ClockedInNowItem } from './clockedInNowModel.js';

const clockTime = (value: string) => new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
}).format(new Date(value));

export default function ClockedInNowWidget({ items }: { items: ClockedInNowItem[] }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <Card className="h-full overflow-hidden rounded-lg">
      <div className="flex items-center justify-between border-b border-brand-100 px-4 py-3 dark:border-brand-600">
        <div className="flex items-center gap-2">
          <Clock3 size={16} className="text-accent-700 dark:text-accent-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-brand-900 dark:text-brand-50">Clocked In Now</h2>
        </div>
        <span className="min-w-7 rounded-full bg-accent-50 px-2 py-0.5 text-center text-sm font-semibold text-accent-800 dark:bg-accent-900/30 dark:text-accent-300">
          {items.length}
        </span>
      </div>

      {items.length === 0 ? <p className="p-4 text-sm text-brand-400 dark:text-brand-300">No employees are currently clocked in.</p> : null}
      {items.length > 0 ? (
        <ol className="divide-y divide-brand-100 dark:divide-brand-600">
          {items.slice(0, 6).map((item) => (
            <li key={item.id} className="px-4 py-3">
              <p className="truncate text-sm font-semibold text-brand-900 dark:text-brand-50">{item.employeeName}</p>
              <p className="mt-0.5 truncate text-sm text-brand-600 dark:text-brand-200">{item.contextLabel || 'Clocked In'}</p>
              <p className="mt-1 text-xs text-brand-400 dark:text-brand-300">Clocked in {clockTime(item.clockIn)} · {formatClockedInElapsed(item.clockIn, now)}</p>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="flex justify-end border-t border-brand-100 px-4 py-3 dark:border-brand-600">
        <Link to="/time-reports" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-200">
          View Time Tracking
        </Link>
      </div>
    </Card>
  );
}