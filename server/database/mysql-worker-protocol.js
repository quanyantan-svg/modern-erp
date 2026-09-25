export const MYSQL_RESPONSE_HEADER_BYTES = 16;

const STATUS_INDEX = 0;
const LENGTH_INDEX = 1;
const ACTIVE_REQUEST_INDEX = 2;
const RESPONSE_REQUEST_INDEX = 3;

export function responseState(shared) {
  return new Int32Array(shared, 0, MYSQL_RESPONSE_HEADER_BYTES / Int32Array.BYTES_PER_ELEMENT);
}

export function beginWorkerRequest(shared, requestId) {
  const state = responseState(shared);
  Atomics.store(state, STATUS_INDEX, 0);
  Atomics.store(state, LENGTH_INDEX, 0);
  Atomics.store(state, RESPONSE_REQUEST_INDEX, 0);
  Atomics.store(state, ACTIVE_REQUEST_INDEX, requestId);
  return state;
}

export function abandonWorkerRequest(state, requestId) {
  Atomics.compareExchange(state, ACTIVE_REQUEST_INDEX, requestId, 0);
}

export function readWorkerResponse(shared, requestId) {
  const state = responseState(shared);
  if (Atomics.load(state, RESPONSE_REQUEST_INDEX) !== requestId) return null;
  const length = Atomics.load(state, LENGTH_INDEX);
  const decoded = new TextDecoder().decode(new Uint8Array(shared, MYSQL_RESPONSE_HEADER_BYTES, length));
  return {
    status: Atomics.load(state, STATUS_INDEX),
    value: decoded ? JSON.parse(decoded) : {},
  };
}

export function encodeWorkerResponse(shared, requestId, value, status = 1) {
  const state = responseState(shared);
  if (Atomics.load(state, ACTIVE_REQUEST_INDEX) !== requestId) return false;

  const output = new Uint8Array(shared, MYSQL_RESPONSE_HEADER_BYTES);
  let bytes = new TextEncoder().encode(JSON.stringify(value));
  let finalStatus = status;
  if (bytes.length > output.length) {
    bytes = new TextEncoder().encode(JSON.stringify({ message: `MySQL adapter response exceeded ${output.length} bytes` }));
    finalStatus = 2;
  }

  output.set(bytes.subarray(0, output.length));
  Atomics.store(state, LENGTH_INDEX, Math.min(bytes.length, output.length));
  Atomics.store(state, RESPONSE_REQUEST_INDEX, requestId);

  // Claim the response slot only after the bytes and metadata are ready. If
  // the parent timed out or began another generation meanwhile, this late
  // response is discarded and cannot wake or overwrite the later request.
  if (Atomics.compareExchange(state, ACTIVE_REQUEST_INDEX, requestId, 0) !== requestId) return false;
  Atomics.store(state, STATUS_INDEX, finalStatus);
  Atomics.notify(state, STATUS_INDEX);
  return true;
}
