/** Stand-in so the Worker bundle does not include Postgres or PGlite. */
export class PGlite {
  constructor() {
    throw new Error("This Worker stores the shared cache in memory and at the edge, not in Postgres.");
  }
}

class Pool {
  constructor() {
    throw new Error("This Worker stores the shared cache in memory and at the edge, not in Postgres.");
  }
}

const pg = { Pool };
export default pg;
