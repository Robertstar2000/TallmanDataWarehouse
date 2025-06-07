import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import odbc from 'odbc';
import fs from 'fs';
import path from 'path';
import MDBReader from 'mdb-reader';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';

// Resolve __dirname in ESM and load env from service directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// Determine SQLite DB path with fallback
let rawDbUrl = process.env.DATABASE_URL;
if (!rawDbUrl) {
  console.warn('DATABASE_URL not set; defaulting to file:./dev.db');
  rawDbUrl = 'file:./dev.db';
}
const relativeDbPath = rawDbUrl.replace(/^file:/, '');
const dbFile = path.resolve(__dirname, relativeDbPath);
console.log('Opening SQLite DB at:', dbFile);
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Failed to open SQLite database', err);
    process.exit(1);
  }
});
const dbAll = promisify(db.all).bind(db);
const dbRun = promisify(db.run).bind(db);

// Initialize SQLite schema
(async () => {
  await dbRun(`CREATE TABLE IF NOT EXISTS selected_columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_selcols ON selected_columns(connection_name, table_name, column_name)`);
  // Clear the table on startup
  await dbRun('DELETE FROM selected_columns');
  console.log('[INIT] Cleared selected_columns table in SQLite.');
})();

// Map connection_name to ODBC DSN via environment variables
const dsnMap = {
  EPICOR: process.env.EPICOR_DSN,
  POINT_OF_RENTAL: process.env.POR_DSN,
  QUICKBOOKS: process.env.QB_DSN,
  JOBSCOPE: process.env.JOBSCOPE_DSN,
};

const SYNC_INTERVAL_MS = 2000;
let currentCommand = 'Idle';
let syncIndex = 0;

