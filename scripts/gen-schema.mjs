#!/usr/bin/env node
// Fetches the live XSD from budjetti.vm.fi and writes src/schema.ts.
// Run with: npm run gen-schema

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root    = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT_URL = 'https://budjetti.vm.fi/opendata/opendata-xml.jsp';

// ── Fetch XSD via schemaLocation in the root document ────────────────────────

console.log(`Fetching ${ROOT_URL} …`);
const rootXml = await fetch(ROOT_URL).then(r => {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
});

const locMatch = rootXml.match(/schemaLocation="([^"]+)"/);
if (!locMatch) throw new Error('No xsi:schemaLocation found in root document');

const xsdUrl = locMatch[1].trim().split(/\s+/).at(-1).replace(/^http:/, 'https:');
console.log(`Fetching schema ${xsdUrl} …`);
const xsd = await fetch(xsdUrl).then(r => {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function allMatches(src, re) { return [...src.matchAll(re)].map(m => m[1]); }
function unique(arr)          { return [...new Set(arr)]; }

// Detect the XML Schema namespace prefix (commonly 'xs' or 'xsd')
const xsPrefix = xsd.match(/xmlns:(\w+)="http:\/\/www\.w3\.org\/2001\/XMLSchema"/)?.[1] ?? 'xs';
const XS = xsPrefix + ':';
console.log(`XSD namespace prefix: ${XS}`);

// Attributes to skip — these are loading hints removed after fetching
const SKIP_ATTRS = new Set(['href', 'xlink:href']);

// Attributes with numeric types (built after prefix detection)
const NUM_TYPE_NAMES = ['decimal', 'integer', 'int', 'long', 'float', 'double'];
const NUM_TYPES = new Set(NUM_TYPE_NAMES.map(t => XS + t));

// Convert kebab/colon names to camelCase
function toCamel(s) {
  return s.replace(/[-:]([a-z])/g, (_, c) => c.toUpperCase());
}

// Extract the inner text of the first XML block with a given tag + name attr.
// Uses a depth counter so nested same-tag elements are handled correctly.
function extractBlock(tag, name) {
  const openRe = new RegExp(`<${tag}\\s+name="${name}"[^>]*>`);
  const m = xsd.match(openRe);
  if (!m || m.index == null) return '';
  const start = m.index + m[0].length;
  const open  = `<${tag}`;
  const close = `</${tag}>`;
  let depth = 1;
  let pos   = start;
  while (depth > 0) {
    const nextOpen  = xsd.indexOf(open, pos);
    const nextClose = xsd.indexOf(close, pos);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const gt = xsd.indexOf('>', nextOpen);
      if (gt !== -1 && xsd[gt - 1] !== '/') depth++;
      pos = (gt !== -1 ? gt : nextOpen) + 1;
    } else {
      depth--;
      if (depth === 0) return xsd.slice(start, nextClose);
      pos = nextClose + close.length;
    }
  }
  return '';
}

// ── Parse attributes (handles both self-closing and element-with-children) ────

function parseAttrs(body) {
  const attrs = [];
  let pos = 0;
  const attrOpen  = `<${XS}attribute`;
  const attrClose = `</${XS}attribute>`;
  const enumRe    = new RegExp(`<${XS}enumeration\\s+value="([^"]+)"`, 'g');
  while (true) {
    const start = body.indexOf(attrOpen, pos);
    if (start === -1) break;
    const gtIdx = body.indexOf('>', start);
    if (gtIdx === -1) break;
    const openTag = body.slice(start, gtIdx + 1);
    const isSelfClosing = body[gtIdx - 1] === '/';

    const name = openTag.match(/\sname="([^"]+)"/)?.[1]
      ?? (openTag.match(/\sref="xlink:(\w+)"/)?.[1] && 'xlink:' + openTag.match(/\sref="xlink:(\w+)"/)[1]);
    const type = openTag.match(/\stype="([^"]+)"/)?.[1] ?? `${XS}string`;
    const use  = openTag.match(/\suse="([^"]+)"/)?.[1] ?? 'optional';

    let enums = [];
    if (!isSelfClosing) {
      const closeIdx = body.indexOf(attrClose, gtIdx);
      if (closeIdx !== -1) {
        const content = body.slice(gtIdx + 1, closeIdx);
        enums = [...content.matchAll(enumRe)].map(m => m[1]);
        pos = closeIdx + attrClose.length;
      } else {
        pos = gtIdx + 1;
      }
    } else {
      pos = gtIdx + 1;
    }

    if (!name || SKIP_ATTRS.has(name)) continue;
    attrs.push({ name, type, use, enums });
  }
  return attrs;
}

// ── Parse attributeGroups ─────────────────────────────────────────────────────

const attrGroupNames = unique(allMatches(xsd, new RegExp(`<${XS}attributeGroup\\s+name="([^"]+)"`, 'g')));
const attrGroups = {};
for (const g of attrGroupNames) {
  attrGroups[g] = parseAttrs(extractBlock(`${XS}attributeGroup`, g));
}

