import type { TimeOffRequest } from '../types';

export const formatTimeOffDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day));
};

export const formatTimeOffRange = (request: Pick<TimeOffRequest, 'startDate' | 'endDate'>) => request.startDate === request.endDate
  ? formatTimeOffDate(request.startDate)
  : `${formatTimeOffDate(request.startDate)} - ${formatTimeOffDate(request.endDate)}`;
