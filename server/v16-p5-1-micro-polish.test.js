import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const editor = read('src/pages/mrp-runs.jsx');
const metadata = read('src/navigation/presentationMetadata.js');
const planRoute = metadata.match(/route\('material-requirements-plan'[^\n]+/)?.[0] || '';

test('MRP editor keeps one visible 运算名称 heading', () => {
  assert.match(editor, /<h3>运算名称<\/h3><input/);
  assert.doesNotMatch(editor, /<label>运算名称/);
});

test('MRP name input remains accessibly labelled', () => {
  assert.match(editor, /<input aria-label="运算名称"[^>]*maxLength=\{80\}[^>]*required[^>]*autoFocus=\{!runId\}/);
});

test('MRP editor keeps one visible 需求来源 heading', () => {
  assert.match(editor, /<h3>需求来源<\/h3><select/);
  assert.doesNotMatch(editor, /<label>需求来源/);
});

test('MRP demand source select remains accessibly labelled', () => {
  assert.match(editor, /<select aria-label="需求来源" value=\{form\.demandSourceMode\}/);
});

test('demand source values and combined-demand hint remain unchanged', () => {
  for (const value of ['SALES_ORDERS', 'FORECAST', 'SALES_PLUS_FORECAST']) assert.match(editor, new RegExp(`value="${value}"`));
  assert.match(editor, /demandModeHint\(form\.demandSourceMode\)/);
});

test('material plan presentation title is 物料需求计划', () => {
  assert.match(planRoute, /route\('material-requirements-plan','物料需求计划'/);
  assert.doesNotMatch(planRoute, /MRP · 物料建议/);
});

test('material plan route identity remains unchanged', () => {
  assert.match(planRoute, /^route\('material-requirements-plan'/);
});

test('material plan remains an internal result surface', () => {
  assert.match(planRoute, /'FLOW_INTERNAL_STEP','REPORT','contextual'/);
});

test('material plan parent remains mrp-runs', () => {
  assert.match(planRoute, /parentRoute:'mrp-runs'/);
});

test('material plan presentation concept remains MRP', () => {
  assert.match(planRoute, /presentationConcept:'MRP'/);
});
