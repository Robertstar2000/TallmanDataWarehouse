# Query Tool – Cross-Platform Data Sync Application

## 1· Purpose
Connect to multiple external ERP/DB servers (Epicor P21, Point of Rental, QuickBooks, JobScope), select tables & columns, cache locally, and expose data via CSV download, live ODBC DSN (e.g. Excel).

## 2· Technology Stack & Architecture
| Layer                       = | Technology                     | Description                                            |
|-------------------            |--------------------------------|--------------------------------------------------------|
| Process Manager               | pm2                            | Keeps Node.js sync service alive, restarts on failure |
| API & Sync Engine             | Node.js + Express v5           | REST endpoints & 2 s polling background sync          |
| ORM & DB                      | SQLite3 (sqlite3) direct DB access plus external ODBC adapters | Local `selected_columns` cache                           |
| ODBC Integration              | node-odbc                      | DSN connections to external DBs                        |
| Access/Jet Integration        | node mdb-reader    | connections to external Access/Jet DB FILE                        |
| Front-End UI                  | React 18 + Vite                | SPA for selecting fields & managing data              |
| Hosting                       | Windows Server/IIS + IISNode   | Production deployment via IIS + pm2                    |

## 3· Local Cache DB Schema
```sql
CREATE TABLE selected_columns (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_name  TEXT    NOT NULL,
  table_name       TEXT    NOT NULL,
  column_name      TEXT    NOT NULL,
  snapshot_json    TEXT    NOT NULL,
  last_synced_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_selcols ON selected_columns(connection_name, table_name, column_name);
```

## 4· External Connection Layer
• Define DSNs in `.env`:
```ini
EPICOR_DSN="Your_Epicor_P21_DSN"
POR_DSN="Your_Point_of_Rental Path"
QB_DSN="DBD"
JOBSCOPE_DSN="TBD"
```
• Leverage **node-odbc** to connect and query external tables/columns.

## 5· Data Sync Engine (every 2 s)
1. Poll `selected_columns` table.
2. Group by `connection_name`, open ODBC connection or path connection per source.
3. Run `SELECT column FROM table`, capture results.
4. Update `snapshot_json` and `last_synced_at` in local DB.
5. Log errors and continue without blocking other sources.

## 6· Front-End UI Flow
1. **Connections**: list configured DSNs (buttons).
2. **Tables**: fetch and list table names.
3. **Columns**: fetch and list column names (buttons to add).
4. **Selections**: view and delete chosen columns.
5. **Download**: CSV export at bottom.
6. **P21 DB ODBC**: enter DSN and store string, view connect instructions.
7. **POR Access/JEt** enter path to .mdb file
7. **Connection Test**: health check button shows status banner.
8. **SQL Query Test**: run ad-hoc SQL, display results.
9. **Help**: opens this README in modal.

