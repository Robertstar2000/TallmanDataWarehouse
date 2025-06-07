import fs from 'fs';
import path from 'path';
import MDBReader from 'mdb-reader';

// Load POR_Path from .env in this directory
const envPath = path.resolve(process.cwd(), '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const match = envContent.match(/^POR_Path="?(.+?)"?$/m);
if (!match) {
  console.error('POR_Path not found in .env');
  process.exit(1);
}
const porPath = match[1];

// Read MDB file
const buf = fs.readFileSync(path.resolve(porPath));
const reader = new MDBReader(buf);

// Define target table and column
const tableName = 'TotalsDaily';
const columnName = 'ALL';

try {
  const table = reader.getTable(tableName);
  const dataRows = table.getData();
  const colNames = table.getColumnNames();
  const idx = colNames.indexOf(columnName);
  if (idx < 0) throw new Error(`Column ${columnName} not found in ${tableName}`);

  const values = dataRows.map(r => Array.isArray(r) ? r[idx] : r[columnName]);
  console.log(`Values for ${tableName}.${columnName}:`, values);
} catch (err) {
  console.error('Error extracting POR data:', err);
}
