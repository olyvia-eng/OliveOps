import { ArrowLeft } from 'lucide-react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import JobScheduleEditor from '../../components/calendar/JobScheduleEditor';
import { Button, Card, PageHeader } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';

interface Props {
  currentUserRole: string;
}

export default function JobSchedulePage({ currentUserRole }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    jobs,
    customers,
    employees,
    equipmentAssets,
    crews,
    divisions,
    budgetDivisions,
    updateJobSchedule,
  } = useStore();
  const job = jobs.find((item) => item.id === id);
  const canManageSchedule = currentUserRole === 'owner' || currentUserRole === 'admin' || currentUserRole === 'foreman';

  if (!canManageSchedule) return <Navigate to={job ? `/jobs/${job.id}` : '/jobs'} replace />;
  if (!job) return <div className="p-8 text-sm text-gray-500">Job not found.</div>;

  const fromSchedule = searchParams.get('from') === 'schedule';
  const requestedCalendarDate = searchParams.get('calendarDate') ?? '';
  const calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedCalendarDate) ? requestedCalendarDate : '';
  const requestedCalendarView = searchParams.get('calendarView') ?? '';
  const calendarView = requestedCalendarView === 'month' || requestedCalendarView === 'week' || requestedCalendarView === 'day'
    ? requestedCalendarView
    : '';
  const returnParams = new URLSearchParams();
  if (calendarDate) returnParams.set('date', calendarDate);
  if (calendarView) returnParams.set('view', calendarView);
  const returnTarget = fromSchedule
    ? `/schedule${returnParams.size ? `?${returnParams.toString()}` : ''}`
    : `/jobs/${job.id}?tab=project-management`;
  const exitEditor = () => navigate(returnTarget);

  return <div className="space-y-5">
    <PageHeader
      title="Edit Job Schedule"
      subtitle="Set the work window and resources for this Job. Its lifecycle status is managed separately."
      action={<Button variant="secondary" onClick={exitEditor}><ArrowLeft size={15} /> {fromSchedule ? 'Back to Schedule' : 'Back to Job'}</Button>}
    />
    <Card className="p-4 sm:p-6">
      <JobScheduleEditor
        job={job}
        jobs={jobs}
        customers={customers}
        employees={employees}
        equipmentAssets={equipmentAssets}
        crews={crews}
        divisions={divisions}
        budgetDivisions={budgetDivisions}
        onExit={exitEditor}
        onSave={async ({ jobId, ...schedule }) => {
          const saved = await updateJobSchedule(jobId, schedule);
          if (saved) emitAppToast({ tone: 'success', message: 'Job schedule saved.' });
          return saved;
        }}
      />
    </Card>
  </div>;
}
