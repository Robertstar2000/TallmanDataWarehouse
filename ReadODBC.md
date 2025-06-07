# Connecting to the Internal Database via ODBC

This document provides instructions on how to connect to the application's internal SQLite database using ODBC. This allows you to access the synced data directly using tools that support ODBC connections (e.g., Microsoft Excel, Tableau, custom scripts).

## Prerequisites

1.  **SQLite ODBC Driver**: You need to have a SQLite ODBC driver installed on your system. A common one can be downloaded from [SQLite ODBC Driver by Christian Werner](http://www.ch-werner.de/sqliteodbc/). Download the version appropriate for your system (32-bit or 64-bit) and install it.

## Database File Location

The internal database is a SQLite file named `dev.db`.
By default, it is located in the `services/node-sync/` directory relative to the application's root installation path.

*   Example Path: `C:\Path\To\Your\Application\query_Tool\services\node-sync\dev.db`

If the `DATABASE_URL` environment variable was set when the `node-sync` service was started, it might point to a different location. The format would be `file:./path/to/your.db` or `file:/absolute/path/to/your.db`.

## Setting up an ODBC Data Source Name (DSN)

While you can use DSN-less connections, setting up a DSN can simplify the process for many tools.

1.  **Open ODBC Data Source Administrator**:
    *   Search for "ODBC Data Sources" in your Windows search bar. Make sure to open the version (32-bit or 64-bit) that matches the SQLite ODBC driver you installed and the application you intend to use for connecting (e.g., if using 32-bit Excel, use the 32-bit ODBC administrator).
2.  **Add a New DSN**:
    *   Go to the "User DSN" or "System DSN" tab. (User DSN is only for your user account; System DSN is available to all users).
    *   Click "Add...".
    *   Select the "SQLite3 ODBC Driver" (or similarly named driver you installed) and click "Finish".
3.  **Configure the DSN**:
    *   **Data Source Name**: Enter a descriptive name, e.g., `QueryToolLocalDB`.
    *   **Database Name**: Click "Browse..." and navigate to the `dev.db` file (e.g., `C:\Path\To\Your\Application\query_Tool\services\node-sync\dev.db`).
    *   Other options can usually be left at their defaults.
    *   Click "OK".

## Internal Database Schema

The primary table you'll be interested in is `selected_columns`. It stores the data sync configurations and the latest snapshot of the synced data.

**Table: `selected_columns`**

| Column Name       | Data Type     | Description                                                                 |
|-------------------|---------------|-----------------------------------------------------------------------------|
| `id`              | INTEGER       | Primary Key, auto-incrementing.                                             |
| `connection_name` | TEXT          | Name of the external database connection (e.g., "EPICOR", "POINT_OF_RENTAL"). |
| `table_name`      | TEXT          | Name of the table in the external database.                                 |
| `column_name`     | TEXT          | Name of the column in the external database.                                |
| `snapshot_json`   | TEXT (JSON)   | A JSON array containing up to 365 most recent values for this column.       |
| `last_synced_at`  | TEXT          | Timestamp (ISO 8601 format) of the last successful sync for this row.     |

## Extracting Data

When you query the `selected_columns` table via ODBC, the `snapshot_json` column will contain a JSON string.

**Example `snapshot_json` value:**
```json
["Value1", "Value2", 123, "Another Value", null, ...]
```

Most ODBC-consuming tools do not natively parse JSON. You might need to:

1.  **Export the Data**: Export the table (or selected rows/columns) to a CSV or Excel file. Then, use scripting (e.g., Python, PowerShell) or Excel's Power Query (Get & Transform Data) to parse the JSON string from the `snapshot_json` column into individual columns or rows.
2.  **Use Advanced Tools**: Some BI tools or programming languages with ODBC libraries can handle the JSON string programmatically after fetching the data.

**Example SQL Query (via ODBC tool):**
```sql
SELECT
    id,
    connection_name,
    table_name,
    column_name,
    snapshot_json,
    last_synced_at
FROM selected_columns
WHERE connection_name = 'EPICOR';
```

This will return the raw `snapshot_json` string. Further processing will be needed in your client tool to expand the JSON array into usable data points.

## Troubleshooting

*   **Driver Mismatch**: Ensure your ODBC driver (32/64-bit) matches the application you are using to connect (e.g., 32-bit Excel needs a 32-bit SQLite ODBC driver and DSN configured via the 32-bit ODBC Administrator).
*   **Database Locking**: The SQLite database is a single file. If the `node-sync` service is actively writing to it, you might experience temporary locking issues. Most ODBC drivers handle this with retries, but it's something to be aware of. Read-only operations are generally safer.
*   **File Path Issues**: Double-check the path to `dev.db` in your DSN configuration.

This setup allows for powerful ad-hoc querying and analysis of the data aggregated by the Query Tool application.
