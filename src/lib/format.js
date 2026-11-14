// Shared display formatters.
//
// Intl.NumberFormat construction is expensive; creating one per rendered cell
// made money/quantity columns the hottest path in long tables. The instances
// are stateless, so a single module-level instance per format is equivalent.

// 金额：窄货币符号（与既有表格呈现一致）。
const CURRENCY_NARROW = new Intl.NumberFormat('zh-CN', {
  style: 'currency', currency: 'CNY', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2,
});
// 金额：完整货币符号。
const CURRENCY = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' });
// 数量：最多 6 位小数。
const QUANTITY = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 });

export const formatMoneyNarrow = (cents = 0) => CURRENCY_NARROW.format((Number(cents) || 0) / 100);
export const formatMoney = (cents) => CURRENCY.format(Number(cents) / 100);
export const formatQuantity = (value) => QUANTITY.format(Number(value || 0));
export const formatMicros = (value) => QUANTITY.format(Number(value || 0) / 1_000_000);
