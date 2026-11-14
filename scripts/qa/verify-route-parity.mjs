// Frontend ↔ backend route parity verifier.
//
// Contract: every API path the frontend calls must be dispatched by the
// backend. A screen whose endpoint does not exist renders an error state and
// silently loses a business capability, which no unit test can catch.
//
// Two oracles, because neither alone is sufficient:
//
//   1. LIVE PROBE (authoritative for exact paths). The probe runs against a
//      disposable temporary SQLite database and asks the running server. A
//      request answered with the router's own 404 ("接口不存在") proves the
//      method/path pair is not dispatched; any other status means the route
//      exists and the request was rejected for another reason.
//   2. PATTERN MATCH (authoritative for templated paths). A path built from
//      `${...}` cannot be probed reliably — substituting a placeholder breaks
//      routes whose trailing segment is a literal word (`/approve`). The
//      backend route table and the legacy dispatch branches are therefore
//      scanned into segment patterns and matched against the frontend's
//      normalised path.
//
// Safety: the probe never touches production data — it runs on a throwaway
// database in the OS temp directory, and the script writes nothing into the
// repository and never connects to MySQL.

import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..', '..');
const { createApp } = await import(pathToFileURL(resolve(root, 'server', 'app.js')).href);
const { createDatabase } = await import(pathToFileURL(resolve(root, 'server', 'db.js')).href);
const { createStructuredLogger } = await import(pathToFileURL(resolve(root, 'server', 'lib', 'logger.js')).href);

// The probe intentionally sends invalid bodies; the resulting handler errors
// are expected and must not drown the report.
const silentSink = { log() {}, warn() {}, error() {} };

// --- shared helpers -------------------------------------------------------

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Cuts the query string at the first `?` that is not inside a `${ }`. */
function stripQuery(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') depth -= 1;
    else if (text[i] === '?' && depth === 0) return text.slice(0, i);
  }
  return text;
}

/**
 * Replaces every `${ ... }` (balanced braces) with a single `:param`.
 * A template that builds the query string (it follows a literal `?`, it
 * starts with `?`, it is a ternary whose true branch is a query, or it is a
 * `toString()` of a parameter map) is dropped instead, because it contributes
 * no path segment.
 */
