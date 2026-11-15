# TiDB Cloud setup

1. Create a TiDB Cloud cluster and a dedicated application database user with only the required database privileges.
2. Create the `fresh_farm` database and run `database/schema.sql` using a migration identity with schema privileges. Run `database/seed.sql` afterwards to add the starter catalogue, images, and inventory. Both scripts are idempotent, and neither creates users, admins, or orders.
3. Use the cluster's TLS endpoint, port, database name, and app user in the server's environment. The API pool requires TLS with certificate verification enabled.
4. Restrict network access to the API deployment's egress where possible. Do not connect to TiDB from browser code.
5. Run migrations from a controlled deployment step; schema changes are not automatically applied when the API starts.
6. Back up production data and test migrations against a staging cluster before release.

Monetary values use `DECIMAL`, and product/price snapshots are stored per order item. For weight-based products, preserve requested and actual quantities; calculate the final amount on the server using the current approved price and actual quantity. Keep the estimated total for reference, never as a substitute for the confirmed final amount.
