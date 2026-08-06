import { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4">
      <div className="grid place-items-center w-12 h-12 rounded-full bg-(--accent-soft) text-(--accent) mb-3">
        <Icon size={22} />
      </div>
      <p className="text-sm font-medium text-(--text)">{title}</p>
      {description && <p className="text-xs text-(--text-faint) mt-1 max-w-sm">{description}</p>}
    </div>
  );
}
