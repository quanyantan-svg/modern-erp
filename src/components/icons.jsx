export function Icon({ name, size = 20, strokeWidth = 1.8, className = '' }) {
  const paths = {
    message: 'M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z',
    approval: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    cloud: 'M17.5 19H7a5 5 0 0 1-.8-9.94A7 7 0 0 1 19.7 11.5 3.75 3.75 0 0 1 17.5 19Z',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    back: 'm15 18-6-6 6-6', search: 'm21 21-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    close: 'M18 6 6 18M6 6l12 12', more: 'M5 12h.01M12 12h.01M19 12h.01',
    empty: 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9ZM4 7.5l8 4.5 8-4.5M12 12v9',
    error: 'M12 9v4m0 4h.01M10.3 3.7 2.2 18a2 2 0 0 0 1.74 3h16.12a2 2 0 0 0 1.74-3L13.7 3.7a2 2 0 0 0-3.4 0Z',
    check: 'm5 12 4 4L19 6', info: 'M12 8h.01M11 12h1v4h1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    chevron: 'm9 18 6-6-6-6',
  };
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.apps}/></svg>;
}

export const SearchIcon = (props) => <Icon name="search" {...props}/>;
export const CloseIcon = (props) => <Icon name="close" {...props}/>;
export const MoreIcon = (props) => <Icon name="more" {...props}/>;
export const EmptyIcon = (props) => <Icon name="empty" {...props}/>;
export const ErrorIcon = (props) => <Icon name="error" {...props}/>;
