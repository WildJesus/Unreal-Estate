// Pure DOM + hardcoded region lookup — no external calls, no side effects.
//
// Two extraction paths:
//   extractLocationFromDetail — breadcrumb DOM first, URL slug as fallback
//   extractLocationFromCard   — walks up from a price element to read card text
//
// All lookup keys are pre-folded (ASCII lowercase, diacritics stripped) so the
// same table works for both display text ("Plzeň") and URL slugs ("plzen").

export type CzechRegion =
  | 'praha'
  | 'stredocesky'
  | 'jihocesky'
  | 'plzensky'
  | 'karlovarsky'
  | 'ustecky'
  | 'liberecky'
  | 'kralovehradecky'
  | 'pardubicky'
  | 'vysocina'
  | 'jihomoravsky'
  | 'olomoucky'
  | 'zlinsky'
  | 'moravskoslezsky';

export interface LocationResult {
  region: CzechRegion;
  city?: string;        // e.g. "Praha 10", "Brno", "Jihlava"
  district?: string;    // e.g. "Vršovice", "Žabovřesky"
  rawText: string;      // the original text that was parsed
  source: 'breadcrumb' | 'url' | 'card';
}

// ── ASCII fold ────────────────────────────────────────────────────────────────
// NFD decomposition splits each accented letter into base + combining mark;
// the regex then strips all combining marks. Handles all Czech diacritics:
//   č→c  š→s  ž→z  ř→r  ý→y  í→i  á→a  é→e  ě→e  ú→u  ů→u  ň→n  ť→t  ď→d

function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// ── Region lookup ─────────────────────────────────────────────────────────────
// Pre-folded keys: ASCII lowercase, no diacritics.
// Covers all 14 kraje, all 76 okresy, and major sub-district city names.
//
// Known ambiguity: "Vinohrady" exists as a district in both Praha (Praha 2/3)
// and Brno — mapped to 'praha' here since Praha is the dominant use case on
// sreality. For Brno-Vinohrady cards the city "Brno" will be matched first.

