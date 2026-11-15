/**
 * TiDB defaults to optimistic transactions, where `SELECT … FOR UPDATE` does
 * not take locks and conflicts only surface at commit. Delivery assignment and
 * capacity checks need real row locks, so admin write transactions explicitly
 * switch the connection to pessimistic mode before starting.
 *
 * The setting is a per-connection session variable, which is safe for a pooled
 * connection. If the server is not TiDB the setting is skipped and the caller
 * still gets a normal transaction.
 */
async function beginTransaction(connection) {
  try {
    await connection.query("SET SESSION tidb_txn_mode = 'pessimistic'")
  } catch {
    // Not TiDB (or the variable is unavailable); keep the default mode.
  }
  await connection.beginTransaction()
}

module.exports = { beginTransaction }
