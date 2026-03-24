/**
 * Send push notification via btw.bridgerb.com
 * Requires NOTIFY_TOKEN env var (or .env file)
 */

const NOTIFY_URL = "https://btw.bridgerb.com/api/notify";

export const notify = async (title: string, message: string): Promise<void> => {
  const token = process.env.NOTIFY_TOKEN;
  if (!token) return;

  try {
    await fetch(NOTIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, message, userToken: token }),
    });
  } catch {}
};
