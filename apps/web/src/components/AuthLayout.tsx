export function AuthLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <p className="text-sm font-semibold tracking-wide text-slate-600">Planificador Académico</p>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}
