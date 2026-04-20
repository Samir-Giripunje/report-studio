import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(reports)
  `;

  if (columns.some((column) => column.name === "folder")) {
    return;
  }

  yield* sql`
    ALTER TABLE reports
    ADD COLUMN folder TEXT
  `;
});