## 7· Configuration & Environment
• Copy `.env.example` to `.env` and set (default):
```ini
DATABASE_URL="file:./dev.db"
PORT=3000
# ODBC DSNs as above
```
## Starting the App
```bash
# Build UI
npm run build
# Run backend and serve built UI
npm run start
```
Open the application at [http://localhost:3000](http://localhost:3000).

## 8· Security & Best Practices
• Parameterize all queries; never interpolate user input directly.
• Encrypt DSN credentials at rest if required.
• Rate-limit sync queries to avoid overloading source systems.
• Audit logs for each connection test and query.

## 9· Deployment Steps
1. **Prerequisites**: Node.js ≥ 18, npm ≥ 8, Windows Server with IIS/IISNode.
2. **Install**:
   ```powershell
   cd services/node-sync
   npm install
   npm run start:pm2
   ```
3. **UI**:
   ```powershell
   cd services/ui
   npm install
   npm run build    # for production
   ```
4. **IIS Configuration**: point to built UI & IISNode entry for API.
5. **Monitoring**: pm2 logs & Windows Event Viewer.

## 10· Help & Troubleshooting
• **README modal** for quick access.
• **Common Errors**:
  - Port in use: stop existing Node via `Stop-Process -Name node`.
  - ODBC failures: verify DSN in ODBC Data Source Administrator.
• **Contribution**: fork repo, follow lint & test conventions.

---
*Start development:*
```powershell
cd services/node-sync; npm install; npm run dev
cd ../ui; npm install; npm run dev

*Product Requirments Document*
1 · Purpose
Create a cross‑platform desktop/web app that can connect to four different external database servers (Epicor P21 ERP, Point of Rental, QuickBooks, JobScope ERP), let users pick any combination of tables + columns, pull the data into a local cache DB, and expose that cache for download or live ODBC access.

2 · Technology Stack & High‑Level Architecture
Layer	Node.js requirements	PHP requirements	Notes
Process Manager	pm2 for service orchestration, auto‑restart, logging	–	Keeps background sync workers alive.
API Gateway	Express (5+), JSON & REST, CORS enabled	Laravel (10+) as alternative/companion to Express; use built‑in routing, Eloquent models	Only one needs to be chosen at deployment; both specs provided for flexibility.
Background Jobs	bullmq (Redis‑backed) or node-cron timed every 2 s	Laravel Queues + Horizon + Redis	Executes batched “grab‑&‑cache” queries on each external DB.
Database Layer	SQLite3 (sqlite3) direct DB access plus external ODBC adapters	Laravel Eloquent for local DB plus doctrine/dbal for ODBC	Local DB can be SQLite for simplicity or MySQL/PostgreSQL for concurrency.
ODBC Bridge	node-odbc exposes DSN for Excel	PHP PDO_OCI / ODBC optional	Provides live read‑only DSN to Excel or other BI tools.
Front‑End	Any SPA (React/Vite) or Laravel Blade/Twig; communicates via REST endpoints	Same: Vue + Inertia or Blade views	UI only consumes REST; tech is interchangeable.
Packaging	For MS IIS server with IISNode
Supports on‑prem or cloud deployment.

Recommendation: Use a Node.js microservice for heavy polling (§ 4) and a Laravel API/UI for the rest. This avoids PHP long‑running processes while letting Laravel handle auth, forms, and Blade pages.

3 · Local Cache DB Schema
sql
Copy
Edit
CREATE TABLE selected_columns (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name      TEXT    NOT NULL,
    column_name     TEXT    NOT NULL,
    snapshot_json   JSON    NOT NULL,   -- full list of values pulled for that column
    last_synced_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
snapshot_json holds the “List of all data” pulled from the external column.

Add indexes on (table_name, column_name).

4 · External Connection Layer
Each of the four source DBs is configured via connection profiles stored in .env or a secure vault table (encrypted).

Support ODBC, JDBC, or vendor drivers.

Connection test endpoint: POST /api/connections/test returns latency, driver version, and auth success.

5 · Data‑Sync Engine (every 2 seconds)
Queue Build – User saves selections → rows inserted into selected_columns.

Scheduler – Cron tick every 2 s adds jobs to sync-queue.

Worker – Pull N jobs, group by connection, open one connection per server, iterate rows with vendor‑specific SQL / Access‑Jet.

Throttle – Use LIMIT n OFFSET p paging to avoid full‑table scans; maintain cursor in Redis.

Write‑back – Update snapshot_json + last_synced_at. Commit in single transaction.

6 · User Interface Flow
Four Source Panels – Each lists tables (lazy‑loaded) with checkboxes.

Table click → expands column list with checkboxes.

Selections Panel shows running tally.

Buttons:

Start Sync – fires background job loop.

Download CSV – streams selected_columns as CSV.

Open ODBC DSN – modal with DSN string & credentials.

Connection Test – quick ping.

Query Test – freeform SQL against chosen source; runs once, no caching.

Help – opens embedded README.md.

7 · Persistent Configuration
Store server host, port, user, password, and DSN in env plus encrypted DB table.

Remember last 10 query‑test expressions per user (localStorage or DB).

Use JWT + Refresh tokens (Laravel Sanctum or jsonwebtoken in Node) for auth.

8 · Security / Compliance
Encrypt credentials at rest (libsodium, Laravel’s encrypt() helper).

Parameterize all SQL to prevent injection.

Limit each polling worker to one thread per external DB.

Audit log every connection test & query test.

9 · Deployment Checklist
Docker Compose with services:

app-node (Express worker), app-php (Laravel), redis, local-db (SQLite/MySQL), nginx.

CI pipeline (GitHub Actions) → lint, unit tests, container build, push to registry.

Helm chart for Kubernetes if needed.

Expose only ports 80/443; internal DB/Redis stay on private network.

10 · README Contents (for Help button)
Install & setup (Node 18 +, PHP 8.3, Composer 2, npm 10).

How to add a new source DB.

How to generate an Excel DSN.

Troubleshooting common sync errors.

Contribution guide & coding standards.
