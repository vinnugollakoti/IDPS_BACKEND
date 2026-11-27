import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedModulesForRole } from '../lib/modulePermissions';

test('partial permission records retain newly added teacher apps without overriding denials', () => {
  const modules = allowedModulesForRole('TEACHER', [
    { module: 'students', isAllowed: true },
    { module: 'exams', isAllowed: false },
  ]);
  assert.ok(modules.includes('homework'));
  assert.ok(modules.includes('circulars'));
  assert.ok(!modules.includes('exams'));
  assert.ok(!modules.includes('fees'));
  assert.deepEqual(allowedModulesForRole('TEACHER',
    allowedModulesForRole('TEACHER', []).map(module => ({ module, isAllowed: false }))), []);
});
