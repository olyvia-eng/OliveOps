import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('route rendering is protected by a branded Error Boundary outside Suspense', async () => {
  const [app, boundary] = await Promise.all([
    source('../src/App.tsx'),
    source('../src/components/errors/RouteErrorBoundary.tsx'),
  ]);

  assert.match(app, /<BrowserRouter>\s*<RouteErrorBoundary>\s*<Suspense/);
  assert.match(app, /<\/Suspense>\s*<\/RouteErrorBoundary>\s*<\/BrowserRouter>/);
  assert.match(boundary, /class AppErrorBoundary extends Component/);
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /componentDidCatch/);
  assert.match(boundary, />Something went wrong</);
  assert.match(boundary, /We couldn't load this page\./);
  assert.match(boundary, /Try Again/);
  assert.match(boundary, /Reload OliveOps/);
  assert.doesNotMatch(boundary, /stack|componentStack/);
});

test('route changes reset the boundary and sidebar navigation remains client-side', async () => {
  const [boundary, sidebar] = await Promise.all([
    source('../src/components/errors/RouteErrorBoundary.tsx'),
    source('../src/components/layout/Sidebar.tsx'),
  ]);

  assert.match(boundary, /useLocation\(\)/);
  assert.match(boundary, /key=\{location\.key\}/);
  assert.match(sidebar, /useNavigate\(\)/);
  assert.match(sidebar, /navigate\(path\)/);
  assert.doesNotMatch(sidebar, /window\.location/);
});

test('unhandled rejections use the same classified recovery path and builds expose a version', async () => {
  const [main, viteConfig] = await Promise.all([
    source('../src/main.tsx'),
    source('../vite.config.ts'),
  ]);

  assert.match(main, /addEventListener\('unhandledrejection'/);
  assert.match(main, /source: 'unhandled-rejection'/);
  assert.match(main, /addEventListener\('vite:preloadError'/);
  assert.match(main, /forceChunkLoadFailure: true/);
  assert.match(main, /if \(result\.recoveryStarted\) event\.preventDefault\(\)/);
  assert.doesNotMatch(main, /vite:preloadError'[\s\S]{0,80}event\.preventDefault/);
  assert.match(main, /window\.location\.pathname/);
  assert.match(viteConfig, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(viteConfig, /import\.meta\.env\.VITE_APP_VERSION/);
});