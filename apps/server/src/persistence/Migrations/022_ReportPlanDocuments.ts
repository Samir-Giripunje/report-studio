import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Back-fill `documents: []` into the `userDocuments` config of existing report
 * plan_json rows that were created before the ReportSourceDocument feature was
 * added. Without this, the Effect Schema decoder rejects old rows because the
 * `documents` field is now required.
 *
 * Only rows where `globalSourceConfig.userDocuments.documents` is absent are
 * updated — already-migrated rows are left untouched.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE reports
    SET plan_json = json_set(
      plan_json,
      '$.globalSourceConfig.userDocuments.documents',
      json('[]')
    )
    WHERE json_extract(plan_json, '$.globalSourceConfig.userDocuments.documents') IS NULL
  `;
});
