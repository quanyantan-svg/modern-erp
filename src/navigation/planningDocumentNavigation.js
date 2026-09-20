export const PLANNING_DOCUMENT_PAGES = Object.freeze([
  'production-instructions',
  'purchase-instructions',
  'purchase-requisitions',
]);

export function planningDocumentTabForPage(page) {
  return PLANNING_DOCUMENT_PAGES.includes(page) ? page : 'production-instructions';
}
