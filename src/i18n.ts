// i18n — Czech / English translations for all user-visible strings.
// Usage:
//   import { t, setLang, getLang, type Lang } from './i18n';
//   t('widgetBurden')                     // static → "Zatížení" or "Burden"
//   t('ppStep2Head', 2015)                // dynamic → "2. Zatížení v roce 2015"

export type Lang = 'cs' | 'en';

// Active language — updated by setLang(), read by t().
let currentLang: Lang = 'cs';

export function getLang(): Lang  { return currentLang; }
export function setLang(l: Lang) { currentLang = l; }

// ─── Translation maps ─────────────────────────────────────────────────────────

const T = {
  cs: {
    // ── Debug overlay ──────────────────────────────────────────────────────────
    dbgTitle:           'Ladič cen',
    dbgBadge:           'debug',
    dbgClose:           'Zavřít',
    dbgScanning:        'Prohledávám…',
    dbgNoPricesFound:   '0 nalezených cen',
    dbgNoPricesOnPage:  'Na této stránce nebyly nalezeny žádné ceny.',
    dbgZeroPrices:      '0 cen',
    dbgFooterWithLoc:   (n: number, region: string, source: string) =>
                          `${n} cen · ${region} [${source}]`,
    dbgFooterNoLoc:     (n: number) => `${n} cen · lokace neznámá`,
    dbgFooterLocated:   (n: number, located: number) =>
                          `${n} cen · ${located}/${n} lokalizováno`,
    dbgLocationUnknown: 'lokace neznámá',

    // ── Main overlay ───────────────────────────────────────────────────────────
    moDisclaimer:       'Zátěž počítána pro pár, kde oba vydělávají mediánovou mzdu v daném kraji.',
    moMinimize:         'Minimalizovat',
    moClose:            'Zavřít',
    moExpand:           'Rozbalit',
    moYearSection:      'Porovnat s jiným rokem',
    moNoYearSelected:   'Žádný rok nevybrán',
    moYearPlaceholder:  'zadejte rok, např. 2013',
    moConfirmYear:      'Potvrdit rok (Enter)',
    moCitySection:      'Porovnat s jiným městem',
    moCitySelected:     'vybráno',
    moBurdenChart:      'Zátěž hypotéky (Medián bytu)',
    bcLegend:           (mult: string, year: number) => `Bydlení je dnes ${mult}× náročnější než v&nbsp;${year}`,
    moComparison:       'Porovnání',
    moSelectedYear:     'Vybraný rok',

    // ── Detail comparison panel ────────────────────────────────────────────────
    compNoPrice:        'Na této stránce nebyla detekována cena',
    compCantParse:      'Cenu nelze naparsovat',
    compMoreBurden:     (mult: string) => `${mult} náročnější`,
    compLessBurden:     (mult: string) => `${mult} méně náročné`,
    compBurdenNow:      'Zatížení dnes',
    compEquivPrice:     'Ekv. cena',
    compPaymentNow:     'Splátka dnes',
    compPaymentYear:    (year: number) => `Splátka ${year}`,
    compRegionEst:      '⚡ region odhadnut jako Praha',
    compNoData:         (year: number) => `Žádná data pro rok ${year}`,

    // ── Inline widget ──────────────────────────────────────────────────────────
    widgetBurden:       'Zatížení',
    widgetMortgage:     'Splátka',
    widgetPerMonth:     '/měs',
    widgetInfoTooltip:  'Jak jsme to vypočítali',
    widgetNoData:       'žádná data',

    // ── Info popup — static chrome ─────────────────────────────────────────────
    popupTitle:         'Jak se to počítá?',
    popupClose:         'Zavřít',

    // ── Inline widget — equiv section ─────────────────────────────────────────
    widgetEquivLabel:   'Ekvivalent',
    widgetEquivSep:     '↕ přepočet na dnešní podmínky',

    // ── Extension popup labels ────────────────────────────────────────────────
    popupAutoTurnOn:     'Automaticky zapnout',
    popupLaunchOverlay:  'Spustit overlay',
    popupLaunchDebugger: 'Spustit debugger',
    popupNotOnSreality:  'Nejste na stránce sreality.cz.',
    popupLangLabel:      'Jazyk',

    // ── Extension name ────────────────────────────────────────────────────────
    extensionName:       'Unreal Estate',
  },

  en: {
    // ── Debug overlay ──────────────────────────────────────────────────────────
    dbgTitle:           'Price Debugger',
    dbgBadge:           'debug',
    dbgClose:           'Close',
    dbgScanning:        'Scanning…',
    dbgNoPricesFound:   '0 prices found',
    dbgNoPricesOnPage:  'No prices found on this page.',
    dbgZeroPrices:      '0 prices',
    dbgFooterWithLoc:   (n: number, region: string, source: string) =>
                          `${n} price${n === 1 ? '' : 's'} · ${region} [${source}]`,
    dbgFooterNoLoc:     (n: number) =>
                          `${n} price${n === 1 ? '' : 's'} · location unknown`,
    dbgFooterLocated:   (n: number, located: number) =>
                          `${n} price${n === 1 ? '' : 's'} · ${located}/${n} located`,
    dbgLocationUnknown: 'location unknown',

    // ── Main overlay ───────────────────────────────────────────────────────────
    moDisclaimer:       'Burden calculated for a couple where both partners earn the regional median wage.',
    moMinimize:         'Minimize',
    moClose:            'Close',
    moExpand:           'Expand',
    moYearSection:      'Compare to a different year',
    moNoYearSelected:   'No year selected',
    moYearPlaceholder:  'type a year, e.g. 2013',
    moConfirmYear:      'Confirm year (Enter)',
    moCitySection:      'Compare to a different city',
    moCitySelected:     'selected',
    moBurdenChart:      'Mortgage burden (Median Flat)',
    bcLegend:           (mult: string, year: number) => `Housing today is ${mult}× more burdensome than in&nbsp;${year}`,
    moComparison:       'Comparison',
    moSelectedYear:     'Selected year',

    // ── Detail comparison panel ────────────────────────────────────────────────
    compNoPrice:        'No price detected on this page',
    compCantParse:      'Could not parse price',
    compMoreBurden:     (mult: string) => `${mult} more burdensome`,
    compLessBurden:     (mult: string) => `${mult} less burdensome`,
    compBurdenNow:      'Burden now',
    compEquivPrice:     'Equiv. price',
    compPaymentNow:     'Payment now',
    compPaymentYear:    (year: number) => `Payment ${year}`,
    compRegionEst:      '⚡ region estimated as Praha',
    compNoData:         (year: number) => `No data available for ${year}`,

    // ── Inline widget ──────────────────────────────────────────────────────────
    widgetBurden:       'Burden',
    widgetMortgage:     'Mortgage',
    widgetPerMonth:     '/month',
    widgetInfoTooltip:  'How we calculated this',
    widgetNoData:       'no data',

    // ── Info popup — static chrome ─────────────────────────────────────────────
    popupTitle:         'How is it calculated?',
    popupClose:         'Close',

    // ── Inline widget — equiv section ─────────────────────────────────────────
    widgetEquivLabel:   'Equivalent',
    widgetEquivSep:     '↕ recalculated to today\'s terms',

    // ── Extension popup labels ────────────────────────────────────────────────
    popupAutoTurnOn:     'Auto turn on',
    popupLaunchOverlay:  'Launch overlay',
    popupLaunchDebugger: 'Launch debugger',
    popupNotOnSreality:  'Not on a sreality.cz page.',
    popupLangLabel:      'Language',

    // ── Extension name ────────────────────────────────────────────────────────
    extensionName:       'Unreal Estate',
  },
} as const;

// ─── t() — translate a key, dispatching on static vs. function value ──────────

type Translations = typeof T.cs;
type Key = keyof Translations;

// Overload 1 — static string keys (no extra args needed)
type StaticKey = { [K in Key]: Translations[K] extends string ? K : never }[Key];
export function t(key: StaticKey): string;

// Overload 2 — function keys (passes args through to the translation function)
type FnKey = { [K in Key]: Translations[K] extends (...a: any[]) => string ? K : never }[Key];
export function t<K extends FnKey>(
  key: K,
  ...args: Parameters<Translations[K] extends (...a: any[]) => string ? Translations[K] : never>
): string;

// Implementation
export function t(key: Key, ...args: unknown[]): string {
  const val = T[currentLang][key] ?? T.cs[key];
  return typeof val === 'function' ? (val as (...a: unknown[]) => string)(...args) : val as string;
}
