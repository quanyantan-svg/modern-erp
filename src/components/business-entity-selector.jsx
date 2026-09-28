// V1.4-E5 C02 — single-select business-object selector used as the
// filter UI for the five canonical decision reports. Backed by the
// bounded /api/lookups/business-entities endpoint; never displays or
// accepts internal UUIDs as user input.
//
// Contract:
//   * entityType: 'CUSTOMER' | 'SUPPLIER' | 'PRODUCT' | 'WAREHOUSE'
//   * usage: 'REPORT_SALES' | 'REPORT_PURCHASE' | 'REPORT_INVENTORY'
//   * value: canonical internal id, or '' to clear
//   * onChange(nextValue, entity | null)
//   * label, placeholder, required, disabled, name
//   * testId: propagated for query selectors in tests
//   * initialEntity (optional): { id, code, name, active } used to seed
//     the selected chip before the user has opened the popover. Useful
//     when the selector is hydrated from a deep link / URL state.
//
// Display contract:
//   * chip = `code · name` for active rows; append `（已停用）` when inactive.
//   * No-result state shows "未找到匹配的业务对象" + clear filter.
//   * Selected value never transmits empty string or stale text — the
//     consumer receives the canonical id only after a successful select.

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';

const DEFAULT_LIMIT = 50;

function normalizeEntityType(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!['CUSTOMER', 'SUPPLIER', 'PRODUCT', 'WAREHOUSE'].includes(text)) {
    throw new Error('BusinessEntitySelector: entityType 必须是 CUSTOMER / SUPPLIER / PRODUCT / WAREHOUSE');
  }
  return text;
}

function normalizeUsage(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!['REPORT_SALES', 'REPORT_PURCHASE', 'REPORT_INVENTORY'].includes(text)) {
    throw new Error('BusinessEntitySelector: usage 必须是 REPORT_SALES / REPORT_PURCHASE / REPORT_INVENTORY');
  }
  return text;
}

function makeLabel(item) {
  if (!item) return '';
  return item.active ? `${item.code} · ${item.name}` : `${item.code} · ${item.name}（已停用）`;
}

function safeClose(event, isOpen, onClose) {
  if (!isOpen) return;
  if (event.type === 'keydown' && event.key !== 'Escape') return;
  onClose();
}

