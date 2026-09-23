import { useRouter } from '@/router';
import { Shield, Lock, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';

export function ProtectionPage() {
  const { back } = useRouter();
  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <button onClick={back} className="flex items-center gap-1.5 text-sm text-sec mb-4 hover:text-main transition-colors">
          <ArrowLeft size={18} /> Back
        </button>

        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-accent-soft flex items-center justify-center mx-auto mb-4">
            <Shield size={36} className="text-accent" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-main font-display">Rental Protection</h1>
          <p className="text-sec text-sm mt-2 max-w-md mx-auto">
            You don't have to trust a stranger. We verify, document, protect, and provide a fair process for every rental.
          </p>
        </div>

        {/* Three pillars */}
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          <div className="p-5 rounded-card-xl bg-card border border-app">
            <Lock size={24} className="text-warning mb-3" />
            <h3 className="font-semibold text-main text-sm mb-1">Security Hold</h3>
            <p className="text-xs text-sec leading-relaxed">
              A refundable authorization on your card. Not a fee. Released after return and inspection.
            </p>
          </div>
          <div className="p-5 rounded-card-xl bg-card border border-app">
            <Shield size={24} className="text-accent mb-3" />
            <h3 className="font-semibold text-main text-sm mb-1">Rental Protection</h3>
            <p className="text-xs text-sec leading-relaxed">
              Covers damage, theft, and missing components during your rental. Subject to terms.
            </p>
          </div>
          <div className="p-5 rounded-card-xl bg-card border border-app">
            <CheckCircle2 size={24} className="text-success mb-3" />
            <h3 className="font-semibold text-main text-sm mb-1">Insurance Coverage</h3>
            <p className="text-xs text-sec leading-relaxed">
              Insurance-backed coverage for high-value items where applicable. Provided by our partners.
            </p>
          </div>
        </div>

        {/* Security hold explanation */}
        <div className="p-5 rounded-card-xl bg-card border border-app mb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-card-lg bg-warning-soft flex items-center justify-center shrink-0">
              <Lock size={20} className="text-warning" />
            </div>
            <div>
              <h3 className="font-semibold text-main">$500 Refundable Security Hold</h3>
              <p className="text-sm text-sec mt-1 leading-relaxed">
                This is separate from protection. It is a temporary authorization on your card, not a charge.
                Released according to the rental agreement after return and inspection.
              </p>
              <div className="mt-3 p-3 rounded-card-lg bg-warning-soft border border-app">
                <p className="text-xs text-sec">
                  <strong className="text-warning">Important:</strong> The security hold is never charged as rental revenue.
                  It exists solely to protect the owner's item and is refunded automatically upon successful return.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* What's covered */}
        <div className="p-5 rounded-card-xl bg-card border border-app mb-4">
          <h3 className="font-semibold text-main mb-3">What's covered by Rental Protection</h3>
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
        </div>

        {/* What's not covered */}
        <div className="p-5 rounded-card-xl bg-card border border-app mb-4">
          <h3 className="font-semibold text-main mb-3">Not covered</h3>
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
        </div>

        {/* Claims process */}
        <div className="p-5 rounded-card-xl bg-card border border-app">
          <h3 className="font-semibold text-main mb-3">If something goes wrong</h3>
          <div className="space-y-3">
            {[
              { step: 1, title: 'Report the issue', desc: 'File a claim from your rental detail page' },
              { step: 2, title: 'Submit evidence', desc: 'Photos, component checklist, and rental agreement' },
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
        </div>
      </div>
    </div>
  );
}
