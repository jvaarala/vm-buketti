export type {
  Laskelmaraha, Muutos, Vertailuluvut, Budjettilaskelma,
  Tulomomentti, Tuloluku, Osasto,
  Menomomentti, Menoluku, Paaluokka,
  Kanta, Teos, Vuosi,
  LazyOsasto, LazyPaaluokka, LazyKanta, LazyTeos, LazyVuosi,
  Juuri,
} from './schema.js';

import type {
  Budjettilaskelma,
  Menomomentti, Menoluku,
  Tulomomentti, Tuloluku,
  LazyKanta, LazyPaaluokka, LazyOsasto,
  Juuri,
} from './schema.js';

// ── High-level query types ────────────────────────────────────────────────────

export type KantaType =
  | 'valtiovarainministerionKanta'
  | 'hallituksenEsitys'
  | 'eduskunnanKirjelma'
  | (string & {});

export type TeosType =
  | 'tae'
  | 'ltae1' | 'ltae2' | 'ltae3' | 'ltae4' | 'ltae5'
  | (string & {});

export interface KantaQuery {
  year: number;
  teos: TeosType;
  kanta: KantaType;
}

export interface MergedKantaQuery {
  year: number;
  teos: TeosType | TeosType[];
  kanta: KantaType;
}

export interface MergedMenomomentti {
  numero: string | number;
  nimi: string;
  /** Sum of Laskelmaraha.arvo where tyyppi === 'maararaha' across all merged teos */
  amount: number;
  /** Sum of Laskelmaraha.arvo where tyyppi starts with 'aiemmin-budjetoitu' */
  comparison: number;
}

export interface MergedMenoluku {
  numero: string | number;
  nimi: string;
  amount: number;
  comparison: number;
  Menomomentti: MergedMenomomentti[];
}

export interface MergedPaaluokka {
  numero: string | number;
  nimi: string;
  amount: number;
  comparison: number;
  Menoluku: MergedMenoluku[];
}

export interface MergedTulomomentti {
  numero: string | number;
  nimi: string;
  amount: number;
  comparison: number;
}

export interface MergedTuloluku {
  numero: string | number;
  nimi: string;
  amount: number;
  comparison: number;
  Tulomomentti: MergedTulomomentti[];
}

export interface MergedOsasto {
  numero: string | number;
  nimi: string;
  amount: number;
  comparison: number;
  Tuloluku: MergedTuloluku[];
}

/** A node in the unified budget tree, usable for both spending (menot) and income (tulot). */
export interface BudgetNode {
  /**
   * Composite dot-separated key, e.g. `'23.10.21'` for menot or `'T11.01.01'` for tulot.
   * Use this with BudgetBranch.get() or MergedKanta.get().
   */
  key: string;
  numero: string | number;
  nimi: string;
  amount: number;
  comparison: number;
  children: BudgetNode[];
}

/** One side (menot or tulot) of a merged kanta, with O(1) key lookup. */
export interface BudgetBranch {
  nodes: BudgetNode[];
  /** O(1) lookup by composite key (e.g. `'23.10.21'`). */
  get(key: string): BudgetNode | undefined;
}

export interface MergedKanta {
  /** Typed spending-side access, merged by numero with pre-computed amounts. */
  Paaluokka: MergedPaaluokka[];
  /** Typed income-side access, merged by numero with pre-computed amounts. */
  Osasto: MergedOsasto[];
  /** Unified spending/income branches with identical shape */
  branches: { menot: BudgetBranch; tulot: BudgetBranch };
  /**
   * O(1) access by composite key across both branches.
   * Menot keys: `'23'`, `'23.10'`, `'23.10.21'`.
   * Tulot keys: `'T11'`, `'T11.01'`, `'T11.01.01'` (T prefix).
   */
  get(key: string): BudgetNode | undefined;
}

// ── VmBuketti public interface ───────────────────────────────────────────────

export interface VmBukettiOptions {
  /**
   * URL of a CORS proxy endpoint that accepts `?url=<encoded>` query params.
   *
   * @example
   * createVmBuketti({ proxyUrl: '/proxy' });
   */
  proxyUrl?: string;

  /**
   * Custom function for fetching XML content from a URL.
   * Use this to add custom headers, authentication, etc.
   * Takes precedence over `proxyUrl`.
   *
   * Defaults to `fetch(url)` using the global `fetch`.
   */
  fetchXml?: (url: string) => Promise<string>;

