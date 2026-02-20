export class OrmError extends Error {
  constructor(msg:string){ super(msg); this.name='OrmError'; }
}
