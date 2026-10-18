import { HeadContent, Link, Outlet, createRootRoute, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-3xl text-ink">Nothing here.</h1>
        <div className="mt-6">
          <Link to="/" className="btn btn-outline">
            Back to recordings
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
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-2xl text-ink">This screen didn't load.</h1>
        <p className="mt-2 text-sm text-ink-muted">Your recordings are safe. Try again.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              void router.invalidate();
              reset();
            }}
            className="btn btn-primary"
          >
            Try again
          </button>
          <a href="/" className="btn btn-ghost">
            Recordings
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({ meta: [{ title: "Alien Technology" }] }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  return (
    <>
      <HeadContent />
      <AppShell>
        <Outlet />
      </AppShell>
    </>
  );
}
