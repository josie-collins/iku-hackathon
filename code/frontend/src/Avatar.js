// Placeholder profile pictures: cartoon characters generated in the browser by
// DiceBear from the username, so the same person always gets the same character
// and nothing is downloaded (works offline).
// Style: "Adventurer" by Lisa Wischofsky, CC BY 4.0 (credited in the page footer).
import { createAvatar } from '@dicebear/core';
import * as adventurer from '@dicebear/adventurer';

const BACKGROUNDS = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf'];
const cache = new Map(); // seed -> data URI, so each picture is drawn once

export function avatarUrl(seed) {
  if (!cache.has(seed)) {
    cache.set(seed, createAvatar(adventurer, { seed, backgroundColor: BACKGROUNDS, radius: 50 }).toDataUri());
  }
  return cache.get(seed);
}

// The name is always shown next to the picture, so the image itself is decorative.
export default function Avatar({ username, name, size = 32 }) {
  return (
    <img
      className="avatar"
      src={avatarUrl(username || name || '?')}
      alt=""
      width={size}
      height={size}
    />
  );
}

// A row of overlapping avatars, e.g. who's on a trip
export function AvatarStack({ people, size = 28 }) {
  return (
    <span className="avatar-stack">
      {people.map((p) => (
        <span key={p.user_id || p.id || p.username} title={p.name}>
          <Avatar username={p.username} name={p.name} size={size} />
        </span>
      ))}
    </span>
  );
}

export const AVATAR_CREDIT = {
  text: 'Avatars: "Adventurer" by Lisa Wischofsky, CC BY 4.0, via DiceBear',
  url: 'https://www.dicebear.com/styles/adventurer/',
};
