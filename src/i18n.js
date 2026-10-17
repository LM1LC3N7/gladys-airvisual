// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, test button), en and fr.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => (n === 1 ? one : many);

/** "2026-10-17T18:00:00Z" -> "18:00 UTC". */
export const utcTime = (ms) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

/** Why a location or a node has no fresh value. */
export const REASONS = {
  refused: { en: 'API key refused', fr: "clé d'API refusée" },
  limited: { en: 'too many calls (429)', fr: "trop d'appels (429)" },
  budget: { en: 'daily budget spent', fr: 'budget du jour épuisé' },
  not_found: { en: 'not found', fr: 'introuvable' },
  no_station: { en: 'no city nearby', fr: 'aucune ville à proximité' },
  failed: { en: 'no answer', fr: 'pas de réponse' },
};

export const reason = (kind) => REASONS[kind] ?? REASONS.failed;

export const T = {
  notConfigured: {
    en: 'Enter your AirVisual API key (for the houses and the cities), or the id of an AirVisual Pro.',
    fr: "Saisissez votre clé d'API AirVisual (pour les maisons et les villes), ou l'identifiant d'un AirVisual Pro.",
  },
  noLocation: {
    en: 'No location to read: give a house of Gladys a position, or enter a city.',
    fr: 'Aucun lieu à lire : donnez une position à une maison de Gladys, ou saisissez une ville.',
  },
  keyRefused: {
    en: 'AirVisual refused the API key (wrong, expired or without access): the reads stop. Check the key on the IQAir dashboard; one new try every 6 hours until the key changes.',
    fr: "AirVisual a refusé la clé d'API (erronée, expirée ou sans accès) : les lectures s'arrêtent. Vérifiez la clé sur le tableau de bord IQAir ; un nouvel essai toutes les 6 heures jusqu'à ce que la clé change.",
  },
  rateLimited: (until) => ({
    en: `AirVisual asks to slow down (call limit reached): no call before ${utcTime(until)}.`,
    fr: `AirVisual demande de ralentir (limite d'appels atteinte) : aucun appel avant ${utcTime(until)}.`,
  }),
  budgetSpent: (until) => ({
    en: `The daily call budget of the free plan is spent: the reads resume at ${utcTime(until)}.`,
    fr: `Le budget d'appels du jour du plan gratuit est épuisé : les lectures reprennent à ${utcTime(until)}.`,
  }),
  invalidEntries: (cities, nodes) => ({
    en: [
      cities
        ? `${cities} city ${plural(cities, 'entry', 'entries')} ignored (expected "City, State, Country")`
        : '',
      nodes ? `${nodes} node ${plural(nodes, 'id', 'ids')} ignored` : '',
    ]
      .filter(Boolean)
      .join(', '),
    fr: [
      cities
        ? `${cities} ${plural(cities, 'ville ignorée', 'villes ignorées')} (format attendu « Ville, Région, Pays »)`
        : '',
      nodes
        ? `${nodes} ${plural(nodes, 'identifiant de node ignoré', 'identifiants de node ignorés')}`
        : '',
    ]
      .filter(Boolean)
      .join(', '),
  }),
  /** The connected status: what is read, and what fails. */
  ok: ({ locations, nodes, interval, failing = [] }) => {
    const en = [];
    const fr = [];
    if (locations > 0) {
      en.push(`${locations} ${plural(locations, 'location', 'locations')} (every ${interval} min)`);
      fr.push(`${locations} ${plural(locations, 'lieu', 'lieux')} (toutes les ${interval} min)`);
    }
    if (nodes > 0) {
      en.push(`${nodes} AirVisual Pro`);
      fr.push(`${nodes} AirVisual Pro`);
    }
    let textEn = `${en.join(', ')}.`;
    let textFr = `${fr.join(', ')}.`;
    if (failing.length > 0) {
      textEn += ` Without value: ${failing.map((f) => `${f.name} (${reason(f.kind).en})`).join(', ')}.`;
      textFr += ` Sans valeur : ${failing.map((f) => `${f.name} (${reason(f.kind).fr})`).join(', ')}.`;
    }
    return { en: textEn, fr: textFr };
  },
};
