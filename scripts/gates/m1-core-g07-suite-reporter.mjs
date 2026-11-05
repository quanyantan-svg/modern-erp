import { once } from 'node:events';
import { tap } from 'node:test/reporters';

// node:test run() emits structured test events. Convert those events to TAP
// before the Root captures stdout so its existing sanitized diagnostics can
// recover failure names, assertions, hook errors and stacks.
export async function emitNodeTestTap(stream, { output = process.stdout } = {}) {
  let failed = false;
  stream.on('test:fail', () => { failed = true; });

  for await (const chunk of stream.compose(tap)) {
    if (!output.write(chunk)) await once(output, 'drain');
  }
  return Object.freeze({ failed });
}
