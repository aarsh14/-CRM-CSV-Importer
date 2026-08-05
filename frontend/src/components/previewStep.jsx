function PreviewStep({ previewRows, fields, fileName, onConfirm, onBack, uploadError }) {
  if (!previewRows || previewRows.length === 0) {
    return (
      <div className="panel">
        <p className="empty-state">No data to preview.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2 className="panel-heading">Preview</h2>
      <p className="panel-note">
        Showing the first {previewRows.length} rows exactly as they appear in{' '}
        <strong>{fileName}</strong>. Nothing has been sent anywhere yet.
      </p>

      <div className="preview-meta">
        <span>{fields.length} columns detected</span>
        <span>{previewRows.length} rows shown</span>
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {fields.map((f) => (
                <th key={f}>{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, i) => (
              <tr key={i}>
                {fields.map((f) => {
                  const value = row[f];
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

      {uploadError && <div className="error-banner">{uploadError}</div>}

      <div className="btn-row">
        <button className="btn" onClick={onConfirm}>
          Confirm import
        </button>
        <button className="btn btn-ghost" onClick={onBack}>
          Choose a different file
        </button>
      </div>
    </div>
  );
}

export default PreviewStep;