  /**
   * Called when a sub-link fetch fails during lazy loading.
   * If not provided, failures are silently ignored (partial data is returned).
   */
  onError?: (error: Error, url: string) => void;
}

export interface VmBuketti {
  /** Returns the raw lazy-proxy root. All child accesses return Promises. */
  getJuuri(): Juuri;

  /**
   * Navigates to a single LazyKanta. Useful for raw lazy access
   * without the full merge pipeline.
   *
   * @example
   * const lk = await service.kanta({ year: 2025, teos: 'tae', kanta: 'eduskunnanKirjelma' });
   * const paaluokat = await lk.Paaluokka;
   */
  kanta(query: KantaQuery): Promise<LazyKanta>;

  /**
   * Resolves one or more teos publications, merges their nodes by `numero`,
   * sums amounts, and returns a fully materialised MergedKanta with O(1) index.
   *
   * @example
   * const tree = await service.getMergedKanta({
   *   year: 2025,
   *   teos: ['tae', 'ltae1'],
   *   kanta: 'eduskunnanKirjelma',
   * });
   * tree.Paaluokka[0].amount;      // pre-computed
   * tree.get('23.10.21');           // O(1) lookup
   * tree.branches.menot.nodes;      // unified shape
   */
  getMergedKanta(query: MergedKantaQuery): Promise<MergedKanta>;
}

const ROOT_URL = 'https://budjetti.vm.fi/opendata/opendata-xml.jsp';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const CAMEL_RE   = /[-:]([a-z])/g;

type ResolveEl = (el: Element, rootDoc: Document) => Promise<void>;

// ── XML helpers ──────────────────────────────────────────────────────────────

function parseXML(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('XML parse error: ' + err.textContent?.slice(0, 120));
  return doc;
}

function getHref(el: Element): string | null {
  return el.getAttributeNS(XLINK_NS, 'href') || el.getAttribute('xlink:href') || null;
}

function toCamel(s: string): string {
  return s.replace(CAMEL_RE, (_, c: string) => c.toUpperCase());
}

// ── Generic lazy tree builder ────────────────────────────────────────────────
//
// The traversal algorithm is the same for every node in the tree:
//   - If the element has xlink:href it must be fetched before its children are
//     readable. A Proxy intercepts child-property accesses and fires the fetch
//     on demand, caching the resulting Promise.
//   - Otherwise, children are already in the DOM and can be wrapped eagerly;
//     but if any child element carries an xlink:href the child array is still
//     wrapped in a Promise so callers use a consistent await pattern.
//
// The Juuri root is treated the same way via a document-level Proxy.

function readAttrs(el: Element): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const attr of el.attributes) {
    if (attr.namespaceURI) continue; // skip xlink:href, xmlns:* and any other namespace attrs
    const key = toCamel(attr.name);
    out[key] = NUMERIC_RE.test(attr.value) ? Number(attr.value) : attr.value;
  }
  return out;
}

function buildNode(el: Element, rootDoc: Document, resolveEl: ResolveEl): unknown {
  const attrs = readAttrs(el);

  if (getHref(el)) {
    // xlink element: children unknown until fetched — use a Proxy
    // After resolveEl completes, group all children by tagName in one pass
    // so each subsequent property access is O(1) rather than re-filtering el.children.
    let groupsP: Promise<Map<string, unknown[]>> | null = null;
    const getGroups = (): Promise<Map<string, unknown[]>> => {
      if (!groupsP) {
        groupsP = resolveEl(el, rootDoc).then(() => {
          const groups = new Map<string, unknown[]>();
          for (const c of el.children) {
            let list = groups.get(c.tagName);
            if (!list) { list = []; groups.set(c.tagName, list); }
            list.push(buildNode(c, rootDoc, resolveEl));
          }
          return groups;
        });
      }
      return groupsP;
    };
    const propCache = new Map<string, Promise<unknown[]>>();

    return new Proxy(attrs as Record<string, unknown>, {
      get(target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'then') return undefined;
        if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        if (!propCache.has(prop)) {
          propCache.set(prop, getGroups().then(g => g.get(prop) ?? []));
        }
        return propCache.get(prop);
      },
    });
  }

  // Non-xlink element: children are in the DOM now
  const node: Record<string, unknown> = { ...attrs };

  const groups = new Map<string, Element[]>();
  for (const child of el.children) {
    if (!groups.has(child.tagName)) groups.set(child.tagName, []);
    groups.get(child.tagName)!.push(child);
  }

  for (const [tag, children] of groups) {
    node[tag] = children.map(c => buildNode(c, rootDoc, resolveEl));
  }

  return node;
}

