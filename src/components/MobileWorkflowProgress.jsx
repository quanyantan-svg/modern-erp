const STATE_LABELS = {
  completed: '已完成',
  current: '进行中',
  pending: '未开始',
  optional: '可选',
  direct: '直接业务',
};

export default function MobileWorkflowProgress({ stages = [], title = '业务流程', onOpen }) {
  return <section className="mobile-workflow" aria-label={title} data-testid="mobile-workflow-progress">
    <h4>{title}</h4>
    <ol>
      {stages.map((stage, index) => {
        const state = stage.state || 'pending';
        const marker = state === 'completed' ? '✓' : state === 'current' ? '●' : '○';
        const content = <>
          <span className="mobile-workflow__label">{stage.label}</span>
          {stage.documentNo && <span className="mobile-workflow__document mono">{stage.documentNo}</span>}
          {stage.hint && <small>{stage.hint}</small>}
        </>;
        return <li key={stage.key || `${stage.label}-${index}`} className={`mobile-workflow__stage is-${state}`} data-state={state}>
          <span className="mobile-workflow__marker" aria-hidden="true">{marker}</span>
          <div>{stage.href ? <a className="mobile-workflow__link" href={stage.href}>{content}</a> : stage.onOpen ? <button type="button" className="mobile-workflow__link" onClick={() => stage.onOpen(stage)}>{content}</button> : onOpen && stage.documentNo ? <button type="button" className="mobile-workflow__link" onClick={() => onOpen(stage)}>{content}</button> : content}</div>
          <span className="mobile-workflow__state">{stage.stateLabel || STATE_LABELS[state]}</span>
        </li>;
      })}
    </ol>
  </section>;
}
