import { redirect } from "next/navigation";

/** Fans no longer have a chats tab — old links land on the Home feed. */
export default function GuestChatsPage() {
  redirect("/home");
}
