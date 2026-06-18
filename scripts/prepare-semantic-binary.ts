import { readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  StringPoolWriter,
  writeMagic,
  writeUInt16LE,
  writeUInt32LE,
  writeUInt8,
} from "../lib/game/binary-io";
import {
  domainToIndex,
  SEMANTIC_GRAPH_MAGIC,
  SEMANTIC_GRAPH_VERSION,
  SEMANTIC_WORD_MAGIC,
  SEMANTIC_WORD_VERSION,
  usageBiasToIndex,
} from "../lib/game/semantic-binary-constants";
import { parseWordCacheJson } from "../lib/game/semantic-binary";
import type { WordKnowledge } from "../lib/game/semantic-knowledge";

const WORD_HEADER_SIZE = 16;

function getArg(flag: string, fallback: string) {
  const match = process.argv.find((argument) => argument.startsWith(`${flag}=`));
  return match ? match.slice(flag.length + 1) : fallback;
}

function writeWordCacheBinary(entries: Array<[string, WordKnowledge]>, outputPath: string) {
  const sorted = [...entries].sort(([left], [right]) => left.localeCompare(right, "zh-CN"));
  const pool = new StringPoolWriter();
  const recordChunks: Buffer[] = [];
  const indexEntries: Array<{ keyOffset: number; recordOffset: number }> = [];

  let recordOffset = 32 + sorted.length * 8;

  for (const [word, knowledge] of sorted) {
    const keyOffset = pool.intern(word);
    const stringOffsets: number[] = [];

    for (const value of [
      knowledge.sememes,
      knowledge.synonyms,
      knowledge.concepts,
      knowledge.core_sememes ?? knowledge.sememes,
      knowledge.expanded_sememes ?? [],
    ]) {
      for (const item of value) {
        stringOffsets.push(pool.intern(item));
      }
    }

    const header = Buffer.alloc(WORD_HEADER_SIZE);
    writeUInt8(header, 0, domainToIndex(knowledge.domain));
    writeUInt8(header, 1, usageBiasToIndex(knowledge.usage_bias));
    writeUInt16LE(header, 2, knowledge.sense_count ?? 0);
    writeUInt16LE(header, 4, knowledge.sememes.length);
    writeUInt16LE(header, 6, knowledge.synonyms.length);
    writeUInt16LE(header, 8, knowledge.concepts.length);
    writeUInt16LE(header, 10, knowledge.core_sememes?.length ?? knowledge.sememes.length);
    writeUInt16LE(header, 12, knowledge.expanded_sememes?.length ?? 0);

    const payload = Buffer.alloc(stringOffsets.length * 4);
    stringOffsets.forEach((offset, index) => {
      writeUInt32LE(payload, index * 4, offset);
    });

    const record = Buffer.concat([header, payload]);
    recordChunks.push(record);
    indexEntries.push({ keyOffset, recordOffset });
    recordOffset += record.length;
  }

  const stringPool = pool.build();
  const stringPoolOffset = recordOffset;
  const wordIndexOffset = 32;
  const header = Buffer.alloc(32);
  writeMagic(header, 0, SEMANTIC_WORD_MAGIC);
  writeUInt32LE(header, 4, SEMANTIC_WORD_VERSION);
  writeUInt32LE(header, 8, sorted.length);
  writeUInt32LE(header, 12, stringPoolOffset);
  writeUInt32LE(header, 16, wordIndexOffset);
  writeUInt32LE(header, 20, 0);
  writeUInt32LE(header, 24, 0);
  writeUInt32LE(header, 28, 0);

  const indexBuffer = Buffer.alloc(sorted.length * 8);
  indexEntries.forEach((entry, index) => {
    const offset = index * 8;
    writeUInt32LE(indexBuffer, offset, entry.keyOffset);
    writeUInt32LE(indexBuffer, offset + 4, entry.recordOffset);
  });

  writeFileSync(outputPath, Buffer.concat([header, indexBuffer, ...recordChunks, stringPool]));
}

