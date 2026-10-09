// V21 — Wave A focused tests: canonical position identity, owner validation,
// stock status, warehouse bin, legacy read compatibility, migration safety.
//
// Frozen by `solution.md §27` (Domain 5 Closure Design).
//
// Pure / contract tests — no HTTP, no fixture DB.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computePositionKey, normalizeOwnerType, validateOwner, validateStockStatus, validateBin, warehouseAllowsBin, positionKeyForRow } from './lib/inventory-position.js';

// --------------------------------------------------------------------------
// computePositionKey
// --------------------------------------------------------------------------

test('computePositionKey: deterministic for identical tuple', () => {
  const a = computePositionKey({
    productId: 'P1', warehouseId: 'W1', binId: null,
    ownerType: 'ENTERPRISE', ownerId: null,
    stockStatus: 'AVAILABLE', lotId: null, serialId: null,
  });
  const b = computePositionKey({
    productId: 'P1', warehouseId: 'W1', binId: null,
    ownerType: 'ENTERPRISE', ownerId: null,
    stockStatus: 'AVAILABLE', lotId: null, serialId: null,
  });
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('computePositionKey: different owner_type produces different key', () => {
  const enterprise = computePositionKey({
    productId: 'P1', warehouseId: 'W1', ownerType: 'ENTERPRISE', ownerId: null,
    stockStatus: 'AVAILABLE',
  });
  const supplier = computePositionKey({
    productId: 'P1', warehouseId: 'W1', ownerType: 'SUPPLIER', ownerId: 'S1',
    stockStatus: 'AVAILABLE',
  });
  assert.notEqual(enterprise, supplier);
});

test('computePositionKey: different bin produces different key', () => {
  const noBin = computePositionKey({
    productId: 'P1', warehouseId: 'W1', binId: null,
    ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
  });
  const withBin = computePositionKey({
    productId: 'P1', warehouseId: 'W1', binId: 'BIN-A',
    ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
  });
  assert.notEqual(noBin, withBin);
});

test('computePositionKey: different stock_status produces different key', () => {
  const a = computePositionKey({
    productId: 'P1', warehouseId: 'W1', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
  });
  const b = computePositionKey({
    productId: 'P1', warehouseId: 'W1', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'HOLD',
  });
  assert.notEqual(a, b);
});

test('computePositionKey: lot_id and serial_id differentiate', () => {
  const noLot = computePositionKey({
    productId: 'P1', warehouseId: 'W1', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
  });
  const lot1 = computePositionKey({
    productId: 'P1', warehouseId: 'W1', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: 'L1',
  });
  const lot2 = computePositionKey({
    productId: 'P1', warehouseId: 'W1', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: 'L2',
  });
  assert.notEqual(noLot, lot1);
  assert.notEqual(lot1, lot2);
});

test('computePositionKey: owner_id differentiates', () => {
  const sup1 = computePositionKey({
    productId: 'P1', warehouseId: 'W1', ownerType: 'SUPPLIER', ownerId: 'S1', stockStatus: 'AVAILABLE',
  });
  const sup2 = computePositionKey({
    productId: 'P1', warehouseId: 'W1', ownerType: 'SUPPLIER', ownerId: 'S2', stockStatus: 'AVAILABLE',
  });
  assert.notEqual(sup1, sup2);
});

test('computePositionKey: rejects pipe character in id', () => {
  assert.throws(() => computePositionKey({
    productId: 'P|bad', warehouseId: 'W1', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
  }), /不得包含/);
});

test('computePositionKey: rejects oversized id component', () => {
  const longId = 'X'.repeat(200);
  assert.throws(() => computePositionKey({
    productId: longId, warehouseId: 'W1', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
  }), /128/);
});

test('computePositionKey: rejects unknown owner_type', () => {
  assert.throws(() => computePositionKey({
    productId: 'P1', warehouseId: 'W1', ownerType: 'GHOST', ownerId: null, stockStatus: 'AVAILABLE',
  }), /owner_type/);
});

test('computePositionKey: positionKeyForRow matches computePositionKey', () => {
  const row = {
    product_id: 'P1', warehouse_id: 'W1',
    bin_id: 'B1', owner_type: 'SUPPLIER', owner_id: 'S1',
    stock_status: 'AVAILABLE', lot_id: null, serial_id: null,
  };
  const expected = computePositionKey({
    productId: 'P1', warehouseId: 'W1', binId: 'B1',
    ownerType: 'SUPPLIER', ownerId: 'S1',
    stockStatus: 'AVAILABLE',
  });
  assert.equal(positionKeyForRow(row), expected);
});

// --------------------------------------------------------------------------
// normalizeOwnerType / validateOwner
// --------------------------------------------------------------------------

test('normalizeOwnerType: case insensitive', () => {
  assert.equal(normalizeOwnerType('enterprise'), 'ENTERPRISE');
  assert.equal(normalizeOwnerType('Supplier'), 'SUPPLIER');
  assert.equal(normalizeOwnerType('CUSTOMER'), 'CUSTOMER');
});

test('normalizeOwnerType: rejects unknown', () => {
  assert.throws(() => normalizeOwnerType('GHOST'), /owner_type/);
});

test('validateOwner: ENTERPRISE requires owner_id=null', () => {
  // Stub db.prepare with empty result for SUPPLIER/CUSTOMER lookups
  const fakeDb = { prepare: () => ({ get: () => null }) };
  // ENTERPRISE + null owner_id → ok
  assert.doesNotThrow(() => validateOwner(fakeDb, 'ENTERPRISE', null));
  assert.doesNotThrow(() => validateOwner(fakeDb, 'ENTERPRISE', undefined));
  // ENTERPRISE + non-null owner_id → reject
  assert.throws(() => validateOwner(fakeDb, 'ENTERPRISE', 'X1'), /必须为 NULL/);
});

test('validateOwner: SUPPLIER requires active supplier', () => {
  // Active supplier present
  const activeDb = { prepare: (sql) => {
    if (sql.includes('suppliers')) return { get: () => ({ id: 'S1' }) };
    return { get: () => null };
  } };
  assert.doesNotThrow(() => validateOwner(activeDb, 'SUPPLIER', 'S1'));
  // Missing supplier
  const missingDb = { prepare: () => ({ get: () => null }) };
  assert.throws(() => validateOwner(missingDb, 'SUPPLIER', 'S-MISSING'), /供应商不存在/);
});

test('validateOwner: CUSTOMER requires active customer', () => {
  const activeDb = { prepare: (sql) => {
    if (sql.includes('customers')) return { get: () => ({ id: 'C1' }) };
    return { get: () => null };
  } };
  assert.doesNotThrow(() => validateOwner(activeDb, 'CUSTOMER', 'C1'));
  const missingDb = { prepare: () => ({ get: () => null }) };
  assert.throws(() => validateOwner(missingDb, 'CUSTOMER', 'C-MISSING'), /客户不存在/);
});

// --------------------------------------------------------------------------
// validateStockStatus
// --------------------------------------------------------------------------

test('validateStockStatus: AVAILABLE pre-seeded', () => {
  const fakeDb = { prepare: () => ({ get: () => ({ code: 'AVAILABLE', reservable: 1, issuable: 1, shippable: 1, transferable: 1, active: 1 }) }) };
  const row = validateStockStatus(fakeDb, 'AVAILABLE');
  assert.equal(row.code, 'AVAILABLE');
  assert.equal(row.reservable, 1);
});

test('validateStockStatus: unknown status throws when allowInsert=false', () => {
  const fakeDb = { prepare: () => ({ get: () => null }) };
  assert.throws(() => validateStockStatus(fakeDb, 'GHOST_STATUS'), /未注册/);
});

// --------------------------------------------------------------------------
// validateBin / warehouseAllowsBin
// --------------------------------------------------------------------------

test('validateBin: null bin returns null', () => {
  const fakeDb = { prepare: () => ({ get: () => null }) };
  assert.equal(validateBin(fakeDb, 'W1', null), null);
  assert.equal(validateBin(fakeDb, 'W1', ''), null);
});

test('validateBin: cross-warehouse bin rejected', () => {
  const fakeDb = { prepare: () => ({ get: () => ({ id: 'B1', warehouse_id: 'W-OTHER', active: 1 }) }) };
  assert.throws(() => validateBin(fakeDb, 'W1', 'B1'), /不属于/);
});

test('validateBin: inactive bin rejected', () => {
  const fakeDb = { prepare: () => ({ get: () => ({ id: 'B1', warehouse_id: 'W1', active: 0 }) }) };
  assert.throws(() => validateBin(fakeDb, 'W1', 'B1'), /已停用/);
});

test('warehouseAllowsBin: bin_enabled flag respected', () => {
  const yes = { prepare: () => ({ get: () => ({ bin_enabled: 1 }) }) };
  const no  = { prepare: () => ({ get: () => ({ bin_enabled: 0 }) }) };
  assert.equal(warehouseAllowsBin(yes, 'W1'), true);
  assert.equal(warehouseAllowsBin(no,  'W1'), false);
});