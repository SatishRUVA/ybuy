import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import './account-workspace.css';

export function WorkspaceHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <header className="p1-page-head">
    <div><h1>{title}</h1><p>{description}</p></div>
    {action}
  </header>;
}

export function WorkflowSteps({ labels, current }: { labels: string[]; current: number }) {
  return <ol className="p1-steps" aria-label="Workflow steps">
    {labels.map((label, index) => <li key={label} aria-current={index === current ? 'step' : undefined}>
      <span aria-hidden="true" className={index <= current ? 'done' : ''}>{index < current ? <Check size={15} /> : index + 1}</span>
      {label}
    </li>)}
  </ol>;
}
