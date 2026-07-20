/**
 * Platform logo mark. The source image has white corners baked in, so the
 * rounded clip keeps it looking right on any background.
 */
export default function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/logo-192.png"
      alt="Lolyfans"
      className={`rounded-[24%] object-cover ${className || ""}`}
      draggable={false}
    />
  );
}
