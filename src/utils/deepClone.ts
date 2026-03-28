export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map(deepClone) as unknown as T;
  const cloned = Object.create(Object.getPrototypeOf(value));
  for (const key of Object.keys(value as object)) {
    cloned[key] = deepClone((value as any)[key]);
  }
  return cloned;
}
