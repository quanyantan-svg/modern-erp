// Platform 附件挂载面板（PL-10）。
//
// 设计来源：docs/design/platform.md §32.6；Requirement §36.6。
//
// 附件是业务单据的**子文档**：它挂在单据详情页里，随单据一起被看见。
//
// 三条硬约束（服务端已强制，前端不得另立一套）：
//   1. 下载必须走**鉴权后的 API**（`GET /api/platform/attachments/:id/content`）——
//      附件目录不在静态服务范围内，不存在可直接访问的直链；
//   2. 类型与扩展名**双重白名单**由服务端判定，前端只做提示、不做放行；
//   3. 附件不承载金额、状态或来源语义 —— 它只是旁挂的文件。
//
// 挂载点（服务端 `ATTACHMENT_OWNER_PERMISSIONS` 登记的 7 类）：会计凭证、销售订单、
// 采购订单、生产订单、生产检验单、采购申请、销售报价。

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, download } from '../api.js';
import { can } from './ui.jsx';
import '../styles/platform-attachments.css';

const TYPE_TONES = {
  'application/pdf': 'danger',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'success',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'info',
};

function toneOf(contentType) {
  return TYPE_TONES[String(contentType || '').toLowerCase()] || '';
}

function sizeOf(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export default function AttachmentPanel({
  ownerType,
  ownerId,
  user,
  notify,
  title = '附件',
  canUpload = null,
  canDelete = null,
}) {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('LOADING');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);

  const uploadAllowed = canUpload === null ? can(user, 'ATTACHMENTS_UPLOAD') : canUpload;
  const deleteAllowed = canDelete === null ? can(user, 'ATTACHMENTS_DELETE') : canDelete;

  const load = useCallback(async () => {
    if (!ownerType || !ownerId) return;
    setState('LOADING');
    try {
      const response = await api(
        `/api/platform/attachments?ownerType=${encodeURIComponent(ownerType)}&ownerId=${encodeURIComponent(ownerId)}`,
      );
      setItems(response.attachments || []);
      setState('READY');
    } catch (error) {
      setState('ERROR');
      notify(error.message, 'error');
    }
  }, [ownerType, ownerId, notify]);

  useEffect(() => { void load(); }, [load]);

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('ownerType', ownerType);
      form.append('ownerId', ownerId);
      form.append('file', file);
      await api('/api/platform/attachments', { method: 'POST', body: form });
      notify('附件已上传', 'success');
      await load();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function openItem(item) {
    try {
      const result = await download(`/api/platform/attachments/${item.id}/content`);
      const objectUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = result.filename || item.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function removeItem(item) {
    setBusy(true);
    try {
      await api(`/api/platform/attachments/${item.id}/delete`, { method: 'POST', body: {} });
      notify('附件已删除', 'success');
      await load();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="attachment-panel" data-testid={`attachment-panel-${ownerType}`}>
      <header className="attachment-panel__head">
        <h3>{title}</h3>
        {uploadAllowed && (
          <>
            <input
              ref={fileInput}
              type="file"
              className="attachment-panel__file"
              data-testid={`attachment-upload-${ownerType}`}
              disabled={busy}
              onChange={(event) => upload(event.target.files?.[0])}
            />
            <span className="attachment-panel__hint">单个附件上限 10 MB；类型与扩展名由服务端双重校验</span>
          </>
        )}
      </header>

      {state === 'LOADING' && <p className="attachment-panel__empty">正在载入附件…</p>}
      {state === 'ERROR' && (
        <p className="attachment-panel__empty">附件载入失败。</p>
      )}
      {state === 'READY' && items.length === 0 && <p className="attachment-panel__empty">该单据暂无附件。</p>}

      {state === 'READY' && items.length > 0 && (
        <ul className="attachment-panel__list">
          {items.map((item) => (
            <li key={item.id} className="attachment-panel__item">
              <div className="attachment-panel__identity">
                <strong>{item.fileName}</strong>
                <span className="attachment-panel__meta">
                  {sizeOf(item.byteSize)} · {item.contentType} · {String(item.createdAt || '').slice(0, 10)}
                </span>
              </div>
              <div className="attachment-panel__actions">
                <button type="button" className="secondary" onClick={() => openItem(item)}>下载</button>
                {deleteAllowed && (
                  <button type="button" className="danger-button" disabled={busy} onClick={() => removeItem(item)}>删除</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
