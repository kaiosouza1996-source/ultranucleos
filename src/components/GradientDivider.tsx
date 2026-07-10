/**
 * Mesmo degradê (fade nas pontas + brilho no meio) do divisor entre o menu e
 * o corpo do CRM (ver AppSidebar.tsx) — usar no lugar de bordas sólidas
 * sempre que precisar de uma linha separando duas áreas da tela.
 */
export function GradientDivider({ vertical = false, className }: { vertical?: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={`shrink-0 ${vertical ? "w-px h-full" : "h-px w-full"} ${className || ""}`}
      style={{
        background: vertical
          ? "linear-gradient(to bottom, transparent 0%, hsl(var(--primary) / 0.05) 12%, hsl(var(--primary) / 0.45) 50%, hsl(var(--primary) / 0.05) 88%, transparent 100%)"
          : "linear-gradient(to right, transparent 0%, hsl(var(--primary) / 0.05) 12%, hsl(var(--primary) / 0.45) 50%, hsl(var(--primary) / 0.05) 88%, transparent 100%)",
      }}
    />
  );
}