function replaceTemplates(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '$' && text[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}') depth -= 1;
        j += 1;
      }
      const expression = text.slice(i + 2, j - 1);
      const isQuery = text.slice(0, i).endsWith('?')
        || /^\s*\?/.test(expression)
        || /\?\s*`/.test(expression)
        || /toString\(\)/.test(expression);
      out += isQuery ? '' : ':param';
      i = j - 1;
      continue;
    }
    out += text[i];
  }
  return out;
}

/**
 * Splits a concatenated path expression into its literal parts, replacing every
 * dynamic part with `:param`: `'/api/x/' + id + '/confirm'` → `/api/x/:param/confirm`.
 */
function concatenationPath(argument) {
  const parts = [];
  let current = '';
  let quote = null;
  let depth = 0;
  for (let i = 0; i < argument.length; i += 1) {
    const ch = argument[i];
    if (quote) {
      current += ch;
      if (ch === '\\') { current += argument[i + 1] ?? ''; i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; current += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === '+' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  if (parts.length < 2) return null;
  return parts.map((part) => {
    const trimmed = part.trim();
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
      return trimmed.slice(1, -1);
    }
    return ':param';
  }).join('');
}

/** Splits a regex source into path segments; `\/` is a separator, `[^/]` is not. */
function regexSegments(source) {
  const segments = [];
  let current = '';
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[i + 1];
      // `\/` is a path separator — but only outside a character class, where
      // `[^/]` must stay inside its segment.
      if (next === '/' && !inClass) { segments.push(current); current = ''; i += 1; continue; }
      current += ch + next;
      i += 1;
      continue;
    }
    if (ch === '[') inClass = true;
    if (ch === ']') inClass = false;
    if (ch === '/' && !inClass) { segments.push(current); current = ''; continue; }
    current += ch;
  }
  segments.push(current);
  return segments.map((segment) => {
    if (segment.includes('(')) return { wildcard: true };
    const literal = segment.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/').replace(/\\\./g, '.');
    return { wildcard: false, literal };
  }).filter((segment) => segment.literal !== '' || segment.wildcard);
}

function literalSegments(path) {
  return path.split('/').filter(Boolean).map((segment) => (
    // A segment that contains a dynamic part matches any backend segment.
    segment.includes(':param') ? { wildcard: true } : { wildcard: false, literal: segment }
  ));
}

/** Turns a template path such as `/api/planning/reports/${report}` into a pattern. */
function templatePath(content) {
  const index = content.indexOf('${');
  if (index < 0) return content;
  return `${content.slice(0, index)}:param`;
}

function segmentsMatch(frontend, backend) {
  if (frontend.length !== backend.length) return false;
  return frontend.every((segment, index) => {
    const other = backend[index];
    if (segment.wildcard || other.wildcard) return true;
    return segment.literal === other.literal;
  });
}

// --- 1. frontend inventory -------------------------------------------------

function balancedArgs(text, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') { depth -= 1; if (depth === 0) return text.slice(openIndex + 1, i); }
  }
  return null;
}

/** Returns the first argument of a call, up to the first top-level comma. */
function firstArgument(inner) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) return inner.slice(0, i);
  }
  return inner;
}

const callSites = [];
for (const file of walk(resolve(root, 'src'))) {
  if (!/\.(js|jsx)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  const re = /\b(api|download|fetch)\s*\(/g;
  let match;
  while ((match = re.exec(text))) {
    const inner = balancedArgs(text, match.index + match[0].length - 1);
    if (inner === null) continue;
    const argument = firstArgument(inner).trim();
    let raw = null;
    if (argument.startsWith('`')) raw = argument.slice(1, argument.indexOf('`', 1));
    else if (argument.startsWith("'") || argument.startsWith('"')) raw = argument.slice(1, argument.indexOf(argument[0], 1));
    if (!raw || !raw.startsWith('/api')) continue;
    // `api('/api/thing/' + id + '/confirm')` — every dynamic part becomes a
    // parameter segment.
    const joined = concatenationPath(argument);
    const concatenated = joined !== null;
    if (concatenated) raw = joined;
    const methodMatch = inner.match(/method:\s*['"](\w+)['"]/);
    const withoutQuery = stripQuery(raw);
    const templated = withoutQuery.includes('${') || concatenated;
    callSites.push({
      file: relative(root, file).replaceAll('\\', '/'),
      line: text.slice(0, match.index).split('\n').length,
      method: methodMatch ? methodMatch[1].toUpperCase() : 'GET',
      raw,
      templated,
      segments: literalSegments(replaceTemplates(withoutQuery)),
    });
  }
}

// --- 2. backend route inventory (static) ----------------------------------

/** Reads a regex literal starting at `text[start] === '/'`, class-aware. */
function readRegexLiteral(text, start) {
  let inClass = false;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) return text.slice(start + 1, i);
  }
  return null;
}

const backendRoutes = [];
for (const file of walk(resolve(root, 'server'))) {
  if (!file.endsWith('.js') || file.endsWith('.test.js')) continue;
  const text = readFileSync(file, 'utf8');

  // ownedRouteTable.register({ ... }) — the descriptor may span many lines.
  for (const block of text.matchAll(/ownedRouteTable\.register\(\{([\s\S]*?)\}\);/g)) {
    const body = block[1];
    const method = body.match(/method:\s*['"]([A-Z]+)['"]/)?.[1] || 'ANY';
    const pathIndex = body.indexOf('path:');
    if (pathIndex < 0) continue;
    const rest = body.slice(pathIndex + 5).trimStart();
    if (rest.startsWith("'") || rest.startsWith('"')) {
      const end = rest.indexOf(rest[0], 1);
      backendRoutes.push({ method, segments: literalSegments(rest.slice(1, end)) });
    } else if (rest.startsWith('`')) {
      const end = rest.indexOf('`', 1);
      backendRoutes.push({ method, segments: literalSegments(templatePath(rest.slice(1, end))) });
    } else if (rest.startsWith('/')) {
      const source = readRegexLiteral(rest, 0);
      if (source) backendRoutes.push({ method, segments: regexSegments(source) });
    }
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    // Literal paths spell "/api/", regex paths spell "\/api\/".
    if (!line.includes('/api/') && !line.includes('\\/api\\/')) continue;
    // Route-table descriptors are handled above.
    if (line.includes('ownedRouteTable.register')) continue;

    // Tuple route tables: ['GET', '/api/x', handler] / ['POST', /regex/, handler]
    const tuple = line.match(/^\[\s*'([A-Z]+)'\s*,\s*/);
    if (tuple) {
      const rest = line.slice(tuple[0].length);
      if (rest.startsWith("'") || rest.startsWith('"')) {
        const end = rest.indexOf(rest[0], 1);
        backendRoutes.push({ method: tuple[1], segments: literalSegments(rest.slice(1, end)) });
      } else if (rest.startsWith('/')) {
        const source = readRegexLiteral(rest, 0);
        if (source) backendRoutes.push({ method: tuple[1], segments: regexSegments(source) });
      } else if (rest.startsWith('`')) {
        const end = rest.indexOf('`', 1);
        backendRoutes.push({ method: tuple[1], segments: literalSegments(templatePath(rest.slice(1, end))) });
      }
      continue;
    }

    const methods = new Set();
    for (const method of line.matchAll(/req\.method\s*===\s*['"]([A-Z]+)['"]/g)) methods.add(method[1]);
    for (const list of line.matchAll(/\[[^\]]*\]\.includes\(req\.method\)/g)) {
      for (const quoted of list[0].matchAll(/['"]([A-Z]+)['"]/g)) methods.add(quoted[1]);
    }
    const methodList = methods.size ? [...methods] : ['ANY'];

    const push = (method, segments, prefix = false) => backendRoutes.push({ method, segments, prefix });

    // legacy: path === '/api/x'
    const literal = line.match(/(?:^|[^\w.])(?:path|pathname)\s*===\s*(['"])(\/api\/[^'"]*)\1/);
    if (literal) {
      for (const method of methodList) push(method, literalSegments(literal[2]));
      continue;
    }

    // legacy: path.match(/^\/api\/.../)
    const matchIndex = line.search(/(?:path|pathname)\.match\(/);
    if (matchIndex >= 0) {
      const rest = line.slice(matchIndex);
      const regexStart = rest.indexOf('/');
      if (regexStart >= 0) {
        const source = readRegexLiteral(rest, regexStart);
        if (source) for (const method of methodList) push(method, regexSegments(source));
      }
      continue;
    }

    // legacy: path.startsWith('/api/')
    const prefix = line.match(/(?:path|pathname)\.startsWith\((['"])(\/api\/[^'"]*)\1\)/);
    if (prefix) {
      for (const method of methodList) push(method, literalSegments(prefix[2]), true);
    }
  }
}

function backendDispatches(entry) {
  return backendRoutes.some((route) => {
    if (route.method !== 'ANY' && route.method !== entry.method) return false;
    if (route.prefix) {
      const prefixSegments = route.segments.map((segment) => segment.literal);
      const target = entry.segments.map((segment) => (segment.wildcard ? null : segment.literal));
      return target.every((segment, index) => segment === null || segment === prefixSegments[index]);
    }
    return segmentsMatch(entry.segments, route.segments);
  });
}

// --- 3. live probe (authoritative for exact paths) -------------------------

const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-route-parity-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { logger: createStructuredLogger({ sink: silentSink }) }));
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!payload.token) throw new Error(`登录失败: ${JSON.stringify(payload).slice(0, 200)}`);
  return payload.token;
}

let token = await login();
const ROUTER_NOT_FOUND = '接口不存在';

async function send(method, concrete) {
  return fetch(`${baseUrl}${concrete}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
  });
}

// Authentication is resolved before routing, so an expired session makes EVERY
// path answer 401 and hides the router's own 404. The probe set contains
// `POST /api/auth/logout`, which invalidates the session it runs with, so a
// 401 must trigger a fresh login and a retry instead of being accepted.
async function request(method, concrete) {
  let response = await send(method, concrete);
  if (response.status === 401) {
    token = await login();
    response = await send(method, concrete);
  }
  return response;
}

async function probe(method, path) {
  const response = await request(method, path);
  if (response.status === 401) return { dispatched: false, status: 401 };
  const payload = await response.json().catch(() => ({}));
  return { dispatched: payload.message !== ROUTER_NOT_FOUND, status: response.status };
}

// --- 4. verdict ------------------------------------------------------------

const unique = new Map();
for (const call of callSites) {
  const key = `${call.method} ${call.raw.split('?')[0]}`;
  if (!unique.has(key)) unique.set(key, { method: call.method, templated: call.templated, segments: call.segments, raw: call.raw, sites: [] });
  unique.get(key).sites.push(call);
}

const unmatched = [];
for (const [key, entry] of unique) {
  let dispatched;
  if (entry.templated) {
    // A templated path cannot be probed reliably; the static route patterns
    // decide.
    dispatched = backendDispatches(entry);
  } else {
    const result = await probe(entry.method, entry.raw.split('?')[0]);
    dispatched = result.dispatched;
    if (!dispatched && backendDispatches(entry)) {
      // The live server is authoritative; the static scan is only a fallback.
      dispatched = false;
    }
  }
  if (!dispatched) unmatched.push({ key, ...entry });
}

await new Promise((done) => server.close(done));
db.close();
rmSync(tempDir, { recursive: true, force: true });

// --- 5. report -------------------------------------------------------------

console.log(`前端 API 调用点 ${callSites.length} 处，去重后 method+path ${unique.size} 个`);
console.log(`后端路由模式 ${backendRoutes.length} 条（表注册 + 旧分支）`);
if (unmatched.length) {
  console.log(`未匹配后端路由 ${unmatched.length} 个：`);
  for (const entry of unmatched) {
    const sites = entry.sites.map((site) => `${site.file}:${site.line}`).join(', ');
    console.log(`  ${entry.key}  ← ${sites}`);
  }
} else {
  console.log('未匹配后端路由 0 个');
}
process.exitCode = unmatched.length ? 1 : 0;
