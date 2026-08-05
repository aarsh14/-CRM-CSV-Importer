function ResultsStep({ results, onStartOver }) {
  if (!results) return null;

  const { imported, skipped, totalRows } = results;

  return (
    <div className="panel">
      <h2 className="panel-heading">Import complete</h2>
      <p className="panel-note">{totalRows} rows processed.</p>

      <div className="summary-row">
        <div className="summary-card imported">
          <p className="summary-label">Imported</p>
          <p className="summary-value">{imported.length}</p>
        </div>
        <div className="summary-card skipped">
          <p className="summary-label">Skipped</p>
          <p className="summary-value">{skipped.length}</p>
        </div>
      </div>

      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', marginBottom: '0.5rem' }}>
        Imported records
      </h3>
      <p className="panel-note" style={{ marginTop: 0 }}>
        CRM field mapping is a Phase 4 placeholder right now — showing raw source data below.
      </p>
      <RawRowTable rows={imported} emptyLabel="No records were imported." />

      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', margin: '1.5rem 0 0.5rem' }}>
        Skipped records
      </h3>
      <RawRowTable rows={skipped} emptyLabel="Nothing was skipped." showSkipReason />

      <div className="btn-row">
        <button className="btn btn-ghost" onClick={onStartOver}>
          Import another file
        </button>
      </div>
    </div>
  );
}

// Renders ImportRecord documents ({ rawRow, skipReason, ... }) coming
// straight from the backend. Column set is derived from whatever keys
// exist on the first record's rawRow, same "generic table" approach
// used in PreviewStep.
function RawRowTable({ rows, emptyLabel, showSkipReason = false }) {
  if (!rows || rows.length === 0) {
    return <p className="empty-state">{emptyLabel}</p>;
  }

  const fields = Object.keys(rows[0].rawRow || {});

  return (
    <div className="table-wrapper" style={{ marginBottom: '1rem' }}>
      <table className="data-table">
        <thead>
          <tr>
            {showSkipReason && <th>Skip reason</th>}
            {fields.map((f) => (
              <th key={f}>{f}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((record, i) => (
            <tr key={record._id || i}>
              {showSkipReason && <td>{record.skipReason || '—'}</td>}
              {fields.map((f) => {
                const value = record.rawRow?.[f];
                const isEmpty = value === undefined || value === '';
                return (
                  <td key={f} className={isEmpty ? 'cell-empty' : ''}>
                    {isEmpty ? '—' : value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ResultsStep;
