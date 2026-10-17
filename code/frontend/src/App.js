import { useCallback, useState } from 'react';
import { api } from './api';
import Account from './Account';
import { AVATAR_CREDIT } from './Avatar';
import './App.css';

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token'));

  const logIn = (newToken) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
  };
  const logOut = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
  }, []);

  return (
    <main className="App">
      <h1>Group Trip Planner</h1>
      <p className="tagline">Transparent costs, private budgets.</p>
      {token ? <Account onLogOut={logOut} /> : <Login onLogIn={logIn} />}
      <footer className="credits muted small">
        <a href={AVATAR_CREDIT.url} target="_blank" rel="noopener noreferrer">{AVATAR_CREDIT.text}</a>
      </footer>
    </main>
  );
}

const EMPTY_FORM = { username: '', password: '', name: '', homeCurrency: '', departureAirport: '' };

function Login({ onLogIn }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signingUp = mode === 'signup';

  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
  });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = signingUp ? form : { username: form.username, password: form.password };
      const { token } = await api(signingUp ? '/signup' : '/login', { method: 'POST', body });
      onLogIn(token);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(signingUp ? 'login' : 'signup');
    setError('');
  };

  return (
    <section className="card">
      <h2 className="card-title">{signingUp ? 'Create an account' : 'Log in'}</h2>
      <form className="stack" onSubmit={submit}>
        <label>
          <span>Username</span>
          <input {...field('username')} autoComplete="username" autoCapitalize="none" placeholder="tom" required />
          {signingUp && <small className="muted">3–20 characters: letters, numbers and _. Friends find you by this.</small>}
        </label>
        <label>
          <span>Password</span>
          <input
            {...field('password')}
            type="password"
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            minLength={signingUp ? 8 : undefined}
            required
          />
          {signingUp && <small className="muted">At least 8 characters.</small>}
        </label>
        {signingUp && (
          <>
            <label>
              <span>Your name</span>
              <input {...field('name')} autoComplete="given-name" required />
            </label>
            <div className="row">
              <label>
                <span>Home currency</span>
                <input {...field('homeCurrency')} placeholder="GBP" maxLength={3} required />
              </label>
              <label>
                <span>Home airport</span>
                <input {...field('departureAirport')} placeholder="LHR" maxLength={3} required />
              </label>
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'One moment…' : signingUp ? 'Create account' : 'Log in'}
        </button>
      </form>
      <p className="muted switch">
        {signingUp ? 'Already have an account?' : 'New here?'}{' '}
        <button type="button" className="link" onClick={switchMode}>
          {signingUp ? 'Log in' : 'Create an account'}
        </button>
      </p>
    </section>
  );
}

export default App;
