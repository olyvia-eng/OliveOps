import { requireSession } from './_lib/session.js';
import {
  getHomeDashboardPreferencesForUser,
  saveHomeDashboardPreferencesForUser,
} from './_lib/homeDashboardPreferences.js';
import { listTasksForBusiness, updateTaskForBusiness } from './_lib/authRepo.js';

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      const preferences = await getHomeDashboardPreferencesForUser(session.businessId, session.id, session.role);
      return res.status(200).json({ ok: true, preferences });
    }

    const previous = await getHomeDashboardPreferencesForUser(session.businessId, session.id, session.role);
    const preferences = await saveHomeDashboardPreferencesForUser({
      businessId: session.businessId,
      userId: session.id,
      role: session.role,
      preferences: req.body,
    });
    const deletedTaskTabId = req.body?.deletedTaskTabId;
    if (typeof deletedTaskTabId === 'string'
      && previous.customTaskTabs?.some((tab) => tab.id === deletedTaskTabId)
      && !preferences.customTaskTabs?.some((tab) => tab.id === deletedTaskTabId)) {
      const tasks = await listTasksForBusiness(session.businessId);
      await Promise.all(tasks
        .filter((task) => task.assignedUserId === session.id && task.taskTabId === deletedTaskTabId)
        .map((task) => { const next = { ...task, updatedAt: new Date().toISOString() }; delete next.taskTabId; return updateTaskForBusiness({ businessId: session.businessId, task: next }); }));
    }
    return res.status(200).json({ ok: true, preferences });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not save Home dashboard preferences.' });
  }
}
