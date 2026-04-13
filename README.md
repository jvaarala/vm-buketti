# vm-buketti

TypeScript client for the Finnish state budget open data API at [budjetti.vm.fi](https://budjetti.vm.fi).

Turns the XML-based API into a lazy-loading tree you can navigate by awaiting properties — no manual XML parsing, no upfront fetches.

## Install

```sh
npm install @jvaarala/vm-buketti
```

## Usage

```ts
import { createVmBuketti } from '@jvaarala/vm-buketti';

// Node 18+ (direct fetch — no proxy needed):
const service = createVmBuketti();

// Browser (requires a CORS proxy):
const service = createVmBuketti({ proxyUrl: '/proxy' });
```

### Merged view (recommended starting point)

`getMergedKanta` fetches one or more publications, merges their nodes by `numero`, sums amounts, and returns a fully materialised tree with an O(1) index.

```ts
const tree = await service.getMergedKanta({
  year: 2025,
  teos: ['tae', 'ltae1'],          // combine original + first supplementary budget
  kanta: 'eduskunnanKirjelma',
});

// Typed spending/income access with pre-computed amounts
tree.Paaluokka[0].amount;          // sum of maararaha across all specified teos
tree.Paaluokka[0].comparison;      // sum of aiemmin-budjetoitu*
tree.Paaluokka[0].Menoluku[0].Menomomentti[0].amount;

// O(1) lookup by composite key
tree.get('23.10.21');              // spending:  paaluokka.menoluku.menomomentti
tree.get('T11.01.01');             // revenue:   T prefix for income branch

// Unified interface — both branches have identical shape (BudgetNode)
tree.branches.menot.nodes;         // BudgetNode[] (Paaluokka level)
tree.branches.tulot.nodes;         // BudgetNode[] (Osasto level)
tree.branches.menot.get('23.10');  // BudgetNode | undefined
```

### Navigate to a single kanta

```ts
const lk = await service.kanta({ year: 2025, teos: 'tae', kanta: 'eduskunnanKirjelma' });
const pkList = await lk.Paaluokka;   // LazyPaaluokka[]
const menot  = await pkList[0].Menoluku;
```

### Raw lazy tree

```ts
const juuri  = service.getJuuri();
const vuodet = await juuri.Vuosi;                     // all budget years
const teos   = vuodet[0].Teos[0];                     // first publication (e.g. tae)
const kanta  = teos.Kanta[0];                         // budget version
const pkList = await kanta.Paaluokka;                 // expense main classes (lazy fetch)
const menot  = await pkList[0].Menoluku;              // chapters within first main class
```

Data is fetched on demand. Accessing a property for the first time fires the corresponding XML request; repeated accesses return the cached Promise. All methods on the same service instance share a fetch cache.

## API

### `createVmBuketti(options?)`

Returns a `VmBuketti` instance.

| Option | Type | Description |
|--------|------|-------------|
| `proxyUrl` | `string` | Prefix for CORS proxy requests, e.g. `'/proxy'`. Appends `?url=<encoded>`. |
| `fetchXml` | `(url: string) => Promise<string>` | Custom fetch function. Takes precedence over `proxyUrl`. |
| `onError` | `(error: Error, url: string) => void` | Called when a sub-link fetch fails. Defaults to silent (partial data returned). |

### `service.getMergedKanta(query): Promise<MergedKanta>`

Fetches one or more teos publications, merges their nodes by `numero`, and returns a `MergedKanta`.

| Field | Type | Description |
|-------|------|-------------|
| `year` | `number` | Budget year, e.g. `2025`. |
| `teos` | `TeosType \| TeosType[]` | One or more publications: `'tae'`, `'ltae1'`–`'ltae5'`. |
| `kanta` | `KantaType` | Version: `'eduskunnanKirjelma'`, `'hallituksenEsitys'`, `'valtiovarainministerionKanta'`. |

`MergedKanta` has:
- `Paaluokka: MergedPaaluokka[]` — spending branch, typed, with `amount` and `comparison` at every level.
- `Osasto: MergedOsasto[]` — revenue branch.
- `branches: { menot: BudgetBranch; tulot: BudgetBranch }` — unified interface with `nodes` and `get(key)`.
- `get(key): BudgetNode | undefined` — O(1) lookup across both branches. Menot keys: `'23'`, `'23.10'`, `'23.10.21'`. Tulot keys: `'T11'`, `'T11.01'`, `'T11.01.01'`.

### `service.kanta(query): Promise<LazyKanta>`

Navigates to a single `LazyKanta` without resolving or merging its children.

| Field | Type |
|-------|------|
| `year` | `number` |
| `teos` | `TeosType` |
| `kanta` | `KantaType` |

### `service.getJuuri(): Juuri`

Returns the raw lazy-proxy root. Fetches are deferred until properties are accessed.

## Budget hierarchy

```
Juuri
└── Vuosi[]           (year)
    └── Teos[]        (publication: tae, ltae1–ltae7)
        └── Kanta[]   (version: hallituksenEsitys, eduskunnanKirjelma, …)
            ├── Paaluokka[]   → Menoluku[]   → Menomomentti[]   (expenses)
            └── Osasto[]      → Tuloluku[]   → Tulomomentti[]   (revenues)
```

## TypeScript types

All types mirror the XSD schema from budjetti.vm.fi. Lazy nodes (fetched on demand) use `Lazy*` prefixed types with `Promise<T[]>` children. The high-level merge API adds `Merged*` types with pre-computed `amount`/`comparison` fields. `numero` is typed `string | number` — numeric XML attributes (e.g. `numero="01"`) are cast to JS numbers at parse time, so comparisons should use `===` against a number rather than a string.

```ts
import type {
  // Raw schema types
  LazyVuosi, LazyKanta, Menoluku,
  // High-level query types
  KantaQuery, MergedKantaQuery, KantaType, TeosType,
  // Merged node types (spending)
  MergedPaaluokka, MergedMenoluku, MergedMenomomentti,
  // Merged node types (revenue)
  MergedOsasto, MergedTuloluku, MergedTulomomentti,
  // Unified branch types
  MergedKanta, BudgetBranch, BudgetNode,
} from '@jvaarala/vm-buketti';
```

Enumerated attributes (e.g. `teostyyppi`, `momenttityyppi`) include a `| (string & {})` fallback so that values the XSD hasn't yet listed — such as `ltae6`/`ltae7` in live data — are accepted without TypeScript errors while known values still benefit from autocomplete.

## Regenerating types

If the upstream XSD changes, regenerate `src/schema.ts`:

```sh
npm run gen-schema
```

The generated file must not be edited by hand.

## Requirements

- Node 18+ or any modern browser (uses `fetch` and `DOMParser`)
- No runtime dependencies

## Data license

The budget data accessed through this library is published by the Finnish Ministry of Finance as part of the open government data programme. Budget proposals have been available in machine-readable XML format since 2014 (government proposals from 2014, Ministry of Finance drafts from 2016). Parliamentary letters are also published in machine-readable form.

The data is licensed under the **Creative Commons Attribution 4.0 International** license (CC BY 4.0):
http://creativecommons.org/licenses/by/4.0/

When using data retrieved via this library, you must credit the Ministry of Finance of Finland as the data source.

This library itself (the wrapper code) is MIT-licensed.
