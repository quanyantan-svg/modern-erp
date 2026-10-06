import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, Empty, Toolbar, dateTime } from '../components/ui.jsx';
import { BusinessPageHeader, BusinessPageShell, HelpDisclosure } from '../components/design-system.jsx';

export function Notifications({ notify }) {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = () => {
    api('/api/notifications').then((response) => {
      setItems(response.notifications);
      setUnreadCount(response.unreadCount);
    }).catch((error) => notify(error.message, 'error'));
  };

  useEffect(() => { void load(); }, []);

  async function markAllRead() {
    try {
      await api('/api/notifications/read', { method: 'POST', body: {} });
      notify('已全部标为已读');
      load();
    } catch (error) { notify(error.message, 'error'); }
  }

  const typeMap = { INFO: '信息', WARNING: '警告', SUCCESS: '成功', ERROR: '错误' };
  const typeColors = { INFO: '', WARNING: 'warning', SUCCESS: 'success', ERROR: 'danger' };

  return (
    <BusinessPageShell className="notifications-v15" width="rail">
      <BusinessPageHeader title="通知中心" context={`${unreadCount} 条未读`} help={<HelpDisclosure summary="通知说明"><p>桌面通知中心与移动端“消息”共享同一数据源和已读状态。</p></HelpDisclosure>}/>
      <Toolbar action={<button className="secondary" onClick={markAllRead}>全部标为已读</button>}/>
      <div className="table-wrap">
        <table>
          <thead><tr><th>类型</th><th>标题</th><th>内容</th><th>时间</th><th>状态</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={item.is_read ? 'read-row' : ''}>
                <td><Badge type={typeColors[item.type]}>{typeMap[item.type]}</Badge></td>
                <td><strong>{item.title}</strong></td>
                <td>{item.content}</td>
                <td className="dim">{dateTime(item.created_at)}</td>
                <td>{item.is_read ? <span className="dim">已读</span> : <Badge type="info">新</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无通知"/>}
      </div>
    </BusinessPageShell>
  );
}