// Helper to open the POR .mdb file via mdb-reader
function openPorDb() {
  try {
    const filePath = process.env.POR_Path;
    if (!filePath) {
      throw new Error('POR_Path environment variable is not set');
    }
    
    console.log(`[POR] Reading database from path: ${filePath}`);
    const resolvedPath = path.resolve(filePath);
    console.log(`[POR] Resolved path: ${resolvedPath}`);
    
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Database file does not exist at: ${resolvedPath}`);
    }
    
    console.log('[POR] Reading file content...');
    const buf = fs.readFileSync(resolvedPath);
    console.log(`[POR] File read successfully (${buf.length} bytes)`);
    
    console.log('[POR] Creating MDBReader instance...');
    const reader = new MDBReader(buf);
    console.log('[POR] MDBReader instance created successfully');
    
    return reader;
  } catch (error) {
    console.error('[POR] Error opening database:', error);
    throw new Error(`Failed to open Point of Rental database: ${error.message}`);
  }
}

async function runSyncCycle() {
  try {
    currentCommand = 'Starting sync cycle';
    console.log('Running sync at', new Date().toISOString());
    const rows = await dbAll('SELECT * FROM selected_columns');
    // Group by connection_name
    const groups = rows.reduce((acc, row) => {
      acc[row.connection_name] = acc[row.connection_name] || [];
      acc[row.connection_name].push(row);
      return acc;
    }, {});
    const connNames = Object.keys(groups);
    if (connNames.length === 0) { currentCommand = 'Idle'; return; }
    const connName = connNames[syncIndex % connNames.length];
    syncIndex++;
    const rowsGroup = groups[connName];
    currentCommand = `Connecting to ${connName}`;
    // Special-case Point of Rental using MDBReader
    if (connName === 'POINT_OF_RENTAL') {
      const reader = openPorDb();
      for (const row of rowsGroup) {
        try {
          console.log(`Sync POR: table=${row.table_name}, column=${row.column_name}`);
          const tableObj = reader.getTable(row.table_name);
          const rowsData = tableObj.getData();
          console.log(`POR rowsData[0]:`, rowsData[0]);
          // Log first 3 raw rows for debugging
          console.log(`Sample POR data for ${row.table_name}:`, JSON.stringify(rowsData.slice(0,3), null, 2));
          const values = rowsData.map(r => {
            // handle object or array row
            if (Array.isArray(r)) {
              const idx = tableObj.getColumnNames().indexOf(row.column_name);
              return r[idx];
            } else {
              return r[row.column_name];
            }
          }).slice(0, 365); // Limit to first 365 values
          await dbRun(
            'UPDATE selected_columns SET snapshot_json = ?, last_synced_at = ? WHERE id = ?',
            [JSON.stringify(values), new Date().toISOString(), row.id]
          );
        } catch (err) {
          console.error(`Error syncing POR.${row.table_name}.${row.column_name}`, err);
        }
      }
      currentCommand = 'Idle';
      return;
    }
    const dsn = dsnMap[connName];
    if (!dsn) { console.warn(`No DSN for connection ${connName}`); currentCommand='Idle'; return; }
    let connection;
    try {
      // Robust P21 ODBC connection logic
      const connectionString = `DSN=${dsn}`;
      let connection = null;
      try {
        console.log(`[Worker] P21 Connecting using DSN: ${dsn}...`);
        connection = await odbc.connect(connectionString);
        console.log('[Worker] P21 Connected. Executing query...');
        for (const row of rowsGroup) {
          try {
            let sql;
            // Escape double quotes within names by doubling them up, and wrap names in double quotes.
            const escapeQuote = (name) => name.replace(/"/g, '""');
            const quotedColumn = `"${escapeQuote(row.column_name)}"`;
            const quotedTable = `"${escapeQuote(row.table_name)}"`;

            if (connName === 'EPICOR' || (dsn && (dsn.toUpperCase().includes('SQL SERVER') || dsn.toUpperCase().includes('P21')))) {
              sql = `SELECT TOP 365 ${quotedColumn} FROM ${quotedTable}`;
            } else { // Default to LIMIT for other ODBCs (e.g., PostgreSQL, MySQL, SQLite)
              sql = `SELECT ${quotedColumn} FROM ${quotedTable} LIMIT 365`;
            }
            currentCommand = `${connName}: ${sql}`;
            // Execute with a query timeout (e.g., 30 seconds)
            const result = await connection.query(sql);
            console.log('[Worker] P21 Query executed.');
            const values = result.map(r => r[row.column_name]);
            await dbRun(
              'UPDATE selected_columns SET snapshot_json = ?, last_synced_at = ? WHERE id = ?',
              [JSON.stringify(values), new Date().toISOString(), row.id]
            );
          } catch (err) {
            console.error(`Error syncing ${connName}.${row.table_name}.${row.column_name}`, err);
          }
        }
      } catch (error) {
        console.error(`[Worker] P21 Query FAILED:`, error instanceof Error ? error.message : error);
        console.error('[Worker] P21 Query Error Details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      } finally {
        if (connection) {
          try {
            await connection.close();
            console.log('[Worker] P21 Connection closed.');
          } catch (closeError) {
            console.error('[Worker] Error closing P21 connection:', closeError);
          }
        }
      }
      currentCommand = 'Idle';
      return;
    } catch (err) {
      console.error(`Failed to connect to ${connName}`, err);
      currentCommand = 'Idle';
      return;
    }

  } catch (err) {
    console.error('Sync error', err);
  }
}
setInterval(runSyncCycle, SYNC_INTERVAL_MS);

const app = express();
app.use(cors());
app.use(express.json());

// Log incoming requests
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// Serve Help markdown from root README.md
app.get('/api/help', async (req, res) => {
  const readmePath = path.resolve(__dirname, '../../README.md');
  console.log('Attempting to read help file from:', readmePath);
  
  try {
    // Check if file exists first
    try {
      await fs.promises.access(readmePath, fs.constants.F_OK);
      console.log('Help file exists, reading contents...');
    } catch (accessErr) {
      console.error('Help file does not exist or is not accessible:', accessErr);
      return res.status(404).json({ error: 'Help file not found: ' + readmePath });
    }
    
    const data = await fs.promises.readFile(readmePath, 'utf8');
    console.log('Successfully read help file, length:', data.length, 'characters');
    res.type('text/markdown');
    res.send(data);
  } catch (err) {
    console.error('Error reading help file:', err);
    res.status(500).json({ error: 'Cannot read help file: ' + err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));
app.get('/api/connections/test', async (req, res) => {
  // Test all DBs, never throw, always return status for each
  const results = {};
  const dbs = Object.keys(dsnMap);
  await Promise.all(dbs.map(async (name) => {
    const startTime = Date.now();
    if (name === 'POINT_OF_RENTAL') {
      try {
        openPorDb();
        results[name] = {
          connected: true,
          latencyMs: Date.now() - startTime
        };
      } catch (err) {
        results[name] = {
          connected: false,
          error: err.message,
          latencyMs: Date.now() - startTime
        };
      }
    } else {
      let conn;
      try {
        conn = await odbc.connect(`DSN=${dsnMap[name]}`);
        await conn.query('SELECT 1');
        results[name] = {
          connected: true,
          latencyMs: Date.now() - startTime
        };
      } catch (err) {
        results[name] = {
          connected: false,
          error: err.message,
          latencyMs: Date.now() - startTime
        };
      } finally {
        if (conn) {
          try { await conn.close(); } catch {}
        }
      }
    }
  }));
  res.json(results);
});

app.post('/api/connections/test', async (req, res) => {
  const { connection_name } = req.body;
  if (!connection_name || !dsnMap[connection_name]) {
    return res.status(400).json({ 
      status: 'error', 
      message: 'Invalid connection name',
      connected: false
    });
  }

  const dsn = dsnMap[connection_name];
  const startTime = Date.now();
  
  try {
    // Special handling for Point of Rental
    if (connection_name === 'POINT_OF_RENTAL') {
      try {
        const reader = openPorDb();
        // Just try to get table names as a test
        reader.getTableNames();
        return res.json({
          status: 'connected',
          message: 'Successfully connected to Point of Rental database',
          connected: true,
          latencyMs: Date.now() - startTime
        });
      } catch (err) {
        console.error(`Failed to connect to Point of Rental:`, err);
        return res.status(500).json({
          status: 'error',
          message: `Point of Rental connection failed: ${err.message}`,
          connected: false,
          latencyMs: Date.now() - startTime
        });
      }
    }

    // Handle other ODBC connections
    let conn;
    try {
      conn = await odbc.connect(`DSN=${dsn}`);
      // Simple query to test connection
      await conn.query('SELECT 1');
      return res.json({
        status: 'connected',
        message: `Successfully connected to ${connection_name}`,
        connected: true,
        latencyMs: Date.now() - startTime
      });
    } catch (err) {
      console.error(`Connection test failed for ${connection_name}:`, err);
      return res.status(500).json({
        status: 'error',
        message: `Connection test failed: ${err.message}`,
        connected: false,
        latencyMs: Date.now() - startTime
      });
    } finally {
      if (conn) await conn.close();
    }
  } catch (err) {
    console.error('Unexpected error during connection test:', err);
    return res.status(500).json({
      status: 'error',
      message: `Unexpected error: ${err.message}`,
      connected: false,
      latencyMs: Date.now() - startTime
    });
  }
});

// API endpoints for front-end
app.get('/api/connections', (req, res) => {
  res.json(Object.keys(dsnMap));
});

// Save DSN or MDB Path
app.post('/api/connections', (req, res) => {
  const { type, value } = req.body;
  if (!type || !value) return res.status(400).json({ error: 'Missing type or value' });
  // TODO: Save to DB or config file as needed
  console.log(`[API] Saving connection config: type=${type}, value=${value}`);
  // For now, just echo back
  res.json({ status: 'ok', type, value });
});

app.get('/api/tables', async (req, res) => {
  const { connection_name } = req.query;
  console.log(`[API] /api/tables called with connection: ${connection_name}`);

  // Use MDBReader for Point of Rental (old Jet MDB format)
  if (connection_name === 'POINT_OF_RENTAL') {
    console.log('[API] Handling POINT_OF_RENTAL connection');
    try {
      const reader = openPorDb();
      const tableNames = reader.getTableNames();
      console.log(`[API] Found ${tableNames.length} tables in POR database`);
      return res.json(tableNames);
    } catch (e) {
      console.error('[API] Error reading POR tables:', e);
      return res.status(500).json({ 
        error: 'Failed to read POR tables',
        details: e.message,
        stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
      });
    }
  }
  
  // Handle other database connections
  console.log(`[API] Handling database connection: ${connection_name}`);
  const dsn = dsnMap[connection_name];
  if (!dsn) {
    console.error(`[API] Unknown connection: ${connection_name}`);
    return res.status(400).json({ 
      error: `Unknown connection: ${connection_name}`,
      availableConnections: Object.keys(dsnMap)
    });
  }
  
  console.log(`[API] Using DSN: ${dsn}`);
  let conn;
  try {
    console.log('[API] Attempting to connect to database...');
    conn = await odbc.connect(`DSN=${dsn}`);
    console.log('[API] Connected, fetching tables...');
    let tableNames = [];
    if (connection_name && (connection_name.toUpperCase().includes('P21') || connection_name.toUpperCase().includes('EPICOR'))) {
      // Only return tables and views from dbo schema for Epicor/P21
      const sqlTables = `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = 'dbo' ORDER BY TABLE_NAME`;
      const sqlViews = `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = 'dbo' ORDER BY TABLE_NAME`;
      const tablesResult = await conn.query(sqlTables);
      const viewsResult = await conn.query(sqlViews);
      console.log('[API] Epicor/P21 raw tables:', tablesResult);
      console.log('[API] Epicor/P21 raw views:', viewsResult);
      tableNames = [
        ...tablesResult.map(r => r.TABLE_NAME),
        ...viewsResult.map(r => r.TABLE_NAME)
      ];
      tableNames.sort();
      console.log('[API] Epicor/P21 combined tableNames returned:', tableNames);
    } else {
      const result = await conn.tables(null, null, '%', 'TABLE');
      tableNames = result
        .map(r => ({ name: r.TABLE_NAME || r.table_name || r.tableName, schema: r.TABLE_SCHEMA || r.table_schema || r.tableSchema }))
        .filter(t => t.name);
    }
    res.json(tableNames);
  } catch (err) {
    console.error(`[API] Failed fetching tables for ${connection_name}:`, err);
    res.status(500).json({ 
      error: `Failed to fetch tables: ${err.message}`,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } finally {
    if (conn) {
      try {
        console.log('[API] Closing database connection');
        await conn.close();
      } catch (closeErr) {
        console.error('[API] Error closing connection:', closeErr);
      }
    }
  }
});

app.get('/api/columns', async (req, res) => {
  // DEBUG: Always log and always respond with valid JSON, even on error or empty result
  let responded = false;
  function safeJson(obj) {
    if (!responded) {
      responded = true;
      res.setHeader('Content-Type', 'application/json');
      res.json(obj);
    } else {
      console.warn('[API] /api/columns: Response already sent, attempted to send:', obj);
    }
  }
  try {
    // Prevent caching of column metadata
    res.setHeader('Cache-Control', 'no-store');
    // Log all incoming params for debugging
    console.log('[API] /api/columns called', req.query);
    // Debug logging for incoming params
    console.log('[API] /api/columns', { connection_name: req.query.connection_name, table_name: req.query.table_name, data_only: req.query.data_only });
    const { connection_name, table_name, data_only } = req.query;
    // Use MDBReader for Point of Rental (old Jet MDB format)
    if (connection_name === 'POINT_OF_RENTAL') {
      try {
        const reader = openPorDb();
        const tbl = reader.getTable(table_name);
        const columnNames = tbl.getColumnNames();
        const allRows = tbl.getData(); // Get all data once
        const firstRow = allRows.length > 0 ? allRows[0] : null;

        let columnsWithFirstValue = columnNames.map(name => {
          let firstValue = null;
          if (firstRow) {
            const colIndex = columnNames.indexOf(name); // MDBReader might return rows as arrays
            firstValue = Array.isArray(firstRow) ? firstRow[colIndex] : firstRow[name];
          }
          return { name, firstValue };
        });

        if (data_only === 'true') {
          columnsWithFirstValue = columnsWithFirstValue.filter(colObj => {
            // Check if any row has a non-empty value for this column
            return allRows.some(r => {
              const val = Array.isArray(r)
                ? r[columnNames.indexOf(colObj.name)]
                : r[colObj.name];
              return val !== null && String(val).trim() !== '' && val !== 0; // Ensure string conversion for trim
            });
          });
        }
        console.log('[API] POR columnsWithFirstValue:', columnsWithFirstValue);
        safeJson(columnsWithFirstValue);
        return;
      } catch (e) {
        console.error('[API] POR error:', e);
        safeJson({ error: 'Failed to read POR columns' });
        return;
      }
    }
    const dsn = dsnMap[connection_name];
    if (!dsn) return res.status(400).json({ error: 'Unknown connection' });
    let conn;
    try {
      conn = await odbc.connect(`DSN=${dsn}`);
      let columnNames = [];
      // Debug logging for DSN
      console.log('[API] Using DSN:', dsn);
      // Helper to quote SQL identifiers (handles names with spaces, keywords, etc.)
      const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

      // Robust Epicor/P21 detection
      const isEpicor = connection_name && (connection_name.toUpperCase().includes('P21') || connection_name.toUpperCase().includes('EPICOR'));
      if (isEpicor) {
        // Always use dbo schema for Epicor/P21
        const schema = 'dbo';
        const possibleNames = [table_name, table_name.toUpperCase(), table_name.toLowerCase()];
        let foundColumns = [];
        let tried = [];
        // Try unquoted and quoted, with and without schema
        for (const name of possibleNames) {
          for (const quoted of [false, true]) {
            let tname = quoted ? `[${name}]` : name;
            let sql = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? AND TABLE_SCHEMA = ? ORDER BY ORDINAL_POSITION`;
            let params = [tname, schema];
            tried.push({sql, params});
            try {
              const result = await conn.query(sql, params);
              if (result && result.length > 0) {
                foundColumns = result;
                console.log(`[API] Found columns for ${connection_name}.${tname} in schema ${schema}:`, result);
                break;
              }
            } catch (err) {
              console.warn(`[API] Error querying columns for ${connection_name}.${tname}:`, err.message);
            }
          }
          if (foundColumns.length > 0) break;
        }
        // If not found, try all schemas, unquoted/quoted
        if (foundColumns.length === 0) {
          for (const name of possibleNames) {
            for (const quoted of [false, true]) {
              let tname = quoted ? `[${name}]` : name;
              let sql = `SELECT COLUMN_NAME, TABLE_SCHEMA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION`;
              let params = [tname];
              tried.push({sql, params});
              try {
                const result = await conn.query(sql, params);
                if (result && result.length > 0) {
                  foundColumns = result;
                  console.log(`[API] Fallback: Found columns for ${connection_name}.${tname} in any schema:`, result);
                  break;
                }
              } catch (err) {
                console.warn(`[API] Fallback error querying columns for ${connection_name}.${tname}:`, err.message);
              }
            }
            if (foundColumns.length > 0) break;
          }
        }
        columnNames = foundColumns.map(r => r.COLUMN_NAME || r.column_name || r.columnName).filter(Boolean);
        console.log('[API] Epicor/P21 Columns result:', foundColumns, '\nTried:', tried);
      } else {
        // Default: Use ODBC columns
        const result = await conn.columns(null, null, table_name, '%');
        columnNames = result.map(r => r.COLUMN_NAME || r.column_name || r.columnName).filter(Boolean);
      }
      const columnsWithFirstValue = [];
      console.log('[API] Final columnNames:', columnNames);
      const quotedTableName = quoteIdent(table_name);

      for (const colName of columnNames) {
        let firstValue = null;
        const quotedColName = quoteIdent(colName);
        try {
          let firstValueSql;
          // Use TOP 1 for SQL Server (P21 might be SQL Server based)
          if (connection_name && (connection_name.toUpperCase().includes('P21') || (dsn && dsn.toUpperCase().includes('SQL SERVER')))) {
            firstValueSql = `SELECT TOP 1 ${quotedColName} AS val FROM ${quotedTableName}`;
          } else {
            firstValueSql = `SELECT ${quotedColName} AS val FROM ${quotedTableName} LIMIT 1`;
          }
          const firstValueResult = await conn.query(firstValueSql);
          if (firstValueResult.length > 0) {
            firstValue = firstValueResult[0].val;
          }
        } catch (fvError) {
          console.warn(`Could not fetch first value for ${connection_name}.${table_name}.${colName}: ${fvError.message}`);
        }
        columnsWithFirstValue.push({ name: colName, firstValue });
      }
      let finalColumns = columnsWithFirstValue;
      if (data_only === 'true') {
        const filteredColumns = [];
        for (const colObj of columnsWithFirstValue) {
          try {
            // This query checks if *any* row has a meaningful value, not just the first one.
            // The original logic for data_only seemed to imply this broader check.
            const quotedColName = quoteIdent(colObj.name);
            const checkDataSql = `SELECT 1 AS exist FROM ${quotedTableName} WHERE ${quotedColName} IS NOT NULL AND CAST(${quotedColName} AS VARCHAR(MAX)) != '' LIMIT 1`;
            // Note: CAST might be DB specific. For simplicity, using a common approach. Adjust if needed for specific DBs.
            // The original check also included '!= 0' which is tricky for non-numeric types. Keeping it simple for now.
            const rows = await conn.query(checkDataSql);
            if (rows.length > 0 && rows[0].exist) {
              filteredColumns.push(colObj);
            }
          } catch (dataCheckError) {
            console.warn(`Error during data_only check for ${connection_name}.${table_name}.${colObj.name}: ${dataCheckError.message}`);
            // If check fails, conservatively include the column or decide based on requirements.
            // For now, if check fails, it's not added to filteredColumns.
          }
        }
        finalColumns = filteredColumns;
      }
      console.log('[API] Returning columns:', finalColumns);
      safeJson(finalColumns);
      return;
    } catch (err) {
      console.error(`[API] /api/columns error:`, err);
      safeJson({ error: err.message });
      return;
    } finally {
      if (conn) await conn.close();
    }
  } catch (outerErr) {
    console.error('[API] /api/columns outer error:', outerErr);
    safeJson({ error: outerErr.message });
  }
});