const REGION_MAP: Readonly<Record<string, CzechRegion>> = {

  // ── Praha ─────────────────────────────────────────────────────────────────
  'praha': 'praha', 'prague': 'praha',
  'praha 1': 'praha', 'praha 2': 'praha', 'praha 3': 'praha',
  'praha 4': 'praha', 'praha 5': 'praha', 'praha 6': 'praha',
  'praha 7': 'praha', 'praha 8': 'praha', 'praha 9': 'praha',
  'praha 10': 'praha', 'praha 11': 'praha', 'praha 12': 'praha',
  // Major Prague districts / neighborhoods
  'vinohrady': 'praha',   'zizkov': 'praha',    'smichov': 'praha',
  'dejvice': 'praha',     'holesovice': 'praha', 'nusle': 'praha',
  'vrsovice': 'praha',    'branik': 'praha',     'krc': 'praha',
  'stresovice': 'praha',  'bubenec': 'praha',    'brevnov': 'praha',
  'repy': 'praha',        'modrany': 'praha',    'letnany': 'praha',
  'kobylisy': 'praha',    'bohnice': 'praha',    'prosek': 'praha',
  'troja': 'praha',       'mala strana': 'praha', 'hradcany': 'praha',
  'josefov': 'praha',     'zlichov': 'praha',    'hlubocepy': 'praha',
  'ruzyne': 'praha',      'suchdol': 'praha',    'libus': 'praha',
  'chodov': 'praha',      'hostivare': 'praha',  'cakovice': 'praha',
  'michle': 'praha',      'zahradni mesto': 'praha',

  // ── Středočeský kraj ──────────────────────────────────────────────────────
  'stredocesky': 'stredocesky',
  // Okresy
  'benesov': 'stredocesky',      'beroun': 'stredocesky',
  'kladno': 'stredocesky',       'kolin': 'stredocesky',
  'kutna hora': 'stredocesky',   'melnik': 'stredocesky',
  'mlada boleslav': 'stredocesky', 'nymburk': 'stredocesky',
  'praha-vychod': 'stredocesky', 'praha vychod': 'stredocesky',
  'praha-zapad': 'stredocesky',  'praha zapad': 'stredocesky',
  'pribram': 'stredocesky',      'rakovnik': 'stredocesky',
  // Additional cities
  'ricany': 'stredocesky',       'brandys nad labem': 'stredocesky',
  'celakovice': 'stredocesky',   'neratovice': 'stredocesky',
  'kralupy nad vltavou': 'stredocesky', 'lysa nad labem': 'stredocesky',
  'mnichovo hradiste': 'stredocesky',   'sedlcany': 'stredocesky',
  'vlasim': 'stredocesky',       'pruhonice': 'stredocesky',
  'roztoky': 'stredocesky',      'cernosice': 'stredocesky',

  // ── Jihočeský kraj ────────────────────────────────────────────────────────
  'jihocesky': 'jihocesky',
  // Okresy
  'ceske budejovice': 'jihocesky', 'cesky krumlov': 'jihocesky',
  'jindrichuv hradec': 'jihocesky', 'pisek': 'jihocesky',
  'prachatice': 'jihocesky',     'strakonice': 'jihocesky',
  'tabor': 'jihocesky',
  // Additional cities
  'trebon': 'jihocesky',         'sobeslav': 'jihocesky',
  'vodnany': 'jihocesky',        'kaplice': 'jihocesky',
  'blatna': 'jihocesky',         'pisek-mesto': 'jihocesky',

  // ── Plzeňský kraj ─────────────────────────────────────────────────────────
  'plzensky': 'plzensky',
  // Okresy
  'plzen': 'plzensky',           'plzen-mesto': 'plzensky',
  'plzen-jih': 'plzensky',       'plzen-sever': 'plzensky',
  'domazlice': 'plzensky',       'klatovy': 'plzensky',
  'rokycany': 'plzensky',        'tachov': 'plzensky',
  // Additional cities
  'stribro': 'plzensky',         'horsovsky tyn': 'plzensky',
  'stod': 'plzensky',            'blovice': 'plzensky',

  // ── Karlovarský kraj ──────────────────────────────────────────────────────
  'karlovarsky': 'karlovarsky',
  // Okresy
  'karlovy vary': 'karlovarsky', 'cheb': 'karlovarsky', 'sokolov': 'karlovarsky',
  // Additional cities
  'marianske lazne': 'karlovarsky', 'frantiskovy lazne': 'karlovarsky',
  'ostrov': 'karlovarsky',

  // ── Ústecký kraj ──────────────────────────────────────────────────────────
  'ustecky': 'ustecky',
  // Okresy
  'usti nad labem': 'ustecky',   'decin': 'ustecky',
  'chomutov': 'ustecky',         'litomerice': 'ustecky',
  'louny': 'ustecky',            'most': 'ustecky',
  'teplice': 'ustecky',
  // Additional cities
  'bilina': 'ustecky',           'klasterec nad ohri': 'ustecky',
  'roudnice nad labem': 'ustecky',

  // ── Liberecký kraj ────────────────────────────────────────────────────────
  'liberecky': 'liberecky',
  // Okresy
  'liberec': 'liberecky',        'ceska lipa': 'liberecky',
  'jablonec nad nisou': 'liberecky', 'semily': 'liberecky',
  // Additional cities
  'turnov': 'liberecky',         'frydlant': 'liberecky',
  'novy bor': 'liberecky',       'tanvald': 'liberecky',

  // ── Královéhradecký kraj ──────────────────────────────────────────────────
  'kralovehradecky': 'kralovehradecky',
  // Okresy
  'hradec kralove': 'kralovehradecky', 'jicin': 'kralovehradecky',
  'nachod': 'kralovehradecky',   'rychnov nad kneznou': 'kralovehradecky',
  'trutnov': 'kralovehradecky',
  // Additional cities
  'broumov': 'kralovehradecky',  'dvur kralove nad labem': 'kralovehradecky',
  'novy bydzov': 'kralovehradecky',

  // ── Pardubický kraj ───────────────────────────────────────────────────────
  'pardubicky': 'pardubicky',
  // Okresy
  'pardubice': 'pardubicky',     'chrudim': 'pardubicky',
  'svitavy': 'pardubicky',       'usti nad orlici': 'pardubicky',
  // Additional cities
  'vysoke myto': 'pardubicky',   'ceska trebova': 'pardubicky',
  'litomysl': 'pardubicky',      'policka': 'pardubicky',

  // ── Kraj Vysočina ─────────────────────────────────────────────────────────
  'vysocina': 'vysocina',
  // Okresy
  'jihlava': 'vysocina',         'havlickuv brod': 'vysocina',
  'pelhrimov': 'vysocina',       'trebic': 'vysocina',
  'zdar nad sazavou': 'vysocina',
  // Additional cities
  'telc': 'vysocina',            'humpolec': 'vysocina',
  'bystrice nad pernstejnem': 'vysocina',

  // ── Jihomoravský kraj ─────────────────────────────────────────────────────
  'jihomoravsky': 'jihomoravsky',
  // Okresy
  'brno': 'jihomoravsky',        'brno-mesto': 'jihomoravsky',
  'brno-venkov': 'jihomoravsky', 'blansko': 'jihomoravsky',
  'breclav': 'jihomoravsky',     'hodonin': 'jihomoravsky',
  'vyskov': 'jihomoravsky',      'znojmo': 'jihomoravsky',
  // Brno city districts
  'brno-sever': 'jihomoravsky',  'brno-jih': 'jihomoravsky',
  'zabovresky': 'jihomoravsky',  'kralovo pole': 'jihomoravsky',
  'bystrc': 'jihomoravsky',      'bohunice': 'jihomoravsky',
  'kohoutovice': 'jihomoravsky', 'lisen': 'jihomoravsky',
  'reckovice': 'jihomoravsky',   'lesna': 'jihomoravsky',
  // Additional cities
  'mikulov': 'jihomoravsky',     'kyjov': 'jihomoravsky',
  'veseli nad moravou': 'jihomoravsky', 'tisnov': 'jihomoravsky',
  'kurim': 'jihomoravsky',       'rosice': 'jihomoravsky',
  'brno venkov': 'jihomoravsky',

  // ── Olomoucký kraj ────────────────────────────────────────────────────────
  'olomoucky': 'olomoucky',
  // Okresy
  'olomouc': 'olomoucky',        'jesenik': 'olomoucky',
  'prostejov': 'olomoucky',      'prerov': 'olomoucky',
  'sumperk': 'olomoucky',
  // Additional cities
  'zabreh': 'olomoucky',         'unicov': 'olomoucky',
  'mohelnice': 'olomoucky',

  // ── Zlínský kraj ──────────────────────────────────────────────────────────
  'zlinsky': 'zlinsky',
  // Okresy
  'zlin': 'zlinsky',             'kromeriz': 'zlinsky',
  'uherske hradiste': 'zlinsky', 'vsetin': 'zlinsky',
  // Additional cities
  'uhersky brod': 'zlinsky',     'valasske mezirici': 'zlinsky',
  'roznov pod radhostem': 'zlinsky', 'otrokovice': 'zlinsky',
  'napajedla': 'zlinsky',        'slavicin': 'zlinsky',

  // ── Moravskoslezský kraj ──────────────────────────────────────────────────
  'moravskoslezsky': 'moravskoslezsky',
  // Okresy
  'ostrava': 'moravskoslezsky',  'ostrava-mesto': 'moravskoslezsky',
  'bruntal': 'moravskoslezsky',  'frydek-mistek': 'moravskoslezsky',
  'frydek mistek': 'moravskoslezsky', 'karvina': 'moravskoslezsky',
  'novy jicin': 'moravskoslezsky', 'opava': 'moravskoslezsky',
  // Additional cities
  'havirov': 'moravskoslezsky',  'trinec': 'moravskoslezsky',
  'koprivnice': 'moravskoslezsky', 'bohumin': 'moravskoslezsky',
  'orlova': 'moravskoslezsky',   'cesky tesin': 'moravskoslezsky',

} as const;