// ── Parse complexTypes ────────────────────────────────────────────────────────

const typeNames = unique(allMatches(xsd, new RegExp(`<${XS}complexType\\s+name="([^"]+)"`, 'g')));
const complexTypes = {};
for (const t of typeNames) {
  const body = extractBlock(`${XS}complexType`, t);
  complexTypes[t] = parseBodyDef(body);
}

function parseBodyDef(body) {
  // Children
  const children = [];
  const choiceRe   = new RegExp(`<${XS}choice(\\s[^>]*)>([\\s\\S]*?)<\\/${XS}choice>`, 'gs');
  const sequenceRe = new RegExp(`<${XS}sequence(\\s[^>]*)>([\\s\\S]*?)<\\/${XS}sequence>`, 'gs');
  const elementRe  = new RegExp(`<${XS}element(\\s[^>]*)(?:\\/>|>)`, 'gs');
  const attrGroupRefRe = new RegExp(`<${XS}attributeGroup\\s+ref="([^"]+)"`, 'g');

  // ── xs:choice blocks: propagate the choice's own maxOccurs/minOccurs ─────────
  const choiceRanges = [];
  for (const cm of body.matchAll(choiceRe)) {
    choiceRanges.push([cm.index, cm.index + cm[0].length]);
    const pMax = cm[1].match(/\smaxOccurs="([^"]+)"/)?.[1] ?? '1';
    const pMin = cm[1].match(/\sminOccurs="([^"]+)"/)?.[1] ?? '1';
    for (const [, tag] of cm[2].matchAll(elementRe)) {
      const ref = tag.match(/\sref="([^"]+)"/)?.[1];
      if (!ref) continue;
      const maxOccurs = tag.match(/\smaxOccurs="([^"]+)"/)?.[1] ?? pMax;
      const minOccurs = tag.match(/\sminOccurs="([^"]+)"/)?.[1] ?? pMin;
      const isArray   = maxOccurs === 'unbounded' || parseInt(maxOccurs) > 1;
      const isOptional = minOccurs === '0' && !isArray;
      children.push({ ref, isArray, isOptional });
    }
  }

  // ── xs:sequence blocks with non-default maxOccurs: propagate to children ─────
  const sequenceRanges = [];
  for (const sm of body.matchAll(sequenceRe)) {
    const pMax = sm[1].match(/\smaxOccurs="([^"]+)"/)?.[1] ?? '1';
    const pMin = sm[1].match(/\sminOccurs="([^"]+)"/)?.[1] ?? '1';
    if (pMax === '1' && pMin === '1') continue; // default — handled by direct loop
    sequenceRanges.push([sm.index, sm.index + sm[0].length]);
    for (const [, tag] of sm[2].matchAll(elementRe)) {
      const ref = tag.match(/\sref="([^"]+)"/)?.[1];
      if (!ref) continue;
      const maxOccurs = tag.match(/\smaxOccurs="([^"]+)"/)?.[1] ?? pMax;
      const minOccurs = tag.match(/\sminOccurs="([^"]+)"/)?.[1] ?? pMin;
      const isArray   = maxOccurs === 'unbounded' || parseInt(maxOccurs) > 1;
      const isOptional = minOccurs === '0' && !isArray;
      children.push({ ref, isArray, isOptional });
    }
  }

  // ── Direct xs:element children (not inside a choice/sequence block) ──────────
  for (const em of body.matchAll(elementRe)) {
    if (choiceRanges.some(([s, e]) => em.index >= s && em.index < e)) continue;
    if (sequenceRanges.some(([s, e]) => em.index >= s && em.index < e)) continue;
    const ref = em[1].match(/\sref="([^"]+)"/)?.[1];
    if (!ref) continue;
    const maxOccurs = em[1].match(/\smaxOccurs="([^"]+)"/)?.[1] ?? '1';
    const minOccurs = em[1].match(/\sminOccurs="([^"]+)"/)?.[1] ?? '1';
    const isArray   = maxOccurs === 'unbounded' || parseInt(maxOccurs) > 1;
    const isOptional = minOccurs === '0' && !isArray;
    children.push({ ref, isArray, isOptional });
  }

  // Attributes
  const attrs = parseAttrs(body);

  // Inline attributeGroup refs
  for (const gName of allMatches(body, attrGroupRefRe)) {
    attrs.push(...(attrGroups[gName] ?? []));
  }

  return { children, attrs };
}

// ── Map xs:element name → its complexType ─────────────────────────────────────

const elementTypeMap = {};
for (const [, tag] of xsd.matchAll(new RegExp(`<${XS}element(\\s[^>]*?)(?:\\/>|>)`, 'gs'))) {
  const name = tag.match(/\sname="([^"]+)"/)?.[1];
  const type = tag.match(/\stype="([^"]+)"/)?.[1];
  if (name && type) elementTypeMap[name] = type;
}

