import { ArrowLeft } from 'lucide-react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import ScheduleJobModal from '../../components/calendar/ScheduleJobModal';
import { Button, Card, PageHeader } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';

interface Props {
  currentUserRole: string;
}

export default function JobSchedulePage({ currentUserRole }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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

  const returnToJob = () => navigate(`/jobs/${job.id}?tab=project-management`);

  return <div className="space-y-5">
    <PageHeader
      title={job.scheduleConfirmed ? 'Edit Job Schedule' : 'Schedule Job'}
      subtitle="Set the work window and resources for this Job. Its lifecycle status is managed separately."
      action={<Button variant="secondary" onClick={returnToJob}><ArrowLeft size={15} /> Back to Job</Button>}
    />
    <Card className="p-4 sm:p-6">
      <ScheduleJobModal
        open
        presentation="page"
        fixedJob
        title={job.scheduleConfirmed ? 'Edit Job Schedule' : 'Schedule Job'}
        jobs={[job]}
        customers={customers}
        employees={employees}
        equipmentAssets={equipmentAssets}
        crews={crews}
        divisions={divisions}
        budgetDivisions={budgetDivisions}
        initialJobId={job.id}
        onClose={returnToJob}
        onSave={async ({ jobId, ...schedule }) => {
          const saved = await updateJobSchedule(jobId, schedule);
          if (saved) emitAppToast({ tone: 'success', message: 'Job schedule saved.' });
          return saved;
        }}
      />
    </Card>
  </div>;
}
