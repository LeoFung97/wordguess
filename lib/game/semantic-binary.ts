import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  compareUtf8,
  readCString,
  readFloat32LE,
  readMagic,
  readUInt16LE,
  readUInt32LE,
  readUInt8,
  textEncoder,
} from "./binary-io";
import {
  SEMANTIC_GRAPH_MAGIC,
  SEMANTIC_GRAPH_VERSION,
  SEMANTIC_WORD_MAGIC,
  SEMANTIC_WORD_VERSION,
  indexToDomain,
  indexToUsageBias,
  normalizeKnowledge,
  type RawWordKnowledge,
} from "./semantic-binary-constants";
import type { WordKnowledge } from "./semantic-knowledge";

const WORD_HEADER_SIZE = 16;
const WORD_INDEX_ENTRY_SIZE = 8;

type WordIndexEntry = {
  keyOffset: number;
  recordOffset: number;
};

export class SemanticWordCacheBinary {
  private readonly buffer: Buffer;
  private readonly stringPoolOffset: number;
  private readonly wordIndexOffset: number;
  private readonly wordCount: number;

  constructor(buffer: Buffer) {
    const magic = readMagic(buffer, 0, 4);
    if (magic !== SEMANTIC_WORD_MAGIC) {
      throw new Error(`Invalid semantic word cache magic: ${magic}`);
    }

    const version = readUInt32LE(buffer, 4);
    if (version !== SEMANTIC_WORD_VERSION) {
      throw new Error(`Unsupported semantic word cache version: ${version}`);
    }

    this.wordCount = readUInt32LE(buffer, 8);
    this.stringPoolOffset = readUInt32LE(buffer, 12);
    this.wordIndexOffset = readUInt32LE(buffer, 16);
    this.buffer = buffer;
  }

  static tryLoad(filePath = path.join(process.cwd(), "data", "semantic-word-cache.bin")) {
    if (!existsSync(filePath)) {
      return undefined;
    }

    return new SemanticWordCacheBinary(readFileSync(filePath));
  }

  get size() {
    return this.wordCount;
  }

  private readIndexEntry(index: number): WordIndexEntry {
    const offset = this.wordIndexOffset + index * WORD_INDEX_ENTRY_SIZE;
    return {
      keyOffset: readUInt32LE(this.buffer, offset),
      recordOffset: readUInt32LE(this.buffer, offset + 4),
    };
  }

  private findWord(word: string) {
    const needle = textEncoder.encode(word);
    let low = 0;
    let high = this.wordCount;

    while (low < high) {
      const mid = (low + high) >> 1;
      const entry = this.readIndexEntry(mid);
      const key = readCString(this.buffer, this.stringPoolOffset + entry.keyOffset);
      const comparison = compareUtf8(textEncoder.encode(key), needle);

      if (comparison < 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    if (low >= this.wordCount) {
      return -1;
    }

    const entry = this.readIndexEntry(low);
    const key = readCString(this.buffer, this.stringPoolOffset + entry.keyOffset);
    return key === word ? low : -1;
  }

  getWordKnowledge(word: string): WordKnowledge | undefined {
    const index = this.findWord(word);
    if (index < 0) {
      return undefined;
    }

    const { recordOffset } = this.readIndexEntry(index);
    const domain = indexToDomain(readUInt8(this.buffer, recordOffset));
    const usageBias = indexToUsageBias(readUInt8(this.buffer, recordOffset + 1));
    const senseCount = readUInt16LE(this.buffer, recordOffset + 2);
    const sememeCount = readUInt16LE(this.buffer, recordOffset + 4);
    const synonymCount = readUInt16LE(this.buffer, recordOffset + 6);
    const conceptCount = readUInt16LE(this.buffer, recordOffset + 8);
    const coreCount = readUInt16LE(this.buffer, recordOffset + 10);
    const expandedCount = readUInt16LE(this.buffer, recordOffset + 12);

    let offset = recordOffset + WORD_HEADER_SIZE;
    const readStrings = (count: number) => {
      const values: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const stringOffset = readUInt32LE(this.buffer, offset);
        offset += 4;
        values.push(readCString(this.buffer, this.stringPoolOffset + stringOffset));
      }
      return values;
    };

    const sememes = readStrings(sememeCount);
    const synonyms = readStrings(synonymCount);
    const concepts = readStrings(conceptCount);
    const coreSememes = readStrings(coreCount);
    const expandedSememes = readStrings(expandedCount);

    return normalizeKnowledge({
      sememes,
      synonyms,
      concepts,
      core_sememes: coreSememes,
      expanded_sememes: expandedSememes,
      domain,
      usage_bias: usageBias,
      sense_count: senseCount,
    });
  }
}

class MinHeap {
  private readonly nodes: number[] = [];
  private readonly priorities: number[] = [];

  get size() {
    return this.nodes.length;
  }

  push(node: number, priority: number) {
    this.nodes.push(node);
    this.priorities.push(priority);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): { node: number; priority: number } | undefined {
    if (this.nodes.length === 0) {
      return undefined;
    }

    const node = this.nodes[0];
    const priority = this.priorities[0];
    const lastIndex = this.nodes.length - 1;
    this.nodes[0] = this.nodes[lastIndex];
    this.priorities[0] = this.priorities[lastIndex];
    this.nodes.pop();
    this.priorities.pop();

    if (this.nodes.length > 0) {
      this.bubbleDown(0);
    }

    return { node, priority };
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.priorities[parent] <= this.priorities[index]) {
        break;
      }

