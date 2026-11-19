import { allowAny } from '../lib/http.js';
import { readWorkReferenceInput, referenceItem, sendWorkReferencePage } from '../lib/work-reference.js';

const KINDS = new Set(['ORGANIZATION']);

export function listPlatformWorkReferences(db, res, actor, url) {
  allowAny(actor, ['NUMBERING_MANAGE', 'WORKFLOW_MANAGE', 'ORGANIZATIONS_VIEW']);
  const input = readWorkReferenceInput(url, KINDS);
  return sendWorkReferencePage(db, res, input, {
    identity: 'o.id',
    columns: 'o.id,o.code,o.name,o.org_type secondaryText,CASE WHEN o.status=\'ACTIVE\' THEN 1 ELSE 0 END active',
    from: 'FROM organizations o',
    where: ['1=1'],
    args: [],
    search: ['o.code', 'o.name'],
    order: 'o.code,o.id',
    toItem: referenceItem,
  });
}
