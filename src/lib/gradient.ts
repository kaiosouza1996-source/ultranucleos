/**
 * Gradiente de marca da Áurea Investing — fonte única de verdade.
 *
 * Três cores fixas, stops simétricos (um terço cada): azul → roxo → rosa.
 * Mantenha estes valores em sincronia com as CSS custom properties
 * --aurea-gradient-blue / --aurea-gradient-purple / --aurea-gradient-pink
 * em src/index.css (CSS e TS não compartilham valores automaticamente).
 */
export const AUREA_BLUE: [number, number, number] = [74, 142, 255]; // #4A8EFF
export const AUREA_PURPLE: [number, number, number] = [200, 75, 255]; // #C84BFF
export const AUREA_PINK: [number, number, number] = [255, 75, 158]; // #FF4B9E

const STOPS: { t: number; rgb: [number, number, number] }[] = [
  { t: 0, rgb: AUREA_BLUE },
  { t: 0.5, rgb: AUREA_PURPLE },
  { t: 1, rgb: AUREA_PINK },
];

/** Gradiente completo (azul→roxo→rosa, stops 0/50/100%) — uso em elementos ISOLADOS (uma única linha/sublinhado/divisor/card, não uma fileira). */
export const AUREA_GRADIENT_CSS = "linear-gradient(90deg, #4A8EFF 0%, #C84BFF 50%, #FF4B9E 100%)";

function lerp(a: number, b: number, u: number): number {
  return Math.round(a + (b - a) * u);
}

function rgbToCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** Amostra a cor do gradiente de marca na posição t (0–1), interpolando entre os stops mais próximos. */
export function sampleAureaGradient(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i];
    const b = STOPS[i + 1];
    if (clamped >= a.t && clamped <= b.t) {
      const u = (clamped - a.t) / (b.t - a.t || 1);
      return [
        lerp(a.rgb[0], b.rgb[0], u),
        lerp(a.rgb[1], b.rgb[1], u),
        lerp(a.rgb[2], b.rgb[2], u),
      ];
    }
  }
  return STOPS[STOPS.length - 1].rgb;
}

/**
 * Fatia do gradiente de marca correspondente ao elemento `index` de `total`
 * numa fileira de elementos repetidos (ex: cards de KPI lado a lado).
 *
 * Trata a fileira inteira como UMA ÚNICA linha de gradiente contínua: cada
 * elemento mostra apenas o trecho de t = index/total até t = (index+1)/total.
 * A borda de um elemento sempre bate exatamente com a borda do próximo
 * (mesmo valor de t), garantindo continuidade visual mesmo com espaçamento
 * entre os cards.
 *
 * Com total <= 1, retorna o gradiente completo (equivalente a um elemento
 * isolado — ver AUREA_GRADIENT_CSS).
 */
export function getGradientSlice(index: number, total: number): string {
  if (!Number.isFinite(total) || total <= 1) return AUREA_GRADIENT_CSS;
  const n = Math.max(1, Math.floor(total));
  const i = Math.min(Math.max(0, Math.floor(index)), n - 1);
  const t0 = i / n;
  const t1 = (i + 1) / n;
  const tMid = (t0 + t1) / 2;
  const c0 = rgbToCss(sampleAureaGradient(t0));
  const cMid = rgbToCss(sampleAureaGradient(tMid));
  const c1 = rgbToCss(sampleAureaGradient(t1));
  return `linear-gradient(90deg, ${c0} 0%, ${cMid} 50%, ${c1} 100%)`;
}

/** CSS custom property `--accent-gradient` pronta para spread num style inline, ex: style={{ ...gradientSliceStyle(i, n) }} */
export function gradientSliceStyle(index: number, total: number): Record<string, string> {
  return { "--accent-gradient": getGradientSlice(index, total) };
}
