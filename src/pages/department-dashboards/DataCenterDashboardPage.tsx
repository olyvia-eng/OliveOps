import { Database, FileText, Shield } from 'lucide-react';
import DepartmentDashboard from '../../components/dashboard/DepartmentDashboard';
import { useStore } from '../../store';

export default function DataCenterDashboardPage() {
  const { customers, estimates, jobs, employees, timeEntries } = useStore();

  const totalRecords = customers.length + estimates.length + jobs.length + employees.length + timeEntries.length;

  return (
    <DepartmentDashboard
      title="Data Center Dashboard"
      subtitle="System-level record overview. Detailed data tools stay inside Data Center modules."
      kpis={[
        {
          label: 'Total Records',
          value: totalRecords,
          sub: 'Across core entities',
          icon: <Database size={30} />,
          color: 'text-brand-600',
        },
        {
          label: 'Customer Records',
          value: customers.length,
          sub: 'CRM objects',
          icon: <FileText size={30} />,
          color: 'text-accent-700',
        },
        {
          label: 'Job Records',
          value: jobs.length,
          sub: 'Operational objects',
          icon: <Database size={30} />,
          color: 'text-brand-700',
        },
        {
          label: 'Security Access',
          value: 'Healthy',
          sub: 'Auth + role checks active',
          icon: <Shield size={30} />,
          color: 'text-accent-700',
        },
      ]}
      widgets={[
        {
          title: 'Data Assets',
          description: 'Placeholder for documents, forms, and photos index widgets.',
          emptyTitle: 'No asset indexes connected yet',
          emptyDescription: 'Documents, forms, and photos summaries will appear here.',
          actionLabel: 'Open Data Center',
          actionTo: '/data-center',
        },
        {
          title: 'Data Quality Signals',
          description: 'Quick checks before opening detailed data management views.',
          highlights: [
            `${employees.length} employee records`,
            `${estimates.length} estimate records`,
            `${timeEntries.length} time entry records`,
            `${jobs.length} job records`,
          ],
          actionLabel: 'Open Users & Access',
          actionTo: '/user-access',
        },
      ]}
    />
  );
}
