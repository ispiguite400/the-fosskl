/**
 * The decision schema.
 *
 * Structured outputs mean Claude cannot hand back anything that isn't a valid
 * decision - no JSON repair, no "sometimes it writes prose". The add-on
 * re-validates every field anyway (packs/AI_Citizens_BP/scripts/brain/schema.js),
 * so this is the first of two gates, not the only one.
 */

const ACTION_NAMES = [
  "goto", "follow", "mine", "mine_at", "chop", "dig", "place", "build",
  "craft", "farm", "attack", "flee", "guard", "eat", "sleep", "rest",
  "store", "fetch", "give", "explore", "light", "wait", "job", "found", "point",
];

export const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["say", "goal", "mood", "actions"],
  properties: {
    say: {
      type: ["string", "null"],
      description:
        "One or two short sentences this citizen says out loud, in their own voice. " +
        "Shown as a caption above their head, so keep it under about 140 characters. " +
        "Null when they have nothing worth saying right now - silence is normal.",
    },
    to: {
      type: ["string", "null"],
      description: "Who they are speaking to, by name, or null for nobody in particular.",
    },
    mood: {
      type: "string",
      description: "One word for how they feel: cheerful, steady, uneasy, afraid, tired, proud, low.",
    },
    goal: {
      type: "string",
      description: "A short phrase for what they are trying to achieve, e.g. 'get the roof on before dark'.",
    },
    remember: {
      type: "array",
      maxItems: 3,
      items: { type: "string" },
      description:
        "Facts worth keeping - where ore is, who did what, what the town needs. " +
        "Short statements, not narration.",
    },
    actions: {
      type: "array",
      maxItems: 4,
      description:
        "What they do next, in order. Empty when the current work should continue. " +
        "Only use actions from the list you were given.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["do"],
        properties: {
          do: { type: "string", enum: ACTION_NAMES },
          why: { type: "string", description: "A few words on the reason, for the log." },
          x: { type: "number" },
          y: { type: "number" },
          z: { type: "number" },
          who: { type: "string", description: "A player, citizen or creature by name." },
          block: { type: "string", description: "A block id such as minecraft:iron_ore." },
          item: { type: "string", description: "An item id such as minecraft:stone_pickaxe." },
          structure: { type: "string", description: "A structure id from the known list." },
          role: { type: "string", description: "A job to take up." },
          count: { type: "integer", minimum: 1, maximum: 64 },
          radius: { type: "integer", minimum: 4, maximum: 160 },
          seconds: { type: "integer", minimum: 1, maximum: 600 },
        },
      },
    },
  },
};

export { ACTION_NAMES };
