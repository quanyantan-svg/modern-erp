import { once } from 'node:events';
import { tap } from 'node:test/reporters';

// node:test run() emits structured test events. Convert those events to TAP
// before the Root captures stdout so its existing sanitized diagnostics can
// recover failure names, assertions, hook errors and stacks.
//
// The failure signal is taken from **two** independent sources: the
// `test:fail` stream event AND the `not ok` lines of the composed TAP itself.
// The event alone is not sufficient — a failure reported only inside a nested
// subtest does not always reach the top-level `test:fail` event, and a gate
// whose exit code ignores the suite result would report a FAILING suite as a
// PASS.
export async function emitNodeTestTap(stream, { output = process.stdout } = {}) {
  let failed = false;
  stream.on('test:fail', () => { failed = true; });

  let composed = '';
  for await (const chunk of stream.compose(tap)) {
    composed += chunk;
    if (!output.write(chunk)) await once(output, 'drain');
  }
  if (/^\s*not ok \d+/m.test(composed)) failed = true;
  return Object.freeze({ failed });
}
