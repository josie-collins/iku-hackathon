import { useCallback, useState } from 'react';
import { api } from './api';
import Account from './Account';
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
      {token ? <Account onLogOut={logOut} /> : <Join onLogIn={logIn} />}
    </main>
  );
}

function Join({ onLogIn }) {
  const [inviteCode, setInviteCode] = useState('');
  const [members, setMembers] = useState(null);
  const [error, setError] = useState('');

  const findGroup = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const list = await api(`/group/${encodeURIComponent(inviteCode.trim())}/members`);
      if (!list.length) setError('No group found with that invite code.');
      setMembers(list);
    } catch (err) {
      setError(err.message);
    }
  };

  const logInAs = async (userId) => {
    setError('');
    try {
      const { token } = await api('/login', {
        method: 'POST',
        body: { inviteCode: inviteCode.trim(), userId },
      });
      onLogIn(token);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="card">
      <form onSubmit={findGroup}>
        <label htmlFor="invite">Invite code</label>
        <div className="row">
          <input
            id="invite"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="DEMO42"
          />
          <button type="submit" disabled={!inviteCode.trim()}>Find group</button>
        </div>
      </form>

      {members?.length > 0 && (
        <>
          <h2>Who are you?</h2>
          <ul className="members">
            {members.map((m) => (
              <li key={m.user_id}>
                <button onClick={() => logInAs(m.user_id)}>
                  {m.name} <span className="muted">{m.home_currency}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}

export default App;
