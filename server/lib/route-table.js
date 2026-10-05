// V2 Stage 3 / Wave 1 — Backend dispatch ownership infrastructure.
//
// This module is the deliberately small route-table abstraction that lets
// later V2 domain waves migrate handlers out of server/app.js handleApi.
//
// Contract:
//     { method, path, handler, owner }
//
//     method  — uppercase HTTP method string (one of GET/HEAD/POST/PUT/PATCH/
//               DELETE/OPTIONS).
//     path    — exact pathname string (must start with '/') OR a RegExp
//               matching the FULL pathname with anchored `^…$` semantics
//               (identical to the existing handleApi `pathname === ...` and
//               `pathname.match(/^\/api\/...$/)` checks). RegExp must carry
//               NO flags. Capture groups from the RegExp are exposed as
//               `params` on the match result. Named capture groups are not
//               used by this abstraction.
//     handler — function. No contract on signature; this abstraction does
//               NOT impose a universal `(db, req, res, actor, params)`
//               signature. Existing handler signatures remain unchanged.
//     owner   — non-empty string identifying the architecture module that
//               owns the route handler. Must NOT resolve (after trim, `\`
//               → `/`, strip leading `./`) to the current application
//               owner file — i.e. exactly `app.js` or `server/app.js`.
//               All other module owners are accepted, including other
//               files that happen to be named `app.js` (e.g. under
//               `server/modules/<domain>/app.js`, `src/app.js`,
//               `mod/app.js`). Rejected variants include at least:
//               `app.js`, `./app.js`, `server/app.js`,
//               `./server/app.js`, `server\app.js`, `.\server\app.js`.
//
// Fail-closed on unknown descriptor fields. The route table does NOT
// accept, store, or interpret any descriptor key other than the four
// canonical fields above. In particular, any of the following causes
// registration to fail with
//     RouteTableError{ reason: 'unknown_descriptor_field', field: <key> }
// before any other field-level validation runs:
//
//     permissions
//     permissionPolicy
//     transactionPolicy
//     auditPolicy
//     schema
//     validators
//     requestShape
//     responseShape
//     businessState
//
// This protects against a contributor believing declarative permissions /
// transaction / audit metadata has runtime effect. The route-table does
// not duplicate any existing runtime authority.
//
// Authorization remains at the handler entry (allow / allowAny in
// server/lib/http.js). Transaction boundaries remain at the handler
// (transaction(db, work) from server/db.js). Audit remains at the handler
// (audit(db, ...) from server/lib/audit.js, same-transaction). This
// abstraction does not infer, duplicate, centralize, or declaratively
// mirror those policies.

const VALID_METHODS = Object.freeze(new Set([
  'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',
]));

const CANONICAL_DESCRIPTOR_KEYS = Object.freeze(new Set([
  'method', 'path', 'handler', 'owner',
]));

export class RouteTableError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'RouteTableError';
    if (details && typeof details === 'object') Object.assign(this, details);
  }
}

function normalizeMethod(method) {
  if (typeof method !== 'string') {
    throw new RouteTableError('route method must be a string', { reason: 'invalid_method' });
  }
  const upper = method.toUpperCase();
  if (!VALID_METHODS.has(upper)) {
    throw new RouteTableError(`unsupported HTTP method: ${method}`, { reason: 'invalid_method', method });
  }
  return upper;
}

// Counts consecutive backslashes immediately preceding `index` and
// returns true when that count is even (i.e. the character at `index`
// is NOT escaped in regex source semantics). This is the safe way to
// detect a real `^` or `$` anchor without being fooled by `\^` or `\$`.
function isUnescapedAt(source, index) {
  let i = index - 1;
  let backslashes = 0;
  while (i >= 0 && source[i] === '\\') {
    backslashes++;
    i--;
  }
  return backslashes % 2 === 0;
}

function isAnchoredRegexSource(source) {
  if (source.length < 2) return false;
  // `^` is only special at position 0 in JS RegExp.
  if (source[0] !== '^' || !isUnescapedAt(source, 0)) return false;
  const last = source.length - 1;
  // `\$` is a literal `$`, not the end anchor.
  if (source[last] !== '$' || !isUnescapedAt(source, last)) return false;
  return true;
}

function normalizePath(path) {
  if (typeof path === 'string') {
    if (path.length === 0 || path[0] !== '/') {
      throw new RouteTableError(`route path must start with '/': ${path}`, { reason: 'invalid_path' });
    }
    return { kind: 'exact', key: path, matcher: null };
  }
  if (path instanceof RegExp) {
    // Strict flag policy: only unflagged RegExp accepted. RegExp#exec
    // is stateful under `g` and `y` (mutates `lastIndex`), and the
    // existing handleApi regexes use no flags. Disallowing flags also
    // makes duplicate identity deterministic.
    if (path.flags !== '') {
      throw new RouteTableError(
        `RegExp flags are not supported in route descriptors: ${path.flags}`,
        { reason: 'unsupported_regex_flags', flags: path.flags },
      );
    }
    // Strict anchor policy: source must start with `^` and end with an
    // unescaped `$`. Fail closed; do NOT auto-wrap.
    if (!isAnchoredRegexSource(path.source)) {
      throw new RouteTableError(
        `RegExp must be anchored with both ^ and $: ${path.source}`,
        { reason: 'unanchored_regex', source: path.source },
      );
    }
    // Construct an internal RegExp from the validated source so the
    // route table does NOT retain the caller's mutable RegExp object.
    // The caller can mutate their original without affecting dispatch.
    const matcher = new RegExp(path.source);
    return { kind: 'regex', key: path.source, matcher };
  }
  throw new RouteTableError('route path must be a string or RegExp', { reason: 'invalid_path' });
}