const elementNames = unique(allMatches(xsd, new RegExp(`<${XS}element\\s+name="([^"]+)"`, 'g'))).sort();

// ── Build per-element structural map ─────────────────────────────────────────

const schema = {};
for (const el of elementNames) {
  const named = complexTypes[elementTypeMap[el]];
  schema[el] = named ?? parseBodyDef(extractBlock(`${XS}element`, el));
}

// ── Topological sort (leaves first) ──────────────────────────────────────────

function topoSort(names) {
  const visited = new Set();
  const order   = [];

  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    for (const { ref } of (schema[name]?.children ?? [])) {
      if (schema[ref]) visit(ref);
    }
    order.push(name);
  }

  for (const n of names) visit(n);
  return order;
}

const ordered = topoSort(elementNames);

// ── TypeScript type for an attribute ─────────────────────────────────────────

function attrTsType({ type, use, enums }) {
  const base = enums?.length > 0
    ? enums.map(v => `'${v}'`).join(' | ') + ' | (string & {})'
    : NUM_TYPES.has(type) ? 'number' : 'string';
  return use === 'optional' ? `${base} | null` : base;
}

// ── Detect lazy-loadable elements ────────────────────────────────────────────

// Elements whose complexType declares xlink:href
const xlinkElements = new Set();
for (const el of elementNames) {
  const typeName = elementTypeMap[el];
  if (!typeName) continue;
  const body = extractBlock(`${XS}complexType`, typeName);
  if (body.includes('ref="xlink:')) xlinkElements.add(el);
}

// Root elements (not referenced as a child by any other element)
const referencedByOther = new Set();
for (const el of elementNames) {
  for (const { ref } of (schema[el]?.children ?? [])) {
    referencedByOther.add(ref);
  }
}
const rootElements = new Set(elementNames.filter(el => !referencedByOther.has(el)));

// Propagate laziness up: parents of lazy elements also need Lazy variants
const lazyElements = new Set(xlinkElements);
let lazyChanged = true;
while (lazyChanged) {
  lazyChanged = false;
  for (const el of elementNames) {
    if (lazyElements.has(el)) continue;
    const def = schema[el];
    if (!def) continue;
    if (def.children.some(({ ref }) => lazyElements.has(ref))) {
      lazyElements.add(el);
      lazyChanged = true;
    }
  }
}

console.log(`Lazy-loadable (xlink:href): ${[...xlinkElements].join(', ')}`);
console.log(`All lazy elements: ${[...lazyElements].join(', ')}`);
console.log(`Root elements: ${[...rootElements].join(', ')}`);

// ── Emit src/schema.ts ────────────────────────────────────────────────────────

// Regular XSD interfaces (skip root elements — only the lazy version is emitted)
const interfaces = ordered
  .filter(name => schema[name] && !rootElements.has(name))
  .map(name => {
    const { children, attrs } = schema[name];
    const lines = [];

    for (const { name: a, type, use, enums } of attrs) {
      lines.push(`  ${toCamel(a)}: ${attrTsType({ type, use, enums })};`);
    }
    for (const { ref } of children) {
      if (!schema[ref]) continue;
      lines.push(`  ${ref}: ${ref}[];`);
    }

    return `export interface ${name} {\n${lines.join('\n')}\n}`;
  });

// Lazy interfaces for xlink elements, their ancestors, and root
const lazyInterfaces = ordered
  .filter(name => lazyElements.has(name) && schema[name])
  .map(name => {
    const { children, attrs } = schema[name];
    const lines = [];
    const isXlink = xlinkElements.has(name);
    const isRoot = rootElements.has(name);
    const usePromise = isXlink || isRoot;

    for (const { name: a, type, use, enums } of attrs) {
      lines.push(`  ${toCamel(a)}: ${attrTsType({ type, use, enums })};`);
    }

    for (const { ref } of children) {
      if (!schema[ref]) continue;
      const childType = lazyElements.has(ref) ? `Lazy${ref}` : ref;
      if (usePromise) {
        lines.push(`  readonly ${ref}: Promise<${childType}[]>;`);
      } else {
        lines.push(`  ${ref}: ${childType}[];`);
      }
    }

    const interfaceName = isRoot ? name : `Lazy${name}`;
    return `export interface ${interfaceName} {\n${lines.join('\n')}\n}`;
  });

const out = `// Auto-generated from ${xsdUrl}
// Regenerate with: npm run gen-schema

${interfaces.join('\n\n')}

// ── Lazy types (for elements with xlink:href and their ancestors) ────────────

${lazyInterfaces.join('\n\n')}
`;

const outPath = resolve(root, 'src', 'schema.ts');
writeFileSync(outPath, out, 'utf-8');
console.log(`Generated schema.ts  (${ordered.length} interfaces)`);