// ── Public API: mapToRegion ───────────────────────────────────────────────────

/**
 * Map any Czech city / district / okres name to its kraj.
 * Accepts both display text ("Plzeň") and ASCII slugs ("plzen").
 * Returns null if the locality is not recognised.
 */
export function mapToRegion(locality: string): CzechRegion | null {
  return REGION_MAP[fold(locality)] ?? null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Parse a locality string into city and optional district.
 * Handles: "Praha 10 - Vršovice", "Brno - Žabovřesky", "Jihlava", "Kladno".
 */
function parseLocality(text: string): { city: string; district?: string } | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80) return null;

  // "City - District" — the standard sreality card format
  const dashIdx = trimmed.indexOf(' - ');
  if (dashIdx !== -1) {
    const city = trimmed.slice(0, dashIdx).trim();
    const district = trimmed.slice(dashIdx + 3).trim();
    if (city) return { city, district: district || undefined };
  }

  // Bare city name — require at least 5 characters to avoid false positives
  // from short common Czech words that are also city names (e.g. "most" = bridge).
  // Multi-word cities like "Praha 10" (8 chars) are fine; short names like "Brno"
  // (4 chars) are caught by the "City - District" path when context is available.
  if (trimmed.length >= 5) return { city: trimmed };
  return null;
}

/**
 * Build a LocationResult from parsed parts, or null if region is unknown.
 * Tries city first, then district as a fallback region source.
 */
