import PersonalHomeDashboard from './PersonalHomeDashboard';

interface HomePageProps {
  currentUserId: string;
  currentUserName: string;
  currentUserEmail?: string;
  currentUserRole: string;
}

export default function HomePage({ currentUserId, currentUserName, currentUserEmail, currentUserRole }: HomePageProps) {
  return <PersonalHomeDashboard currentUserId={currentUserId} currentUserName={currentUserName} currentUserEmail={currentUserEmail} currentUserRole={currentUserRole} />;
}
