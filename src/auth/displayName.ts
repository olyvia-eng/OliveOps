export interface DisplayNameUser {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
}

export function getDisplayName(user: DisplayNameUser | null | undefined): string {
  if (!user) return '';

  const structuredName = [user.firstName, user.lastName]
    .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
    .map((part) => part.trim())
    .join(' ');

  return structuredName || user.name?.trim() || user.email?.trim() || '';
}