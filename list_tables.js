import odbc from 'odbc';

const DSN = 'P21Play'; // Use your actual DSN

async function listTables() {
  let conn;
  try {
    console.log('Connecting to DSN:', DSN);
    conn = await odbc.connect(`DSN=${DSN}`);
    // Get tables
    const sqlTables = `SELECT TABLE_SCHEMA, TABLE_NAME, 'TABLE' as TYPE FROM INFORMATION_SCHEMA.TABLES`;
    const tables = await conn.query(sqlTables);
    // Get views
    let views = [];
    try {
      const sqlViews = `SELECT TABLE_SCHEMA, TABLE_NAME, 'VIEW' as TYPE FROM INFORMATION_SCHEMA.VIEWS`;
      views = await conn.query(sqlViews);
      if (!views || views.length === 0) {
        // Fallback: try to find views by naming convention in TABLES
        const sqlViewsFallback = `SELECT TABLE_SCHEMA, TABLE_NAME, 'VIEW' as TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'p21_view_%'`;
        const fallbackViews = await conn.query(sqlViewsFallback);
        if (fallbackViews && fallbackViews.length > 0) {
          console.warn('INFORMATION_SCHEMA.VIEWS is empty, using fallback to find views in TABLES with name LIKE p21_view_%');
          views = fallbackViews;
        }
      }
    } catch (e) {
      console.warn('Could not fetch views:', e.message);
    }
    const all = [...tables, ...views];
    all.sort((a, b) => {
      if (a.TABLE_SCHEMA === b.TABLE_SCHEMA) return a.TABLE_NAME.localeCompare(b.TABLE_NAME);
      return a.TABLE_SCHEMA.localeCompare(b.TABLE_SCHEMA);
    });
    console.log('All tables and views:');
    for (const row of all) {
      console.log(`Schema: ${row.TABLE_SCHEMA}, Name: ${row.TABLE_NAME}, Type: ${row.TYPE}`);
    }
  } catch (err) {
    console.error('Error listing tables/views:', err);
  } finally {
    if (conn) await conn.close();
  }
}

listTables();
