import { NextResponse } from "next/server";

// 🚨 הגדר כאן את מספר הטלפון האישי שלך כדי שהמערכת תתעלם ממנו בסנכרון
const MY_PHONE_NUMBER = "0526116628"; // שנה למספר הטלפון שלך

export async function POST(req: Request) {
  try {
    const { icalUrl } = await req.json();

    if (!icalUrl || !icalUrl.startsWith("http")) {
      return NextResponse.json({ 
        success: false, 
        error: "קישור iCal לא תקין או ריק" 
      }, { status: 400 });
    }

    const res = await fetch(icalUrl, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ 
        success: false, 
        error: `שגיאה בגישה ליומן גוגל (סטטוס ${res.status}).` 
      }, { status: 500 });
    }

    const rawIcsText = await res.text();
    // 🛠️ איחוד שורות שנחצו בפורמט iCal (RFC 5545 Unfolding) - פותר גילוי טלפונים שנשברו באמצע
    const icsText = rawIcsText.replace(/\r?\n[ \t]/g, "");

    const vevents = icsText.split("BEGIN:VEVENT");
    const rawEventsCount = vevents.length - 1;

    if (rawEventsCount === 0) {
      return NextResponse.json({ 
        success: true, 
        count: 0, 
        rawEventsCount: 0, 
        message: "אין אירועים ביומן." 
      });
    }

    const events: Array<{ name: string; date: string; time: string; phone: string; service: string }> = [];
    const cleanMyPhone = MY_PHONE_NUMBER.replace(/[- ]/g, "");

    for (let i = 1; i < vevents.length; i++) {
      const block = vevents[i].split("END:VEVENT")[0];

      const summaryMatch = block.match(/SUMMARY:(.*)/);
      const dtstartMatch = block.match(/DTSTART(?:;[^:]*)?:(\d{8}T\d{6}Z?|\d{8})/);
      const descriptionMatch = block.match(/DESCRIPTION:([\s\S]*?)(?=\r?\n[A-Z-]+:|$)/);

      if (summaryMatch && dtstartMatch) {
        let rawName = summaryMatch[1].trim().replace(/\\,/g, ",").replace(/\\/g, "");
        const rawDate = dtstartMatch[1];

        let year = rawDate.substring(0, 4);
        let month = rawDate.substring(4, 6);
        let day = rawDate.substring(6, 8);
        let hours = "12";
        let minutes = "00";

        if (rawDate.includes("T")) {
          const timePart = rawDate.split("T")[1];
          hours = timePart.substring(0, 2);
          minutes = timePart.substring(2, 4);

          if (rawDate.endsWith("Z")) {
            const utcDate = new Date(
              Date.UTC(
                Number(year),
                Number(month) - 1,
                Number(day),
                Number(hours),
                Number(minutes)
              )
            );

            year = utcDate.getFullYear().toString();
            month = String(utcDate.getMonth() + 1).padStart(2, "0");
            day = String(utcDate.getDate()).padStart(2, "0");
            hours = String(utcDate.getHours()).padStart(2, "0");
            minutes = String(utcDate.getMinutes()).padStart(2, "0");
          }
        }

        const formattedDate = `${year}-${month}-${day}`;
        const formattedTime = `${hours}:${minutes}`;

        let phone = "";
        if (descriptionMatch) {
          const cleanDesc = descriptionMatch[1].replace(/\\n/g, " ").replace(/\\/g, "");
          const foundPhones = cleanDesc.match(/(?:05\d[- ]?\d{7}|\+?972[- ]?5\d[- ]?\d{7}|\b0\d{8,9}\b)/g) || [];

          const clientPhone = foundPhones.find(p => {
            const cleaned = p.replace(/[- ]/g, "");
            return cleanMyPhone !== "" && !cleaned.includes(cleanMyPhone) && !cleanMyPhone.includes(cleaned);
          });

          if (clientPhone) {
            phone = clientPhone.replace(/[- ]/g, "");
          }
        }

        events.push({
          name: rawName || "לקוח גוגל",
          date: formattedDate,
          time: formattedTime,
          phone: phone,
          service: "תספורת"
        });
      }
    }

    return NextResponse.json({ 
      success: true, 
      rawEventsCount, 
      count: events.length, 
      events 
    });

  } catch (err: any) {
    console.error("iCal Sync Error:", err);
    return NextResponse.json({ 
      success: false, 
      error: `שגיאת השרת: ${err.message || "תקלה בפיענוח"}` 
    }, { status: 500 });
  }
}