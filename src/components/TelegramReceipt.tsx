import { IconCheck, IconChecks } from "./Icons";

/** Single check = sent; double (sky) = read by the peer. */
export default function TelegramReceipt({
  receipt,
  className = "",
}: {
  receipt: "sent" | "read" | null | undefined;
  className?: string;
}) {
  if (!receipt) return null;
  return (
    <span
      className="inline-flex shrink-0"
      title={receipt === "read" ? "Read" : "Sent"}
      aria-label={receipt === "read" ? "Read" : "Sent"}
    >
      {receipt === "read" ? (
        <IconChecks className={`w-3.5 h-3.5 text-sky-400 ${className}`} />
      ) : (
        <IconCheck className={`w-3.5 h-3.5 text-muted ${className}`} />
      )}
    </span>
  );
}