function makeResult(
  city: string,
  district: string | undefined,
  rawText: string,
  source: LocationResult['source'],
): LocationResult | null {
  const region = mapToRegion(city) ?? (district ? mapToRegion(district) : null);
  if (!region) return null;
  return { region, city, district, rawText, source };
}

/**
 * Try to parse a raw text string as a locality and return a LocationResult.
 */
function tryParseLocality(text: string, source: LocationResult['source']): LocationResult | null {
  const parsed = parseLocality(text);
  if (!parsed) return null;
  return makeResult(parsed.city, parsed.district, text, source);
}

// ── URL slug parsing ──────────────────────────────────────────────────────────
//
// sreality detail URL format:
//   /detail/{sale-type}/{property-type}/{spec}/{location-slug}/{listing-id}
//   e.g. /detail/prodej/byt/3+1/praha-praha-10-vrsovice/1234567890
//
// The location slug is always the 5th path segment (index 4 after filter).
// The city is encoded as the first hyphen-delimited word(s) of that slug.

function fromUrl(): LocationResult | null {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'detail' || parts.length < 5) return null;

  const slug = parts[4];
  if (!slug) return null;

  const segments = slug.split('-');

  // Try 1-word, then 2-word, then 3-word, then 4-word combinations.
  // Handles both single-word cities ("Praha", "Brno") and compound names
  // ("České Budějovice" → "ceske-budejovice", "Ústí nad Labem" → "usti-nad-labem").
  for (let len = 1; len <= Math.min(4, segments.length); len++) {
    const candidate = segments.slice(0, len).join(' ');
    const region = mapToRegion(candidate);
    if (region) {
      return { region, city: candidate, rawText: slug, source: 'url' };
    }
  }

  return null;
}

// ── Breadcrumb DOM parsing ────────────────────────────────────────────────────
//
// Tries multiple selector strategies to find the breadcrumb container, then
// scans its text items from most-specific (last) to least-specific (first).

function fromBreadcrumb(doc: Document): LocationResult | null {
  // Ordered from most-specific to most-general selector
  const selectors = [
    '[aria-label*="breadcrumb" i]',
    '[aria-label*="navigace" i]',   // Czech: "navigace" = navigation
    '[data-e2e*="breadcrumb"]',
    'nav ol',
    'nav ul',
    'nav',
  ];

  for (const sel of selectors) {
    const container = doc.querySelector(sel);
    if (!container) continue;

    // Collect leaf text from links and list items; skip containers that
    // contain only deeper-nested elements (their text would be duplicated).
    const candidates = Array.from(container.querySelectorAll('a, li'))
      .map(el => el.textContent?.trim() ?? '')
      .filter(t => t.length >= 2 && t.length <= 80);

    // Most-specific items are last in the breadcrumb — try them first.
    for (let i = candidates.length - 1; i >= 0; i--) {
      const result = tryParseLocality(candidates[i], 'breadcrumb');
      if (result) return result;
    }
  }

  return null;
}

// ── Card container heuristic ──────────────────────────────────────────────────
//
// Walks up from a price element to find a likely card container — a parent
// that has at least 2 children (title + price + location, etc.).
// Mirrors the same walk-up pattern used in classifyCard() in content.ts.

function getCardContainer(el: Element): Element {
  let node: Element = el;
  for (let i = 0; i < 10; i++) {
    const parent = node.parentElement;
    if (!parent || parent === document.body) break;
    node = parent;
    // Skip the first 2 levels (inline wrappers around the price text) before
    // looking for a card-level container. A real card has multiple children:
    // title, location string, price, etc.
    if (i >= 2 && parent.children.length >= 3) return parent;
  }
  return node;
}

// ── Public API: extractors ────────────────────────────────────────────────────

/**
 * Extract location from a detail page.
 * Priority: breadcrumb DOM → URL slug.
 */
export function extractLocationFromDetail(doc: Document): LocationResult | null {
  return fromBreadcrumb(doc) ?? fromUrl();
}

/**
 * Extract location from a listing card element.
 * Walks up to find the card container, then scans text nodes for a locality
 * string matching the pattern "City - District" or a known city name.
 */
export function extractLocationFromCard(el: Element): LocationResult | null {
  const card = getCardContainer(el);

  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const raw = walker.currentNode.textContent?.trim() ?? '';

    // Skip empty, too-long, or obviously non-locality text
    if (raw.length < 3 || raw.length > 80) continue;
    if (/\d.*Kč|Kč.*\d|m²|m2|\d+\s*\+\s*\d+/i.test(raw)) continue;

    const result = tryParseLocality(raw, 'card');
    if (result) return result;
  }

  return null;
}
