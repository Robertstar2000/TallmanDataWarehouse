import odbc from 'odbc';

const DSN = 'P21Play'; // Use your actual DSN

async function listFilteredTables() {
  let conn;
  try {
    console.log('Connecting to DSN:', DSN);
    conn = await odbc.connect(`DSN=${DSN}`);
    // Get filtered tables
    const sqlTables = `SELECT TABLE_SCHEMA, TABLE_NAME, 'TABLE' as TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%chart%' OR TABLE_NAME LIKE '%account%'`;
    const tables = await conn.query(sqlTables);
    // Get filtered views
    let views = [];
    try {
      const sqlViews = `SELECT TABLE_SCHEMA, TABLE_NAME, 'VIEW' as TYPE FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_NAME LIKE '%chart%' OR TABLE_NAME LIKE '%account%'`;
      views = await conn.query(sqlViews);
      if (!views || views.length === 0) {
        // Fallback: try to find views by naming convention in TABLES
        const sqlViewsFallback = `SELECT TABLE_SCHEMA, TABLE_NAME, 'VIEW' as TYPE FROM INFORMATION_SCHEMA.TABLES WHERE (TABLE_NAME LIKE 'p21_view_%') AND (TABLE_NAME LIKE '%chart%' OR TABLE_NAME LIKE '%account%')`;
        const fallbackViews = await conn.query(sqlViewsFallback);
        if (fallbackViews && fallbackViews.length > 0) {
          console.warn('INFORMATION_SCHEMA.VIEWS is empty, using fallback to find views in TABLES with name LIKE p21_view_% and filter');
          views = fallbackViews;
        }
      }
    } catch (e) {
      console.warn('Could not fetch filtered views:', e.message);
    }
    const all = [...tables, ...views];
    all.sort((a, b) => {
      if (a.TABLE_SCHEMA === b.TABLE_SCHEMA) return a.TABLE_NAME.localeCompare(b.TABLE_NAME);
      return a.TABLE_SCHEMA.localeCompare(b.TABLE_SCHEMA);
    });
    if (all.length === 0) {
      console.log('No tables or views found containing chart or account in the name.');
    } else {
      console.log('Filtered tables and views:');
      for (const row of all) {
        console.log(`Schema: ${row.TABLE_SCHEMA}, Name: ${row.TABLE_NAME}, Type: ${row.TYPE}`);
      }
    }
  } catch (err) {
    console.error('Error listing filtered tables/views:', err);
  } finally {
    if (conn) await conn.close();
  }
}

listFilteredTables();
