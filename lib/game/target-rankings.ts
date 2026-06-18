import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  readFloat32LE,
  readMagic,
  readUInt16LE,
  readUInt32LE,
  readUInt8,
  writeFloat32LE,
  writeUInt16LE,
  writeUInt32LE,
  writeUInt8,
} from "./binary-io";
import {
  TARGET_HINT_TOP_N,
  TARGET_META_SIZE,
  TARGET_RANKINGS_MAGIC,
  TARGET_RANKINGS_VERSION,
} from "./ranking-builder";
import type { TargetDisplayCalibration } from "./scoring";
import type { SimilarityCalibration } from "./types";

const DIRECTORY_ENTRY_SIZE = 8;

type TargetDirectoryEntry = {
  targetIndex: number;
  dataOffset: number;
};

export class TargetRankingsStore {
  private readonly buffer: Buffer;
  private readonly wordCount: number;
  private readonly targetCount: number;
  private readonly directoryOffset: number;
  private readonly ranksBytesPerTarget: number;

  constructor(buffer: Buffer) {
    const magic = readMagic(buffer, 0, 4);
    if (magic !== TARGET_RANKINGS_MAGIC) {
      throw new Error(`Invalid target rankings magic: ${magic}`);
    }

    const version = readUInt32LE(buffer, 4);
    if (version !== TARGET_RANKINGS_VERSION) {
      throw new Error(`Unsupported target rankings version: ${version}`);
    }

    this.wordCount = readUInt32LE(buffer, 8);
    this.targetCount = readUInt32LE(buffer, 12);
    this.directoryOffset = 32;
    this.ranksBytesPerTarget = this.wordCount * 4;
    this.buffer = buffer;
  }

  static tryLoad(filePath = path.join(process.cwd(), "data", "target-rankings.bin")) {
    if (!existsSync(filePath)) {
      return undefined;
    }

    return new TargetRankingsStore(readFileSync(filePath));
  }

  get vocabularySize() {
    return this.wordCount;
  }

  get availableTargetCount() {
    return this.targetCount;
  }

  hasTarget(targetIndex: number) {
    return this.findTargetEntry(targetIndex) !== undefined;
  }

  private readDirectoryEntry(index: number): TargetDirectoryEntry {
    const offset = this.directoryOffset + index * DIRECTORY_ENTRY_SIZE;
    return {
      targetIndex: readUInt32LE(this.buffer, offset),
      dataOffset: readUInt32LE(this.buffer, offset + 4),
    };
  }

  private findTargetEntry(targetIndex: number) {
    let low = 0;
    let high = this.targetCount;

    while (low < high) {
      const mid = (low + high) >> 1;
      const entry = this.readDirectoryEntry(mid);
      if (entry.targetIndex < targetIndex) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    if (low >= this.targetCount) {
      return undefined;
    }

    const entry = this.readDirectoryEntry(low);
    return entry.targetIndex === targetIndex ? entry : undefined;
  }

  getRank(targetIndex: number, guessIndex: number) {
    const entry = this.findTargetEntry(targetIndex);
    if (!entry || guessIndex < 0 || guessIndex >= this.wordCount) {
      return undefined;
    }

    const offset = entry.dataOffset + guessIndex * 4;
    const rank = readUInt32LE(this.buffer, offset);
    return rank === 0 ? undefined : rank;
  }

  private readMeta(targetIndex: number) {
    const entry = this.findTargetEntry(targetIndex);
    if (!entry) {
      return undefined;
    }

    const metaOffset = entry.dataOffset + this.ranksBytesPerTarget;
    const knotCount = readUInt8(this.buffer, metaOffset);
    const knots: TargetDisplayCalibration["knots"] = [];

    let offset = metaOffset + 1;
    for (let index = 0; index < knotCount; index += 1) {
      knots.push({
        raw: readFloat32LE(this.buffer, offset),
        display: readFloat32LE(this.buffer, offset + 4),
      });
      offset += 8;
    }

    const calibration: SimilarityCalibration = {
      nearest: readFloat32LE(this.buffer, offset),
      tenth: readFloat32LE(this.buffer, offset + 4),
      thousandth: readFloat32LE(this.buffer, offset + 8),
    };
    offset += 12;

    const hintCount = readUInt16LE(this.buffer, offset);
    offset += 2;

    const hintWordIndices: number[] = [];
    for (let index = 0; index < hintCount; index += 1) {
      hintWordIndices.push(readUInt32LE(this.buffer, offset));
      offset += 4;
    }

    return {
      displayCalibration: { knots },
      calibration,
      hintWordIndices,
    };
  }

  getDisplayCalibration(targetIndex: number) {
    return this.readMeta(targetIndex)?.displayCalibration;
  }

  getCalibration(targetIndex: number) {
    return this.readMeta(targetIndex)?.calibration;
  }

  getHintWordIndices(targetIndex: number) {
    return this.readMeta(targetIndex)?.hintWordIndices ?? [];
  }
}

export function writeTargetRankingsBinary(options: {
  outputPath: string;
  wordCount: number;
  targets: Array<{
    targetIndex: number;
    ranks: Uint32Array;
    displayCalibration: TargetDisplayCalibration;
    calibration: SimilarityCalibration;
    hintWordIndices: number[];
  }>;
}) {
  const sorted = [...options.targets].sort((left, right) => left.targetIndex - right.targetIndex);
  const header = Buffer.alloc(32);
  header.write(TARGET_RANKINGS_MAGIC, 0, 4, "ascii");
  writeUInt32LE(header, 4, TARGET_RANKINGS_VERSION);
  writeUInt32LE(header, 8, options.wordCount);
  writeUInt32LE(header, 12, sorted.length);
  writeUInt32LE(header, 16, TARGET_META_SIZE);
  writeUInt32LE(header, 20, TARGET_HINT_TOP_N);

  const directory = Buffer.alloc(sorted.length * DIRECTORY_ENTRY_SIZE);
  const chunks: Buffer[] = [];
  let dataOffset = 32 + directory.length;

  sorted.forEach((target, index) => {
    writeUInt32LE(directory, index * DIRECTORY_ENTRY_SIZE, target.targetIndex);
    writeUInt32LE(directory, index * DIRECTORY_ENTRY_SIZE + 4, dataOffset);

    const ranksBuffer = Buffer.from(target.ranks.buffer, target.ranks.byteOffset, target.ranks.byteLength);
    const meta = Buffer.alloc(TARGET_META_SIZE);
    writeUInt8(meta, 0, target.displayCalibration.knots.length);

    let offset = 1;
    for (const knot of target.displayCalibration.knots) {
      writeFloat32LE(meta, offset, knot.raw);
      writeFloat32LE(meta, offset + 4, knot.display);
      offset += 8;
    }

    writeFloat32LE(meta, offset, target.calibration.nearest);
    writeFloat32LE(meta, offset + 4, target.calibration.tenth);
    writeFloat32LE(meta, offset + 8, target.calibration.thousandth);
    offset += 12;

    writeUInt16LE(meta, offset, target.hintWordIndices.length);
    offset += 2;

    target.hintWordIndices.forEach((wordIndex, hintIndex) => {
      writeUInt32LE(meta, offset + hintIndex * 4, wordIndex);
    });

    chunks.push(ranksBuffer, meta);
    dataOffset += ranksBuffer.length + meta.length;
  });

  writeFileSync(options.outputPath, Buffer.concat([header, directory, ...chunks]));
}
