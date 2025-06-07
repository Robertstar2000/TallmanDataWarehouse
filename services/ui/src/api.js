import axios from 'axios';

// Use a relative path which will be proxied by Vite
const baseURL = '/api';
console.log('API Base URL:', baseURL);

// Create axios instance with default config
const api = axios.create({ 
  baseURL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest'
  },
  timeout: 30000, // 30 seconds
  withCredentials: true
});

// Request interceptor for API calls
api.interceptors.request.use(
  config => {
    // You can add auth tokens here if needed
    // const token = localStorage.getItem('token');
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`;
    // }
    return config;
  },
  error => {
    return Promise.reject(error);
  }
);

// Response interceptor for API calls
api.interceptors.response.use(
  response => response,
  error => {
    // Handle errors globally
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('API Error Response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        config: error.config
      });
    } else if (error.request) {
      // The request was made but no response was received
      console.error('API Request Error:', error.request);
      error.message = 'No response from server. Please check your connection.';
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('API Error:', error.message);
    }
    return Promise.reject(error);
  }
);

/**
 * Fetches the list of available database connections
 * @returns {Promise<Array>} Array of connection objects
 */
export async function fetchConnections() {
  try {
    const response = await api.get('/connections');
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.error('Error fetching connections:', error);
    throw error;
  }
}

/**
 * Tests a database connection
 * @param {string} connectionName - The name of the connection to test
 * @returns {Promise<{status: string, message?: string, connected?: boolean}>} Test result
 */
export async function testConnection(connectionName) {
  try {
    const response = await api.post('/connections/test', { connection_name: connectionName });
    
    // Ensure the response is in a consistent format
    const data = response.data || {};
    
    // If the response is a simple boolean or string, normalize it
    if (typeof data === 'boolean') {
      return { status: data ? 'connected' : 'disconnected', connected: data };
    }
    
    if (typeof data === 'string') {
      return { 
        status: data.toLowerCase().includes('connect') ? 'connected' : 'disconnected',
        message: data
      };
    }
    
    // If it's an object, ensure it has a status field
    if (data && typeof data === 'object') {
      return {
        status: data.status || (data.connected ? 'connected' : 'disconnected'),
        message: data.message,
        connected: data.connected || data.status === 'connected'
      };
    }
    
    // Default fallback
    return { status: 'disconnected', message: 'Unknown connection status' };
    
  } catch (error) {
    console.error(`Error testing connection ${connectionName}:`, error);
    return { 
      status: 'error', 
      message: error.response?.data?.message || error.message || 'Connection test failed',
      connected: false
    };
  }
}

/**
 * Fetches the list of tables for a specific connection
 * @param {string} connectionName - The name of the connection
 * @returns {Promise<Array>} Array of table names
 */
export async function fetchTables(connectionName) {
  try {
    console.log(`[API] Fetching tables for connection: ${connectionName}`);
    const response = await api.get('/tables', { 
      params: { connection_name: connectionName } 
    });
    
    console.log(`[API] Received tables response:`, response.data);
    
    // Handle different response formats
    let tables = [];
    if (Array.isArray(response.data)) {
      tables = response.data;
    } else if (response.data && Array.isArray(response.data.tables)) {
      tables = response.data.tables;
    }
    
    console.log(`[API] Extracted tables:`, tables);
    return tables;
    
  } catch (error) {
    console.error(`[API] Error fetching tables for ${connectionName}:`, error);
    if (error.response) {
      console.error('[API] Error response data:', error.response.data);
      console.error('[API] Error response status:', error.response.status);
      console.error('[API] Error response headers:', error.response.headers);
    } else if (error.request) {
      console.error('[API] No response received:', error.request);
    } else {
      console.error('[API] Error setting up request:', error.message);
    }
    throw error;
  }
}

/**
 * Fetches the list of columns for a specific table
 * @param {string} connectionName - The name of the connection
 * @param {string} tableName - The name of the table
 * @param {boolean} [dataOnly=false] - Whether to return only columns with data
 * @returns {Promise<Array>} Array of column names
 */
export async function fetchColumns(connectionName, tableName, dataOnly = false) {
  try {
    const response = await api.get('/columns', { 
      params: { 
        connection_name: connectionName, 
        table_name: tableName, 
        data_only: dataOnly 
      } 
    });
    
    // Handle different response formats
    if (Array.isArray(response.data)) {
      return response.data;
    } else if (response.data && Array.isArray(response.data.columns)) {
      return response.data.columns;
    }
    return [];
  } catch (error) {
    console.error(`Error fetching columns for ${connectionName}.${tableName}:`, error);
    throw error;
  }
}

/**
 * Adds a column selection to the saved selections
 * @param {Object} selection - The selection to add
 * @returns {Promise<Object>} The added selection
 */
export async function addSelection(selection) {
  try {
    const response = await api.post('/selected_columns', selection);
    return response.data;
  } catch (error) {
    console.error('Error adding selection:', error);
    throw error;
  }
}

/**
 * Removes a column selection by ID
 * @param {string|number} id - The ID of the selection to remove
 * @returns {Promise<Object>} The server response
 */
export async function removeSelection(id) {
  try {
    const response = await api.delete(`/selected_columns/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error removing selection ${id}:`, error);
    throw error;
  }
}

/**
 * Fetches all saved column selections
 * @returns {Promise<Array>} Array of saved selections
 */
export async function fetchSelections() {
  try {
    const response = await api.get('/selected_columns');
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.error('Error fetching selections:', error);
    throw error;
  }
}

/**
 * Initiates a CSV download of the Data Sync items.
 * Each row in the CSV will contain: ID, Connection, Table, Column, and up to 365 data values.
 */
export async function downloadCSV() {
  try {
    // Fetch the selections (Data Sync table) from the backend
    const response = await api.get('/selected_columns'); // Using axios instance
    const selections = response.data; // axios automatically parses JSON

    if (!Array.isArray(selections) || selections.length === 0) {
      alert('No Data Sync rows to export.');
      return;
    }

    // Prepare CSV header
    const valueHeaders = Array.from({ length: 365 }, (_, i) => `Value${i + 1}`);
    const header = ['ID', 'Connection', 'Table', 'Column', ...valueHeaders];

    const rows = selections.map(row => {
      const id = row.id !== undefined && row.id !== null ? String(row.id) : '';
      const connection = row.connection_name !== undefined && row.connection_name !== null ? String(row.connection_name) : '';
      const table = row.table_name !== undefined && row.table_name !== null ? String(row.table_name) : '';
      const column = row.column_name !== undefined && row.column_name !== null ? String(row.column_name) : '';

      let columnData = [];
      try {
        if (row.snapshot_json) {
          const parsedData = JSON.parse(row.snapshot_json);
          if (Array.isArray(parsedData)) {
            columnData = parsedData.slice(0, 365);
          }
        }
      } catch (e) {
        console.warn('Error parsing snapshot_json for row ID ' + id + ':', e);
        // Keep columnData as empty array if parsing fails
      }

      // Pad with empty strings if fewer than 365 values and ensure all are strings
      const paddedValues = Array(365).fill('');
      columnData.forEach((val, index) => {
        paddedValues[index] = val !== null && val !== undefined ? String(val) : '';
      });
      
      return [id, connection, table, column, ...paddedValues].join(',');
    });

    const csvContent = [header.join(','), ...rows].join('\n');

    // Create a blob and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) { // feature detection
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'data_sync_export.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else {
      alert("CSV download is not supported in this browser.");
    }

  } catch (error) {
    console.error('Error downloading CSV:', error);
    let errorMessage = 'Failed to generate CSV.';
    if (error.response && error.response.data && error.response.data.message) {
      errorMessage += ` Server: ${error.response.data.message}`;
    } else if (error.message) {
      errorMessage += ` ${error.message}`;
    }
    alert(errorMessage);
    // Not re-throwing error to prevent potential double handling by global interceptors
  }
}

/**
 * Fetches the status of all database connections
 * @returns {Promise<Object>} Status of all connections
 */
export async function fetchStatuses() {
  try {
    const response = await api.get('/connections/status');
    return response.data || {};
  } catch (error) {
    console.error('Error fetching connection statuses:', error);
    throw error;
  }
}

/**
 * Fetches the current sync status
 * @returns {Promise<Object>} Current sync status
 */
export async function fetchSyncStatus() {
  try {
    const response = await api.get('/sync-status');
    return response.data || {};
  } catch (error) {
    console.error('Error fetching sync status:', error);
    throw error;
  }
}

/**
 * Fetches help documentation (README.md)
 * @returns {Promise<string>} Markdown content
 */
export const fetchHelp = () => api.get('/help').then(res => res.data);
export const fetchOdbcHelp = () => api.get('/odbc-help').then(res => res.data);

/**
 * Saves a P21 ODBC DSN string
 * @param {string} dsn
 * @returns {Promise<Object>} Backend response
 */
/**
 * Saves a connection config (DSN or MDB path)
 * @param {string} type - 'p21' or 'por'
 * @param {string} value - DSN string or MDB path
 * @returns {Promise<Object>} Backend response
 */
export async function saveConnectionConfig(type, value) {
  try {
    const response = await api.post('/connections', { type, value });
    return response.data;
  } catch (error) {
    console.error('Error saving connection config:', error);
    throw error;
  }
}

/**
 * Deletes all saved column selections
 * @returns {Promise<Object>} The server response
 */
export async function clearAllSelections() {
  try {
    const response = await api.delete('/selected_columns/all');
    return response.data;
  } catch (error) {
    console.error('Error clearing all selections:', error);
    throw error;
  }
}

/**
 * Tests a SQL query against a connection
 * @param {string} connectionName - The name of the connection to test against
 * @param {string} sql - The SQL query to test
 * @returns {Promise<Object>} The query results
 */
export async function testQuery(connectionName, sql) {
  try {
    const response = await api.post('/test-query', { 
      connection_name: connectionName, 
      sql 
    });
    return response.data;
  } catch (error) {
    console.error('Error testing query:', error);
    throw error;
  }
}
