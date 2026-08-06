export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between mb-3 gap-2">
          <div>
            {title && <h3 className="text-sm font-semibold text-(--text)">{title}</h3>}
            {subtitle && <p className="text-xs text-(--text-faint) mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
