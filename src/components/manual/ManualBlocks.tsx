import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Blocos visuais reutilizáveis migrados do Manual Operacional Áurea Investing.
 * Usados na página /manual e disponíveis para o restante do CRM (dicas, alertas, etc).
 */

export function ScriptBlock({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("script-block", className)}>
      {label && <div className="script-block-label">{label}</div>}
      <p className="script-block-text">{children}</p>
    </div>
  );
}

export function ObjectionBlock({ question, children, className }: { question: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("objection-block", className)}>
      <div className="objection-q">
        <HelpCircle className="w-4 h-4 shrink-0" />
        {question}
      </div>
      <p className="objection-a">{children}</p>
    </div>
  );
}

const complianceIcon = {
  danger: ShieldAlert,
  success: CheckCircle2,
  warning: AlertTriangle,
} as const;

export function ComplianceAlert({
  variant,
  children,
  className,
}: {
  variant: "danger" | "success" | "warning";
  children: ReactNode;
  className?: string;
}) {
  const Icon = complianceIcon[variant];
  return (
    <div className={cn("compliance-alert", variant, className)}>
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

export function InfoBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("info-box", className)}>
      <Info className="w-4 h-4 inline-block mr-2 -mt-0.5" />
      {children}
    </div>
  );
}

export function QuoteBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("quote-block", className)}>
      <p className="quote-block-text">{children}</p>
    </div>
  );
}

const brandBadgeVariants = {
  blue: "bg-brandblue/15 text-brandblue-2",
  pink: "bg-brandpink/15 text-brandpink-2",
  green: "bg-success/10 text-success",
  orange: "bg-warning/10 text-warning",
} as const;

export function BrandBadge({
  variant = "blue",
  children,
  className,
}: {
  variant?: keyof typeof brandBadgeVariants;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide",
        brandBadgeVariants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ManualCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("glass-card glass-card-hover p-7", className)}>
      {children}
    </div>
  );
}

export function ManualSection({
  index,
  title,
  subtitle,
  id,
  children,
}: {
  index: string;
  title: string;
  subtitle?: ReactNode;
  id: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 pb-16 mb-16 border-b border-border last:border-b-0 last:mb-0 last:pb-0">
      <div className="text-[11px] font-bold tracking-[3px] uppercase text-brandblue mb-2">{index}</div>
      <h2 className="text-3xl font-extrabold mb-2 tracking-tight">{title}</h2>
      {subtitle && <p className="text-muted-foreground text-sm mb-10 max-w-2xl">{subtitle}</p>}
      {children}
    </section>
  );
}