export function BusinessEntitySelector({
  entityType,
  usage,
  value,
  onChange,
  label,
  placeholder = '搜索编码或名称',
  required = false,
  disabled = false,
  name,
  testId,
  initialEntity = null,
  inputId,
}) {
  const type = useMemo(() => normalizeEntityType(entityType), [entityType]);
  const use = useMemo(() => normalizeUsage(usage), [usage]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedEntity, setSelectedEntity] = useState(() => {
    if (!initialEntity || !initialEntity.id) return null;
    if (initialEntity.id !== value) return null;
    return {
      id: initialEntity.id,
      code: initialEntity.code,
      name: initialEntity.name,
      active: initialEntity.active ? 1 : 0,
      label: makeLabel(initialEntity),
    };
  });
  const requestIdRef = useRef(0);
  const containerRef = useRef(null);

  // Re-hydrate the displayed chip whenever the upstream `value` changes
  // (e.g. URL deep-link, reset, navigation). Clears the chip when the
  // value is empty.
  useEffect(() => {
    if (!value) {
      setSelectedEntity(null);
      return;
    }
    if (selectedEntity && selectedEntity.id === value) return;
    // Trigger historical hydration via lookup with selectedId.
    let cancelled = false;
    const params = new URLSearchParams();
    params.set('type', type);
    params.set('usage', use);
    params.set('limit', '1');
    params.set('selectedId', value);
    const reqId = ++requestIdRef.current;
    setLoading(true);
    api('/api/lookups/business-entities?' + params.toString())
      .then((data) => {
        if (cancelled || reqId !== requestIdRef.current) return;
        const found = (data.items || []).find((row) => row.id === value);
        if (found) {
          setSelectedEntity({
            id: found.id, code: found.code, name: found.name,
            active: found.active ? 1 : 0, label: found.label,
          });
        } else {
          setSelectedEntity(null);
        }
      })
      .catch(() => {
        if (cancelled || reqId !== requestIdRef.current) return;
        setSelectedEntity(null);
      })
      .finally(() => {
        if (cancelled || reqId !== requestIdRef.current) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, type, use]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set('type', type);
    params.set('usage', use);
    params.set('limit', String(DEFAULT_LIMIT));
    if (query) params.set('q', query);
    if (value) params.set('selectedId', value);
    api('/api/lookups/business-entities?' + params.toString())
      .then((data) => {
        if (cancelled || reqId !== requestIdRef.current) return;
        setResults(data.items || []);
        setHasMore(Boolean(data.hasMore));
        setActiveIndex(0);
      })
      .catch((err) => {
        if (cancelled || reqId !== requestIdRef.current) return;
        setError(err && err.message ? err.message : '查询失败');
        setResults([]);
        setHasMore(false);
      })
      .finally(() => {
        if (cancelled || reqId !== requestIdRef.current) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, query, type, use, value]);

  // Click-outside / Escape close.
  useEffect(() => {
    function handle(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handle);
      document.addEventListener('keydown', handle);
      return () => {
        document.removeEventListener('mousedown', handle);
        document.removeEventListener('keydown', handle);
      };
    }
    return undefined;
  }, [open]);

  function handleSelect(item) {
    setSelectedEntity({
      id: item.id, code: item.code, name: item.name,
      active: item.active ? 1 : 0, label: item.label,
    });
    setOpen(false);
    setQuery('');
    onChange(item.id, item);
  }

  function handleClear(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setSelectedEntity(null);
    setQuery('');
    setOpen(false);
    onChange('', null);
  }

  function handleKeyDown(event) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(results.length - 1, index + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Enter') {
      const pick = results[activeIndex];
      if (pick) {
        event.preventDefault();
        handleSelect(pick);
      }
    }
  }

  const chip = selectedEntity ? (
    <span className="business-entity-selector__chip" data-testid={`${testId || 'business-entity-selector'}-chip`}>
      <span className="business-entity-selector__chip-label">{selectedEntity.label}</span>
    </span>
  ) : (
    <span className="business-entity-selector__placeholder">{placeholder}</span>
  );

  return (
    <div
      className={'business-entity-selector' + (open ? ' business-entity-selector--open' : '') + (disabled ? ' business-entity-selector--disabled' : '')}
      ref={containerRef}
      data-testid={testId || 'business-entity-selector'}
      data-entity-type={type}
      onKeyDown={handleKeyDown}
    >
      {label && (
        <label className="business-entity-selector__label" htmlFor={inputId}>
          {label}{required && <span aria-hidden="true">*</span>}
        </label>
      )}
      <div className="business-entity-selector__control">
        <button
          type="button"
          id={inputId}
          className="business-entity-selector__trigger"
          onClick={() => { if (!disabled) setOpen((current) => !current); }}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${testId || 'business-entity-selector'}-panel`}
          disabled={disabled}
          name={name}
        >
          {chip}
        </button>
        {selectedEntity && !disabled && (
          <button
            type="button"
            aria-label="清除选择"
            className="business-entity-selector__chip-clear"
            onClick={handleClear}
            data-testid={`${testId || 'business-entity-selector'}-clear`}
          >×</button>
        )}
      </div>
      {open && (
        <div id={`${testId || 'business-entity-selector'}-panel`} className="business-entity-selector__panel" data-testid={`${testId || 'business-entity-selector'}-panel`}>
          <div className="business-entity-selector__panel-header">
            <strong>{label || '选择业务对象'}</strong>
            <button type="button" className="business-entity-selector__panel-close" aria-label="关闭选择面板" onClick={() => setOpen(false)}>×</button>
          </div>
          <input
            type="text"
            className="business-entity-selector__search"
            placeholder={placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            data-testid={`${testId || 'business-entity-selector'}-search`}
          />
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="business-entity-selector__inline-clear"
              data-testid={`${testId || 'business-entity-selector'}-panel-clear`}
            >清除当前选择</button>
          )}
          <div className="business-entity-selector__results" role="listbox" data-testid={`${testId || 'business-entity-selector'}-results`}>
            {loading && <div className="business-entity-selector__status" data-testid={`${testId || 'business-entity-selector'}-loading`}>加载中...</div>}
            {error && !loading && (
              <div className="business-entity-selector__status business-entity-selector__status--error" data-testid={`${testId || 'business-entity-selector'}-error`}>
                {error}
                <button type="button" onClick={handleClear} className="business-entity-selector__inline-clear">清除选择</button>
              </div>
            )}
            {!loading && !error && !results.length && (
              <div className="business-entity-selector__status" data-testid={`${testId || 'business-entity-selector'}-empty`}>
                {query ? '未找到匹配的业务对象' : '没有可选业务对象'}
                {value && <button type="button" onClick={handleClear} className="business-entity-selector__inline-clear">清除选择</button>}
              </div>
            )}
            {!loading && !error && results.map((item, index) => (
              <button
                type="button"
                key={item.id}
                role="option"
                aria-selected={index === activeIndex}
                className={
                  'business-entity-selector__option'
                  + (index === activeIndex ? ' business-entity-selector__option--active' : '')
                  + (item.active ? '' : ' business-entity-selector__option--inactive')
                }
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setActiveIndex(index)}
                data-testid={`${testId || 'business-entity-selector'}-option-${item.id}`}
              >
                <span className="business-entity-selector__option-label">{item.label}</span>
                {!item.active && <span className="business-entity-selector__option-flag">历史停用</span>}
              </button>
            ))}
            {!loading && hasMore && (
              <div className="business-entity-selector__status" data-testid={`${testId || 'business-entity-selector'}-more`}>
                还有更多匹配项，请细化搜索条件
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const __BusinessEntitySelectorInternals = {
  makeLabel,
  safeClose,
};
