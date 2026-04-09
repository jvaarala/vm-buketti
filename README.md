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

// Navigate the budget tree
const juuri   = service.getJuuri();
const vuodet  = await juuri.Vuosi;                     // all budget years
const teos    = vuodet[0].Teos[0];                     // first publication (e.g. tae)
const kanta   = teos.Kanta[0];                         // budget version
const pkList  = await kanta.Paaluokka;                 // expense main classes (lazy fetch)
const menot   = await pkList[0].Menoluku;              // chapters within first main class
```

Data is fetched on demand. Accessing a property for the first time fires the corresponding XML request; repeated accesses return the cached Promise.

## API

### `createVmBuketti(options?)`

Returns a `VmBuketti` instance.

| Option | Type | Description |
|--------|------|-------------|
| `proxyUrl` | `string` | Prefix for CORS proxy requests, e.g. `'/proxy'`. Appends `?url=<encoded>`. |
| `fetchXml` | `(url: string) => Promise<string>` | Custom fetch function. Takes precedence over `proxyUrl`. |
| `onError` | `(error: Error, url: string) => void` | Called when a sub-link fetch fails. Defaults to silent (partial data returned). |

### `service.getJuuri(): Juuri`

Returns the root node. Calling this does not trigger any network requests — fetches are deferred until properties are accessed.

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

All types mirror the XSD schema from budjetti.vm.fi. Lazy nodes (fetched on demand) use `Lazy*` prefixed types with `Promise<T[]>` children.

```ts
import type { LazyVuosi, LazyKanta, Menoluku } from '@jvaarala/vm-buketti';
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
