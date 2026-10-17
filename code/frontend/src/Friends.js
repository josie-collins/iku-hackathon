import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import Avatar from './Avatar';

export default function Friends({ onLogOut }) {
  const [data, setData] = useState(null);
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState(null); // { text, error }

  const load = useCallback(() => {
    api('/friends')
      .then(setData)
      .catch((err) => {
        if (err.message === 'unauthenticated') onLogOut();
        else setMessage({ text: err.message, error: true });
      });
  }, [onLogOut]);

  useEffect(load, [load]);

  // Run a request, show what happened, then refresh the lists.
  // `success` is a message, or a function of the response that returns one.
  const act = async (request, success) => {
    try {
      const result = await request();
      const text = typeof success === 'function' ? success(result) : success;
      setMessage(text ? { text } : null);
      load();
      return true;
    } catch (err) {
      setMessage({ text: err.message, error: true });
      return false;
    }
  };

  const sendRequest = async (e) => {
    e.preventDefault();
    const name = username.trim().replace(/^@/, '');
    const ok = await act(
      () => api('/friends/requests', { method: 'POST', body: { username: name } }),
      // If they'd already asked you, sending a request back accepts theirs.
      ({ status }) => (status === 'accepted' ? `You and @${name} are now friends.` : `Request sent to @${name}.`)
    );
    if (ok) setUsername('');
  };

  if (!data) return message ? <p className="error">{message.text}</p> : <p>Loading…</p>;

  return (
    <>
      <section className="card">
        <form onSubmit={sendRequest}>
          <label htmlFor="friend-username">Add a friend by username</label>
          <div className="row">
            <input
              id="friend-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@username"
              autoCapitalize="none"
            />
            <button type="submit" disabled={!username.trim()}>Send request</button>
          </div>
        </form>
        {message && <p className={message.error ? 'error' : 'success'}>{message.text}</p>}
      </section>

      {data.incoming.length > 0 && (
        <section>
          <h2>Friend requests</h2>
          <ul className="people">
            {data.incoming.map((p) => (
              <Person key={p.id} person={p}>
                <button onClick={() => act(() => api(`/friends/requests/${p.id}/accept`, { method: 'POST' }), `You and ${p.name} are now friends.`)}>
                  Accept
                </button>
                <button className="secondary" onClick={() => act(() => api(`/friends/${p.id}`, { method: 'DELETE' }))}>
                  Decline
                </button>
              </Person>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Friends</h2>
        {data.friends.length ? (
          <ul className="people">
            {data.friends.map((p) => (
              <Person key={p.id} person={p}>
                <button
                  className="secondary"
                  onClick={() =>
                    window.confirm(`Remove ${p.name} from your friends?`) &&
                    act(() => api(`/friends/${p.id}`, { method: 'DELETE' }))
                  }
                >
                  Remove
                </button>
              </Person>
            ))}
          </ul>
        ) : (
          <p className="muted">No friends yet. Add someone by their username above.</p>
        )}
      </section>

      {data.outgoing.length > 0 && (
        <section>
          <h2>Waiting for a reply</h2>
          <ul className="people">
            {data.outgoing.map((p) => (
              <Person key={p.id} person={p}>
                <button className="secondary" onClick={() => act(() => api(`/friends/${p.id}`, { method: 'DELETE' }))}>
                  Cancel
                </button>
              </Person>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Person({ person, children }) {
  return (
    <li className="person">
      <div className="person-who">
        <Avatar username={person.username} name={person.name} size={36} />
        <span>
          <strong>{person.name}</strong> <span className="muted">@{person.username}</span>
        </span>
      </div>
      <div className="actions">{children}</div>
    </li>
  );
}
