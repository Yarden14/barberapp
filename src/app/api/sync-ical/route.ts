import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// כמה ימים אחורה לחפש תור שלא שולם (0 = רק תורים של היום, בדיוק לפי הדרישה).
// אפשר להגדיל בהמשך (למשל 14) כדי שתשלום "למחרת" יסומן אוטומטית גם הוא.
const LOOKBACK_DAYS = 0;

// ---- BEGIN PURE HELPERS ----
// חייב להישאר זהה ל-page.tsx (cleanClientName + SHOP_NAME_PREFIXES)
const SHOP_NAME_PREFIXES: string[] = ["[jordiko barbershop]", "jordiko barbershop"];

const cleanClientName = (name: string): string => {
  const original = (name || "").trim();
  let result = original;
  for (const prefix of SHOP_NAME_PREFIXES) {
    const p = prefix.trim().toLowerCase();
    if (p && result.toLowerCase().startsWith(p)) {
      result = result.substring(p.length).replace(/^[\s\-–—:|]+/, "");
    }
  }
  result = result.replace(/^\s*\[[^\]]*\]\s*[-–—:|]*\s*/, "");
  const parts = result
    .split(/\s+[-–—]\s+|\s*[:|]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : original;
};

// הסרת תווי כיווניות בלתי נראים שמופיעים לפעמים בהודעות עברית
const stripInvisible = (s: string): string =>
  s.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");

// מפתח השוואה לשם: אותיות קטנות, בלי פיסוק, בלי חשיבות לסדר המילים
const normalizeNameForMatch = (name: string): string =>
  stripInvisible(name)
    .toLowerCase()
    .replace(/["'״׳`’”“.,\-–—_()\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");

// פענוח הודעת ביט:
// "70.0 ש"ח מחכים לך מיוסי כהן" -> { name: "יוסי כהן", amount: 70 }
const parseBitSms = (raw: string): { name: string; amount: number } | null => {
  const text = stripInvisible(raw).replace(/\r/g, "");
  const NUM = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)";
  const amountMatch =
    text.match(new RegExp(NUM + "\\s*(?:ש[\"״”'׳]?ח|₪)")) ||
    text.match(new RegExp("₪\\s*" + NUM));
  // האות "מ" שאחרי "מחכים לך" היא מילת היחס "מ" (מיוסי = מ + יוסי)
  const nameMatch = text.match(/מחכים\s+לך\s+מ([^\n]+?)\s*(?=\n|\s+באפליקציית|$)/);
  if (!amountMatch || !nameMatch) return null;

  const amount = Number(amountMatch[1].replace(/,/g, ""));
  const name = nameMatch[1].trim();
  if (!Number.isFinite(amount) || amount <= 0 || !name) return null;
  return { name, amount };
};
// ---- END PURE HELPERS ----

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

const json = (body: Record<string, unknown>, status: number) =>
  NextResponse.json(body, { status });

export async function POST(req: Request) {
  try {
    const secret = process.env.BIT_WEBHOOK_SECRET;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!secret || !supabaseUrl || !serviceKey) {
      console.error("[bit-webhook] missing environment variables");
      return json({ success: false, error: "server_not_configured" }, 500);
    }

    // אימות: Authorization: Bearer <BIT_WEBHOOK_SECRET>
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token || !safeEqual(token, secret)) {
      console.warn("[bit-webhook] unauthorized request");
      return json({ success: false, error: "unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ success: false, error: "invalid_json" }, 400);
    }

    const smsText = (body as { smsText?: unknown } | null)?.smsText;
    if (typeof smsText !== "string" || !smsText.trim() || smsText.length > 2000) {
      return json({ success: false, error: "invalid_sms_text" }, 400);
    }

    const parsed = parseBitSms(smsText);
    if (!parsed) {
      console.warn("[bit-webhook] could not parse SMS (not a Bit payment message?)");
      return json({ success: false, error: "parse_failed" }, 422);
    }
    console.log("[bit-webhook] parsed SMS", { name: parsed.name, amount: parsed.amount });

    // תאריך היום לפי שעון ישראל (השרת רץ ב-UTC)
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
    const fromDate = new Date(`${todayStr}T12:00:00Z`);
    fromDate.setUTCDate(fromDate.getUTCDate() - LOOKBACK_DAYS);
    const fromStr = fromDate.toISOString().slice(0, 10);

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from("appointments")
      .select("id, name, time, price, paid, phone, date")
      .gte("date", fromStr)
      .lte("date", todayStr)
      .eq("paid", false);

    if (error) {
      console.error("[bit-webhook] database read error:", error.message);
      return json({ success: false, error: "db_read_error" }, 500);
    }

    // התאמה קפדנית: אותו שם (אחרי ניקוי כותרת היומן) וגם אותו סכום
    const senderKey = normalizeNameForMatch(parsed.name);
    const matches = (data ?? []).filter(
      (a) =>
        normalizeNameForMatch(cleanClientName(a.name || "")) === senderKey &&
        Math.abs((Number(a.price) || 0) - parsed.amount) < 0.01
    );

    if (matches.length === 0) {
      console.warn("[bit-webhook] no matching unpaid appointment", {
        name: parsed.name,
        amount: parsed.amount,
        unpaidChecked: (data ?? []).length,
      });
      return json({ success: false, error: "no_match" }, 404);
    }

    if (matches.length > 1) {
      console.warn("[bit-webhook] ambiguous match, nothing updated", {
        name: parsed.name,
        amount: parsed.amount,
        candidates: matches.map((m) => m.id),
      });
      return json({ success: false, error: "ambiguous_match", candidates: matches.length }, 409);
    }

    const target = matches[0];
    const { data: updated, error: updateError } = await supabase
      .from("appointments")
      .update({ paid: true })
      .eq("id", target.id)
      .eq("paid", false) // הגנה מפני עדכון כפול
      .select()
      .maybeSingle();

    if (updateError) {
      console.error("[bit-webhook] database update error:", updateError.message);
      return json({ success: false, error: "db_update_error" }, 500);
    }
    if (!updated) {
      return json({ success: false, error: "already_paid" }, 409);
    }

    console.log("[bit-webhook] marked as paid", { id: updated.id, date: updated.date, time: updated.time });
    return json({ success: true, appointment: updated }, 200);
  } catch (err) {
    console.error("[bit-webhook] unexpected error:", err instanceof Error ? err.message : err);
    return json({ success: false, error: "internal_error" }, 500);
  }
}