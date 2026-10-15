import assert from "node:assert/strict";
import test from "node:test";
import { historyRanges } from "./history-range";
import { getStatusData } from "./status";

const databaseUrl = process.env.STATUS_HISTORY_TEST_DATABASE_URL;

test("SAPADA parent history includes periods recorded by any component", { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const now = new Date();
  for (const range of historyRanges) {
    const data = await getStatusData(range, now);
    assert.equal(data.dataError, false);
    const parent = data.services[0];
    for (let index = 0; index < range.buckets; index++) {
      const recorded = data.components.some((component) => (component.service.key === "sapada"
        || ("parentKey" in component.service && component.service.parentKey === "sapada")) && component.history[index].count > 0);
      assert.equal(parent.history[index].count > 0, recorded, `${range.key}: missing history in bucket ${index}`);
      assert.ok(parent.history[index].failedCount <= parent.history[index].count);
      assert.ok((parent.history[index].partialCount ?? 0) <= parent.history[index].count);
    }
  }
});