function buildJuuri(fetchRoot: () => Promise<Document>, resolveEl: ResolveEl): Juuri {
  const childCache = new Map<string, Promise<unknown[]>>();
  let docP: Promise<Document> | null = null;
  const ensure = (): Promise<Document> => {
    if (!docP) docP = fetchRoot();
    return docP;
  };

  return new Proxy({} as unknown as Juuri, {
    get(_, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (!childCache.has(prop))
        childCache.set(prop, ensure().then(doc =>
          [...doc.documentElement.children]
            .filter(c => c.tagName === prop)
            .map(el => buildNode(el, doc, resolveEl))
        ));
      return childCache.get(prop);
    },
  });
}

// ── Fetch infrastructure ─────────────────────────────────────────────────────

function makeResolveEl(
  fetchXml: (url: string) => Promise<string>,
  onError?: (error: Error, url: string) => void,
): ResolveEl {
  // Deduplicate concurrent fetches for the same URL (e.g. same Paaluokka linked
  // from multiple teos). The Promise is cached so all callers share one in-flight request.
  const fetchCache = new Map<string, Promise<string>>();

  return async function resolveEl(el: Element, rootDoc: Document): Promise<void> {
    const h = getHref(el);
    if (!h) return;
    const url = new URL(h, ROOT_URL).href;
    try {
      let textP = fetchCache.get(url);
      if (!textP) { textP = fetchXml(url); fetchCache.set(url, textP); }
      const text = await textP;
      const doc = parseXML(text);
      while (el.lastChild) el.removeChild(el.lastChild);
      [...doc.documentElement.children].forEach(c =>
        el.appendChild(rootDoc.importNode(c, true))
      );
      el.removeAttributeNS(XLINK_NS, 'href');
      el.removeAttribute('xlink:href');
    } catch (e) {
      onError?.(e as Error, url);
    }
  };
}

// ── High-level merge helpers ─────────────────────────────────────────────────

// Internal types: resolved (non-lazy) shapes used during merging
type ResolvedPaaluokka = { numero: string | null; nimi: string | null; Menoluku: Menoluku[] };
type ResolvedOsasto    = { numero: string | null; nimi: string | null; Tuloluku: Tuloluku[] };

function sumArvo(
  laskelmat: Budjettilaskelma[],
  match: string | ((t: string) => boolean),
): number {
  const pred = typeof match === 'string' ? (t: string) => t === match : match;
  let sum = 0;
  for (const l of laskelmat)
    for (const lr of l.Laskelmaraha)
      if (pred(lr.tyyppi ?? '') && lr.arvo != null) sum += lr.arvo;
  return sum;
}