// The architecture invariant: `server/app.js` is the current
// application owner (handleApi). It must not be a domain route owner
// because handleApi is the long-term live dispatcher and Wave 1 does
// not migrate it. Other files named `app.js` (under other directories)
// are legitimate module owners and must remain acceptable.
const FORBIDDEN_OWNERS = Object.freeze(new Set([
  'app.js',
  'server/app.js',
]));

function normalizeOwner(owner) {
  if (typeof owner !== 'string') {
    throw new RouteTableError('route owner must be a non-empty string', { reason: 'invalid_owner' });
  }
  if (owner.length === 0) {
    throw new RouteTableError('route owner must be a non-empty string', { reason: 'invalid_owner' });
  }
  // Build a normalized view used ONLY for the architecture-ownership
  // check. The original owner string is returned as stored metadata.
  let view = owner.trim();
  if (view.length === 0) {
    throw new RouteTableError('route owner must be a non-empty string', { reason: 'invalid_owner' });
  }
  view = view.replace(/\\/g, '/');
  while (view.startsWith('./')) {
    view = view.slice(2);
  }
  if (view === '') {
    throw new RouteTableError('route owner must be a non-empty string', { reason: 'invalid_owner' });
  }
  if (FORBIDDEN_OWNERS.has(view)) {
    throw new RouteTableError(
      "route owner must identify an architecture module, not the current app.js owner",
      { reason: 'owner_is_app_js', normalized: view },
    );
  }
  return owner;
}

function normalizeHandler(handler) {
  if (typeof handler !== 'function') {
    throw new RouteTableError('route handler must be a function', { reason: 'invalid_handler' });
  }
  return handler;
}

function dedupKey(method, pathKey) {
  return `${method}::${pathKey}`;
}

export function createRouteTable() {
  /** @type {Array<{ method: string, path: string, pathKind: 'exact'|'regex', matcher: RegExp|null, handler: Function, owner: string }>} */
  const entries = [];
  const seen = new Set();

  function register(descriptor) {
    if (!descriptor || typeof descriptor !== 'object') {
      throw new RouteTableError('route descriptor must be an object', { reason: 'invalid_descriptor' });
    }
    // Fail closed on unknown descriptor fields FIRST, before any other
    // field-level validation. A contributor who accidentally decorates
    // a descriptor with declarative policy metadata must see the
    // architecture-level mistake immediately rather than discover it
    // after the route is silently registered.
    for (const key of Object.keys(descriptor)) {
      if (!CANONICAL_DESCRIPTOR_KEYS.has(key)) {
        throw new RouteTableError(
          `unknown descriptor field: ${key}`,
          { reason: 'unknown_descriptor_field', field: key },
        );
      }
    }
    const method = normalizeMethod(descriptor.method);
    const path = normalizePath(descriptor.path);
    const handler = normalizeHandler(descriptor.handler);
    const owner = normalizeOwner(descriptor.owner);
    const key = dedupKey(method, path.key);
    if (seen.has(key)) {
      throw new RouteTableError(
        `duplicate route registered: ${method} ${path.key}`,
        { reason: 'duplicate_route', method, pathKey: path.key, owner },
      );
    }
    const entry = Object.freeze({
      method,
      path: path.key,
      pathKind: path.kind,
      matcher: path.matcher,
      handler,
      owner,
    });
    entries.push(entry);
    seen.add(key);
    return entry;
  }

  function match(method, pathname) {
    const upper = typeof method === 'string' ? method.toUpperCase() : '';
    for (const entry of entries) {
      if (entry.method !== upper) continue;
      if (entry.pathKind === 'exact') {
        if (entry.path === pathname) {
          return { handler: entry.handler, owner: entry.owner, params: [] };
        }
        continue;
      }
      // pathKind === 'regex'
      const m = entry.matcher.exec(pathname);
      if (m) {
        return { handler: entry.handler, owner: entry.owner, params: m.slice(1) };
      }
    }
    return null;
  }

  function size() {
    return entries.length;
  }

  function list() {
    return entries.map((entry) => ({
      method: entry.method,
      path: entry.path,
      pathKind: entry.pathKind,
      owner: entry.owner,
    }));
  }

  return Object.freeze({ register, match, size, list });
}
