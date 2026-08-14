export type BusinessUserRole = 'owner' | 'admin' | 'foreman' | 'crew_member';

export interface AuthBusiness {
  id: string;
  name: string;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  businessId: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  password: string;
  role: BusinessUserRole;
  active: boolean;
  createdAt: string;
}

export interface SessionUser {
  id: string;
  businessId: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  role: BusinessUserRole;
  businessName: string;
}

export interface BusinessUserSummary {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  role: BusinessUserRole;
  active: boolean;
  createdAt: string;
}

export interface AuthDatabase {
  businesses: AuthBusiness[];
  users: AuthUser[];
}
