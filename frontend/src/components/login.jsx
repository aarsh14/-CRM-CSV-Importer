import { useState } from 'react';
import { login } from '../api/client';

function Login({ onSuccess, onSwitchToSignup }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      onSuccess(user);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel" style={{ maxWidth: 400, margin: '0 auto' }}>
      <h2 className="panel-heading">Log in</h2>
      <p className="panel-note">Access your lead import history.</p>

      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="form-field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <div className="error-banner">{error}</div>}

        <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p className="panel-note" style={{ marginTop: '1rem', textAlign: 'center' }}>
        No account?{' '}
        <button
          type="button"
          onClick={onSwitchToSignup}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-accent)',
            cursor: 'pointer',
            fontWeight: 500,
            padding: 0,
          }}
        >
          Sign up
        </button>
      </p>
    </div>
  );
}

export default Login;
