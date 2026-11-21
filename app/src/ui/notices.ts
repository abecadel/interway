// Where each country publishes notices to skippers (closures, low water, lock hours). The route brief names the
// sources of the countries whose towns a route passes; the data has no closures of its own.
export const NOTICES: Record<string, { name: string; url: string }> = {
  PL: { name: 'Wody Polskie, komunikaty nawigacyjne', url: 'https://www.gov.pl/web/wody-polskie' },
  DE: { name: 'ELWIS, Nachrichten für die Binnenschifffahrt', url: 'https://www.elwis.de' },
  LU: { name: 'ELWIS (Moselle)', url: 'https://www.elwis.de' },
  NL: { name: 'Vaarweginformatie', url: 'https://www.vaarweginformatie.nl' },
  BE: { name: 'Visuris (Flanders) and Voies hydrauliques (Wallonia)', url: 'https://www.visuris.be' },
  FR: { name: 'VNF, avis à la batellerie', url: 'https://www.vnf.fr/vnf/services/avisbat/' },
  AT: { name: 'DoRIS (Danube)', url: 'https://www.doris.bmk.gv.at' },
  CZ: { name: 'Státní plavební správa', url: 'https://www.spspraha.cz' },
  HU: { name: 'Hydroinfo', url: 'https://www.hydroinfo.hu' },
  RO: { name: 'AFDJ Galați (lower Danube)', url: 'https://www.afdj.ro' },
  GB: { name: 'Canal & River Trust, notices', url: 'https://canalrivertrust.org.uk/notices' },
  IE: { name: 'Waterways Ireland, marine notices', url: 'https://www.waterwaysireland.org/marine-notices' },
  SE: { name: 'Sjöfartsverket, notices to mariners', url: 'https://www.sjofartsverket.se' },
};

/** The notices sources for the countries, in the order given, each once. */
export function noticesFor(countries: string[]): { cc: string; name: string; url: string }[] {
  return [...new Set(countries)].filter((cc) => NOTICES[cc]).map((cc) => ({ cc, ...NOTICES[cc] }));
}
