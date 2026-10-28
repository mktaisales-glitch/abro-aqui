// The concepts the demo is known to handle (spec 06): the 15 "what fits here" concepts. Each has an English id
// (what Qloo is asked about), labels for the UI, and the words people actually type for it in Spanish, English
// and Catalan, so "hamburguesería" or "cafetería" reach the same Qloo tags as "burger" or "coffee shop".
// Tags: only the pairs already checked on the live API are written here; the rest are resolved with /v2/tags.

export const CONCEPT_LIST = [
  { id: "seafood restaurant", en: "Seafood restaurant", es: "Marisquería", tags: ["urn:tag:genre:place:restaurant:seafood", "urn:tag:category:place:seafood_restaurant"],
    syn: ["seafood", "seafood restaurant", "fish restaurant", "marisqueria", "marisco", "mariscos", "restaurante de marisco", "restaurante de mariscos", "restaurante de pescado", "pescado y marisco", "restaurant de marisc", "marisc"] },
  { id: "pizza", en: "Pizzeria", es: "Pizzería", tags: ["urn:tag:genre:place:restaurant:pizza", "urn:tag:category:place:pizza"],
    syn: ["pizza", "pizzas", "pizzeria", "pizza place", "pizza restaurant", "pizzeria napolitana"] },
  { id: "ramen", en: "Ramen bar", es: "Ramen", tags: ["urn:tag:genre:place:restaurant:ramen", "urn:tag:category:place:ramen_restaurant"],
    syn: ["ramen", "ramen bar", "ramen shop", "ramen restaurant", "restaurante de ramen", "ramenteria"] },
  { id: "sushi", en: "Sushi bar", es: "Sushi", syn: ["sushi", "sushi bar", "sushi restaurant", "restaurante de sushi", "restaurant de sushi"] },
  { id: "burger", en: "Burger joint", es: "Hamburguesería",
    syn: ["burger", "burgers", "hamburger", "hamburgers", "burger joint", "burger bar", "burger restaurant", "hamburguesa", "hamburguesas", "hamburgueseria", "hamburgueserias"] },
  { id: "tapas", en: "Tapas bar", es: "Bar de tapas", syn: ["tapas", "tapas bar", "bar de tapas", "tapeo", "tapes", "bar de tapes"] },
  { id: "vegan restaurant", en: "Vegan restaurant", es: "Restaurante vegano",
    syn: ["vegan", "vegan restaurant", "vegano", "vegana", "restaurante vegano", "comida vegana", "vega", "restaurant vega"] },
  { id: "mexican restaurant", en: "Mexican restaurant", es: "Restaurante mexicano",
    syn: ["mexican", "mexican restaurant", "mexicano", "restaurante mexicano", "comida mexicana", "taqueria", "tacos", "mexica", "restaurant mexica"] },
  { id: "italian restaurant", en: "Italian restaurant", es: "Restaurante italiano",
    syn: ["italian", "italian restaurant", "italiano", "restaurante italiano", "comida italiana", "trattoria", "italia", "restaurant italia"] },
  { id: "brunch", en: "Brunch spot", es: "Brunch", syn: ["brunch", "brunch spot", "brunch cafe", "brunch place", "desayunos", "desayuno", "breakfast", "esmorzars"] },
  { id: "coffee shop", en: "Coffee shop", es: "Cafetería", tags: ["urn:tag:genre:place:restaurant:coffee_shop", "urn:tag:category:place:coffee_shop"],
    syn: ["coffee", "coffee shop", "coffee house", "cafe", "cafeteria", "cafeterias", "specialty coffee", "cafe de especialidad", "cafe d especialitat", "cafes"] },
  { id: "bakery", en: "Bakery", es: "Panadería", tags: ["urn:tag:genre:place:restaurant:bakery", "urn:tag:category:place:bakery"],
    syn: ["bakery", "bakeries", "bread shop", "panaderia", "panaderias", "pan", "forn", "fleca", "forn de pa"] },
  { id: "ice cream", en: "Ice cream shop", es: "Heladería", tags: ["urn:tag:genre:place:restaurant:ice_cream_shop", "urn:tag:category:place:ice_cream_shop"],
    syn: ["ice cream", "ice cream shop", "ice cream parlor", "gelato", "gelateria", "heladeria", "heladerias", "helado", "helados", "gelats", "gelat"] },
  { id: "cocktail bar", en: "Cocktail bar", es: "Coctelería",
    syn: ["cocktail", "cocktails", "cocktail bar", "cocteleria", "coctel", "cocteles", "bar de cocteles", "bar de copas"] },
  { id: "wine bar", en: "Wine bar", es: "Bar de vinos",
    syn: ["wine bar", "wine", "bar de vinos", "vinos", "vinoteca", "enoteca", "bodega", "bodegas", "vermut", "vermuteria", "vermouth", "vermouth bar", "bar de vins", "celler"] },
];

/** lower case, no accents, words only: "Hamburguesería " → "hamburgueseria" */
export const normConcept = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/·/g, "").replace(/[^a-z0-9]+/g, " ").trim()
  .replace(/^(?:a|an|the|un|una|el|la|los|las|uno)\s+/, "");

const INDEX = new Map();
for (const c of CONCEPT_LIST) for (const w of [c.id, c.en, c.es, ...c.syn]) if (!INDEX.has(normConcept(w))) INDEX.set(normConcept(w), c);

/** The curated concept a typed text means (id, label or synonym, any accents or case), or null. */
export function matchConcept(text) {
  const n = normConcept(text);
  if (!n) return null;
  return INDEX.get(n) ?? (n.endsWith("s") ? INDEX.get(n.slice(0, -1)) : null) ?? (n.endsWith("es") ? INDEX.get(n.slice(0, -2)) : null) ?? null;
}

/** Tags already known for a concept id, as the resolver returns them; null when they still have to be resolved. */
export function knownResolved(id) {
  const c = CONCEPT_LIST.find((x) => x.id === id);
  if (!c?.tags) return null;
  return [{ part: c.id, heatmap_tag: c.tags[0], competitor_tag: c.tags[1], heat_candidates: [c.tags[0]], comp_candidates: [c.tags[1]], label: c.id }];
}

/** What GET /api/concepts returns: labels and synonyms for the dropdown (no tags). */
export const publicConcepts = (dropped = new Set()) => CONCEPT_LIST.filter((c) => !dropped.has(c.id)).map(({ id, en, es, syn }) => ({ id, en, es, synonyms: syn }));
