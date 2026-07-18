import { supabaseAdmin } from "@/lib/supabase/admin";

export type PostStats = {
  /** Real guest likes per post (added to the owner-set base). */
  likes: Map<string, number>;
  /** Comment count per post. */
  comments: Map<string, number>;
  /** Posts the viewing guest has liked. */
  likedByMe: Set<string>;
};

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
  const [{ data: likeRows }, { data: commentRows }] = await Promise.all([
    db.from("post_likes").select("post_id, chat_id").in("post_id", postIds).limit(10000),
    db.from("post_comments").select("post_id").in("post_id", postIds).limit(10000),
  ]);

  for (const row of likeRows ?? []) {
    stats.likes.set(row.post_id, (stats.likes.get(row.post_id) ?? 0) + 1);
    if (viewerChatIds.includes(row.chat_id)) stats.likedByMe.add(row.post_id);
  }
  for (const row of commentRows ?? []) {
    stats.comments.set(row.post_id, (stats.comments.get(row.post_id) ?? 0) + 1);
  }
  return stats;
}
