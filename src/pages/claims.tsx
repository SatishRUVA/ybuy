import { useRouter } from '@/router';
import { claims } from '@/data';
import { ArrowLeft, AlertCircle, CheckCircle2, Clock, FileText, Camera, ClipboardCheck, MessageSquare, ChevronRight } from 'lucide-react';

export function ClaimsPage() {
  const { navigate } = useRouter();
  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-main font-display mb-1">Claims center</h1>
        <p className="text-sec text-sm mb-6">Track and manage your rental claims</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <ClaimStat label="Critical" value={claims.filter((c) => c.status === 'critical').length} tone="error" />
          <ClaimStat label="Under review" value={claims.filter((c) => c.status === 'under-review').length} tone="warning" />
          <ClaimStat label="Resolved" value={claims.filter((c) => c.status === 'resolved').length} tone="success" />
          <ClaimStat label="Total" value={claims.length} tone="default" />
        </div>

        <div className="space-y-3">
          {claims.map((claim) => (
            <button key={claim.id} onClick={() => navigate({ name: 'claim-detail', id: claim.id })} className="w-full flex items-center gap-4 p-4 rounded-card-xl bg-card border border-app hover:shadow-card card-hover text-left">
              <div className={`w-12 h-12 rounded-card-lg flex items-center justify-center shrink-0 ${claim.status === 'under-review' ? 'bg-warning-soft' : 'bg-success-soft'}`}>
                {claim.status === 'under-review' ? <AlertCircle size={22} className="text-warning" /> : <CheckCircle2 size={22} className="text-success" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-main">Claim #{claim.id}</p>
                <p className="text-xs text-sec truncate">{claim.listingTitle} — {claim.issue}</p>
                <p className="text-xs text-muted mt-0.5">{claim.date}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-main">${claim.amount}</p>
                <p className={`text-xs ${claim.status === 'under-review' ? 'text-warning' : 'text-success'}`}>
                  {claim.status === 'under-review' ? 'Under review' : 'Resolved'}
                </p>
              </div>
              <ChevronRight size={18} className="text-muted shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ClaimDetailPage({ id }: { id: string }) {
  const { back } = useRouter();
  const claim = claims.find((c) => c.id === id);
  if (!claim) return <div className="p-8 text-center text-sec">Claim not found.</div>;

  const evidence = [
    { icon: Camera, label: 'Pickup photos', present: true },
    { icon: Camera, label: 'Return photos', present: true },
    { icon: ClipboardCheck, label: 'Component checklist', present: true },
    { icon: FileText, label: 'Rental agreement', present: true },
    { icon: MessageSquare, label: 'Messages', present: true },
  ];

  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <button onClick={back} className="flex items-center gap-1.5 text-sm text-sec mb-4 hover:text-main transition-colors">
          <ArrowLeft size={18} /> Back to claims
        </button>

        <div className="p-5 rounded-card-xl bg-card border border-app mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-muted uppercase tracking-wide">Claim #{claim.id}</span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${claim.status === 'under-review' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'}`}>
              {claim.status === 'under-review' ? 'Under Review' : 'Resolved'}
            </span>
          </div>
          <h1 className="text-xl font-bold text-main font-display">{claim.listingTitle}</h1>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-sec">Issue</span><span className="font-medium text-main">{claim.issue}</span></div>
            <div className="flex justify-between"><span className="text-sec">Claim amount</span><span className="font-bold text-main">${claim.amount}</span></div>
            <div className="flex justify-between"><span className="text-sec">Filed</span><span className="font-medium text-main">{claim.date}</span></div>
          </div>
        </div>

        {/* Evidence */}
        <div className="p-5 rounded-card-xl bg-card border border-app mb-4">
          <h3 className="font-semibold text-main mb-3">Evidence</h3>
          <div className="space-y-2">
            {evidence.map((e, i) => {
              const Icon = e.icon;
              return (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-card-lg bg-subtle border border-app">
                  <Icon size={18} className="text-sec" />
                  <span className="text-sm text-main flex-1">{e.label}</span>
                  <CheckCircle2 size={16} className="text-success" />
                </div>
              );
            })}
          </div>
        </div>

        {/* Timeline */}
        <div className="p-5 rounded-card-xl bg-card border border-app">
          <h3 className="font-semibold text-main mb-4">Timeline</h3>
          <div className="space-y-0">
            {claim.timeline.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    step.done ? 'bg-success text-white' : step.current ? 'bg-warning text-white' : 'bg-subtle text-muted border border-app'
                  }`}>
                    {step.done ? <CheckCircle2 size={16} /> : step.current ? <Clock size={16} className="animate-pulse-soft" /> : <span className="text-xs">{i + 1}</span>}
                  </div>
                  {i < claim.timeline.length - 1 && <div className={`w-0.5 h-8 ${step.done ? 'bg-success' : 'bg-border-strong'}`} />}
                </div>
                <div className="pt-1.5 pb-3">
                  <p className={`text-sm font-medium ${step.done ? 'text-main' : step.current ? 'text-warning' : 'text-muted'}`}>
                    {step.step}
                    {step.current && <span className="ml-2 text-xs text-warning">In progress</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ClaimStat({ label, value, tone }: { label: string; value: number; tone: 'error' | 'warning' | 'success' | 'default' }) {
  const toneClass = { error: 'text-error', warning: 'text-warning', success: 'text-success', default: 'text-main' }[tone];
  return (
    <div className="p-4 rounded-card-xl bg-card border border-app text-center">
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
      <p className="text-xs text-sec mt-0.5">{label}</p>
    </div>
  );
}