app.get('/api/selected_columns', async (req, res) => {
  const rows = await dbAll('SELECT * FROM selected_columns');
  res.json(rows);
});

app.post('/api/selected_columns', async (req, res) => {
  const { connection_name, table_name, column_name } = req.body;
  // Insert placeholder row
  await dbRun(
    'INSERT INTO selected_columns(connection_name, table_name, column_name, snapshot_json) VALUES(?,?,?,?)',
    [connection_name, table_name, column_name, '[]']
  );
  // Retrieve inserted row
  let newRow = (await dbAll('SELECT * FROM selected_columns ORDER BY id DESC LIMIT 1'))[0];
  try {
    let values = [];
    if (connection_name === 'POINT_OF_RENTAL') {
      const reader = openPorDb();
      const tableObj = reader.getTable(table_name);
      const data = tableObj.getData();
      const columnNames = tableObj.getColumnNames();
      const columnIndex = columnNames.indexOf(column_name);
      if (columnIndex !== -1) {
        values = data.map(r => (Array.isArray(r) ? r[columnIndex] : r[column_name])).slice(0, 365);
      } else {
        console.warn(`Column ${column_name} not found in POR table ${table_name}`);
      }
    } else {
      const dsn = dsnMap[connection_name];
      if (!dsn) throw new Error(`DSN not found for connection: ${connection_name}`);
      const conn = await odbc.connect(`DSN=${dsn}`);
      let sql;
      // Escape double quotes within names by doubling them up, and wrap names in double quotes.
      const escapeQuote = (name) => name.replace(/"/g, '""');
      const quotedColumn = `"${escapeQuote(column_name)}"`;
      const quotedTable = `"${escapeQuote(table_name)}"`;

      if (connection_name === 'EPICOR' || (dsn && (dsn.toUpperCase().includes('SQL SERVER') || dsn.toUpperCase().includes('P21')))) {
        sql = `SELECT TOP 365 ${quotedColumn} FROM ${quotedTable}`;
      } else {
        sql = `SELECT ${quotedColumn} FROM ${quotedTable} LIMIT 365`;
      }
      const result = await conn.query(sql);
      await conn.close();
      if (result && result.length > 0 && result[0].hasOwnProperty(column_name)){
        values = result.map(r => r[column_name]);
      } else if (result && result.length > 0 && Object.keys(result[0]).length === 1) {
        // If the column name in the result set doesn't exactly match (e.g. due to case sensitivity or driver behavior)
        // and there's only one column in the result, assume it's the correct one.
        const actualColumnNameInResult = Object.keys(result[0])[0];
        values = result.map(r => r[actualColumnNameInResult]);
        console.warn(`Query for ${quotedColumn} returned column named ${actualColumnNameInResult}. Using this column.`);
      } else {
        console.warn(`No data or column ${column_name} not found in result for ${connection_name}.${table_name}`);
      }
    }
    // Update snapshot_json with the array of values
    await dbRun(
      'UPDATE selected_columns SET snapshot_json = ?, last_synced_at = CURRENT_TIMESTAMP WHERE id = ?',
      [JSON.stringify(values), newRow.id]
    );
    newRow = (await dbAll('SELECT * FROM selected_columns WHERE id = ?', [newRow.id]))[0];
  } catch (err) {
    console.error('Error fetching initial values for selection:', err);
    // If an error occurs, we still have the placeholder '[]' in snapshot_json, or the previous value if update failed.
  }
  res.json(newRow);
});

app.delete('/api/selected_columns/:id', async (req, res) => {
  const id = Number(req.params.id);
  await dbRun('DELETE FROM selected_columns WHERE id = ?', [id]);
  res.json({ success: true });
});

app.get('/api/download', async (req, res) => {
  const rows = await dbAll('SELECT * FROM selected_columns');
  res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
  res.setHeader('Content-Type', 'text/csv');
  const csv = rows.map(r => [r.connection_name, r.table_name, r.column_name, JSON.stringify(r.snapshot_json), r.last_synced_at].join(',')).join('\n');
  res.send(csv);
});

app.post('/api/query-test', async (req, res) => {
  const { connection_name, sql } = req.body;
  const dsn = dsnMap[connection_name];
  if (!dsn) return res.status(400).json({ error: 'Unknown connection' });
  try {
    const conn = await odbc.connect(`DSN=${dsn}`);
    const result = await conn.query(sql);
    await conn.close();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Connection status endpoint
// Test a specific database connection
app.get('/api/connections/test', async (req, res) => {
  const { connectionName } = req.query;
  
  if (!connectionName) {
    return res.status(400).json({ error: 'Connection name is required' });
  }
  
  const dsn = dsnMap[connectionName];
  if (!dsn) {
    return res.status(404).json({ error: 'Connection not found' });
  }
  
  try {
    console.log(`[API] Testing connection to ${connectionName} using DSN: ${dsn}`);
    const conn = await odbc.connect(`DSN=${dsn}`);
    await conn.close();
    console.log(`[API] Successfully connected to ${connectionName}`);
    res.json({ success: true, connection: connectionName });
  } catch (error) {
    console.error(`[API] Connection test failed for ${connectionName}:`, error.message);
    res.status(500).json({ 
      error: 'Connection test failed', 
      message: error.message,
      connection: connectionName
    });
  }
});

app.get('/api/connections/status', async (req, res) => {
  const statuses = {};
  for (const name of Object.keys(dsnMap)) {
    if (name === 'POINT_OF_RENTAL') {
      try {
        openPorDb(); // Will throw if MDB file is missing or unreadable
        statuses[name] = true;
      } catch (error) {
        console.error(`[API] Status check failed for ${name}:`, error.message);
        statuses[name] = false;
      }
    } else {
      try {
        const conn = await odbc.connect(`DSN=${dsnMap[name]}`);
        await conn.close();
        statuses[name] = true;
      } catch (error) {
        console.error(`[API] Status check failed for ${name}:`, error.message);
        statuses[name] = false;
      }
    }
  }
  res.json(statuses);
});

// Endpoint to fetch current sync command status
app.get('/api/sync-status', (req, res) => {
  res.json({ currentCommand });
});

// Serve built UI (if present) and catch-all route
const uiDist = path.resolve(__dirname, '../ui/dist');
if (fs.existsSync(uiDist)) {
  // Serve built UI static files
  app.use(express.static(uiDist));
  // Explicitly serve asset files
  app.use('/assets', express.static(path.join(uiDist, 'assets')));
  // SPA fallback: for GET requests not starting with /api or /assets, serve index.html
  app.get(/^\/(?!api|assets).*$/, (req, res) => {
    res.sendFile(path.join(uiDist, 'index.html'));
  });
}

// Endpoint to serve README.md for general help
app.get('/api/help', async (req, res) => {
  const filePath = path.join(__dirname, '..', '..', 'README.md'); // Assumes README.md is in the project root
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading README.md:', err);
      return res.status(500).send('Error reading help file.');
    }
    res.type('text/markdown');
    res.send(data);
  });
});

// Endpoint to serve ReadODBC.md
app.get('/api/odbc-help', async (req, res) => {
  const filePath = path.join(__dirname, '..', '..', 'ReadODBC.md');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading ReadODBC.md:', err);
      return res.status(500).send('Error reading ODBC help file.');
    }
    res.type('text/markdown');
    res.send(data);
  });
});

// Start HTTP server
const port = process.env.NODE_SYNC_PORT || 3001;
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
