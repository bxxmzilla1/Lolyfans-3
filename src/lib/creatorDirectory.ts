import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerProfiles } from "@/lib/guest";

/** What a creator card on the Home section needs. */
export type CreatorCardData = {
  ownerId: string;
  name: string;
  avatarPath: string | null;
  bannerPath: string | null;
  verified: boolean;
  bio: string | null;
};

/**
 * Every creator on the platform that fans can reach: creators with an active
 * invite link, plus any the fan already chats with (`pinnedOwnerIds`, listed
 * first in the order given).
 */
export async function listCreators(
  pinnedOwnerIds: string[] = []
): Promise<CreatorCardData[]> {
  const db = supabaseAdmin();
  const { data: invites } = await db
    .from("invites")
    .select("owner_id")
    .eq("active", true);

  const pinned = [...new Set(pinnedOwnerIds)];
  const others = [
    ...new Set((invites ?? []).map((r) => r.owner_id as string)),
  ].filter((id) => !pinned.includes(id));

  const profiles = await ownerProfiles([...pinned, ...others]);
  const toCard = (id: string): CreatorCardData | null => {
    const p = profiles.get(id);
    if (!p) return null;
    return {
      ownerId: id,
      name: p.name,
      avatarPath: p.avatarPath,
      bannerPath: p.bannerPath,
      verified: p.verified,
      bio: p.bio,
    };
  };

  const rest = others
    .map(toCard)
    .filter((c): c is CreatorCardData => c !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  const first = pinned
    .map(toCard)
    .filter((c): c is CreatorCardData => c !== null);
  return [...first, ...rest];
}
