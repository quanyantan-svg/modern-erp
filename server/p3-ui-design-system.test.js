import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const css = read('src', 'styles.css');
const shell = read('src', 'components', 'MobileShell.jsx');
const metadata = read('src', 'navigation', 'applicationMetadata.js');
const primitives = read('src', 'components', 'design-system.jsx');

describe('P3 global design system', () => {
  test('defines the required semantic token families and spacing scale', () => {
    for (const token of ['--bg-app', '--bg-grouped', '--bg-surface', '--bg-elevated', '--text-primary', '--text-secondary', '--text-tertiary', '--text-disabled', '--separator', '--border-subtle', '--accent', '--accent-hover', '--accent-soft', '--success', '--success-soft', '--warning', '--warning-soft', '--danger', '--danger-soft', '--info', '--info-soft', '--shadow-sm', '--shadow-md', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--space-1', '--space-8']) assert.match(css, new RegExp(token));
  });

  test('uses the canonical native platform font stack without remote font assets', () => {
    assert.match(css, /-apple-system,\s*BlinkMacSystemFont,\s*"SF Pro Text",\s*"Segoe UI",\s*system-ui,\s*\n?\s*"PingFang SC",\s*"Microsoft YaHei",\s*sans-serif/);
    assert.doesNotMatch(css, /@font-face|fonts\.(?:googleapis|gstatic)\.com/);
  });

  test('exports coherent reusable page, list, form, button, control and summary primitives', () => {
    for (const name of ['PageHeader', 'SectionHeader', 'GroupedList', 'ListRow', 'FormSection', 'FormRow', 'TextField', 'TextArea', 'SelectField', 'DateField', 'MoneyField', 'QuantityField', 'PrimaryButton', 'SecondaryButton', 'TertiaryButton', 'DestructiveButton', 'IconButton', 'SegmentedControl', 'BottomActionBar', 'SummaryCard']) assert.match(primitives, new RegExp(`export function ${name}\\b`));
  });

  test('exports the V1.2 list, sheet, feedback and lifecycle primitives', () => {
    for (const name of ['SearchField', 'FilterButton', 'Sheet', 'FilterSheet', 'StatusChip', 'RecordList', 'RecordCard', 'DetailSection', 'KeyValueRow', 'ActionMenu', 'ActionSheet', 'ConfirmSheet', 'DangerSheet', 'InlineAlert', 'EmptyState', 'Skeleton', 'RelationshipCard', 'LifecycleBadge', 'DependencyGraphSheet']) assert.match(primitives, new RegExp(`export function ${name}\\b`));
  });

  test('uses one centered application viewport with fixed canonical bottom navigation', () => {
    assert.match(css, /--app-max-width:\s*600px/);
    assert.match(css, /\.mobile-shell\s*\{[^}]*max-width:\s*var\(--app-max-width\)[^}]*margin:\s*0 auto/s);
    assert.match(css, /\.mobile-bottom-nav\s*\{[^}]*position:\s*fixed[^}]*width:\s*min\(100%,\s*var\(--app-max-width\)\)/s);
  });

  test('sheet and action layers use explicit stacking tokens and safe-area padding', () => {
    for (const token of ['--z-navigation', '--z-sheet', '--z-toast']) assert.match(css, new RegExp(token));
    assert.match(css, /\.sheet__body\s*\{[^}]*safe-area-inset-bottom/s);
    assert.match(css, /\.bottom-action-bar\s*\{[^}]*safe-area-inset-bottom/s);
  });

  test('mobile shell exposes exactly the canonical labels in order', () => {
    const labels = [...shell.matchAll(/key: '[^']+', label: '([^']+)'/g)].map((match) => match[1]);
    // V1.6 P1A: cloud/云翼/签核 replaced by workspace/工作台/审批.
    assert.deepEqual(labels, ['消息', '审批', '应用', '工作台', '我的']);
    assert.doesNotMatch(shell, /通讯录|敬请期待|云翼/);
  });

  test('launcher has V1.6 flowchart-aligned business group names and permission filtering remains external', () => {
    // V1.7 P0: launcher groups are now owned by applicationRegistry.js;
    // applicationMetadata.js is a compatibility projection. Permission
    // filtering continues to live in the registry, not in the projection.
    const registry = read('src', 'navigation', 'applicationRegistry.js');
    for (const label of ['基础资料', '销售管理', '生产管理', '采购管理', '库存管理', '决策报表']) {
      assert.match(registry, new RegExp(`launcherGroup\\('[^']+','${label}'`));
    }
    assert.doesNotMatch(metadata, /permission\s*:/);
  });

  test('mobile input and primary-action targets meet the product contract', () => {
    assert.match(css, /input, select \{[^}]*min-height:48px/s);
    assert.match(css, /button\.primary[^}]*min-height:48px/s);
  });

  test('mobile modal is a safe-area-aware bottom sheet', () => {
    assert.match(css, /\.modal-backdrop \{[^}]*align-items:flex-end/s);
    assert.match(css, /\.modal-body \{[^}]*safe-area-inset-bottom/s);
  });

  test('legacy tables receive a mobile record-card representation', () => {
    assert.match(css, /\.mobile-application-view \.table-wrap tbody tr \{[^}]*display:grid/s);
    assert.match(css, /\.mobile-application-view \.table-wrap tbody td \{[^}]*overflow-wrap:anywhere/s);
  });
});
