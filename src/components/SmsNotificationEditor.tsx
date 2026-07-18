"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export const DEFAULT_SMS_TEMPLATE =
  "NAME sent you a message on Lolyfans. Reply to her here LINKURL";

/**
 * Customize the SMS sent to offline guests when they get a new message.
 * NAME becomes the owner's display name, LINKURL becomes the app link.
 */
export default function SmsNotificationEditor() {
  const [template, setTemplate] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [origin, setOrigin] = useState("https://your-app.com");

  useEffect(() => {
    setOrigin(window.location.origin);
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = data.user?.user_metadata ?? {};
        setTemplate((meta.sms_template as string) || DEFAULT_SMS_TEMPLATE);
        setDisplayName((meta.display_name as string) || "");
      });
  }, []);

  async function save() {
    setSaving(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: { sms_template: template.trim() },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  const preview = (template.trim() || DEFAULT_SMS_TEMPLATE)
    .replace(/LINKURL/g, origin)
    .replace(/NAME/g, displayName || "Your name");

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <p className="font-semibold">SMS Notification</p>
        <p className="text-muted text-sm mt-1">
          The text an offline user receives when you send them a message. Use{" "}
          <span className="font-mono text-fg">NAME</span> for your display name
          and <span className="font-mono text-fg">LINKURL</span> for the link
          back to your Lolyfans.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold">Message template</label>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={4}
          maxLength={320}
          placeholder={DEFAULT_SMS_TEMPLATE}
          className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none resize-none"
        />
        <div className="flex gap-2">
          <button
            onClick={() => setTemplate((t) => `${t}NAME`)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold bg-card2 border border-line text-muted hover:text-fg transition-colors"
          >
            + NAME
          </button>
          <button
            onClick={() => setTemplate((t) => `${t}LINKURL`)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold bg-card2 border border-line text-muted hover:text-fg transition-colors"
          >
            + LINKURL
          </button>
          <button
            onClick={() => setTemplate(DEFAULT_SMS_TEMPLATE)}
            className="ml-auto px-3 py-1.5 rounded-full text-xs font-semibold bg-card2 border border-line text-muted hover:text-fg transition-colors"
          >
            Reset to default
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold">Preview</label>
        <div className="bg-card2 border border-line rounded-xl px-4 py-3 text-sm whitespace-pre-wrap break-words">
          {preview}
        </div>
        <p className="text-muted text-xs">
          Sent only when the user is offline, at most once every 30 seconds.
        </p>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save template"}
      </button>
    </div>
  );
}
