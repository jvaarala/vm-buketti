export type {
  Laskelmaraha, Muutos, Vertailuluvut, Budjettilaskelma,
  Tulomomentti, Tuloluku, Osasto,
  Menomomentti, Menoluku, Paaluokka,
  Kanta, Teos, Vuosi,
  LazyOsasto, LazyPaaluokka, LazyKanta, LazyTeos, LazyVuosi,
  Juuri,
} from './schema.js';

import type { Juuri } from './schema.js';

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
  getJuuri(): Juuri;
}

const ROOT_URL = 'https://budjetti.vm.fi/opendata/opendata-xml.jsp';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

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
  return s.replace(/[-:]([a-z])/g, (_, c: string) => c.toUpperCase());
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
    out[key] = /^-?\d+(\.\d+)?$/.test(attr.value) ? Number(attr.value) : attr.value;
  }
  return out;
}

function buildNode(el: Element, rootDoc: Document, resolveEl: ResolveEl): unknown {
  const attrs = readAttrs(el);

  if (getHref(el)) {
    // xlink element: children unknown until fetched — use a Proxy
    let resolved: Promise<void> | null = null;
    const ensure = (): Promise<void> => {
      if (!resolved) resolved = resolveEl(el, rootDoc);
      return resolved;
    };
    const childCache = new Map<string, Promise<unknown[]>>();

    return new Proxy(attrs as Record<string, unknown>, {
      get(target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'then') return undefined;
        if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        if (!childCache.has(prop)) {
          childCache.set(prop, ensure().then(() => {
            const children = [...el.children].filter(c => c.tagName === prop);
            return children.map(c => buildNode(c, rootDoc, resolveEl));
          }));
        }
        return childCache.get(prop);
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
  return async function resolveEl(el: Element, rootDoc: Document): Promise<void> {
    const h = getHref(el);
    if (!h) return;
    const url = new URL(h, ROOT_URL).href;
    try {
      const text = await fetchXml(url);
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

  return {
    getJuuri(): Juuri {
      return buildJuuri(
        () => fetchXml(ROOT_URL).then(parseXML),
        resolveEl,
      );
    },
  };
}
