import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('signup requires separate first and last names and trims them before submission', async () => {
  const source = await read('../src/pages/auth/SignupPage.tsx');
  assert.match(source, /label="First Name \*"/);
  assert.match(source, /label="Last Name \*"/);
  assert.match(source, /!firstName\.trim\(\) \|\| !lastName\.trim\(\)/);
  assert.match(source, /firstName: firstName\.trim\(\)/);
  assert.match(source, /lastName: lastName\.trim\(\)/);
});

test('reset page rejects weak and mismatched passwords before submission', async () => {
  const source = await read('../src/pages/auth/ResetPasswordPage.tsx');
  assert.match(source, /password\.length < 8/);
  assert.match(source, /Password must be at least 8 characters\./);
  assert.match(source, /password !== confirmPassword/);
  assert.match(source, /Passwords do not match\./);
});

test('login and app expose password recovery routes and success copy', async () => {
  const [login, app] = await Promise.all([
    read('../src/pages/auth/LoginPage.tsx'),
    read('../src/App.tsx'),
  ]);
  assert.match(login, /to="\/forgot-password"/);
  assert.match(login, /Your password has been reset\. You can now sign in with your new password\./);
  assert.match(app, /path="forgot-password"/);
  assert.match(app, /path="reset-password"/);
});

test('display-name helper supports structured, legacy, and email-only users', async () => {
  const source = await read('../src/auth/displayName.ts');
  assert.match(source, /\[user\.firstName, user\.lastName\]/);
  assert.match(source, /structuredName \|\| user\.name\?\.trim\(\) \|\| user\.email\?\.trim\(\)/);
});