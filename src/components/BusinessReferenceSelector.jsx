// 通用业务参照选择器（Requirement §36.22 PL-UX-03；Design §32.22.4、§32.22.5）。
//
// 组件只实现交互协议，不拥有业务可见性：授权、范围与候选集合全部由后端参照
// 端点决定，组件只负责把候选呈现出来，并区分加载、空、无权、错误与只读。
//
// descriptor.search({ q, limit, offset, selectedId, signal })
//   → { items: [{ id, code, name, secondaryText, active }], total }
//
// 组件**不自动选中第一项**，**不接受自由文本 ID**，也不在无权时发出请求。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

const LOADING = 'LOADING';
const READY = 'READY';
const EMPTY = 'EMPTY';
const FORBIDDEN = 'FORBIDDEN';
const ERROR = 'ERROR';

function stateFor(error) {
  if (error?.status === 403) return FORBIDDEN;
  return ERROR;
}

export default function BusinessReferenceSelector({
  descriptor,
  label,
  value,
  onChange,
  optional = false,
  disabled = false,
  multiple = false,
  emptyHint = '没有可选的记录',
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState(LOADING);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState([]);
  const requestId = useRef(0);
  const debounce = useRef(null);

  const scopeKey = descriptor?.key || '';
  const enabled = descriptor?.enabled !== false;
  // 描述符由调用方每次渲染新建，组件只按 scopeKey 判断候选集合是否变化。
  const descriptorRef = useRef(descriptor);
  descriptorRef.current = descriptor;
  const selectedIds = useMemo(() => {
    if (multiple) return Array.isArray(value) ? value : [];
    return value ? [value] : [];
  }, [multiple, value]);

  const runSearch = useCallback(async ({ q, nextOffset, signal }) => {
    const current = requestId.current + 1;
    requestId.current = current;
    setState(LOADING);
    setError('');
    try {
      const result = await descriptorRef.current.search({ q, limit: PAGE_SIZE, offset: nextOffset, selectedId: '', signal });
      if (requestId.current !== current) return;
      setItems(result.items || []);
      setTotal(Number(result.total || 0));
      setOffset(nextOffset);
      setState((result.items || []).length === 0 ? EMPTY : READY);
    } catch (failure) {
      if (requestId.current !== current) return;
      if (failure?.name === 'AbortError') return;
      setItems([]);
      setError(failure?.message || '参照加载失败');
      setState(stateFor(failure));
    }
  }, []);

  // 首屏与筛选条件变化时重新取候选；无权时不发请求。
  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setTotal(0);
      setState(FORBIDDEN);
      return undefined;
    }
    const controller = new AbortController();
    runSearch({ q: '', nextOffset: 0, signal: controller.signal });
    return () => { controller.abort(); requestId.current += 1; };
  }, [enabled, runSearch, scopeKey]);

  // 搜索输入防抖，避免每个按键都打一次后端。
  useEffect(() => {
    if (!enabled) return undefined;
    if (debounce.current) clearTimeout(debounce.current);
    const controller = new AbortController();
    debounce.current = setTimeout(() => {
      runSearch({ q: query, nextOffset: 0, signal: controller.signal });
    }, SEARCH_DEBOUNCE_MS);
    return () => { controller.abort(); requestId.current += 1; if (debounce.current) clearTimeout(debounce.current); };
  }, [query, enabled, runSearch, scopeKey]);

  // 已选中的记录即使不在当前页，也要能显示业务编码与名称。
  useEffect(() => {
    if (!enabled || selectedIds.length === 0) return;
    const known = new Set(items.map((row) => row.id));
    const missing = selectedIds.filter((id) => !known.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(missing.map((selectedId) => descriptorRef.current.search({ q: '', limit: PAGE_SIZE, offset: 0, selectedId, signal: undefined })));
        if (cancelled) return;
        const rows = results.flatMap((result) => result.items || []).filter((row, index, all) => missing.includes(row.id) && all.findIndex((entry) => entry.id === row.id) === index);
        if (rows.length === 0) return;
        setItems((current) => [...rows, ...current]);
        if (multiple) setChosen((current) => [...rows.filter((row) => !current.some((entry) => entry.id === row.id)), ...current]);
      } catch {
        // 水合失败不改变页面状态：当前选中仍以 canonical ID 提交。
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, items, scopeKey, selectedIds]);

  const choose = (row) => {
    if (multiple) {
      const nextIds = selectedIds.includes(row.id)
        ? selectedIds.filter((id) => id !== row.id)
        : [...selectedIds, row.id];
      const known = [...chosen, ...items];
      const nextRows = nextIds.map((id) => known.find((entry) => entry.id === id)).filter(Boolean);
      setChosen(nextRows);
      onChange(nextIds, nextRows);
      return;
    }
    onChange(row.id, row);
  };

  const removeChosen = (id) => {
    const nextIds = selectedIds.filter((selectedId) => selectedId !== id);
    const known = [...chosen, ...items];
    const next = nextIds.map((selectedId) => known.find((entry) => entry.id === selectedId)).filter(Boolean);
    setChosen(next);
    onChange(nextIds, next);
  };

  const selectedLabel = (id) => {
    const row = items.find((entry) => entry.id === id) || chosen.find((entry) => entry.id === id);
    return row ? `${row.code} · ${row.name}` : id;
  };

  const selectedRows = multiple
    ? selectedIds.map((id) => items.find((row) => row.id === id) || chosen.find((row) => row.id === id)).filter(Boolean)
    : selectedIds.map((id) => items.find((row) => row.id === id)).filter(Boolean);

  if (disabled) {
    return <label className="business-reference business-reference--readonly">
      <span>{label}{optional ? '（可选）' : ''}</span>
      <em className="business-reference__value">{selectedIds.length === 0 ? '未选择' : selectedIds.map(selectedLabel).join('、')}</em>
    </label>;
  }

  return <div className="business-reference" data-state={state}>
    <span className="business-reference__label">{label}{optional ? '（可选）' : ''}</span>
    <input
      type="search"
      className="business-reference__search"
      value={query}
      placeholder="输入编码或名称查找"
      aria-label={`${label}搜索`}
      onChange={(event) => setQuery(event.target.value)}
    />
    {multiple && selectedRows.length > 0
      ? <div className="business-reference__chips">
        {selectedRows.map((row) => <span className="business-reference__chip" key={row.id}>
          {row.code} · {row.name}
          <button type="button" aria-label={`移除 ${row.name}`} onClick={() => removeChosen(row.id)}>×</button>
        </span>)}
      </div>
      : <p className="business-reference__current">
        <span>{selectedIds.length === 0 ? (optional ? '未指定' : '尚未选择') : selectedIds.map(selectedLabel).join('、')}</span>
        {optional && selectedIds.length > 0
          ? <button type="button" className="business-reference__retry" onClick={() => onChange('', null)}>清除</button>
          : null}
      </p>}
    {state === LOADING && <p className="business-reference__hint">正在加载可选记录…</p>}
    {state === EMPTY && <p className="business-reference__hint">{emptyHint}</p>}
    {state === FORBIDDEN && <p className="business-reference__hint">当前账号没有查看该类参照的权限。</p>}
    {state === ERROR && <p className="business-reference__hint business-reference__hint--error">
      {error}
      <button type="button" className="business-reference__retry" onClick={() => runSearch({ q: query, nextOffset: 0, signal: undefined })}>重试</button>
    </p>}
    {state === READY && <ul className="business-reference__list">
      {items.map((row) => {
        const active = selectedIds.includes(row.id);
        return <li key={row.id}>
          <button
            type="button"
            className={active ? 'business-reference__option business-reference__option--active' : 'business-reference__option'}
            aria-pressed={active}
            disabled={row.active === false}
            onClick={() => choose(row)}
          >
            <span className="business-reference__code">{row.code}</span>
            <span className="business-reference__name">{row.name}</span>
            {row.secondaryText ? <span className="business-reference__secondary">{row.secondaryText}</span> : null}
            {row.active === false ? <span className="business-reference__secondary">已停用</span> : null}
          </button>
        </li>;
      })}
    </ul>}
    {total > PAGE_SIZE && <div className="business-reference__pager">
      <button type="button" disabled={offset === 0} onClick={() => runSearch({ q: query, nextOffset: Math.max(0, offset - PAGE_SIZE), signal: undefined })}>上一页</button>
      <span>{total === 0 ? '0' : `${Math.min(offset + 1, total)}–${Math.min(offset + items.length, total)}`} / 共 {total} 条</span>
      <button type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => runSearch({ q: query, nextOffset: offset + PAGE_SIZE, signal: undefined })}>下一页</button>
    </div>}
  </div>;
}
