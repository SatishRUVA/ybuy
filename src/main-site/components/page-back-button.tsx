import { ArrowLeft } from 'lucide-react';
import { useRouter, type Route } from '@/router';
import { Button } from '@/main-site/components/ui';

export function PageBackButton({ fallback, children }: { fallback: Route; children: string }) {
  const { back } = useRouter();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      icon={<ArrowLeft size={17} aria-hidden="true" />}
      className="mb-4 justify-start"
      onClick={() => back(fallback)}
    >
      {children}
    </Button>
  );
}
