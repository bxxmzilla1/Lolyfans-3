/** Deterministic PRNG so a seeded feed keeps the same order between refreshes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Mix a feed so it isn't just newest-first: creators are visited in a random
 * order and contribute one post per pass, so every creator shows up near the
 * top instead of whoever posted most recently taking over the feed.
 *
 * Pass a `seed` where the same viewer refetches often (the fan shell polls
 * every few seconds) — the order then stays put instead of jumping around.
 */
export function shuffleFeedByCreator<T extends { ownerId: string }>(
  posts: T[],
  seed?: string
): T[] {
  if (posts.length < 2) return posts;
  const rand = seed === undefined ? Math.random : mulberry32(hashString(seed));

  const byOwner = new Map<string, T[]>();
  for (const post of posts) {
    const list = byOwner.get(post.ownerId);
    if (list) list.push(post);
    else byOwner.set(post.ownerId, [post]);
  }
  for (const [ownerId, list] of byOwner) {
    byOwner.set(ownerId, shuffle(list, rand));
  }

  const out: T[] = [];
  let owners = shuffle([...byOwner.keys()], rand);
  while (owners.length > 0) {
    for (const ownerId of owners) {
      out.push(byOwner.get(ownerId)!.pop()!);
    }
    owners = shuffle(
      owners.filter((id) => byOwner.get(id)!.length > 0),
      rand
    );
  }
  return out;
}
