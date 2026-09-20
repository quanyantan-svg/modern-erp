import { Icon } from './icons.jsx';

export function PageHeader({ title, subtitle, action, large = false }) { return <header className={`page-header${large ? ' page-header--large' : ''}`}><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="page-header__action">{action}</div>}</header>; }
export function SectionHeader({ title, subtitle, action }) { return <header className="section-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>; }
export function GroupedList({ title, children, className = '' }) { return <section className={`grouped-section ${className}`}>{title && <h2>{title}</h2>}<div className="grouped-list">{children}</div></section>; }
export function ListRow({ title, subtitle, meta, status, onClick, children }) { const Tag = onClick ? 'button' : 'div'; return <Tag type={onClick ? 'button' : undefined} className="list-row" onClick={onClick}><div className="list-row__content"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}{children}</div><div className="list-row__aside">{status}{meta && <small>{meta}</small>}{onClick && <Icon name="chevron" size={18}/>}</div></Tag>; }
export function FormSection({ title, description, children }) { return <fieldset className="form-section"><legend>{title}</legend>{description && <p>{description}</p>}<div className="form-section__body">{children}</div></fieldset>; }
export function FormRow({ label, hint, error, required, children }) { return <label className={`form-row${error ? ' form-row--error' : ''}`}><span className="field-label">{label}{required && <i aria-hidden="true">*</i>}</span>{children}{error ? <small role="alert">{error}</small> : hint && <small>{hint}</small>}</label>; }
export function TextField(props) { return <input {...props}/>; }
export function TextArea(props) { return <textarea {...props}/>; }
export function SelectField({ children, ...props }) { return <select {...props}>{children}</select>; }
export function DateField(props) { return <input type="date" {...props}/>; }
export function MoneyField(props) { return <input type="number" inputMode="decimal" step="0.01" {...props}/>; }
export function QuantityField(props) { return <input type="number" inputMode="decimal" {...props}/>; }
export function PrimaryButton({ className = '', ...props }) { return <button className={`primary ${className}`} {...props}/>; }
export function SecondaryButton({ className = '', ...props }) { return <button className={`secondary ${className}`} {...props}/>; }
export function TertiaryButton({ className = '', ...props }) { return <button className={`ghost ${className}`} {...props}/>; }
export function DestructiveButton({ className = '', ...props }) { return <button className={`danger-button ${className}`} {...props}/>; }
export function IconButton({ label, icon, className = '', ...props }) { return <button type="button" className={`icon-button ${className}`} aria-label={label} {...props}>{icon}</button>; }
export function SegmentedControl({ options, value, onChange, label = '视图选项' }) { return <div className="segmented-control" role="group" aria-label={label}>{options.map((option) => <button type="button" key={option.value} className={value === option.value ? 'is-selected' : ''} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>; }
export function BottomActionBar({ children }) { return <div className="bottom-action-bar">{children}</div>; }
export function SummaryCard({ label, value, detail }) { return <article className="summary-card"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>; }
