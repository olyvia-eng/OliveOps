import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('route rendering is protected by a branded Error Boundary outside Suspense', async () => {
  const [app, boundary, recoverySuccess] = await Promise.all([
    source('../src/App.tsx'),
    source('../src/components/errors/RouteErrorBoundary.tsx'),
    source('../src/components/errors/RouteRecoverySuccess.tsx'),
  ]);

  assert.match(app, /<BrowserRouter>\s*<RouteErrorBoundary>\s*<Suspense/);
  assert.match(app, /<\/Routes>\s*<RouteRecoverySuccess \/>\s*<\/Suspense>/);
  assert.match(app, /<\/Suspense>\s*<\/RouteErrorBoundary>\s*<\/BrowserRouter>/);
  assert.match(boundary, /class AppErrorBoundary extends Component/);
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /componentDidCatch/);
  assert.match(boundary, />Something went wrong</);
  assert.match(boundary, /We couldn't load this page\./);
  assert.match(boundary, /Try Again/);
  assert.match(boundary, /Reload OliveOps/);
  assert.doesNotMatch(boundary, /stack|componentStack/);
  assert.match(recoverySuccess, /useEffect/);
  assert.match(recoverySuccess, /clearChunkRecovery/);
});

test('pathname changes reset the boundary without remounting routes for query-only navigation', async () => {
  const [boundary, sidebar] = await Promise.all([
    source('../src/components/errors/RouteErrorBoundary.tsx'),
    source('../src/components/layout/Sidebar.tsx'),
  ]);

  assert.match(boundary, /useLocation\(\)/);
  assert.match(boundary, /key=\{location\.pathname\}/);
  assert.doesNotMatch(boundary, /key=\{location\.key\}/);
  assert.match(sidebar, /useNavigate\(\)/);
  assert.match(sidebar, /navigate\(path\)/);
  assert.doesNotMatch(sidebar, /window\.location/);
});

test('global failures use one cleanup-aware recovery installer and builds expose a version', async () => {
  const [main, recovery, viteConfig] = await Promise.all([
    source('../src/main.tsx'),
    source('../src/errors/routeErrorRecovery.js'),
    source('../vite.config.ts'),
  ]);

  assert.match(main, /installGlobalErrorHandlers/);
  assert.match(main, /import\.meta\.hot\.dispose\(removeGlobalErrorHandlers\)/);
  assert.match(main, /window\.location\.pathname/);
  assert.match(recovery, /addEventListener\('error'/);
  assert.match(recovery, /addEventListener\('unhandledrejection'/);
  assert.match(recovery, /addEventListener\('vite:preloadError'/);
  assert.match(recovery, /if \(result\.recoveryStarted\) event\.preventDefault\(\)/);
  assert.match(recovery, /removeEventListener\('vite:preloadError'/);
  assert.match(viteConfig, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(viteConfig, /import\.meta\.env\.VITE_APP_VERSION/);
});