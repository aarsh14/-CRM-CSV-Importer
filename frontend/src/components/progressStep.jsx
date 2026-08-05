import { useEffect } from 'react';
import { useJobPolling } from '../hooks/useJobPolling';

// Two distinct phases, tracking two different things:
//   Phase A — uploading: bytes travelling browser -> server (uploadPercent,
//             driven by axios onUploadProgress in client.js). No jobId exists yet.
//   Phase B — processing: server streaming/batching/mapping rows (useJobPolling,
//             driven by polling GET /api/jobs/:id). Starts once jobId is set.
function ProgressStep({ jobId, uploadPercent, onComplete }) {
  const isUploading = !jobId;

  const { status, processedRows, totalRows, result, error } = useJobPolling(
    isUploading ? null : jobId
  );

  useEffect(() => {
    if (status === 'completed' && result) {
      onComplete({
        totalRows: result.totalRows,
        imported: result.imported || [],
        skipped: result.skipped || [],
      });
    }
  }, [status, result, onComplete]);

  const processingPercent =
    totalRows > 0 ? Math.round((processedRows / totalRows) * 100) : 0;

  return (
    <div className="panel">
      <h2 className="panel-heading">
        {isUploading ? 'Uploading' : 'Processing'}
      </h2>
      <p className="panel-note">
        {isUploading
          ? 'Sending your file to the server.'
          : 'Streaming your file and mapping rows into CRM records.'}
      </p>

      {error && <div className="error-banner">{error}</div>}
      {status === 'failed' && (
        <div className="error-banner">The import failed while processing.</div>
      )}

      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: 'var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${isUploading ? uploadPercent : processingPercent}%`,
            background: 'var(--color-accent)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      <p className="panel-note" style={{ marginTop: '0.6rem' }}>
        {isUploading
          ? `${uploadPercent}% uploaded`
          : status === 'pending'
          ? 'Starting…'
          : `${processedRows} of ${totalRows || '?'} rows processed (${processingPercent}%)`}
      </p>
    </div>
  );
}

export default ProgressStep;