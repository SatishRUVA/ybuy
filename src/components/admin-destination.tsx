import { ADMIN_PORTAL_URL } from '@/lib/admin-portal';

export function AdminDestination() {
  return <main className="mx-auto max-w-lg px-6 py-20">
    <h1 className="text-2xl font-bold">Administration has moved</h1>
    <p className="mt-3">Admin and Super Admin now sign in on the dedicated YBuy administrator site.</p>
    <a className="mt-6 inline-flex min-h-11 items-center rounded-card border border-app px-4 font-semibold underline"
      href={ADMIN_PORTAL_URL}>Open YBuy administration</a>
  </main>;
}
