import { useState } from 'react';
import { Contacts, Followups, SalesActivities } from '../pages/crm.jsx';

const CRM_SECTIONS = Object.freeze([
  { key: 'contacts', label: '联系人' },
  { key: 'followups', label: '客户跟进' },
  { key: 'activities', label: '销售活动' },
]);

export default function MobileCrmApplication({ user, notify }) {
  const [section, setSection] = useState('contacts');

  return (
    <div className="mobile-crm-application" data-testid="mobile-crm-application">
      <div className="mobile-crm-application__tabs" role="tablist" aria-label="客户关系">
        {CRM_SECTIONS.map((item) => (
          <button
            type="button"
            role="tab"
            key={item.key}
            aria-selected={section === item.key}
            className={section === item.key ? 'active' : ''}
            onClick={() => setSection(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {section === 'contacts' && <Contacts user={user} notify={notify} />}
      {section === 'followups' && <Followups user={user} notify={notify} />}
      {section === 'activities' && <SalesActivities user={user} notify={notify} />}
    </div>
  );
}
