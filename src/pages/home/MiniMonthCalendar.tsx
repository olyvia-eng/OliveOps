import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface MiniMonthCalendarProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
}

const weekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function MiniMonthCalendar({ selectedDate, onSelect }: MiniMonthCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(selectedDate));
  const firstDay = startOfWeek(startOfMonth(visibleMonth));
  const lastDay = endOfWeek(endOfMonth(visibleMonth));
  const days: Date[] = [];
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) days.push(day);

  const chooseDate = (date: Date) => {
    onSelect(date);
    if (!isSameMonth(date, visibleMonth)) setVisibleMonth(startOfMonth(date));
  };

  return (
    <section aria-labelledby="mini-calendar-title">
      <div className="flex items-center justify-between">
        <h2 id="mini-calendar-title" className="text-sm font-semibold text-brand-900 dark:text-brand-50">{format(visibleMonth, 'MMMM yyyy')}</h2>
        <div className="flex items-center gap-1">
          <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-brand-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-600" onClick={() => setVisibleMonth((month) => subMonths(month, 1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-brand-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-600" onClick={() => setVisibleMonth((month) => addMonths(month, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center text-[10px] font-semibold text-brand-400 dark:text-brand-300">
        {weekdayLabels.map((label, index) => <span key={`${label}-${index}`} className="py-1">{label}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {days.map((day) => {
          const selected = isSameDay(day, selectedDate);
          const today = isSameDay(day, new Date());
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => chooseDate(day)}
              className={`mx-auto grid h-8 w-8 place-items-center rounded-md text-xs font-medium ${selected ? 'bg-brand-700 text-white' : today ? 'bg-accent-100 text-accent-800' : isSameMonth(day, visibleMonth) ? 'text-brand-800 hover:bg-brand-50 dark:text-brand-100 dark:hover:bg-brand-600' : 'text-gray-300 dark:text-brand-500'}`}
              aria-label={format(day, 'EEEE, MMMM d, yyyy')}
              aria-pressed={selected}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </section>
  );
}
