import type { DropReason, PosHeuristic, SemanticKnowledgeLite } from "./types";

const TWO_CHAR_HAN = /^[\u4e00-\u9fff]{2}$/;

/** Common mainland surnames for person-name heuristics. */
const COMMON_SURNAMES = new Set([
  "王", "李", "张", "刘", "陈", "杨", "黄", "赵", "周", "吴", "徐", "孙", "马", "朱", "胡",
  "郭", "何", "林", "罗", "高", "梁", "郑", "谢", "宋", "唐", "许", "韩", "冯", "邓", "曹",
  "彭", "曾", "肖", "蔡", "潘", "田", "董", "袁", "于", "余", "叶", "蒋", "杜", "苏", "魏",
  "程", "吕", "丁", "沈", "任", "姚", "卢", "傅", "钟", "姜", "崔", "谭", "廖", "范", "汪",
  "陆", "金", "石", "戴", "贾", "韦", "夏", "邱", "方", "侯", "邹", "熊", "孟", "秦", "白",
]);

const BLOCKLIST_EXACT = new Set([
  "一个", "一些", "一下", "一起", "一定", "一样", "一般", "一直", "一种", "一位", "一条",
  "一张", "一本", "一片", "一层", "一点", "几个", "多少", "什么", "怎么", "为何", "为什么",
  "因为", "所以", "但是", "而且", "或者", "如果", "虽然", "不过", "就是", "还是", "已经",
  "可以", "应该", "需要", "不会", "没有", "这样", "那样", "这个", "那个", "哪个", "这些",
  "那些", "这里", "那里", "哪里", "现在", "以后", "之前", "之后", "今天", "明天", "昨天",
  "今年", "明年", "去年", "早上", "晚上", "中午", "下午", "半夜", "春天", "夏天", "秋天",
  "冬天", "自己", "大家", "我们", "你们", "他们", "她们", "它们", "咱们", "本人", "别人",
  "北京", "上海", "广州", "深圳", "天津", "重庆", "香港", "澳门", "台湾", "中国", "美国",
  "日本", "韩国", "英国", "法国", "德国", "公司", "集团", "银行", "医院", "学校", "大学",
  "学院", "政府", "部门", "委员会", "新冠", "疫情", "核酸", "封控", "网课",
  "有些", "很多", "许多", "非常", "十分", "比较", "更加", "最为", "极其", "稍微", "有点",
  "一下儿", "有点儿", "是不是", "能不能", "好不好", "怎么办", "为什么", "什么样",
]);

const FUNCTION_CHARS = new Set([
  "的", "了", "是", "在", "和", "与", "或", "及", "把", "被", "给", "对", "向", "从", "到",
  "为", "以", "于", "而", "则", "若", "但", "且", "又", "也", "还", "就", "都", "很", "太",
  "更", "最", "再", "才", "只", "不", "没", "无", "非", "未", "啊", "呢", "吧", "吗", "呀",
  "嘛", "哦", "哪", "谁", "啥", "怎", "啥", "此", "彼", "某", "各", "每", "第", "两", "几",
]);