function mergeMenomomentti(lists: Menomomentti[][]): MergedMenomomentti[] {
  const map = new Map<string, Menomomentti[]>();
  for (const arr of lists)
    for (const m of arr) {
      const k = m.numero ?? '';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
  return [...map.entries()].map(([numero, items]) => ({
    numero,
    nimi: items.find(i => i.nimi)?.nimi ?? '',
    amount:     items.reduce((s, i) => s + sumArvo(i.Budjettilaskelma, 'maararaha'), 0),
    comparison: items.reduce((s, i) => s + sumArvo(i.Budjettilaskelma, t => t.startsWith('aiemmin-budjetoitu')), 0),
  }));
}

function mergeMenoluku(lists: Menoluku[][]): MergedMenoluku[] {
  const map = new Map<string, Menoluku[]>();
  for (const arr of lists)
    for (const m of arr) {
      const k = m.numero ?? '';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
  return [...map.entries()].map(([numero, items]) => {
    const Menomomentti = mergeMenomomentti(items.map(i => i.Menomomentti));
    return {
      numero,
      nimi: items.find(i => i.nimi)?.nimi ?? '',
      amount:     Menomomentti.reduce((s, m) => s + m.amount, 0),
      comparison: Menomomentti.reduce((s, m) => s + m.comparison, 0),
      Menomomentti,
    };
  });
}

function mergePaaluokka(lists: ResolvedPaaluokka[][]): MergedPaaluokka[] {
  const map = new Map<string, ResolvedPaaluokka[]>();
  for (const arr of lists)
    for (const p of arr) {
      const k = p.numero ?? '';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
  return [...map.entries()].map(([numero, items]) => {
    const Menoluku = mergeMenoluku(items.map(i => i.Menoluku));
    return {
      numero,
      nimi: items.find(i => i.nimi)?.nimi ?? '',
      amount:     Menoluku.reduce((s, m) => s + m.amount, 0),
      comparison: Menoluku.reduce((s, m) => s + m.comparison, 0),
      Menoluku,
    };
  });
}

function mergeTulomomentti(lists: Tulomomentti[][]): MergedTulomomentti[] {
  const map = new Map<string, Tulomomentti[]>();
  for (const arr of lists)
    for (const m of arr) {
      const k = m.numero ?? '';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
  return [...map.entries()].map(([numero, items]) => ({
    numero,
    nimi: items.find(i => i.nimi)?.nimi ?? '',
    amount:     items.reduce((s, i) => s + sumArvo(i.Budjettilaskelma, 'maararaha'), 0),
    comparison: items.reduce((s, i) => s + sumArvo(i.Budjettilaskelma, t => t.startsWith('aiemmin-budjetoitu')), 0),
  }));
}

function mergeTuloluku(lists: Tuloluku[][]): MergedTuloluku[] {
  const map = new Map<string, Tuloluku[]>();
  for (const arr of lists)
    for (const t of arr) {
      const k = t.numero ?? '';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }
  return [...map.entries()].map(([numero, items]) => {
    const Tulomomentti = mergeTulomomentti(items.map(i => i.Tulomomentti));
    return {
      numero,
      nimi: items.find(i => i.nimi)?.nimi ?? '',
      amount:     Tulomomentti.reduce((s, m) => s + m.amount, 0),
      comparison: Tulomomentti.reduce((s, m) => s + m.comparison, 0),
      Tulomomentti,
    };
  });
}

function mergeOsasto(lists: ResolvedOsasto[][]): MergedOsasto[] {
  const map = new Map<string, ResolvedOsasto[]>();
  for (const arr of lists)
    for (const o of arr) {
      const k = o.numero ?? '';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(o);
    }
  return [...map.entries()].map(([numero, items]) => {
    const Tuloluku = mergeTuloluku(items.map(i => i.Tuloluku));
    return {
      numero,
      nimi: items.find(i => i.nimi)?.nimi ?? '',
      amount:     Tuloluku.reduce((s, t) => s + t.amount, 0),
      comparison: Tuloluku.reduce((s, t) => s + t.comparison, 0),
      Tuloluku,
    };
  });
}

// ── BudgetNode converters (unified interface) ────────────────────

function paaluokkaToNode(p: MergedPaaluokka): BudgetNode {
  const pk = String(p.numero);
  return {
    key: pk, numero: p.numero, nimi: p.nimi,
    amount: p.amount, comparison: p.comparison,
    children: p.Menoluku.map(ml => {
      const mlk = String(ml.numero);
      return {
        key: `${pk}.${mlk}`,
        numero: ml.numero, nimi: ml.nimi,
        amount: ml.amount, comparison: ml.comparison,
        children: ml.Menomomentti.map(mm => ({
          key: `${pk}.${mlk}.${String(mm.numero)}`,
          numero: mm.numero, nimi: mm.nimi,
          amount: mm.amount, comparison: mm.comparison,
          children: [],
        })),
      };
    }),
  };
}

function osastoToNode(o: MergedOsasto): BudgetNode {
  const ok = String(o.numero);
  return {
    key: `T${ok}`, numero: o.numero, nimi: o.nimi,
    amount: o.amount, comparison: o.comparison,
    children: o.Tuloluku.map(tl => {
      const tlk = String(tl.numero);
      return {
        key: `T${ok}.${tlk}`,
        numero: tl.numero, nimi: tl.nimi,
        amount: tl.amount, comparison: tl.comparison,
        children: tl.Tulomomentti.map(tm => ({
          key: `T${ok}.${tlk}.${String(tm.numero)}`,
          numero: tm.numero, nimi: tm.nimi,
          amount: tm.amount, comparison: tm.comparison,
          children: [],
        })),
      };
    }),
  };
}

function buildFlatIndex(nodes: BudgetNode[], index: Map<string, BudgetNode>): void {
  for (const n of nodes) {
    index.set(n.key, n);
    buildFlatIndex(n.children, index);
  }
}

// ── Navigation helpers ───────────────────────────────────────────────────────

async function navigateToKanta(juuri: Juuri, q: KantaQuery): Promise<LazyKanta> {
  const years = await juuri.Vuosi;
  const vuosi = years.find(v => v.vuosi === q.year);
  if (!vuosi) throw new Error(`Year ${q.year} not found`);
  const teos = vuosi.Teos.find(t => t.teostyyppi === q.teos);
  if (!teos) throw new Error(`Teos '${q.teos}' not found for year ${q.year}`);
  const kanta = teos.Kanta.find(k => k.kanta === q.kanta);
  if (!kanta) throw new Error(`Kanta '${q.kanta}' not found`);
  return kanta;
}

async function resolveFullKanta(
  kanta: LazyKanta,
): Promise<{ Paaluokka: ResolvedPaaluokka[]; Osasto: ResolvedOsasto[] }> {
  const [lazyPk, lazyOs] = await Promise.all([kanta.Paaluokka, kanta.Osasto]);
  const [Paaluokka, Osasto] = await Promise.all([
    Promise.all(lazyPk.map(async (lp: LazyPaaluokka) => ({
      numero: lp.numero, nimi: lp.nimi, Menoluku: await lp.Menoluku,
    }))),
    Promise.all(lazyOs.map(async (lo: LazyOsasto) => ({
      numero: lo.numero, nimi: lo.nimi, Tuloluku: await lo.Tuloluku,
    }))),
  ]);
  return { Paaluokka, Osasto };
}

// ── Public factory ───────────────────────────────────────────────────────────

/**
 * Creates a VmBuketti instance for accessing the Finnish state budget API.
 *
 * @example
 * // Node.js (fetch available globally in Node 18+):
 * const service = createVmBuketti();
 *
 * @example
 * // Browser with CORS proxy:
 * const service = createVmBuketti({
 *   fetchXml: url => fetch('/proxy?url=' + encodeURIComponent(url)).then(r => r.text())
 * });
 */
export function createVmBuketti(options?: VmBukettiOptions): VmBuketti {
  const doFetch = async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Server returned ${r.status} for ${url}`);
    return r.text();
  };

  const fetchXml = options?.fetchXml ?? (
    options?.proxyUrl
      ? (url: string) => doFetch(options.proxyUrl! + '?url=' + encodeURIComponent(url))
      : doFetch
  );

  const resolveEl = makeResolveEl(fetchXml, options?.onError);

  // Build juuri once so all methods share the same fetch cache.
  const juuri = buildJuuri(
    () => fetchXml(ROOT_URL).then(parseXML),
    resolveEl,
  );

  return {
    getJuuri(): Juuri {
      return juuri;
    },

    kanta(query: KantaQuery): Promise<LazyKanta> {
      return navigateToKanta(juuri, query);
    },

    async getMergedKanta(query: MergedKantaQuery): Promise<MergedKanta> {
      const teosArr = Array.isArray(query.teos) ? query.teos : [query.teos];

      const kantas = await Promise.all(
        teosArr.map(teos => navigateToKanta(juuri, { year: query.year, teos, kanta: query.kanta }))
      );
      const resolved = await Promise.all(kantas.map(resolveFullKanta));

      const mergedPk = mergePaaluokka(resolved.map(r => r.Paaluokka));
      const mergedOs = mergeOsasto(resolved.map(r => r.Osasto));

      const menotNodes = mergedPk.map(paaluokkaToNode);
      const tulotNodes = mergedOs.map(osastoToNode);

      const menotIdx = new Map<string, BudgetNode>();
      const tulotIdx = new Map<string, BudgetNode>();
      buildFlatIndex(menotNodes, menotIdx);
      buildFlatIndex(tulotNodes, tulotIdx);

      return {
        Paaluokka: mergedPk,
        Osasto: mergedOs,
        branches: {
          menot: { nodes: menotNodes, get: k => menotIdx.get(k) },
          tulot: { nodes: tulotNodes, get: k => tulotIdx.get(k) },
        },
        get: k => menotIdx.get(k) ?? tulotIdx.get(k),
      };
    },
  };
}
