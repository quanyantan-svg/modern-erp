// V22 — Finance Operations Wave A.
//
// FO14 — Other / Manual AR & AP bounded capability.
//
// Already exposed via createManualAccountReceivable / createManualAccountPayable
// in finance-ar-open-item.js / finance-ap-open-item.js. This module provides
// a thin façade for caller convenience and future expansion.

import { createManualAccountReceivable } from './finance-ar-open-item.js';
import { createManualAccountPayable } from './finance-ap-open-item.js';

export const manualArFacade = createManualAccountReceivable;
export const manualApFacade = createManualAccountPayable;
