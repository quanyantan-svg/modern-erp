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

  test('uses the canonical platform font stack without bundled font names', () => {
    assert.match(css, /system-ui,\s*-apple-system,\s*BlinkMacSystemFont,\s*"Segoe UI",\s*\n?\s*"PingFang SC",\s*"Microsoft YaHei",\s*sans-serif/);
    assert.doesNotMatch(css, /SF Pro Text|SF Pro Display/);
  });

  test('exports coherent reusable page, list, form, button, control and summary primitives', () => {
    for (const name of ['PageHeader', 'SectionHeader', 'GroupedList', 'ListRow', 'FormSection', 'FormRow', 'TextField', 'TextArea', 'SelectField', 'DateField', 'MoneyField', 'QuantityField', 'PrimaryButton', 'SecondaryButton', 'TertiaryButton', 'DestructiveButton', 'IconButton', 'SegmentedControl', 'BottomActionBar', 'SummaryCard']) assert.match(primitives, new RegExp(`export function ${name}\\b`));
  });

  test('mobile shell exposes exactly the canonical labels in order', () => {
    const labels = [...shell.matchAll(/key: '[^']+', label: '([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual(labels, ['消息', '签核', '应用', '云翼', '我的']);
    assert.doesNotMatch(shell, /通讯录|敬请期待/);
  });

  test('launcher has calm business group names and permission filtering remains external', () => {
    for (const label of ['销售', '采购', '计划与生产', '库存', '财务', '决策报表', '基础资料', '系统']) assert.match(metadata, new RegExp(`label: '${label}'`));
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