function writeGraphBinary(edges: Array<{ a: string; b: string; w: number }>, outputPath: string) {
  const pool = new StringPoolWriter();
  const nodeSet = new Set<string>();

  for (const edge of edges) {
    nodeSet.add(edge.a);
    nodeSet.add(edge.b);
  }

  const nodeNames = [...nodeSet].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const nodeIds = new Map(nodeNames.map((name, index) => [name, index]));
  const keyOffsets = new Map(nodeNames.map((name) => [name, pool.intern(name)]));
  const adjacency = new Map<number, Array<{ neighbor: number; weight: number }>>();

  for (const name of nodeNames) {
    adjacency.set(nodeIds.get(name)!, []);
  }

  for (const edge of edges) {
    const left = nodeIds.get(edge.a)!;
    const right = nodeIds.get(edge.b)!;
    const weight = edge.w;
    adjacency.get(left)!.push({ neighbor: right, weight });
    adjacency.get(right)!.push({ neighbor: left, weight });
  }

  const nodeCount = nodeNames.length;
  const rowPtr = new Uint32Array(nodeCount + 1);
  const colEntries: number[] = [];
  const weightEntries: number[] = [];

  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    rowPtr[nodeId] = colEntries.length;
    const neighbors = adjacency.get(nodeId) ?? [];
    neighbors.sort((left, right) => left.neighbor - right.neighbor);
    for (const neighbor of neighbors) {
      colEntries.push(neighbor.neighbor);
      weightEntries.push(neighbor.weight);
    }
  }
  rowPtr[nodeCount] = colEntries.length;

  const stringPool = pool.build();
  const headerSize = 32;
  const rowPtrOffset = headerSize;
  const colIdxOffset = rowPtrOffset + rowPtr.byteLength;
  const weightsOffset = colIdxOffset + colEntries.length * 4;
  const stringPoolOffset = weightsOffset + weightEntries.length * 4;
  const nodeIndexOffset = stringPoolOffset + stringPool.length;

  const header = Buffer.alloc(headerSize);
  writeMagic(header, 0, SEMANTIC_GRAPH_MAGIC);
  writeUInt32LE(header, 4, SEMANTIC_GRAPH_VERSION);
  writeUInt32LE(header, 8, nodeCount);
  writeUInt32LE(header, 12, rowPtrOffset);
  writeUInt32LE(header, 16, colIdxOffset);
  writeUInt32LE(header, 20, weightsOffset);
  writeUInt32LE(header, 24, stringPoolOffset);
  writeUInt32LE(header, 28, nodeIndexOffset);

  const rowPtrBuffer = Buffer.from(rowPtr.buffer);
  const colIdxBuffer = Buffer.alloc(colEntries.length * 4);
  colEntries.forEach((value, index) => {
    writeUInt32LE(colIdxBuffer, index * 4, value);
  });

  const weightsBuffer = Buffer.alloc(weightEntries.length * 4);
  weightEntries.forEach((value, index) => {
    weightsBuffer.writeFloatLE(value, index * 4);
  });

  const nodeIndexBuffer = Buffer.alloc(nodeCount * 8);
  nodeNames.forEach((word, index) => {
    writeUInt32LE(nodeIndexBuffer, index * 8, keyOffsets.get(word)!);
    writeUInt32LE(nodeIndexBuffer, index * 8 + 4, index);
  });

  writeFileSync(
    outputPath,
    Buffer.concat([header, rowPtrBuffer, colIdxBuffer, weightsBuffer, stringPool, nodeIndexBuffer]),
  );
}

function main() {
  const cacheJsonPath = getArg("--cache", path.join("data", "semantic-word-cache.json"));
  const graphJsonPath = getArg("--graph", path.join("data", "semantic-graph.json"));
  const cacheBinPath = getArg("--cache-output", path.join("data", "semantic-word-cache.bin"));
  const graphBinPath = getArg("--graph-output", path.join("data", "semantic-graph.bin"));

  const cacheJson = JSON.parse(readFileSync(cacheJsonPath, "utf8"));
  const graphJson = JSON.parse(readFileSync(graphJsonPath, "utf8")) as {
    edges?: Array<{ a: string; b: string; w: number }>;
  };

  const cacheEntries = [...parseWordCacheJson(cacheJson).entries()];
  writeWordCacheBinary(cacheEntries, cacheBinPath);
  writeGraphBinary(graphJson.edges ?? [], graphBinPath);

  console.log(
    `Wrote ${cacheEntries.length.toLocaleString()} word records to ${cacheBinPath} and ${
      (graphJson.edges ?? []).length
    } edges to ${graphBinPath}.`,
  );
}

main();