      this.swap(parent, index);
      index = parent;
    }
  }

  private bubbleDown(index: number) {
    const length = this.nodes.length;

    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < length && this.priorities[left] < this.priorities[smallest]) {
        smallest = left;
      }

      if (right < length && this.priorities[right] < this.priorities[smallest]) {
        smallest = right;
      }

      if (smallest === index) {
        break;
      }

      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(first: number, second: number) {
    const node = this.nodes[first];
    this.nodes[first] = this.nodes[second];
    this.nodes[second] = node;

    const priority = this.priorities[first];
    this.priorities[first] = this.priorities[second];
    this.priorities[second] = priority;
  }
}

export class SemanticGraphBinary {
  private readonly buffer: Buffer;
  private readonly nodeCount: number;
  private readonly rowPtrOffset: number;
  private readonly colIdxOffset: number;
  private readonly weightsOffset: number;
  private readonly stringPoolOffset: number;
  private readonly nodeIndexOffset: number;
  private readonly nodeNameCache = new Map<number, string>();

  constructor(buffer: Buffer) {
    const magic = readMagic(buffer, 0, 4);
    if (magic !== SEMANTIC_GRAPH_MAGIC) {
      throw new Error(`Invalid semantic graph magic: ${magic}`);
    }

    const version = readUInt32LE(buffer, 4);
    if (version !== SEMANTIC_GRAPH_VERSION) {
      throw new Error(`Unsupported semantic graph version: ${version}`);
    }

    this.nodeCount = readUInt32LE(buffer, 8);
    this.rowPtrOffset = readUInt32LE(buffer, 12);
    this.colIdxOffset = readUInt32LE(buffer, 16);
    this.weightsOffset = readUInt32LE(buffer, 20);
    this.stringPoolOffset = readUInt32LE(buffer, 24);
    this.nodeIndexOffset = readUInt32LE(buffer, 28);
    this.buffer = buffer;
  }

  static tryLoad(filePath = path.join(process.cwd(), "data", "semantic-graph.bin")) {
    if (!existsSync(filePath)) {
      return undefined;
    }

    return new SemanticGraphBinary(readFileSync(filePath));
  }

  private readNodeName(nodeId: number) {
    const cached = this.nodeNameCache.get(nodeId);
    if (cached) {
      return cached;
    }

    const keyOffset = readUInt32LE(this.buffer, this.nodeIndexOffset + nodeId * 8);
    const name = readCString(this.buffer, this.stringPoolOffset + keyOffset);
    this.nodeNameCache.set(nodeId, name);
    return name;
  }

  private findNodeId(word: string) {
    const needle = textEncoder.encode(word);
    let low = 0;
    let high = this.nodeCount;

    while (low < high) {
      const mid = (low + high) >> 1;
      const keyOffset = readUInt32LE(this.buffer, this.nodeIndexOffset + mid * 8);
      const key = readCString(this.buffer, this.stringPoolOffset + keyOffset);
      const comparison = compareUtf8(textEncoder.encode(key), needle);

      if (comparison < 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    if (low >= this.nodeCount) {
      return -1;
    }

    const keyOffset = readUInt32LE(this.buffer, this.nodeIndexOffset + low * 8);
    const key = readCString(this.buffer, this.stringPoolOffset + keyOffset);
    return key === word ? low : -1;
  }

  shortestDistance(source: string, target: string) {
    if (source === target) {
      return 0;
    }

    const sourceId = this.findNodeId(source);
    const targetId = this.findNodeId(target);
    if (sourceId < 0 || targetId < 0) {
      return undefined;
    }

    const heap = new MinHeap();
    const distances = new Float64Array(this.nodeCount);
    distances.fill(Number.POSITIVE_INFINITY);
    distances[sourceId] = 0;
    heap.push(sourceId, 0);

    while (heap.size > 0) {
      const current = heap.pop();
      if (!current || current.priority > distances[current.node]) {
        continue;
      }

      if (current.node === targetId) {
        return current.priority;
      }

      const start = readUInt32LE(this.buffer, this.rowPtrOffset + current.node * 4);
      const end = readUInt32LE(this.buffer, this.rowPtrOffset + (current.node + 1) * 4);

      for (let edgeIndex = start; edgeIndex < end; edgeIndex += 1) {
        const neighbor = readUInt32LE(this.buffer, this.colIdxOffset + edgeIndex * 4);
        const weight = readFloat32LE(this.buffer, this.weightsOffset + edgeIndex * 4);
        const nextDistance = current.priority + weight;

        if (nextDistance < distances[neighbor]) {
          distances[neighbor] = nextDistance;
          heap.push(neighbor, nextDistance);
        }
      }
    }

    return undefined;
  }

  hasNode(word: string) {
    return this.findNodeId(word) >= 0;
  }
}

export function parseWordCacheJson(raw: unknown): Map<string, WordKnowledge> {
  const cache = new Map<string, WordKnowledge>();

  if (!raw || typeof raw !== "object") {
    return cache;
  }

  const record = raw as Record<string, RawWordKnowledge | { schema_version?: number }>;

  if ("words" in record && record.words && typeof record.words === "object") {
    for (const [word, knowledge] of Object.entries(record.words as Record<string, RawWordKnowledge>)) {
      cache.set(word, normalizeKnowledge(knowledge));
    }
    return cache;
  }

  for (const [word, knowledge] of Object.entries(record)) {
    if (word === "__meta__" || !knowledge || typeof knowledge !== "object") {
      continue;
    }
    cache.set(word, normalizeKnowledge(knowledge as RawWordKnowledge));
  }

  return cache;
}
