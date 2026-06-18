import { readFile } from "fs/promises";

export type FrequencyEntry = {
  word: string;
  frequency: number;
};

const WORD_COLUMNS = new Set(["word", "词", "词语", "token"]);
const FREQUENCY_COLUMNS = new Set([
  "wcount",
  "frequency",
  "freq",
  "count",
  "词频",
  "频率",
  "频次",
]);

export function parseCount(value: string, label = "count") {
  const match = value.trim().match(/^(\d+)([kK])?$/);
  if (!match) {
    throw new Error(`Invalid ${label}: ${value} (use a number or k suffix, e.g. 80k)`);
  }

  const amount = Number(match[1]);
  const multiplier = match[2] ? 1_000 : 1;
  const parsed = amount * multiplier;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function detectDelimiter(line: string) {
  if (line.includes("\t")) {
    return "\t";
  }
  if (line.includes(",")) {
    return ",";
  }
  if (/\s+\d/.test(line)) {
    return /\s+/;
  }
  return "\t";
}

function normalizeColumn(column: string) {
  return column.trim().replace(/^"|"$/g, "").toLowerCase();
}

function findHeaderLine(lines: string[]) {
  for (let index = 0; index < Math.min(lines.length, 20); index += 1) {
    const columns = lines[index].split(detectDelimiter(lines[index])).map((column) => normalizeColumn(column));
    const hasWord = columns.some((column) => WORD_COLUMNS.has(column));
    const hasFrequency = columns.some((column) => FREQUENCY_COLUMNS.has(column));
    if (hasWord && hasFrequency) {
      return index;
    }
  }

  return -1;
}

function parseHeaderColumns(headerLine: string) {
  const delimiter = detectDelimiter(headerLine);
  const columns = headerLine.split(delimiter).map((column) => normalizeColumn(column));
  const wordIndex = columns.findIndex((column) => WORD_COLUMNS.has(column));
  const frequencyIndex = columns.findIndex((column) => FREQUENCY_COLUMNS.has(column));
  return { delimiter, wordIndex, frequencyIndex };
}

function looksLikeFrequencyRow(line: string) {
  const delimiter = detectDelimiter(line);
  const parts = line.split(delimiter).map((part) => part.trim().replace(/^"|"$/g, ""));
  if (parts.length < 2) {
    return false;
  }

  return parts[0].length > 0 && Number.isFinite(Number(parts[1])) && Number(parts[1]) > 0;
}

export async function loadFrequencyEntries(filePath: string): Promise<FrequencyEntry[]> {
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    throw new Error(`Frequency list is empty: ${filePath}`);
  }

  const headerLineIndex = findHeaderLine(lines);
  const entries: FrequencyEntry[] = [];

  if (headerLineIndex >= 0) {
    const { delimiter, wordIndex, frequencyIndex } = parseHeaderColumns(lines[headerLineIndex]);
    if (wordIndex < 0 || frequencyIndex < 0) {
      throw new Error(`Could not find word/frequency columns in ${filePath}`);
    }

    for (let lineIndex = headerLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      const parts = lines[lineIndex].split(delimiter).map((part) => part.trim().replace(/^"|"$/g, ""));
      const word = parts[wordIndex];
      const frequency = Number(parts[frequencyIndex]);
      if (!word || !Number.isFinite(frequency) || frequency <= 0) {
        continue;
      }
      entries.push({ word, frequency });
    }
  } else if (looksLikeFrequencyRow(lines[0])) {
    for (const line of lines) {
      const delimiter = detectDelimiter(line);
      const parts = line.split(delimiter).map((part) => part.trim().replace(/^"|"$/g, ""));
      const word = parts[0];
      const frequency = Number(parts[1]);
      if (!word || !Number.isFinite(frequency) || frequency <= 0) {
        continue;
      }
      entries.push({ word, frequency });
    }
  } else {
    const total = lines.length;
    lines.forEach((word, index) => {
      if (!word) {
        return;
      }
      entries.push({ word, frequency: total - index });
    });
  }

  entries.sort((first, second) => second.frequency - first.frequency || first.word.localeCompare(second.word, "zh"));
  return entries;
}

export function selectWordsByFrequency(
  frequencyEntries: FrequencyEntry[],
  availableWords: Set<string>,
  limit: number,
): string[] {
  const selected: string[] = [];

  for (const entry of frequencyEntries) {
    if (!availableWords.has(entry.word)) {
      continue;
    }

    selected.push(entry.word);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}
