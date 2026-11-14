// Canonical "is this module the process entry point" check.
//
// `import.meta.url === 'file://' + process.argv[1]` never matches on Windows
// (the module URL is file:///D:/... while argv[1] is D:\...), so the backup
// and restore CLIs silently did nothing and still exited 0. Comparing the
// resolved absolute paths is exact and platform independent.
//
// The module URL must be supplied by the caller: inside this helper
// `import.meta.url` refers to the helper itself, not to the caller.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isMainModule(moduleUrl, entry = process.argv[1]) {
  if (!moduleUrl || !entry) return false;
  try {
    return resolve(fileURLToPath(moduleUrl)) === resolve(entry);
  } catch {
    return false;
  }
}
