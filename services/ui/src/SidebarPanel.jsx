import React from 'react';

function SidebarPanel(props) {
  const {
    connections,
    selectedConn,
    handleConnectionSelect,
    excelDsn,
    setExcelDsn,
    saveConnectionConfig,
    setError,
    setHealth,
    health,
    error,
    visibleColumns,
    setVisibleColumns,
    downloadCSV,
    onFetchGeneralHelp, // New prop for general help handler
    onFetchOdbcHelp    // New prop for ODBC help handler (renamed from fetchOdbcHelp)
    // fetchHelp, setShowHelp, setHelpContent are no longer needed here
  } = props;

  return (
    <div className="connections-panel">
      <h2>Connections</h2>
      <button className="help-btn" onClick={onFetchGeneralHelp}>Help</button>
      <div className="connections-list">
        {Array.isArray(connections) && connections.length > 0 ? (
          connections.map(conn => (
            <button
              key={typeof conn === 'string' ? conn : conn.name}
              className={selectedConn === (conn.name || conn) ? 'conn-btn selected' : 'conn-btn'}
              onClick={() => handleConnectionSelect(conn.name || conn)}
            >{conn.name || conn}</button>
          ))
        ) : (
          <div className="placeholder">No connections found</div>
        )}
      </div>
      {/* 1. P21 ODBC DSN */}
      <div className="dsn-entry">
        <label htmlFor="dsn-input"><b>P21 ODBC DSN:</b></label>
        <input
          id="dsn-input"
          type="text"
          placeholder="Enter DSN string for Epicor P21"
          value={excelDsn}
          onChange={e => setExcelDsn(e.target.value)}
        />
        <button 
          onClick={async () => {
            try {
              await saveConnectionConfig('p21', excelDsn);
              setError(null);
              setHealth({ status: 'success', message: 'DSN saved!' });
            } catch (err) {
              setError('Failed to save DSN: ' + (err.message || err.toString()));
            }
          }}
        >Save DSN</button>
        {health.status === 'success' && health.message && <div className="success-msg">{health.message}</div>}
        {error && error.includes('DSN') && <div className="error-message">{error}</div>}
      </div>
      {/* 2. POR Access/JET .mdb Path */}
      <div className="mdb-entry">
        <label htmlFor="mdb-input"><b>POR Access/JET .mdb Path:</b></label>
        <input
          id="mdb-input"
          type="text"
          placeholder="Enter .mdb file path for Point of Rental"
          value={visibleColumns.mdbPath || ''}
          onChange={e => setVisibleColumns(v => ({...v, mdbPath: e.target.value}))}
        />
        <button 
          onClick={async () => {
            try {
              await saveConnectionConfig('por', visibleColumns.mdbPath);
              setError(null);
              setHealth({ status: 'success', message: 'MDB path saved!' });
            } catch (err) {
              setError('Failed to save MDB path: ' + (err.message || err.toString()));
            }
          }}
        >Save Path</button>
        {health.status === 'success' && health.message && <div className="success-msg">{health.message}</div>}
        {error && error.includes('MDB') && <div className="error-message">{error}</div>}
      </div>
      {/* 3. QuickBooks Connection String/Path (reserved) */}
      <div className="qb-entry">
        <label htmlFor="qb-input"><b>QuickBooks Connection String/Path:</b></label>
        <input
          id="qb-input"
          type="text"
          placeholder="Reserved for future QuickBooks integration"
          disabled
        />
        <span className="field-note">(Not yet implemented)</span>
      </div>
      {/* 4. JobScope ERP Connection String/Path (reserved) */}
      <div className="jobscope-entry">
        <label htmlFor="jobscope-input"><b>JobScope ERP Connection String/Path:</b></label>
        <input
          id="jobscope-input"
          type="text"
          placeholder="Reserved for future JobScope ERP integration"
          disabled
        />
        <span className="field-note">(Not yet implemented)</span>
      </div>
      {/* 5. Hubspot CRM Connection String/Path (reserved) */}
      <div className="hubspot-entry">
        <label htmlFor="hubspot-input"><b>Hubspot CRM Connection String/Path:</b></label>
        <input
          id="hubspot-input"
          type="text"
          placeholder="Reserved for future Hubspot CRM integration"
          disabled
        />
        <span className="field-note">(Not yet implemented)</span>
      </div>
      {/* 6. Cascade Connection String/Path (reserved) */}
      <div className="cascade-entry">
        <label htmlFor="cascade-input"><b>Cascade Connection String/Path:</b></label>
        <input
          id="cascade-input"
          type="text"
          placeholder="Reserved for future Cascade integration"
          disabled
        />
      </div>
      {/* 7. Connection Test */}
      <button className="health-btn" onClick={async () => {
        if (!selectedConn) {
          setError('Please select a connection to test.');
          return;
        }
        setHealth({ status: 'testing', message: 'Testing connection...' });
        try {
          const res = await props.testConnection(selectedConn);
          setHealth({ status: res.status, message: res.message });
          setError(null);
        } catch (err) {
          setHealth({ status: 'error', message: err.message || 'Connection test failed.' });
          setError('Connection test failed: ' + (err.message || err.toString()));
        }
      }}>Test Connection</button>
      <span className={`health-banner health-${health.status}`}>{health.status}{health.message ? ': ' + health.message : ''}</span>
      {error && error.includes('connection') && <div className="error-message">{error}</div>}
      <button className="download-btn" onClick={downloadCSV}>Download CSV</button>
      <button className="odbc-help-btn" onClick={onFetchOdbcHelp}>ODBC Help</button>
    </div>
  );
}

export default SidebarPanel;
