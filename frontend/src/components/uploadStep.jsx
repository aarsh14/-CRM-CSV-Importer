import { useState, useRef } from 'react';
import Papa from 'papaparse';

const PREVIEW_ROW_LIMIT = 200;

function UploadStep({ onFileReady }) {
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState('');
    const [fileName, setFileName] = useState('');
    const inputRef = useRef(null);  //eference to hidden file input

    const parseFile = (file) => {
        setError('');

        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.csv')) {
            setError('Please upload a .csv file.');
            return;
        }

        setFileName(file.name);


        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            preview: PREVIEW_ROW_LIMIT,
            worker: true,
            complete: (results) => {
                if (!results.data || results.data.length === 0) {
                    setError('This CSV appears to be empty.');
                    return;
                }

                onFileReady({
                    file,
                    previewRows: results.data,
                    fields: results.meta.fields || [],
                });
            },
            error: (err) => {
                setError('Could not read this file: ' + err.message);
            },
        });
    };

    const handleFileInput = (e) => {
        parseFile(e.target.files[0]);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        parseFile(e.dataTransfer.files[0]);
    };

    return (
        <div className="panel">
            <h2 className="panel-heading">Upload a lead file</h2>
            <p className="panel-note">
                Any CSV export works — Facebook Ads, Google Ads, a CRM export, or a manual spreadsheet.
                Column names don't need to match anything specific.
            </p>

            <div
                className={`dropzone ${isDragging ? 'dropzone-active' : ''}`}
                onDrop={handleDrop}
                onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
            >
                <p className="dropzone-label">
                    {fileName ? fileName : 'Drag a CSV file here'}
                </p>
                <p className="dropzone-sub">or</p>
                <button className="btn" onClick={() => inputRef.current?.click()}>
                    Choose file
                </button>
                <input
                    ref={inputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileInput}
                    style={{ display: 'none' }}
                />
            </div>

            {error && <div className="error-banner">{error}</div>}
        </div>
    );
}

export default UploadStep;
