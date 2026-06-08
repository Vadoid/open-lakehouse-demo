export default function Collapsible({ title, hint, children, defaultOpen = false }:{
  title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex items-center justify-between cursor-pointer list-none select-none">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h2>
        <span className="flex items-center gap-2 text-[10px] text-gray-600">
          {hint}
          <svg className="w-3 h-3 transition-transform group-open:rotate-180" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
        </span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
