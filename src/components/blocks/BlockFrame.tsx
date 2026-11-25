/** Card wrapper every block renders in. */
export function BlockFrame({
  title,
  action,
  children,
  bodyClassName = "",
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="card flex h-full min-h-0 flex-col overflow-hidden">
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
          {title && <h2 className="truncate text-sm font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
