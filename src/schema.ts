// Auto-generated from https://budjetti.vm.fi/indox/opendata/kl_buketti.xsd
// Regenerate with: npm run gen-schema

export interface Laskelmaraha {
  tyyppi: 'toteutuma' | 'aiemmin-budjetoitu' | 'aiemmin-budjetoitu-ltae' | 'aiemmin-budjetoitu-ltae1' | 'aiemmin-budjetoitu-ltae2' | 'aiemmin-budjetoitu-ltae3' | 'aiemmin-budjetoitu-ltae4' | 'aiemmin-budjetoitu-ltae5' | 'muutosraha' | 'maararaha' | (string & {});
  vuosi: string | null;
  arvo: number | null;
}

export interface Muutos {
  kuvaus: string | null;
  Laskelmaraha: Laskelmaraha[];
}

export interface Vertailuluvut {
  Laskelmaraha: Laskelmaraha[];
}

export interface Budjettilaskelma {
  Laskelmaraha: Laskelmaraha[];
  Muutos: Muutos[];
  Vertailuluvut: Vertailuluvut[];
}

export interface Tulomomentti {
  nimi: string | null;
  numero: string | null;
  momenttityyppi: 'aktiivinen' | 'poistettava' | 'poistettu' | 'siirretty' | 'uusi' | (string & {}) | null;
  infoOsa: string | null;
  Budjettilaskelma: Budjettilaskelma[];
}

export interface Tuloluku {
  nimi: string | null;
  numero: string | null;
  lukutyyppi: 'aktiivinen' | 'poistettava' | 'poistettu' | 'uusi' | (string & {}) | null;
  infoOsa: string | null;
  Tulomomentti: Tulomomentti[];
}

export interface Osasto {
  numero: string | null;
  nimi: string | null;
  Tuloluku: Tuloluku[];
}

export interface Menomomentti {
  maararahalaji: 'arviomaararaha' | 'kiinteamaararaha' | 'siirtomaararaha_2v' | 'siirtomaararaha_3v' | 'siirtomaararaha_5v' | (string & {}) | null;
  nimi: string | null;
  numero: string | null;
  momenttityyppi: 'aktiivinen' | 'poistettava' | 'poistettu' | 'siirretty' | 'uusi' | (string & {}) | null;
  infoOsa: string | null;
  Budjettilaskelma: Budjettilaskelma[];
}

export interface Menoluku {
  nimi: string | null;
  numero: string | null;
  lukutyyppi: 'aktiivinen' | 'poistettava' | 'poistettu' | 'uusi' | (string & {}) | null;
  infoOsa: string | null;
  Menomomentti: Menomomentti[];
}

export interface Paaluokka {
  numero: string | null;
  nimi: string | null;
  Menoluku: Menoluku[];
}

export interface Kanta {
  kanta: 'valtiovarainministerionKanta' | 'hallituksenEsitys' | 'eduskunnanKirjelma' | (string & {}) | null;
  Osasto: Osasto[];
  Paaluokka: Paaluokka[];
}

export interface Teos {
  nimi: string | null;
  teostyyppi: 'tae' | 'ltae1' | 'ltae2' | 'ltae3' | 'ltae4' | 'ltae5' | (string & {}) | null;
  Kanta: Kanta[];
}

export interface Vuosi {
  vuosi: number;
  Teos: Teos[];
}

// ── Lazy types (for elements with xlink:href and their ancestors) ────────────

export interface LazyOsasto {
  numero: string | null;
  nimi: string | null;
  readonly Tuloluku: Promise<Tuloluku[]>;
}

export interface LazyPaaluokka {
  numero: string | null;
  nimi: string | null;
  readonly Menoluku: Promise<Menoluku[]>;
}

export interface LazyKanta {
  kanta: 'valtiovarainministerionKanta' | 'hallituksenEsitys' | 'eduskunnanKirjelma' | (string & {}) | null;
  readonly Osasto: Promise<LazyOsasto[]>;
  readonly Paaluokka: Promise<LazyPaaluokka[]>;
}

export interface LazyTeos {
  nimi: string | null;
  teostyyppi: 'tae' | 'ltae1' | 'ltae2' | 'ltae3' | 'ltae4' | 'ltae5' | (string & {}) | null;
  Kanta: LazyKanta[];
}

export interface LazyVuosi {
  vuosi: number;
  Teos: LazyTeos[];
}

export interface Juuri {
  readonly Vuosi: Promise<LazyVuosi[]>;
}