const NUMERAL_CHARS = new Set(["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "百", "千", "万", "亿", "两", "几", "多", "半"]);

const MEASURE_SUFFIXES = ["个", "位", "条", "张", "本", "种", "件", "台", "辆", "次", "遍", "场", "顿", "口", "份", "层", "段", "块", "片", "点"];

const PLACE_SUFFIXES = ["市", "省", "县", "区", "镇", "村", "街", "路", "国", "州", "岛", "江", "河", "湖", "海", "山", "岭", "港", "湾"];

const ORG_SUFFIXES = ["公司", "集团", "银行", "医院", "学校", "大学", "学院", "委员会", "政府", "部门", "中心", "协会", "基金", "媒体", "电视台"];

const HOT_TOPIC_TERMS = ["新冠", "疫情", "核酸", "封控", "网课", "直播带货", "元宇宙", "区块链", "比特币"];

const CONJUNCTION_PATTERNS = /^(因为|所以|但是|而且|或者|如果|虽然|不过|就是|还是|然而|因此|于是|并且|以及|除非|无论|不管)/;

const PRONOUN_PATTERNS = /^(我|你|他|她|它|咱|这|那|哪|谁|什么|怎么|为何|自己|大家|我们|你们|他们|她们|它们|咱们|本人|别人|自身|彼此|大家)/;

const TIME_PATTERNS = /^(今天|明天|昨天|今年|明年|去年|早上|晚上|中午|下午|半夜|凌晨|白天|黑夜|早晨|黄昏|现在|以后|之前|之后|春天|夏天|秋天|冬天|周一|周二|周三|周四|周五|周六|周日|星期|月份|年代)/;

const FUNC_SEMEMES = new Set(["FuncWord|功能词", "DeChinese|构助", "AimAt|定向", "expression|词语"]);

export function isTwoCharChinese(word: string) {
  return TWO_CHAR_HAN.test(word);
}

export function isSimplifiedChinese(word: string, toSimplified: (value: string) => string) {
  return toSimplified(word) === word;
}

export function guessPosHeuristic(word: string, knowledge?: SemanticKnowledgeLite): PosHeuristic {
  if (BLOCKLIST_EXACT.has(word)) {
    return "function";
  }

  if (knowledge?.core_sememes?.some((sememe) => FUNC_SEMEMES.has(sememe))) {
    return "function";
  }

  if (PRONOUN_PATTERNS.test(word)) {
    return "pronoun";
  }

  if (CONJUNCTION_PATTERNS.test(word)) {
    return "function";
  }

  if (TIME_PATTERNS.test(word)) {
    return "time";
  }

  if ([...word].every((char) => NUMERAL_CHARS.has(char))) {
    return "numeral";
  }

  if (MEASURE_SUFFIXES.some((suffix) => word.endsWith(suffix)) && NUMERAL_CHARS.has(word[0]!)) {
    return "measure";
  }

  if (ORG_SUFFIXES.some((suffix) => word.endsWith(suffix))) {
    return "organization";
  }

  if (PLACE_SUFFIXES.some((suffix) => word.endsWith(suffix))) {
    return "place";
  }

  if (COMMON_SURNAMES.has(word[0]!) && !COMMON_SURNAMES.has(word[1]!)) {
    return "person";
  }

  if ([...word].some((char) => FUNCTION_CHARS.has(char))) {
    return "particle";
  }

  const domain = knowledge?.domain;
  if (domain === "emotion" || domain === "body/health") {
    return "noun";
  }
  if (domain === "action/motion") {
    return "verb";
  }
  if (domain === "psychology/cognition" || domain === "abstract/general") {
    return "noun";
  }

  const verbMarkers = ["做", "说", "看", "听", "写", "读", "走", "跑", "吃", "喝", "买", "卖", "学", "教", "开", "关", "打", "拉", "推", "拉", "想", "感", "爱", "恨", "帮", "等", "找", "用", "玩", "住", "坐", "站", "睡", "醒", "笑", "哭"];
  const adjMarkers = ["大", "小", "好", "坏", "新", "旧", "高", "低", "长", "短", "快", "慢", "强", "弱", "美", "丑", "真", "假", "深", "浅", "冷", "热", "明", "暗", "红", "绿", "蓝", "白", "黑", "黄", "轻", "重", "远", "近", "宽", "窄", "厚", "薄"];

  if (verbMarkers.some((marker) => word.includes(marker))) {
    return "verb";
  }

  if (adjMarkers.some((marker) => word.includes(marker))) {
    return "adjective";
  }

  return "unknown";
}

export type HardFilterResult =
  | { pass: true }
  | { pass: false; reason: DropReason; detail: string };

export function applyHardFilters(
  word: string,
  frequencyRank: number,
  config: { minFrequencyRank: number; maxFrequencyRank: number },
  options: {
    inVocab: boolean;
    inEmbedding: boolean;
    isSimplified: boolean;
    toSimplified: (value: string) => string;
  },
): HardFilterResult {
  if (!isTwoCharChinese(word)) {
    return { pass: false, reason: "not_two_char", detail: "Not exactly two Chinese characters" };
  }

  if (!options.isSimplified) {
    return { pass: false, reason: "not_simplified", detail: "Not Simplified Chinese form" };
  }

  if (!options.inVocab) {
    return { pass: false, reason: "not_in_vocab", detail: "Not in game vocabulary" };
  }

  if (!options.inEmbedding) {
    return { pass: false, reason: "not_in_embedding", detail: "Not in embedding coverage" };
  }

  if (frequencyRank > config.maxFrequencyRank) {
    return { pass: false, reason: "too_obscure", detail: `Frequency rank ${frequencyRank} exceeds max ${config.maxFrequencyRank}` };
  }

  if (frequencyRank < config.minFrequencyRank) {
    return { pass: false, reason: "too_easy", detail: `Frequency rank ${frequencyRank} below min ${config.minFrequencyRank}` };
  }

  if (BLOCKLIST_EXACT.has(word)) {
    return { pass: false, reason: "blocklist", detail: "Exact blocklist match" };
  }

  if (HOT_TOPIC_TERMS.some((term) => word.includes(term))) {
    return { pass: false, reason: "hot_topic", detail: "Time-limited hot-topic term" };
  }

  const pos = guessPosHeuristic(word);
  switch (pos) {
    case "function":
      return { pass: false, reason: "function_word", detail: "Function word heuristic" };
    case "pronoun":
      return { pass: false, reason: "pronoun", detail: "Pronoun heuristic" };
    case "numeral":
      return { pass: false, reason: "numeral", detail: "Numeral heuristic" };
    case "measure":
      return { pass: false, reason: "measure_word", detail: "Measure word heuristic" };
    case "particle":
      return { pass: false, reason: "particle", detail: "Particle / function morpheme heuristic" };
    case "place":
      return { pass: false, reason: "place_name", detail: "Place name heuristic" };
    case "person":
      return { pass: false, reason: "person_name", detail: "Person name heuristic" };
    case "organization":
      return { pass: false, reason: "organization", detail: "Organization name heuristic" };
    case "time":
      return { pass: false, reason: "blocklist", detail: "Deictic time word" };
    default:
      break;
  }

  if (CONJUNCTION_PATTERNS.test(word)) {
    return { pass: false, reason: "conjunction", detail: "Conjunction pattern" };
  }

  return { pass: true };
}

export function scorePlayability(
  word: string,
  frequencyRank: number,
  pos: PosHeuristic,
  knowledge?: SemanticKnowledgeLite,
): number {
  let score = 0.55;

  if (pos === "noun" || pos === "verb" || pos === "adjective") {
    score += 0.22;
  } else if (pos === "unknown") {
    score += 0.08;
  } else {
    score -= 0.25;
  }

  if (knowledge?.domain && knowledge.domain !== "abstract/general") {
    score += 0.08;
  }

  if (knowledge?.usage_bias === "literal") {
    score += 0.05;
  } else if (knowledge?.usage_bias === "figurative") {
    score -= 0.03;
  }

  const senseCount = knowledge?.sense_count ?? 0;
  if (senseCount >= 2 && senseCount <= 4) {
    score += 0.06;
  } else if (senseCount >= 5) {
    score -= 0.08;
  }

  if (frequencyRank < 500) {
    score -= 0.12;
  } else if (frequencyRank >= 500 && frequencyRank <= 8_000) {
    score += 0.1;
  } else if (frequencyRank > 15_000) {
    score -= 0.06;
  }

  if (knowledge?.core_sememes?.some((sememe) => FUNC_SEMEMES.has(sememe))) {
    score -= 0.35;
  }

  const trivialConcrete = ["东西", "事情", "问题", "地方", "时候", "方式", "情况", "方面", "部分", "程度"];
  if (trivialConcrete.includes(word)) {
    score -= 0.15;
  }

  const richFields = ["感情", "文化", "历史", "自然", "社会", "心理", "逻辑", "艺术", "科学", "教育"];
  if (richFields.some((term) => word.includes(term) || word.endsWith(term.slice(-1)))) {
    score += 0.04;
  }

  return clamp(score, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export { BLOCKLIST_EXACT, COMMON_SURNAMES, HOT_TOPIC_TERMS };
