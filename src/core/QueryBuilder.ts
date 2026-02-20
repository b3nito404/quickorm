export class QueryBuilder {
  // minimal placeholder for chaining filters
  private filters: string[] = [];
  where(k:string, op:string, v:any) { this.filters.push(`${k}${op}${v}`); return this; }
  build() { return this.filters.join(" AND "); }
}
