export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl">🎲</div>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">
            Math Trade
          </h1>
          <p className="text-sm text-slate-500">
            Trade board games with multi-party swaps.
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
