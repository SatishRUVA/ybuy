import { useRouter } from '@/router';

export function OutOfScopePage() {
  const { navigate } = useRouter();
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center gap-3 py-24 px-4 text-center">
      <h2 className="text-lg font-semibold text-main">Not available in Part 1</h2>
      <p className="text-sm text-sec max-w-sm">
        This feature is out of scope for the current build. Set
        VITE_SHOW_OUT_OF_SCOPE_PAGES=true locally to preview it.
      </p>
      <button
        onClick={() => navigate({ name: 'home' })}
        className="px-5 py-2.5 rounded-card-lg bg-accent text-accent-text font-semibold text-sm hover:opacity-90 transition-opacity"
      >
        Back to home
      </button>
    </div>
  );
}
