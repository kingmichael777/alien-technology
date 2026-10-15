import { HeadContent, Link, Outlet, createRootRoute, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { AppShell } from "@/components/at/AppShell";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="max-w-md text-center">
        <div className="mono-label">404</div>
        <h1 className="mt-3 font-serif text-3xl text-ink">No record at this address.</h1>
        <div className="mt-6">
          <Link to="/" className="btn btn-outline">
            Return to the vault
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-2xl text-ink">This screen did not load.</h1>
        <p className="mt-2 text-sm text-ink-muted">Your records are untouched. Try again or return to the vault.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="btn btn-primary"
          >
            Try again
          </button>
          <a href="/" className="btn btn-ghost">
            Vault
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [{ title: "Alien Technology" }],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  // All app data lives in IndexedDB on this device, so the whole app renders in the browser.
  return (
    <>
      <HeadContent />
      <AppShell>
        <Outlet />
      </AppShell>
    </>
  );
}
