import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jobDetailSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const cardSource = readFileSync('src/components/jobs/JobSopsCard.tsx', 'utf8');
const viewerSource = readFileSync('src/pages/sops/SopDetailPage.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const authRepoSource = readFileSync('api/_lib/authRepo.js', 'utf8');
const sopRepoSource = readFileSync('api/_lib/sopRepo.js', 'utf8');

test('Project Management places Job SOPs after tasks and before notes', () => {
  const projectManagement = jobDetailSource.slice(jobDetailSource.indexOf("activeTab === 'project-management'"), jobDetailSource.indexOf("activeTab === 'invoices'"));
  const tasksAt = projectManagement.indexOf('<OutstandingTasks');
  const sopsAt = projectManagement.indexOf('<JobSopsCard');
  const notesAt = projectManagement.indexOf('>Notes</h2>');
  assert.ok(tasksAt >= 0 && sopsAt > tasksAt && notesAt > sopsAt);
  assert.match(projectManagement, /<JobSopsCard jobId=\{job\.id\} canManage=\{canManageSchedule\}/);
});

test('Job SOP card supports concise read, empty, search, multi-add, and unlink states', () => {
  assert.match(cardSource, />SOPs for this Job</);
  assert.match(cardSource, />Procedures that apply to this job\.</);
  assert.match(cardSource, /No SOPs have been added to this Job/);
  assert.match(cardSource, /Search by title, category, or description/);
  assert.match(cardSource, /type="checkbox"/);
  assert.match(cardSource, /selectedIds/);
  assert.match(cardSource, /canManage \? <Button[^>]+>.*Add SOP/s);
  assert.match(cardSource, /canManage \? <button[^>]+title=\{`Remove/);
  assert.match(cardSource, /to=\{`\/jobs\/\$\{jobId\}\/sops\/\$\{sop\.sopId\}`\}/);
});

test('Job SOP view uses the existing detail viewer in read-only Job context', () => {
  assert.match(appSource, /path="jobs\/:id\/sops\/:sopId" element=\{<SopDetailPage jobContext \/>\}/);
  assert.match(viewerSource, /jobContext \? null : <Button[^>]+.*Edit SOP/s);
  assert.match(viewerSource, /getJobSop\(jobId, sopId\)/);
  assert.match(viewerSource, /jobContext \? `\/jobs\/\$\{jobId\}\?tab=project-management` : '\/sops'/);
  assert.match(viewerSource, /<AuthorizedPdfPreview document=\{definition\.document\}/);
  assert.match(viewerSource, /<AttachmentList fileIds=\{definition\.attachmentFileIds\}/);
});

test('Job and SOP deletion cascade only association records through queryable prefixes', () => {
  assert.match(authRepoSource, /removeJobSopAssociationsForJob\(businessId, jobId\)/);
  assert.match(sopRepoSource, /removeJobSopAssociationsForSop\(businessId, sopId\)/);
});