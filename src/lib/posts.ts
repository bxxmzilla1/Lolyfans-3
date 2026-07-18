import { supabaseAdmin } from "@/lib/supabase/admin";

export type PostStats = {
  /** Real guest likes per post (added to the owner-set base). */
  likes: Map<string, number>;
  /** Comment count per post. */
  comments: Map<string, number>;
  /** Posts the viewing guest has liked. */
  likedByMe: Set<string>;
};

const PAGE = 1000;

/**
 * Fetch every row of a query by paging in chunks of 1000 — Supabase caps a
 * single response at 1000 rows no matter the .limit(), which silently dropped
 * counts once posts accumulated enough comments/likes.
 */
async function allRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await build(from, from + PAGE - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Like/comment counts for a set of posts, plus the viewer's own likes. */
export async function postStats(
  postIds: string[],
  viewerChatIds: string[]
): Promise<PostStats> {
  const stats: PostStats = {
    likes: new Map(),
    comments: new Map(),
    likedByMe: new Set(),
  };
  if (!postIds.length) return stats;

  const db = supabaseAdmin();
  const [likeRows, commentRows] = await Promise.all([
    allRows<{ post_id: string; chat_id: string }>((from, to) =>
      db
        .from("post_likes")
        .select("post_id, chat_id")
        .in("post_id", postIds)
        // Deterministic order for paging: post_likes has no id column.
        .order("post_id")
        .order("chat_id")
        .range(from, to)
    ),
    allRows<{ post_id: string }>((from, to) =>
      db
        .from("post_comments")
        .select("post_id")
        .in("post_id", postIds)
        .order("id")
        .range(from, to)
    ),
  ]);

  for (const row of likeRows) {
    stats.likes.set(row.post_id, (stats.likes.get(row.post_id) ?? 0) + 1);
    if (viewerChatIds.includes(row.chat_id)) stats.likedByMe.add(row.post_id);
  }
  for (const row of commentRows) {
    stats.comments.set(row.post_id, (stats.comments.get(row.post_id) ?? 0) + 1);
  }
  return stats;
}
