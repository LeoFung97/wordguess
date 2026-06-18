import type { SemanticDomain, UsageBias, WordKnowledge } from "./semantic-knowledge";

export const SEMANTIC_WORD_MAGIC = "WRSK";
export const SEMANTIC_WORD_VERSION = 1;
export const SEMANTIC_GRAPH_MAGIC = "WRSG";
export const SEMANTIC_GRAPH_VERSION = 1;

export const DOMAIN_VALUES: SemanticDomain[] = [
  "weather/climate",
  "geography/nature",
  "politics/society",
  "economy/business",
  "psychology/cognition",
  "body/health",
  "emotion",
  "action/motion",
  "abstract/general",
];

export const USAGE_BIAS_VALUES: UsageBias[] = ["literal", "figurative", "mixed", "unknown"];

const DOMAIN_INDEX = new Map(DOMAIN_VALUES.map((value, index) => [value, index]));
const USAGE_BIAS_INDEX = new Map(USAGE_BIAS_VALUES.map((value, index) => [value, index]));

export function domainToIndex(domain: SemanticDomain | undefined) {
  return DOMAIN_INDEX.get(domain ?? "abstract/general") ?? DOMAIN_INDEX.get("abstract/general")!;
}

export function indexToDomain(index: number): SemanticDomain {
  return DOMAIN_VALUES[index] ?? "abstract/general";
}

export function usageBiasToIndex(bias: UsageBias | undefined) {
  return USAGE_BIAS_INDEX.get(bias ?? "unknown") ?? USAGE_BIAS_INDEX.get("unknown")!;
}

export function indexToUsageBias(index: number): UsageBias {
  return USAGE_BIAS_VALUES[index] ?? "unknown";
}

export type RawWordKnowledge = Partial<WordKnowledge> & {
  sememes?: string[];
  synonyms?: string[];
  concepts?: string[];
};

export function normalizeKnowledge(raw: RawWordKnowledge): WordKnowledge {
  const core = raw.core_sememes ?? raw.sememes ?? [];
  const expanded = raw.expanded_sememes ?? [];
  const sememes = raw.sememes ?? [...core, ...expanded.filter((item) => !core.includes(item))];

  return {
    sememes,
    synonyms: raw.synonyms ?? [],
    concepts: raw.concepts ?? [],
    core_sememes: core,
    expanded_sememes: expanded,
    domain: raw.domain ?? "abstract/general",
    usage_bias: raw.usage_bias ?? "unknown",
    sense_count: raw.sense_count ?? 0,
  };
}
