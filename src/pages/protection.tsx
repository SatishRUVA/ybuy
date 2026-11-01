import { useRouter } from '@/router';
import { Shield, Lock, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { WorkspaceHeader } from '@/components/account-workspace';

export function ProtectionPage() {
  const { back } = useRouter();
  return (
    <div className="p1-container p1-page p1-account">
      <div>
        <button onClick={back} className="p1-back">
          <ArrowLeft size={18} /> Back
        </button>

        <WorkspaceHeader title="A little clarity. A better rental." description="Understand deposits, protection terms and the real process for reporting an issue before you book." />

        {/* Three pillars */}
        <div className="p1-owner-metrics account-protection-pillars">
          <div>
            <Lock size={24} className="text-warning mb-3" />
            <h3 className="font-semibold text-main text-sm mb-1">Security Deposit</h3>
            <p className="text-xs text-sec leading-relaxed">
              A refundable charge at checkout, not a rental fee. Refunded after owner-confirmed return when no unresolved dispute exists.
            </p>
          </div>
          <div className="p1-metric-accent">
            <Shield size={24} className="text-accent mb-3" />
            <h3 className="font-semibold text-main text-sm mb-1">Rental Protection</h3>
            <p className="text-xs text-sec leading-relaxed">
              Protection eligibility and any applicable coverage depend on the listing, checkout and policy terms. Eligibility is not an insurance guarantee.
            </p>
          </div>
          <div>
            <CheckCircle2 size={24} className="text-success mb-3" />
            <h3 className="font-semibold text-main text-sm mb-1">Insurance fee</h3>
            <p className="text-xs text-sec leading-relaxed">
              When enabled, checkout charges 1% of the owner-declared item value per rental day and item.
            </p>
          </div>
        </div>

        {/* Security hold explanation */}
        <section className="p1-panel account-panel p1-space-bottom">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-card-lg bg-warning-soft flex items-center justify-center shrink-0">
              <Lock size={20} className="text-warning" />
            </div>
            <div>
              <h3 className="font-semibold text-main">Refundable Security Deposit</h3>
              <p className="text-sm text-sec mt-1 leading-relaxed">
                This is separate from protection. The amount shown on the listing is charged at checkout.
                It is eligible for refund after the owner confirms return when no unresolved dispute exists.
              </p>
              <div className="mt-3 p-3 rounded-card-lg bg-warning-soft border border-app">
                <p className="text-xs text-sec">
                  <strong className="text-warning">Important:</strong> The security deposit is not owner rental revenue.
                  Check your rental for the verified refund status; unresolved disputes require review.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* What's covered */}
        <section className="p1-panel account-panel p1-space-bottom">
          <h3 className="font-semibold text-main mb-3">Issues to check against your protection terms</h3>
          <p className="p1-muted">These are examples, not a coverage promise. Check the applicable policy and report the facts through a claim.</p>
          <div className="space-y-2">
            {[
              'Accidental damage during the rental period',
              'Theft of the item during active rental',
              'Missing components at return inspection',
              'Loss from verified pickup to confirmed return',
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <CheckCircle2 size={16} className="text-success shrink-0" />
                <span className="text-sec">{item}</span>
              </div>
            ))}
          </div>
        </section>

        {/* What's not covered */}
        <section className="p1-panel account-panel p1-space-bottom">
          <h3 className="font-semibold text-main mb-3">Common exclusions to review</h3>
          <div className="space-y-2">
            {[
              'Normal wear and tear from intended use',
              'Damage from misuse or negligence',
              'Items rented outside the platform',
              'Issues reported after return inspection',
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <AlertCircle size={16} className="text-muted shrink-0" />
                <span className="text-sec">{item}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Claims process */}
        <section className="p1-panel account-panel">
          <h3 className="font-semibold text-main mb-3">If something goes wrong</h3>
          <div className="space-y-3">
            {[
              { step: 1, title: 'Report the issue', desc: 'File a claim from your rental detail page' },
              { step: 2, title: 'Submit evidence', desc: 'Attach relevant files to the claim. Pickup and return checklist answers are not saved as evidence.' },
              { step: 3, title: 'Both parties respond', desc: 'Owner and renter provide their side' },
              { step: 4, title: 'We review and resolve', desc: 'Fair resolution based on evidence and terms' },
            ].map((s) => (
              <div key={s.step} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-accent-soft flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-accent">{s.step}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-main">{s.title}</p>
                  <p className="text-xs text-sec">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
