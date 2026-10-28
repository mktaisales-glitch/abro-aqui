// Spanish names for the Qloo tag values shown to owners (customer identity, time of day, cuisine, kind of place)
// and for common concept parts. Anything not listed is shown as Qloo returns it.
export const ES_TAGS = {
  // who
  "locals": "Vecinos", "groups of friends": "Grupos de amigos", "tourists": "Turistas", "foodies": "Foodies", "couples": "Parejas",
  "solo diners": "Gente que come sola", "families": "Familias", "students": "Estudiantes", "business travelers": "Viajes de trabajo",
  "professionals": "Profesionales", "kids": "Niños", "large groups": "Grupos grandes", "date night": "Citas",
  // when
  "evening": "tarde-noche", "afternoon": "tarde", "midday": "mediodía", "late night": "madrugada", "morning": "mañana",
  "all day": "todo el día", "breakfast": "desayuno", "brunch": "brunch", "lunch": "comida", "dinner": "cena", "happy hour": "afterwork",
  // serves / kind
  "spanish": "Española", "seafood": "Marisco", "tapas": "Tapas", "catalan": "Catalana", "mediterranean": "Mediterránea", "burgers": "Hamburguesas",
  "american": "Americana", "taqueria": "Taquería", "european": "Europea", "fusion": "Fusión", "italian": "Italiana", "japanese": "Japonesa",
  "pizza": "Pizza", "coffee": "Café", "cafe": "Cafetería", "dessert": "Postres", "desserts": "Postres", "ice cream": "Helado", "bakery": "Panadería",
  "bar": "Bar", "tapas bar": "Bar de tapas", "cocktail bar": "Coctelería", "pub": "Pub", "wine bar": "Bodega", "night club": "Discoteca",
  "mediterranean restaurant": "Restaurante mediterráneo", "spanish restaurant": "Restaurante español", "tapas restaurant": "Restaurante de tapas",
  "catalonian restaurant": "Restaurante catalán", "fine dining restaurant": "Alta cocina", "galician restaurant": "Restaurante gallego",
  "rice restaurant": "Arrocería", "seafood restaurant": "Marisquería", "performing arts theater": "Teatro", "coffee shop": "Cafetería",
  "ice cream shop": "Heladería", "hotel": "Hotel", "museum": "Museo", "gym": "Gimnasio", "bookstore": "Librería",
  // concept parts
  "waffles": "gofres", "waffle": "gofres", "specialty coffee": "café de especialidad", "ramen": "ramen",
};
export const es = (name) => ES_TAGS[String(name ?? "").toLowerCase()] ?? name;
const PARTS = { "seafood restaurant": "marisco", "seafood": "marisco", "ice cream": "helado", "waffles": "gofres", "waffle": "gofres", "specialty coffee": "café de especialidad", "coffee": "café", "bakery": "pan", "ramen": "ramen", "pizza": "pizza", "tapas": "tapas",
  "burger": "hamburguesas", "burgers": "hamburguesas", "sushi": "sushi", "vegan restaurant": "cocina vegana", "vegan": "cocina vegana", "mexican restaurant": "cocina mexicana",
  "mexican": "cocina mexicana", "italian restaurant": "cocina italiana", "italian": "cocina italiana", "brunch": "brunch", "coffee shop": "café", "cocktail bar": "cócteles",
  "cocktails": "cócteles", "wine bar": "vino", "wine": "vino" };
/** A concept part in Spanish, lower case: "seafood restaurant" → "marisco". */
export const esPart = (p) => PARTS[String(p ?? "").toLowerCase()] ?? String(es(p)).toLowerCase();
