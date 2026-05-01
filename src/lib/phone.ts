/** Phone validation/normalization for Brazilian / E.164 numbers. */
const DEFAULT_DDI = "55";
const DEFAULT_DDD = "21";

export function normalizePhone(raw: string, ddd?: string): string | null {
  if (!raw && !ddd) return null;
  let n = String(raw || "").replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  if (!n) return null;

  // Se DDD foi fornecido em coluna separada e o número ainda não o contém
  const dddClean = (ddd || "").replace(/\D/g, "");
  if (dddClean && n.length <= 9) {
    n = dddClean + n;
  }

  if (!/^\d{8,15}$/.test(n)) return null;

  // BR sem DDI → adiciona 55
  if (n.length <= 11 && !n.startsWith(DEFAULT_DDI)) {
    if (n.length === 8 || n.length === 9) {
      // sem DDD: usa default
      n = DEFAULT_DDI + DEFAULT_DDD + n;
    } else {
      n = DEFAULT_DDI + n;
    }
  }
  if (n.length < 12 || n.length > 15) return null;
  return n;
}

export function formatPhoneDisplay(n: string): string {
  if (!n) return "";
  // +55 (21) 9 8765-4321
  const m = n.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  if (!m) return "+" + n;
  return `+${m[1]} (${m[2]}) ${m[3]}-${m[4]}`;
}
