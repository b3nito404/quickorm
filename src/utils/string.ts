/** Convert CamelCase to snake_case */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/^_/, '');
}

/** Convert snake_case to CamelCase */
export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function pluralize(str: string): string {
  if (str.endsWith('y') && !/[aeiou]y$/.test(str)) {
    return str.slice(0, -1) + 'ies';
  }
  if (/(?:s|x|z|ch|sh)$/.test(str)) {
    return str + 'es';
  }
  return str + 's';
}

/** Infer a table name from a class name */
export function defaultTableName(className: string): string {
  return pluralize(toSnakeCase(className));
}
