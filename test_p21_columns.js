import odbc from 'odbc';
import dotenv from 'dotenv';
dotenv.config();

const DSN = 'P21Play'; // Hardcoded as per user instruction
const TABLE = 'p21_view_chart_of_accts';
const SCHEMAS = ['dbo', null];
const NAMES = [TABLE, TABLE.toUpperCase(), TABLE.toLowerCase()];

async function tryQueries() {
  let conn;
  try {
    console.log('Connecting to DSN:', DSN);
    conn = await odbc.connect(`DSN=${DSN}`);
    for (const schema of SCHEMAS) {
      for (const name of NAMES) {
        let sql = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ?`;
        const params = [name];
        if (schema) {
          sql += ' AND TABLE_SCHEMA = ?';
          params.push(schema);
        }
        sql += ' ORDER BY ORDINAL_POSITION';
        try {
          console.log(`Trying SQL:`, sql, params);
          const result = await conn.query(sql, params);
          console.log(`Result for TABLE_NAME='${name}'${schema ? ", SCHEMA='" + schema + "'" : ''}:`, result);
          if (result && result.length > 0) {
            console.log('SUCCESS! Columns:', result.map(r => r.COLUMN_NAME || r.column_name || r.columnName));
            return;
          }
        } catch (e) {
          console.log(`Query failed for TABLE_NAME='${name}'${schema ? ", SCHEMA='" + schema + "'" : ''}:`, e.message);
        }
      }
    }
    // Try quoted table names as well
    for (const schema of SCHEMAS) {
      for (const name of NAMES) {
        let sql = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ?`;
        const quoted = `[${name}]`;
        const params = [quoted];
        if (schema) {
          sql += ' AND TABLE_SCHEMA = ?';
          params.push(schema);
        }
        sql += ' ORDER BY ORDINAL_POSITION';
        try {
          console.log(`Trying SQL (quoted):`, sql, params);
          const result = await conn.query(sql, params);
          console.log(`Result for TABLE_NAME='${quoted}'${schema ? ", SCHEMA='" + schema + "'" : ''}:`, result);
          if (result && result.length > 0) {
            console.log('SUCCESS! Columns:', result.map(r => r.COLUMN_NAME || r.column_name || r.columnName));
            return;
          }
        } catch (e) {
          console.log(`Query failed for TABLE_NAME='${quoted}'${schema ? ", SCHEMA='" + schema + "'" : ''}:`, e.message);
        }
      }
    }
    console.log('No successful query found.');
  } catch (err) {
    console.error('Connection or query error:', err);
  } finally {
    if (conn) await conn.close();
  }
}

tryQueries();
