import { useState ,useEffect} from 'react';
import './App.css';
import UploadStep from './components/uploadStep';
import PreviewStep from './components/previewStep';
import ProgressStep from './components/progressStep';
import ResultsStep from './components/resultStep';
import Login from './components/login';
import Signup from './components/signup';
import { uploadCsvFile } from './api/client';
import { getCurrentUser,logout } from './api/client';

const STEPS = [
  { key: 'upload', label: 'Upload' },
  { key: 'preview', label: 'Preview' },
  { key: 'progress', label: 'Processing' },
  { key: 'results', label: 'Results' },
];

function App() {
  // 'checking' | 'authenticated' | 'unauthenticated'
  const [authStatus, setAuthStatus] = useState('checking');
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('signup'); // 'login' | 'signup'

  const [step, setStep] = useState('upload');
  const [fileData, setFileData] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [results, setResults] = useState(null);
  const [uploadError, setUploadError] = useState('');

  // On first load, check if a valid session cookie already exists —
  // avoids forcing a fresh login every time the page is refreshed.
  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u);
        setAuthStatus('authenticated');
      })
      .catch(() => {
        setAuthStatus('unauthenticated');
      });
  }, []);

 
 
 
 const handleAuthSuccess = (u) => {
    setUser(u);
    setAuthStatus('authenticated');
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setAuthStatus('unauthenticated');
    handleStartOver();
  };

  const currentIndex = STEPS.findIndex((s) => s.key === step);

  const handleFileReady = (data) => {
    setFileData(data);
    setStep('preview');
  };

  const handleConfirm = async () => {
    setUploadError('');
    setUploadPercent(0);
    setStep('progress');

    try {
      const { jobId } = await uploadCsvFile(fileData.file, setUploadPercent);
      setJobId(jobId);
    } catch (err) {
      setUploadError(
        err.response?.data?.error || 'Upload failed. Please try again.'
      );
      setStep('preview');
    }
  };

  const handleProcessingComplete = (jobResults) => {
    setResults(jobResults);
    setStep('results');
  };

  const handleStartOver = () => {
    setFileData(null);
    setJobId(null);
    setUploadPercent(0);
    setResults(null);
    setStep('upload');
  };

  // --- Auth gating ---

  if (authStatus === 'checking') {
    return (
      <div className="app-shell">
        <p className="empty-state">Loading…</p>
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div>
            <h1 className="app-title">Lead Importer</h1>
            <p className="app-subtitle">AI-mapped CRM import from any CSV format</p>
          </div>
        </header>

        {authMode === 'login' ? (
          <Login
            onSuccess={handleAuthSuccess}
            onSwitchToSignup={() => setAuthMode('signup')}
          />
        ) : (
          <Signup
            onSuccess={handleAuthSuccess}
            onSwitchToLogin={() => setAuthMode('login')}
          />
        )}
      </div>
    );
  }

  // --- Authenticated app ---

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1 className="app-title">Lead Importer</h1>
          <p className="app-subtitle">AI-mapped CRM import from any CSV format</p>
        </div>
      </header>

      <div className="top-bar">
        <span className="user-email">{user?.email}</span>
        <button className="btn btn-ghost" onClick={handleLogout}>
          Log out
        </button>
      </div>

      <div className="step-track">
        {STEPS.map((s, i) => (
          <div
            key={s.key}
            className={`step-pill ${i === currentIndex ? 'active' : ''} ${
              i < currentIndex ? 'done' : ''
            }`}
          >
            <span className="step-num">{i + 1}</span>
            {s.label}
          </div>
        ))}
      </div>

      {step === 'upload' && <UploadStep onFileReady={handleFileReady} />}

      {step === 'preview' && fileData && (
        <PreviewStep
          previewRows={fileData.previewRows}
          fields={fileData.fields}
          fileName={fileData.file.name}
          onConfirm={handleConfirm}
          onBack={handleStartOver}
          uploadError={uploadError}
        />
      )}

      {step === 'progress' && (
        <ProgressStep
          jobId={jobId}
          uploadPercent={uploadPercent}
          onComplete={handleProcessingComplete}
        />
      )}

      {step === 'results' && results && (
        <ResultsStep results={results} onStartOver={handleStartOver} />
      )}
    </div>
  );
}

export default App;
