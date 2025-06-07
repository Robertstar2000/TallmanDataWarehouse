import React, { useState, useEffect, Component } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import SidebarPanel from './SidebarPanel';
import {
  fetchConnections, testConnection, fetchTables, fetchColumns,
  addSelection, removeSelection, fetchSelections,
  downloadCSV, testQuery, fetchStatuses, fetchSyncStatus, fetchHelp, fetchOdbcHelp, clearAllSelections,
  saveConnectionConfig
} from './api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Error Boundary Component
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null,
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.toString()}</p>
          {this.state.errorInfo && (
            <div className="error-details">
              <h3>Component Stack:</h3>
              <pre>{this.state.errorInfo.componentStack}</pre>
            </div>
          )}
          <button 
            onClick={() => window.location.reload()}
            className="reload-button"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Reusable component for displaying lists with checkboxes
function CheckboxList({ items, selectedItem, handleItemSelect, addSelection, removeSelection, reloadSelections, selectedConn, selectedTable, type, selections }) {
  const isTable = type === 'table';
  const isColumn = type === 'column';
  const isSync = type === 'sync';

  return (
    <div className="scrolling-list-container">
      <label><b>{type === 'sync' ? 'Data Sync' : type.charAt(0).toUpperCase() + type.slice(1)}</b></label>
      <div className={`scrolling-list ${type}-list`}>
        {items.length === 0 ? (
          <div className="placeholder">No {type === 'sync' ? 'sync items' : type}</div>
        ) : isSync ? (
          <table className="sync-table">
            <thead>
              <tr>
                <th></th>
                <th>ID</th>
                <th>Server</th>
                <th>Table</th>
                <th>Column</th>
                <th>First Value</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      id={`sync-${item.id}`}
                      // For sync items, 'checked' means 'selected for removal'.
                      // The current onChange handler removes the item when checked.
                      // If you want to 'un-remove' by unchecking, that logic needs to be added.
                      checked={false} // Default to unchecked; user checks to select for removal.
                      onChange={async e => {
                        if (e.target.checked) {
                          await removeSelection(item.id);
                          reloadSelections(); 
                        }
                      }}
                    />
                  </td>
                  <td>{item.id}</td>
                  <td>{item.connection_name}</td>
                  <td>{item.table_name}</td>
                  <td>{item.column_name}</td>
                  <td>{JSON.parse(item.snapshot_json || '[]')[0] ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          items.map(item => {
            const isColumnType = isColumn && typeof item === 'object' && item !== null && 'name' in item;
            const itemName = isColumnType ? item.name : item;
            const itemFirstValue = isColumnType ? item.firstValue : null;
            
            const columnNameClass = isColumnType && 
                                    (itemFirstValue === null || String(itemFirstValue).trim() === '') 
                                    ? 'column-name-null-or-blank' 
                                    : '';

            return (
              <div key={itemName} className={`${type}-item`}>
                <input
                  type="checkbox"
                  id={`${type}-${itemName}`}
                  checked={isColumn 
                              ? selections.some(sel => sel.connection_name === selectedConn && sel.table_name === selectedTable && sel.column_name === itemName)
                              : (isTable ? selectedItem === itemName : false)
                          }
                  onChange={async e => {
                    if (isTable) {
                      if (e.target.checked) {
                        await handleItemSelect(itemName);
                      } else {
                        await handleItemSelect('');
                      }
                    } else if (isColumn) {
                      if (e.target.checked) {
                        await addSelection({ connection_name: selectedConn, table_name: selectedTable, column_name: itemName });
                      } else {
                        const selectionToRemove = selections.find(
                          sel => sel.connection_name === selectedConn &&
                                 sel.table_name === selectedTable &&
                                 sel.column_name === itemName
                        );
                        if (selectionToRemove) {
                          await removeSelection(selectionToRemove.id);
                        }
                      }
                      await reloadSelections();
                    }
                  }}
                />
                <label htmlFor={`${type}-${itemName}`}>
                  <span className={columnNameClass}>{itemName}</span>
                </label>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Reusable component for SQL Query Panel
function SQLQueryPanel({ sql, setSql, testQuery, selectedConn, setQueryResult, setError, queryResult }) {
  return (
    <div className="sql-panel">
      <h2>SQL Query Test</h2>
      <textarea
        className="sql-input"
        value={sql}
        onChange={e => setSql(e.target.value)}
        placeholder="Enter SQL query here..."
        rows={4}
      />
      <button
        onClick={async () => {
          try {
            const res = await testQuery(sql, selectedConn);
            setQueryResult(res.rows || []);
            setError(null);
          } catch (err) {
            setError('Query failed: ' + (err.message || err.toString()));
            setQueryResult([]);
          }
        }}
      >Run Query</button>
      {/* Raw query result field */}
      <div className="query-raw-result">
        {queryResult.length > 0
          ? `Rows returned: ${queryResult.length}`
          : (queryResult && queryResult.length === 0 ? 'No results.' : '')}
      </div>
      <div className="query-result">
        {queryResult.length > 0 ? (
          <>
            <h3>Results</h3>
            <table>
              <thead>
                <tr>
                  {Object.keys(queryResult[0]).map(col => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queryResult.map((row, i) => (
                  <tr key={row['Id'] !== undefined ? row['Id'] : i}>
                    {Object.values(row).map((val, j) => (
                      <td key={j}>{val}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="placeholder">No results.</div>
        )}
      </div>
    </div>
  );
}

function App() {
  console.log('DEBUG: App function invoked');
  // Connection and UI state
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState('');
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [columns, setColumns] = useState([]);
  const [selections, setSelections] = useState([]);
const [connectionStatuses, setConnectionStatuses] = useState(null);

  // Reload selections from backend
  const reloadSelections = async () => {
    try {
      const data = await fetchSelections();
      setSelections(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err.response?.status === 429) {
        console.warn('Rate limited when fetching selections:', err);
        setSelections([]);
      } else {
        setError('Failed to reload selections: ' + (err.message || err.toString()));
      }
    }
  };

  const handleFetchGeneralHelp = () => {
    fetchHelp() // Uses the imported function from api.js
      .then(data => {
        setHelpContent(data);
        setShowHelp(true);
      })
      .catch(err => {
        console.error('Error fetching general help:', err);
        setError('Failed to load general help content.');
      });
  };

  const handleFetchOdbcHelp = () => {
    fetchOdbcHelp() // Uses the imported function from api.js
      .then(data => {
        setOdbcHelpContent(data);
        setShowOdbcHelp(true);
      })
      .catch(err => {
        console.error('Error fetching ODBC help:', err);
        setError('Failed to load ODBC help content.');
      });
  };
  const [statuses, setStatuses] = useState({});
  
  // Query and results
  const [sql, setSql] = useState('');
  const [queryResult, setQueryResult] = useState([]);
  const [dataOnly, setDataOnly] = useState(false);
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [helpContent, setHelpContent] = useState('');
  const [showOdbcHelp, setShowOdbcHelp] = useState(false);
  const [odbcHelpContent, setOdbcHelpContent] = useState('');
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [excelDsn, setExcelDsn] = useState('');
  const [visibleColumns, setVisibleColumns] = useState({});
  const [tableColumns, setTableColumns] = useState({});
  
  // System status
  const [health, setHealth] = useState({ status: 'unknown' });
  const [syncStatus, setSyncStatus] = useState('idle');
  
  // Initialize statuses for all connections
  useEffect(() => {
    if (connections.length > 0) {
      const initialStatuses = {};
      connections.forEach(conn => {
        if (!statuses[conn.name]) {
          initialStatuses[conn.name] = 'disconnected';
        } else {
          initialStatuses[conn.name] = statuses[conn.name];
        }
      });
      setStatuses(prev => ({ ...prev, ...initialStatuses }));
    }
  }, [connections]);

  const checkHealth = async () => {
    const res = await fetch('/api/health');
    setHealth(await res.json());
  };

  // Load connections and their status on component mount
  useEffect(() => {
    const loadConnections = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch connections
        let conns;
        try {
          conns = await fetchConnections();
          console.log('Fetched connections:', conns);
        } catch (apiErr) {
          setError('Failed to fetch connections: ' + (apiErr.message || apiErr.toString()));
          setLoading(false);
          return;
        }
        if (!Array.isArray(conns)) {
          setError('Invalid response format: expected an array of connections');
          setLoading(false);
          return;
        }
        
        setConnections(conns);
        
        // Initialize statuses for all connections
        const initialStatuses = {};
        conns.forEach(conn => {
          if (conn && conn.name) {
            initialStatuses[conn.name] = 'disconnected';
          }
        });
        
        setStatuses(initialStatuses);
        
        // Test each connection and update status
        const updatedStatuses = { ...initialStatuses };
        
        // Use Promise.all to test all connections in parallel, including POR (mdb-reader)
        await Promise.all(conns.map(async (conn) => {
          if (!conn?.name) return;
          try {
            // Always use testConnection (server handles POR via mdb-reader, others via ODBC)
            const result = await testConnection(conn.name);
            const connected = result?.connected;
            updatedStatuses[conn.name] = connected ? 'connected' : 'disconnected';
            setStatuses(prev => ({ ...prev, ...updatedStatuses }));
          } catch (error) {
            console.error(`Error testing connection ${conn.name}:`, error);
            updatedStatuses[conn.name] = 'error';
            setStatuses(prev => ({ ...prev, ...updatedStatuses }));
          }
        }));
        
      } catch (error) {
        console.error('Error loading connections:', error);
        const errorMsg = error.response?.data?.message || 
                       error.message || 
                       'Failed to load connections. Please try again later.';
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    };

    loadConnections();
    reloadSelections();
    console.log('DEBUG: useEffect for loadConnections ran');
  }, []);
  
  // Test a single connection
  const testConnectionStatus = async (connectionName) => {
    try {
      // Update status to testing
      setStatuses(prev => ({
        ...prev,
        [connectionName]: { status: 'testing', timestamp: new Date().toISOString() }
      }));
      
      try {
        // Test the connection - the testConnection function returns a normalized response
        const result = await testConnection(connectionName);
        
        // Ensure we have a valid response
        if (!result) {
          throw new Error('No response from connection test');
        }
        
        // Extract and normalize the status
        let { status, message, connected, timestamp } = result || {};
        if (!status) status = connected ? 'connected' : 'disconnected';
        if (!timestamp || isNaN(Date.parse(timestamp))) timestamp = new Date().toISOString();
        const statusWithTimestamp = {
          status,
          message: message || `Connection ${status}`,
          timestamp,
          connected
        };
        // Update status with the normalized result
        setStatuses(prev => ({
          ...prev,
          [connectionName]: statusWithTimestamp
        }));
        
        // Handle success/failure
        if (connected) {
          setError(null);
          return true;
        } else {
          const errorMsg = message || `Failed to connect to ${connectionName}`;
          setError(errorMsg);
          console.error('Connection test failed:', errorMsg);
          return false;
        }
        
      } catch (testError) {
        console.error(`Test error for ${connectionName}:`, testError);
        const errorStatus = {
          status: 'error',
          message: testError.response?.data?.message || testError.message || 'Connection test failed',
          timestamp: new Date().toISOString(),
          connected: false
        };
        
        setStatuses(prev => ({
          ...prev,
          [connectionName]: errorStatus
        }));
        
        setError(errorStatus.message);
        return false;
      }
      
    } catch (error) {
      const errorStatus = {
        status: 'error',
        message: error.response?.data?.message || error.message || 'An unexpected error occurred while testing the connection',
        timestamp: new Date().toISOString(),
        connected: false
      };
      
      setStatuses(prev => ({
        ...prev,
        [connectionName]: errorStatus
      }));
      
      setError(errorStatus.message);
      return false;
    }
  };

  const handleConnectionSelect = async (connectionName) => {
    try {
      console.log('handleConnectionSelect called with:', connectionName);
      setLoading(true);
      setSelectedConn(connectionName);
      setSelectedTable('');
      setColumns([]);
      setError(null);
      
      if (!connectionName) {
        console.log('No connection name provided, clearing tables');
        setTables([]);
        return;
      }
      
      console.log(`Testing connection to ${connectionName}...`);
      // First test the connection
      const isConnected = await testConnectionStatus(connectionName);
      console.log(`Connection test result for ${connectionName}:`, isConnected);
      
      if (!isConnected) {
        const errorMsg = `Cannot connect to ${connectionName}. Please check the connection settings.`;
        console.error(errorMsg);
        setError(errorMsg);
        return;
      }
      
      console.log(`Fetching tables for ${connectionName}...`);
      // Fetch tables for the selected connection
      const tables = await fetchTables(connectionName);
      console.log(`Fetched tables for ${connectionName}:`, tables);
      setTables(Array.isArray(tables) ? tables : []);
      
    } catch (error) {
      console.error('Error in handleConnectionSelect:', error);
      setError(error.message || `An error occurred while selecting connection: ${connectionName}`);
      
      // Reset selection on error
      setSelectedConn('');
      setTables([]);
      setColumns([]);
      
    } finally {
      setLoading(false);
    }
  };

  const handleTableSelect = async (tableName) => {
    if (!selectedConn || !tableName) {
      setSelectedTable('');
      setColumns([]);
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      
      // Verify connection is still active
      const isConnected = await testConnectionStatus(selectedConn);
      if (!isConnected) {
        throw new Error(`Connection to ${selectedConn} is no longer available`);
      }
      
      // Update selected table
      setSelectedTable(tableName);
      
      // Fetch columns for the selected table
      try {
        const columns = await fetchColumns(selectedConn, tableName, true);
        setColumns(columns);
      } catch (columnError) {
        console.error(`Error loading columns for ${selectedConn}.${tableName}:`, columnError);
        throw new Error(`Failed to load columns: ${columnError.message}`);
      }
      
    } catch (error) {
      console.error('Error in handleTableSelect:', error);
      setError(error.message || `Failed to select table: ${tableName}`);
      
      // Reset selection on error
      setSelectedTable('');
      setColumns([]);
      
      // If connection is lost, reset the connection selection
      if (error.message.includes('no longer available')) {
        setSelectedConn('');
        setTables([]);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Get the appropriate Font Awesome icon for a given connection status
   * @param {object|string} status - The connection status
   * @returns {string} Font Awesome icon class
   */
  const getStatusIcon = (status) => {
    try {
      // Handle null/undefined
      if (status == null) return 'question-circle';
      
      // Handle objects with status/connected properties
      if (typeof status === 'object') {
        if (status.status) return getStatusIcon(status.status);
        if (typeof status.connected === 'boolean') return status.connected ? 'check-circle' : 'times-circle';
        return 'question-circle';
      }
      
      // Convert to string and normalize
      const statusStr = String(status).toLowerCase().trim();
      
      // Map status to icons
      if (['connected', 'true', 'up', 'ok', 'success'].includes(statusStr)) return 'check-circle';
      if (['disconnected', 'false', 'down', 'error', 'failed'].includes(statusStr)) return 'times-circle';
      if (['testing', 'loading', 'pending'].includes(statusStr)) return 'spinner fa-spin';
      if (statusStr.includes('error') || statusStr.includes('fail')) return 'exclamation-circle';
      
      console.warn(`Unknown status: ${statusStr}`);
      return 'question-circle';
    } catch (error) {
      console.error('Error getting status icon:', error, 'Status value:', status);
      return 'question-circle';
    }
  };

  // Handle connection selection change
  useEffect(() => {
    if (selectedConn) {
      handleConnectionSelect(selectedConn);
    }
  }, [selectedConn]);

  useEffect(() => {
    if (selectedConn) {
      const loadAll = async () => {
        const map = {};
        for (const tbl of tables) {
          map[tbl] = await fetchColumns(selectedConn, tbl, dataOnly);
        }
        setTableColumns(map);
      };
      loadAll();
    } else {
      setTableColumns({});
    }
  }, [selectedConn, tables, dataOnly]);

  useEffect(() => {
    if (selectedConn && selectedTable) {
      fetchColumns(selectedConn, selectedTable, dataOnly).then(setColumns);
    }
  }, [selectedTable, dataOnly]);

  useEffect(() => {
    fetchStatuses().then(setStatuses);
  }, []);

  useEffect(() => {
    const loadStatus = () => fetchSyncStatus()
      .then(data => {
        console.log('[DEBUG] Raw sync status API response:', data);
        // Ensure we have a valid status string
        let status = data?.currentCommand || data?.status || 'idle';
        if (!status || typeof status !== 'string') status = 'unknown';
        // Accept only known values, otherwise show 'pending'
        const allowed = ['idle', 'syncing', 'running', 'error'];
        if (!allowed.includes(status)) status = 'pending';
        setSyncStatus(status);
      })
      .catch(err => {
        console.error('Error fetching sync status:', err);
        setSyncStatus('error');
      });
    
    loadStatus();
    console.log('[SYNC] Creating sync status polling interval (5s)');
    const iv = setInterval(loadStatus, 5000); // Check every 5 seconds
    return () => {
      console.log('[SYNC] Clearing sync status polling interval');
      clearInterval(iv);
    };

  }, []);

  // Loading & error guards
  if (loading) {
    return <div className="loading">Loading...</div>;
  }
  if (error) {
    return <div className="error-message">Error: {error}</div>;
  }

  // Main UI
  return (
    <>
      <h1 className="app-header">Tallman Data Warehouse</h1>
      <div className="app-grid">
        <SidebarPanel
          connections={connections}
          selectedConn={selectedConn}
        handleConnectionSelect={handleConnectionSelect}
        excelDsn={excelDsn}
        setExcelDsn={setExcelDsn}
        saveConnectionConfig={saveConnectionConfig}
        setError={setError}
        setHealth={setHealth}
        health={health}
        error={error}
        visibleColumns={visibleColumns}
        setVisibleColumns={setVisibleColumns}
        downloadCSV={downloadCSV}
        onFetchGeneralHelp={handleFetchGeneralHelp}
        onFetchOdbcHelp={handleFetchOdbcHelp} // Changed prop name for consistency
        // setShowHelp, setHelpContent, setShowOdbcHelp, setOdbcHelpContent are managed by the handlers above
        testConnection={testConnection}
      />
      <div className="main-content">
        <CheckboxList
          items={tables}
          selectedItem={selectedTable}
          handleItemSelect={handleTableSelect}
          type="table"
        />
        <CheckboxList
          items={columns}
          selectedConn={selectedConn}
          selectedTable={selectedTable}
          addSelection={addSelection}
          removeSelection={removeSelection}
          reloadSelections={reloadSelections}
          type="column"
          selections={selections}
        />
        <CheckboxList
          items={selections}
          selectedConn={selectedConn}
          selectedTable={selectedTable}
          removeSelection={removeSelection}
          reloadSelections={reloadSelections}
          type="sync"
        />
        <SQLQueryPanel
          sql={sql}
          setSql={setSql}
          testQuery={testQuery}
          selectedConn={selectedConn}
          setQueryResult={setQueryResult}
          setError={setError}
          queryResult={queryResult}
        />
        <div className="section-container connection-diagnostics-section">
          <h3>Connection Diagnostics</h3>
          <button onClick={async () => {
            setLoading(true);
            setConnectionStatuses(null);
            const statuses = await testAllConnections();
            setConnectionStatuses(statuses);
            setLoading(false);
          }} disabled={loading} className="action-button">
            Test All Connections
          </button>
          {connectionStatuses && (
            <div className="connection-statuses-display">
              <h4>Connection Test Results:</h4>
              <ul>
                {Object.entries(connectionStatuses).map(([name, status]) => (
                  <li key={name} style={{ color: status.connected ? 'green' : 'red' }}>
                    <strong>{name}:</strong> {status.connected ? 'Connected' : `Error - ${status.error || 'Unknown error'}`}
                    {status.latencyMs !== undefined && ` (Latency: ${status.latencyMs}ms)`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
    {showHelp && (
      <div className="help-modal-overlay">
        <div className="help-modal-content">
          <button className="help-modal-close-btn" onClick={() => setShowHelp(false)}>×</button>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{helpContent}</ReactMarkdown>
        </div>
      </div>
    )}
    {showOdbcHelp && (
      <div className="help-modal-overlay odbc-help-modal-overlay">
        <div className="help-modal-content odbc-help-modal-content">
          <button className="help-modal-close-btn" onClick={() => setShowOdbcHelp(false)}>×</button>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{odbcHelpContent}</ReactMarkdown>
        </div>
      </div>
    )}
  </>
);
}
export default App;
