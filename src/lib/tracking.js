export const TRACKING_POLICIES = Object.freeze({
  NONE: { label: '不跟踪', shortLabel: '不跟踪', description: '适用于无需批次或单件身份跟踪的普通货品。' },
  LOT: { label: '批次管理', shortLabel: '批次', description: '库存按批次区分，适用于原材料、批量采购件等。' },
  SERIAL: { label: '序列号管理', shortLabel: '序列号', description: '每件库存具有唯一序列号，适用于单件跟踪的成品或高价值物品。' },
});

export function trackingPolicyOf(product) {
  const policy = String(product?.trackingPolicy || product?.tracking_policy || 'NONE').toUpperCase();
  return TRACKING_POLICIES[policy] ? policy : 'NONE';
}

export function trackingPresentation(policy) {
  return TRACKING_POLICIES[String(policy || 'NONE').toUpperCase()] || TRACKING_POLICIES.NONE;
}

export function withProductTracking(line, productId) {
  if (line.productId === productId) return line;
  return { ...line, productId, trackingAllocations: [] };
}

export function copySourceAllocations(allocations = []) {
  return allocations.map((row) => ({
    lotId: row.lotId || null,
    lotCode: row.lotCode || row.plannedLotCode || '',
    serialId: row.serialId || null,
    serialNumber: row.serialNumber || row.plannedSerialNumber || '',
    quantity: Number(row.quantity || 1),
    manufactureDate: row.manufactureDate || null,
    expiryDate: row.expiryDate || null,
    supplierLotReference: row.supplierLotReference || null,
  }));
}
