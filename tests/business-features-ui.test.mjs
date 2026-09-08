import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const sidebar = readFileSync('src/navigation/sidebarConfig.ts', 'utf8');
const setup = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
const page = readFileSync('src/pages/settings/CompanyFeaturesPage.tsx', 'utf8');

test('feature-aware navigation tags Projects, Services, and Snow Operations', () => {
  assert.match(sidebar, /estimates\/projects[^\n]+feature: 'projects'/);
  assert.match(sidebar, /estimates\/services[^\n]+feature: 'recurringServices'/);
  assert.match(sidebar, /jobs\/projects[^\n]+feature: 'projects'/);
  assert.match(sidebar, /jobs\/services[^\n]+feature: 'recurringServices'/);
  assert.match(sidebar, /snow-operations[^\n]+feature: 'snowOperations'/);
  assert.match(sidebar, /if \(item\.feature && !features\[item\.feature\]\) return null/);
});

test('feature-specific list, detail, and Snow routes use direct-route protection', () => {
  assert.match(app, /function FeatureRoute/);
  assert.match(app, /path="estimates\/projects"[^\n]+FeatureRoute feature="projects"/);
  assert.match(app, /path="estimates\/services"[^\n]+FeatureRoute feature="recurringServices"/);
  assert.match(app, /path="jobs\/projects"[^\n]+FeatureRoute feature="projects"/);
  assert.match(app, /path="jobs\/services"[^\n]+FeatureRoute feature="recurringServices"/);
  assert.match(app, /path="snow-operations"[^\n]+FeatureRoute feature="snowOperations"/);
  assert.match(app, /businessFeatures\[workType === 'service' \? 'recurringServices' : 'projects'\]/);
  assert.match(app, /This feature is not enabled for your company/);
});

test('Company Setup exposes a simple business-wide Features page', () => {
  assert.match(setup, /label: 'Features', path: '\/settings\/features'/);
  assert.match(setup, /label: 'Estimate Templates'[^\n]+visible: businessFeatures\.projects/);
  assert.match(app, /path="settings\/features"/);
  assert.match(app, /path="estimates\/templates"[^\n]+FeatureRoute feature="projects"/);
  assert.match(page, /Choose which OliveOps tools your company uses\./);
  assert.match(page, /role="switch"/);
  assert.match(page, /JSON\.stringify\(\{ features: next \}\)/);
});