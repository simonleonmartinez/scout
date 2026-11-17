const Identifiers = {
    adjectives: [
        "Bright",
        "Curious",
        "Swift",
        "Bold",
        "Gentle",
        "Mystic",
        "Shiny",
        "Clever",
        "Ancient",
        "Fresh",
        "Wild",
        "Radiant",
        "Daring",
        "Lively",
        "Fierce",
        "Velvet",
        "Twilight",
        "Blooming",
        "Spirited",
        "Shimmering",
    ],
    plants: [
        "Hoya",
        "Wisteria",
        "Lavender",
        "Rosemary",
        "Thyme",
        "Sage",
        "Jasmine",
        "Magnolia",
        "Camellia",
        "Azalea",
        "Hydrangea",
        "Hibiscus",
        "Oleander",
        "Fuchsia",
        "Bougainvillea",
        "Clematis",
        "Gardenia",
        "Marigold",
        "Peony",
        "Verbena",
    ],
};
/**
 * @returns A randomized session ID composed of an adjective and a plant name.
 */
export function createRandomizedSessionId() {
    const identifiers = Identifiers;
    const adjective = identifiers.adjectives[Math.floor(Math.random() * identifiers.adjectives.length)];
    const plant = identifiers.plants[Math.floor(Math.random() * identifiers.plants.length)];
    return `${adjective} ${plant}`;
}
