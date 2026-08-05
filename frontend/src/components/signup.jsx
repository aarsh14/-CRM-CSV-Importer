import { useState } from "react";
import { signup } from "../api/client";



function Signup({ onSuccess, onSwitchToLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const user = await signup(email, password);
      onSuccess(user);
    } catch (err) {
      setError(err.response?.data?.error || 'Signup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel" style={{ maxWidth: 400, margin: '0 auto' }}>
      <h2 className="panel-heading">Create an account</h2>
      <p className="panel-note">Takes a few seconds — no email verification needed for this project.</p>

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
            minLength={8}
          />
        </div>

        {error && <div className="error-banner">{error}</div>}

        <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Creating account…' : 'Sign up'}
        </button>
      </form>

      <p className="panel-note" style={{ marginTop: '1rem', textAlign: 'center' }}>
        Already have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-accent)',
            cursor: 'pointer',
            fontWeight: 500,
            padding: 0,
          }}
        >
          Log in
        </button>
      </p>
    </div>
  );
}

export default Signup;
