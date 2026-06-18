export function magnitude(vector: ArrayLike<number>) {
  let sum = 0;

  for (let index = 0; index < vector.length; index += 1) {
    sum += vector[index] * vector[index];
  }

  return Math.sqrt(sum);
}

export function cosineSimilarity(first: ArrayLike<number>, second: ArrayLike<number>) {
  if (first.length !== second.length) {
    throw new Error("Vectors must have the same dimensions.");
  }

  let sum = 0;

  for (let index = 0; index < first.length; index += 1) {
    sum += first[index] * second[index];
  }

  return sum;
}

export function normalizeVector(vector: ArrayLike<number>) {
  const length = magnitude(vector);
  if (length === 0) {
    throw new Error("Cannot normalize a zero-length vector.");
  }

  return Array.from({ length: vector.length }, (_, index) => vector[index] / length);
}
