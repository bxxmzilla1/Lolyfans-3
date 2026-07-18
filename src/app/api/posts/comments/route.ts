import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

/**
 * Owner-side comment management for the Social proof tab: list and delete
 * comments, and seed new ones written by Grok.
 */

async function ownedPost(ownerId: string, postId: string) {
  const { data } = await supabaseAdmin()
    .from("posts")
    .select("id, caption, media_type")
    .eq("id", postId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  return data;
}

export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const postId = req.nextUrl.searchParams.get("postId");
  if (!postId || !(await ownedPost(ownerId, postId))) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const { data } = await supabaseAdmin()
    .from("post_comments")
    .select("id, chat_id, author_name, body, created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(500);
  return NextResponse.json({ comments: data ?? [] });
}

/** Generate `count` comments with Grok and attach them to the post. */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { postId, count, instructions } = await req.json();
  const howMany = Math.min(50, Math.max(1, Math.floor(Number(count) || 0)));
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });
  const post = await ownedPost(ownerId, postId);
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Grok is not configured. Add XAI_API_KEY in Vercel first." },
      { status: 400 }
    );
  }

  const prompt = [
    `Write ${howMany} short, casual social-media comments for a creator's ${post.media_type} post.`,
    post.caption ? `The post caption is: "${post.caption}".` : "",
    String(instructions || "").trim()
      ? `Extra instructions from the creator: ${String(instructions).trim().slice(0, 500)}`
      : "",
    "Make them feel like real fans wrote them: varied length (2-12 words), lowercase-heavy,",
    "occasional emoji, slang and small typos are fine. No hashtags. Each from a different person.",
    "Also invent a realistic short display name for each commenter (first names, nicknames,",
    "some with numbers). Reply ONLY with a JSON array like:",
    '[{"name":"jess","comment":"omg stunning"}]',
  ]
    .filter(Boolean)
    .join("\n");

  const grokRes = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROK_MODEL || "grok-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 1,
    }),
  });
  if (!grokRes.ok) {
    const text = await grokRes.text().catch(() => "");
    console.error("Grok comment generation failed:", grokRes.status, text.slice(0, 300));
    return NextResponse.json(
      { error: "Grok couldn't generate comments. Try again in a moment." },
      { status: 502 }
    );
  }
  const data = await grokRes.json().catch(() => null);
  const raw: string = data?.choices?.[0]?.message?.content || "";

  // Grok sometimes wraps the JSON in a code fence or adds prose around it.
  const match = raw.match(/\[[\s\S]*\]/);
  let items: { name?: string; comment?: string }[] = [];
  try {
    items = JSON.parse(match ? match[0] : raw);
  } catch {
    return NextResponse.json(
      { error: "Grok returned an unexpected format. Try again." },
      { status: 502 }
    );
  }

  const now = Date.now();
  const rows = items
    .filter((i) => i?.comment && String(i.comment).trim())
    .slice(0, howMany)
    .map((i) => ({
      post_id: postId,
      chat_id: null,
      author_name: String(i.name || "fan").trim().slice(0, 40) || "fan",
      body: String(i.comment).trim().slice(0, 500),
      // Spread over the past 3 days so the thread doesn't look bot-made.
      created_at: new Date(
        now - Math.floor(Math.random() * 72 * 60 * 60 * 1000)
      ).toISOString(),
    }));
  if (!rows.length) {
    return NextResponse.json({ error: "Grok returned no comments. Try again." }, { status: 502 });
  }

  const { data: inserted, error } = await supabaseAdmin()
    .from("post_comments")
    .insert(rows)
    .select("id, chat_id, author_name, body, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comments: inserted ?? [] });
}

/** Delete one comment, or all comments on a post. */
export async function DELETE(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, postId, all } = await req.json();
  const db = supabaseAdmin();

  if (all && postId) {
    if (!(await ownedPost(ownerId, postId))) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    const { error } = await db.from("post_comments").delete().eq("post_id", postId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // Only allow deleting comments on the owner's own posts.
  const { data: comment } = await db
    .from("post_comments")
    .select("id, post_id")
    .eq("id", id)
    .maybeSingle();
  if (!comment || !(await ownedPost(ownerId, comment.post_id))) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  const { error } = await db.from("post_comments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
