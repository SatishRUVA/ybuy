import { useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/shadcn/alert-dialog';
import { useFeatureFlag } from '@/lib/use-feature-flags';

const VPN_CHECK_KEY = 'ybuy-vpn-check:v2';

export function VpnNotice() {
  const { enabled } = useFeatureFlag('vpn_detection');
  const [open, setOpen] = useState(false);
  const requestStarted = useRef(false);

  useEffect(() => {
    if (!enabled || requestStarted.current) return;
    requestStarted.current = true;

    try {
      const previousCheck = sessionStorage.getItem(VPN_CHECK_KEY);
      if (previousCheck === 'clear' || previousCheck === 'dismissed') return;
      if (previousCheck === 'vpn') {
        setOpen(true);
        return;
      }
    } catch {
      // Continue without session storage when browser privacy settings block it.
    }

    void fetch('/api/access/vpn-check')
      .then(async (response) => {
        if (!response.ok) return;
        const result: unknown = await response.json();
        if (typeof result !== 'object' || result === null || !('isVpn' in result) || typeof result.isVpn !== 'boolean') return;

        try {
          sessionStorage.setItem(VPN_CHECK_KEY, result.isVpn ? 'vpn' : 'clear');
        } catch {
          // The in-memory ref still prevents duplicate checks during this mount.
        }
        if (result.isVpn) setOpen(true);
      })
      .catch(() => undefined);
  }, [enabled]);

  return (
    <AlertDialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) {
        try {
          if (sessionStorage.getItem(VPN_CHECK_KEY) === 'vpn') sessionStorage.setItem(VPN_CHECK_KEY, 'dismissed');
        } catch {
          // Keep the dialog usable when browser privacy settings block storage.
        }
      }
    }}>
      <AlertDialogContent className="w-[calc(100%_-_2rem)] max-w-[330px] rounded-card-xl px-5 py-6 text-center sm:px-6">
        <div aria-hidden="true" className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-warning-soft text-warning">
          <ShieldAlert size={30} strokeWidth={1.8} />
        </div>
        <AlertDialogTitle className="text-center text-xl">VPN detected</AlertDialogTitle>
        <AlertDialogDescription className="mt-2 text-center leading-relaxed">
          We detected that you may be using a VPN. VPN use can affect location estimates and access to some services. Please turn off your VPN and try again.
        </AlertDialogDescription>
        <AlertDialogFooter className="mt-5">
          <AlertDialogCancel className="inline-flex min-h-12 w-full items-center justify-center rounded-card bg-accent px-6 py-3 text-[15px] font-semibold leading-snug text-accent-text shadow-xs transition-colors duration-fast ease-out hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            OK
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}