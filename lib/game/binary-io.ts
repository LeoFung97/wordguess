export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

export function writeUInt32LE(buffer: Buffer, offset: number, value: number) {
  buffer.writeUInt32LE(value, offset);
}

export function readUInt32LE(buffer: Buffer, offset: number) {
  return buffer.readUInt32LE(offset);
}

export function writeFloat32LE(buffer: Buffer, offset: number, value: number) {
  buffer.writeFloatLE(value, offset);
}

export function readFloat32LE(buffer: Buffer, offset: number) {
  return buffer.readFloatLE(offset);
}

export function writeUInt16LE(buffer: Buffer, offset: number, value: number) {
  buffer.writeUInt16LE(value, offset);
}

export function readUInt16LE(buffer: Buffer, offset: number) {
  return buffer.readUInt16LE(offset);
}

export function writeUInt8(buffer: Buffer, offset: number, value: number) {
  buffer.writeUInt8(value, offset);
}

export function readUInt8(buffer: Buffer, offset: number) {
  return buffer.readUInt8(offset);
}

export function writeMagic(buffer: Buffer, offset: number, magic: string) {
  buffer.write(magic, offset, magic.length, "ascii");
}

export function readMagic(buffer: Buffer, offset: number, length: number) {
  return buffer.toString("ascii", offset, offset + length);
}

export function compareUtf8(a: Buffer, b: Buffer) {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] < b[index]) {
      return -1;
    }
    if (a[index] > b[index]) {
      return 1;
    }
  }

  if (a.length < b.length) {
    return -1;
  }

  if (a.length > b.length) {
    return 1;
  }

  return 0;
}

export function lowerBoundUtf8(keys: Buffer, keyWidth: number, count: number, needle: Buffer) {
  let low = 0;
  let high = count;

  while (low < high) {
    const mid = (low + high) >> 1;
    const offset = mid * keyWidth;
    const comparison = compareUtf8(keys.subarray(offset, offset + needle.length), needle);
    if (comparison < 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

export class StringPoolWriter {
  private readonly chunks: Buffer[] = [];
  private readonly offsets = new Map<string, number>();
  private length = 0;

  intern(value: string) {
    const existing = this.offsets.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const bytes = textEncoder.encode(`${value}\0`);
    const offset = this.length;
    this.chunks.push(bytes);
    this.length += bytes.length;
    this.offsets.set(value, offset);
    return offset;
  }

  build() {
    return Buffer.concat(this.chunks, this.length);
  }
}

export function readCString(buffer: Buffer, offset: number) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end += 1;
  }

  return textDecoder.decode(buffer.subarray(offset, end));
}
