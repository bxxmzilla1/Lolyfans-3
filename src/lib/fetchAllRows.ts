// Supabase/PostgREST silently caps every select at 1000 rows, which froze
// stats like invite clicks at exactly 1000. This helper pages through the
// full result set in 1000-row chunks. The query builder passed in must apply
// a stable .order(...) so pages don't overlap.
const PAGE_SIZE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return { data: all, error: null };
  }
}
