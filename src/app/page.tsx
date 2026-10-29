"use client";

import React, { useState, useEffect } from "react";
import { 
  Calendar, Check, MessageCircle, UserPlus, DollarSign, Users, Clock, 
  Edit2, Plus, X, Trash2, TrendingUp, TrendingDown, BarChart3, ChevronLeft, ChevronRight, 
  Phone, Search, ArrowUpDown, Sparkles, RefreshCw, Settings 
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface Appointment {
  id: string;
  name: string;
  time: string;
  service: string;
  price: number;
  paid: boolean;
  phone: string;
  date: string; // YYYY-MM-DD
}

interface ClientSummary {
  key: string;
  name: string;
  phone: string;
  totalVisits: number;
  totalSpent: number;
  lastVisit: string;
  firstVisit: string;
}

const getLocalTodayStr = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const formatDateToYMD = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

interface MonthlyStat {
  monthKey: string;
  monthLabel: string;
  totalRevenue: number;
  totalAppointments: number;
  newClientsCount: number;
  newClientsDiff: number;
}

function calculateMonthlyStats(appointments: Appointment[]): MonthlyStat[] {
  const clientFirstSeenMap = new Map<string, string>();
  
  // מיון תורים לפי תאריך
  const sortedApps = [...appointments].sort((a, b) => 
    (a.date || "").localeCompare(b.date || "")
  );

  // זיהוי תאריך ראשון של כל לקוח
  sortedApps.forEach((app) => {
    const clientId = app.phone 
      ? app.phone.replace(/[^\d]/g, "") 
      : (app.name || "").trim().toLowerCase();

    if (clientId && app.date) {
      if (!clientFirstSeenMap.has(clientId) || app.date < clientFirstSeenMap.get(clientId)!) {
        clientFirstSeenMap.set(clientId, app.date);
      }
    }
  });

  // קיבוץ לפי חודשים
  const monthlyMap = new Map<string, { revenue: number; count: number; newClientsSet: Set<string> }>();

  sortedApps.forEach((app) => {
    if (!app.date) return;
    const monthKey = app.date.substring(0, 7); // YYYY-MM
    const clientId = app.phone 
      ? app.phone.replace(/[^\d]/g, "") 
      : (app.name || "").trim().toLowerCase();

    if (!monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, { revenue: 0, count: 0, newClientsSet: new Set() });
    }

    const current = monthlyMap.get(monthKey)!;
    if (app.paid) {
      current.revenue += Number(app.price) || 0;
    }
    current.count += 1;

    const firstSeenDate = clientFirstSeenMap.get(clientId);
    if (firstSeenDate && firstSeenDate.substring(0, 7) === monthKey) {
      current.newClientsSet.add(clientId);
    }
  });

  // חישוב הפרשים בין חודשים
  const sortedMonthKeys = Array.from(monthlyMap.keys()).sort();
  let previousMonthNewClients = 0;

  const result: MonthlyStat[] = sortedMonthKeys.map((mKey) => {
    const data = monthlyMap.get(mKey)!;
    const newClientsCount = data.newClientsSet.size;
    const diff = newClientsCount - previousMonthNewClients;
    previousMonthNewClients = newClientsCount;

    const [year, month] = mKey.split("-");
    const dateObj = new Date(Number(year), Number(month) - 1, 1);
    const monthLabel = dateObj.toLocaleDateString("he-IL", { month: "long", year: "numeric" });

    return {
      monthKey: mKey,
      monthLabel,
      totalRevenue: data.revenue,
      totalAppointments: data.count,
      newClientsCount,
      newClientsDiff: diff,
    };
  });

  return result.reverse();
}

// ניהול רשימת תורים שנערכו/נמחקו כדי למנוע יבוא חוזר מ-Google Calendar
const getModifiedGCalKeys = (): string[] => {
  try {
    const data = localStorage.getItem("barber_modified_gcal_keys");
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

const addModifiedGCalKey = (key: string) => {
  try {
    const list = getModifiedGCalKeys();
    const cleanKey = key.trim().toLowerCase();
    if (!list.includes(cleanKey)) {
      list.push(cleanKey);
      localStorage.setItem("barber_modified_gcal_keys", JSON.stringify(list));
    }
  } catch (e) {
    console.error(e);
  }
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<"today" | "stats" | "clients">("today");
  
  const [defaultPrice, setDefaultPrice] = useState<number>(30);
  const [isEditingDefaultPrice, setIsEditingDefaultPrice] = useState<boolean>(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // סנכרון מ-Google Calendar
  const [icalUrl, setIcalUrl] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // ניווט תאריכים
  const todayStr = getLocalTodayStr();
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // סינון ביצועים: שבועי / חודשי / שנתי
  const [statsPeriod, setStatsPeriod] = useState<"week" | "month" | "year">("week");

  // ספר לקוחות
  const [clientSearch, setClientSearch] = useState<string>("");
  const [clientSort, setClientSort] = useState<"recent" | "oldest" | "spent" | "visits">("recent");

  // טופס תור חדש + השלמה אוטומטית
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [newTime, setNewTime] = useState<string>("12:00");
  const [newPhone, setNewPhone] = useState<string>("");
  const [newPrice, setNewPrice] = useState<number>(defaultPrice);
  const [newService, setNewService] = useState<string>("תספורת");
  const [newDate, setNewDate] = useState<string>(todayStr);
  const [showClientSuggestions, setShowClientSuggestions] = useState<boolean>(false);

  // טופס עריכת תור קיים + השלמה אוטומטית
  const [editingApp, setEditingApp] = useState<Appointment | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [editDate, setEditDate] = useState<string>("");
  const [editTime, setEditTime] = useState<string>("");
  const [editPrice, setEditPrice] = useState<number>(70);
  const [editService, setEditService] = useState<string>("תספורת");
  const [editPhone, setEditPhone] = useState<string>("");
  const [showEditClientSuggestions, setShowEditClientSuggestions] = useState<boolean>(false);

  useEffect(() => {
    const savedDefaultPrice = localStorage.getItem("barber_default_price");
    if (savedDefaultPrice) {
      const parsed = Number(savedDefaultPrice);
      if (parsed > 0) {
        setDefaultPrice(parsed);
        setNewPrice(parsed);
      }
    }

    const savedIcal = localStorage.getItem("barber_ical_url");
    if (savedIcal) {
      setIcalUrl(savedIcal);
      autoSyncFromGCal(savedIcal, false);
    } else {
      fetchAppointments();
    }
  }, []);

  const handleSetDefaultPrice = (val: number) => {
    if (val > 0) {
      setDefaultPrice(val);
      setNewPrice(val);
      localStorage.setItem("barber_default_price", val.toString());
    }
    setIsEditingDefaultPrice(false);
  };

  const fetchAppointments = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .order("time", { ascending: true });

    if (error) {
      console.error("שגיאה במשיכת נתונים:", error);
    } else if (data) {
      const uniqueMap = new Map<string, Appointment>();

      data.forEach((app: any) => {
        const cleanName = (app.name || "").trim().toLowerCase();
        const appDate = app.date || todayStr;
        const key = `${cleanName}_${appDate}_${app.time}`;
        const isPaid = Boolean(app.paid);

        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, {
            id: String(app.id),
            name: app.name ? app.name.trim() : "",
            time: app.time,
            service: app.service,
            price: Number(app.price),
            paid: isPaid,
            phone: app.phone || "",
            date: appDate
          });
        } else {
          const existing = uniqueMap.get(key)!;
          if (isPaid && !existing.paid) {
            existing.paid = true;
            existing.id = String(app.id);
          }
        }
      });

      setAppointments(Array.from(uniqueMap.values()));
    }
    setLoading(false);
  };
// פונקציית עזר להמרת זמן מ-iCal לשעה ותאריך מדויקים בישראל
const parseIcalToIsraelTime = (dtStr: string) => {
   // חילוץ רכיבי התאריך והשעה מתוך DTSTART (למשל 20261029T143000Z)
   const match = dtStr.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
   if (!match) return { dateStr: '', timeStr: dtStr };

   const [, y, m, d, h, min, s] = match;
   // יצירת תאריך UTC
   const utcDate = new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +s));

   // המרה לתאריך ושעה מקומיים בישראל (Asia/Jerusalem)
   const dateStr = utcDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // פורמט YYYY-MM-DD
   const timeStr = utcDate.toLocaleTimeString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
   });

   return { dateStr, timeStr };
 };
  const autoSyncFromGCal = async (urlToSync: string, isManual: boolean = false) => {
    if (!urlToSync) {
      if (isManual) alert("אנא הזן קישור iCal בהגדרות תחילה.");
      return;
    }
    setIsSyncing(true);

    try {
      const response = await fetch("/api/sync-ical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icalUrl: urlToSync })
      });

      const resData = await response.json();

      if (!resData.success) {
        alert(`❌ שגיאה בסנכרון:\n${resData.error}`);
        setIsSyncing(false);
        return;
      }

      if (resData.count === 0) {
        if (isManual) alert(`ℹ️ גוגל לא החזיר תורים ביומן הזה.`);
        setIsSyncing(false);
        return;
      }

      const { data: existingApps, error: fetchErr } = await supabase
        .from("appointments")
        .select("name, date, time");

      if (fetchErr) {
        alert(`❌ שגיאה בחיבור ל-Supabase:\n${fetchErr.message}`);
        setIsSyncing(false);
        return;
      }

      const existingSet = new Set(
        (existingApps || []).map((a: any) => `${a.name.trim().toLowerCase()}_${a.date}_${a.time}`)
      );
      const modifiedKeysSet = new Set(getModifiedGCalKeys());

      const uniqueEventsMap = new Map<string, any>();
      resData.events.forEach((evt: any) => {
        const cleanName = evt.name.trim().toLowerCase();
        const key = `${cleanName}_${evt.date}_${evt.time}`;
        if (!uniqueEventsMap.has(key)) {
          uniqueEventsMap.set(key, evt);
        }
      });

      const uniqueEvents = Array.from(uniqueEventsMap.values());

      const newToInsert = uniqueEvents
        .filter((evt: any) => {
          const key = `${evt.name.trim().toLowerCase()}_${evt.date}_${evt.time}`;
          return !existingSet.has(key) && !modifiedKeysSet.has(key);
        })
        .map((evt: any) => ({
          id: crypto.randomUUID(),
          name: evt.name.trim(),
          date: evt.date,
          time: evt.time,
          service: evt.service,
          price: defaultPrice,
          paid: false,
          phone: evt.phone
        }));

      if (newToInsert.length > 0) {
        const { error: insertErr } = await supabase.from("appointments").insert(newToInsert);
        if (insertErr) {
          alert(`❌ שגיאה בהכנסת תורים ל-Supabase:\n${insertErr.message}`);
        } else {
          if (isManual) alert(`✅ סונכרנו בהצלחה ${newToInsert.length} תורים חדשים מגוגל!`);
        }
      } else {
        if (isManual) alert(`👍 כל התורים מגוגל כבר מעודכנים באפליקציה.`);
      }

    } catch (err: any) {
      alert(`❌ שגיאה בלתי צפויה: ${err.message}`);
    } finally {
      setIsSyncing(false);
      fetchAppointments();
    }
  };

  const handleSaveIcalUrl = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem("barber_ical_url", icalUrl);
    setIsSettingsOpen(false);
    autoSyncFromGCal(icalUrl, true);
  };

  const handleAddAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const targetDate = newDate || selectedDate;
    const appToInsert = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      time: newTime,
      service: newService,
      price: Number(newPrice) || defaultPrice,
      paid: false,
      phone: newPhone,
      date: targetDate
    };

    const { data, error } = await supabase
      .from("appointments")
      .insert([appToInsert])
      .select();

    if (error) {
      console.error("שגיאה בהוספת תור:", error);
      fetchAppointments();
    } else if (data && data[0]) {
      fetchAppointments();
      setNewName("");
      setNewPhone("");
      setNewTime("12:00");
      setNewPrice(defaultPrice);
      setIsModalOpen(false);
    }
  };

  const openEditModal = (app: Appointment) => {
    setEditingApp(app);
    setEditName(app.name);
    setEditDate(app.date);
    setEditTime(app.time);
    setEditPrice(app.price);
    setEditService(app.service);
    setEditPhone(app.phone);
    setShowEditClientSuggestions(false);
  };

  const handleSaveEditAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingApp || !editName.trim()) return;

    // לרשום את המפתח המקורי ב-localStorage כדי למנוע מגוגל להחזיר אותו ב-F5
    const originalKey = `${editingApp.name.trim().toLowerCase()}_${editingApp.date}_${editingApp.time}`;
    addModifiedGCalKey(originalKey);

    const updatedObj = {
      name: editName.trim(),
      date: editDate,
      time: editTime,
      price: Number(editPrice),
      service: editService,
      phone: editPhone
    };

    setAppointments(prev =>
      prev.map(a => (a.id === editingApp.id ? { ...a, ...updatedObj } : a))
    );

    const { error } = await supabase
      .from("appointments")
      .update(updatedObj)
      .eq("id", editingApp.id);

    if (error) {
      console.error("שגיאה בעדכון תור:", error);
    }

    setEditingApp(null);
    setShowEditClientSuggestions(false);
    fetchAppointments();
  };

  const deleteAppointment = async (id: string) => {
    if (!confirm("בטוח שברצונך למחוק את התור הזה?")) return;

    const targetApp = appointments.find(a => a.id === id);
    if (targetApp) {
      const originalKey = `${targetApp.name.trim().toLowerCase()}_${targetApp.date}_${targetApp.time}`;
      addModifiedGCalKey(originalKey);
    }

    setAppointments(prev => prev.filter(app => app.id !== id));

    const { error } = await supabase
      .from("appointments")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("שגיאה במחיקת תור:", error);
      fetchAppointments();
    }
  };

  const togglePaid = async (id: string, currentPaidStatus: boolean) => {
    const newPaidStatus = !currentPaidStatus;
    const targetApp = appointments.find(a => a.id === id);

    setAppointments(prev =>
      prev.map(app => (app.id === id ? { ...app, paid: newPaidStatus } : app))
    );

    if (targetApp) {
      const { error } = await supabase
        .from("appointments")
        .update({ paid: newPaidStatus })
        .eq("id", id);

      if (error) {
        console.error("שגיאה בעדכון תשלום:", error);
        fetchAppointments();
      }
    }
  };

  const sendWhatsAppReminder = (name: string, phone: string, price: number) => {
    const text = `מה קורה אחי אתה מעביר?`;
    const encodedText = encodeURIComponent(text);
    window.open(`https://wa.me/972${phone ? phone.substring(1) : ""}?text=${encodedText}`, "_blank");
  };

  const changeSelectedDate = (days: number) => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    const date = new Date(y, m - 1, d + days, 12, 0, 0);
    setSelectedDate(formatDateToYMD(date));
  };

  const formatHebrewDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d, 12, 0, 0);

    const [tY, tM, tD] = todayStr.split("-").map(Number);
    const todayObj = new Date(tY, tM - 1, tD, 12, 0, 0);

    const diffDays = Math.round((dateObj.getTime() - todayObj.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "היום";
    if (diffDays === 1) return "מחר";
    if (diffDays === -1) return "אתמול";

    return dateObj.toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric" });
  };

  const filteredAppointments = appointments
    .filter(a => (a.date || todayStr) === selectedDate)
    .sort((a, b) => a.time.localeCompare(b.time));

  const clientsMap = new Map<string, ClientSummary>();

  appointments.forEach(app => {
    const rawName = app.name ? app.name.trim() : "";
    if (!rawName) return;

    const key = rawName.toLowerCase().replace(/\s+/g, " ");
    const isPastOrToday = app.date <= todayStr;

    if (!clientsMap.has(key)) {
      clientsMap.set(key, {
        key,
        name: rawName,
        phone: app.phone || "",
        totalVisits: 1,
        totalSpent: app.paid ? app.price : 0,
        lastVisit: isPastOrToday ? app.date : "",
        firstVisit: app.date || todayStr
      });
    } else {
      const client = clientsMap.get(key)!;
      client.totalVisits += 1;
      if (app.paid) client.totalSpent += app.price;
      if (app.phone && !client.phone) client.phone = app.phone;

      if (isPastOrToday) {
        if (!client.lastVisit || app.date > client.lastVisit) {
          client.lastVisit = app.date;
        }
      }

      if (app.date && app.date < client.firstVisit) {
        client.firstVisit = app.date;
      }
    }
  });

  const allClients = Array.from(clientsMap.values());
  
  const searchedClients = allClients.filter(c =>
    c.name.includes(clientSearch) || c.phone.includes(clientSearch)
  );

  const sortedClients = [...searchedClients].sort((a, b) => {
    if (clientSort === "recent") {
      if (!a.lastVisit) return 1;
      if (!b.lastVisit) return -1;
      return b.lastVisit.localeCompare(a.lastVisit);
    }
    if (clientSort === "oldest") {
      if (!a.lastVisit) return 1;
      if (!b.lastVisit) return -1;
      return a.lastVisit.localeCompare(b.lastVisit);
    }
    if (clientSort === "spent") return b.totalSpent - a.totalSpent;
    if (clientSort === "visits") return b.totalVisits - a.totalVisits;
    return 0;
  });

  const [tY, tM, tD] = todayStr.split("-").map(Number);
  const nowObj = new Date(tY, tM - 1, tD, 12, 0, 0);

  const dayOfWeek = nowObj.getDay();
  const sundayObj = new Date(tY, tM - 1, tD - dayOfWeek, 12, 0, 0);
  const sundayStr = formatDateToYMD(sundayObj);

  const currentMonthStartStr = `${tY}-${String(tM).padStart(2, "0")}-01`;
  const currentYearStartStr = `${tY}-01-01`;

  const prevMonthStartObj = new Date(tY, tM - 2, 1, 12, 0, 0);
  const prevMonthEndObj = new Date(tY, tM - 1, 0, 12, 0, 0);
  const prevMonthStartStr = formatDateToYMD(prevMonthStartObj);
  const prevMonthEndStr = formatDateToYMD(prevMonthEndObj);

  const filteredForStats = appointments.filter(app => {
    if (!app.date || app.date > todayStr) return false;

    if (statsPeriod === "week") return app.date >= sundayStr && app.date <= todayStr;
    if (statsPeriod === "month") return app.date >= currentMonthStartStr && app.date <= todayStr;
    if (statsPeriod === "year") return app.date >= currentYearStartStr && app.date <= todayStr;
    return false;
  });

  const statsEarned = filteredForStats.filter(a => a.paid).reduce((acc, curr) => acc + curr.price, 0);
  const statsPending = filteredForStats.filter(a => !a.paid).reduce((acc, curr) => acc + curr.price, 0);
  const statsTotalCount = filteredForStats.length;

  const prevMonthApps = appointments.filter(app => app.date >= prevMonthStartStr && app.date <= prevMonthEndStr);
  const prevMonthEarned = prevMonthApps.filter(a => a.paid).reduce((acc, curr) => acc + curr.price, 0);
  const prevMonthCount = prevMonthApps.length;

  const earnedDiff = statsEarned - prevMonthEarned;
  const countDiff = statsTotalCount - prevMonthCount;

  const newClientsCount = allClients.filter(client => {
    if (!client.firstVisit) return false;
    if (statsPeriod === "week") return client.firstVisit >= sundayStr && client.firstVisit <= todayStr;
    if (statsPeriod === "month") return client.firstVisit >= currentMonthStartStr && client.firstVisit <= todayStr;
    if (statsPeriod === "year") return client.firstVisit >= currentYearStartStr && client.firstVisit <= todayStr;
    return false;
  }).length;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col justify-between text-right font-sans pb-24" dir="rtl">
      <div className="w-full max-w-2xl mx-auto bg-gray-50 min-h-screen shadow-lg flex flex-col">
        
        {/* כותרת עליונה */}
        <header className="bg-black text-white p-5 shadow-md flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">המספרה שלי</h1>
            <p className="text-xs text-gray-400">ניהול תורים, תשלומים ותזכורות</p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 hover:text-white transition-colors"
              title="הגדרות Google Calendar"
            >
              <Settings className="w-4 h-4" />
            </button>

            {icalUrl && (
              <button
                onClick={() => autoSyncFromGCal(icalUrl, true)}
                disabled={isSyncing}
                className="p-2 bg-gray-800 border border-gray-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
                title="סנכרן מחדש מ-Google Calendar"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-yellow-400" : "text-green-400"}`} />
              </button>
            )}

            <div className="bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-700 flex items-center gap-2">
              <span className="text-xs text-gray-300">קבוע:</span>
              {isEditingDefaultPrice ? (
                <input
                  type="number"
                  defaultValue={defaultPrice}
                  className="w-16 text-center font-bold text-black rounded px-1 text-sm"
                  onBlur={(e) => handleSetDefaultPrice(Number(e.target.value))}
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => setIsEditingDefaultPrice(true)}
                  className="text-sm font-bold text-yellow-400 hover:underline flex items-center gap-1"
                  title="לחץ לשינוי המחיר הקבוע"
                >
                  ₪{defaultPrice}
                  <Edit2 className="w-3 h-3 text-gray-400" />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* תוכן הטאבים */}
        <main className="p-4 sm:p-6 flex-1">
        {/* דוח ביצועים חודשי - מוצג רק בלשונית ביצועים / חודשי */}
        {activeTab !== "today" && statsPeriod === "month" && (
          <div className="mt-8 bg-gray-900 text-white rounded-2xl p-4 shadow-lg border border-gray-800">
            <h2 className="text-xl font-bold mb-4 text-amber-400 text-right">📊 סיכום ביצועים חודשי</h2>
            
            <div className="space-y-4">
              {calculateMonthlyStats(appointments).map((stat) => (
                <div key={stat.monthKey} className="bg-gray-800/80 rounded-xl p-4 border border-gray-700/50">
                  <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-700">
                    <span className="font-bold text-lg text-white">{stat.monthLabel}</span>
                    <span className="text-emerald-400 font-extrabold text-lg">₪{stat.totalRevenue.toLocaleString()}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-900/50 p-2.5 rounded-lg text-right">
                      <span className="text-gray-400 block text-xs">סה"כ תורים</span>
                      <span className="font-semibold text-white text-base">{stat.totalAppointments}</span>
                    </div>

                    <div className="bg-gray-900/50 p-2.5 rounded-lg text-right">
                      <span className="text-gray-400 block text-xs">לקוחות חדשים</span>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="font-semibold text-white text-base">{stat.newClientsCount}</span>
                        
                        {stat.newClientsDiff !== 0 && (
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                            stat.newClientsDiff > 0 
                              ? "bg-emerald-500/20 text-emerald-400" 
                              : "bg-rose-500/20 text-rose-400"
                          }`}>
                            {stat.newClientsDiff > 0 ? `+${stat.newClientsDiff}` : stat.newClientsDiff} מחודש שעבר
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
          {/* TAB 1: TODAY / CALENDAR */}
          {activeTab === "today" && (
            <div className="space-y-4">
              
              <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 flex items-center justify-between">
                <button
                  onClick={() => changeSelectedDate(-1)}
                  className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                  title="יום קודם"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg text-gray-900">
                    {formatHebrewDate(selectedDate)}
                  </span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="text-xs text-gray-500 border rounded-md p-1 cursor-pointer"
                  />
                  {selectedDate !== todayStr && (
                    <button
                      onClick={() => setSelectedDate(todayStr)}
                      className="text-xs bg-black text-white px-2 py-1 rounded-md font-medium"
                    >
                      חזור להיום
                    </button>
                  )}
                </div>

                <button
                  onClick={() => changeSelectedDate(1)}
                  className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                  title="יום הבא"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              </div>

              <div className="flex justify-between items-center mb-2">
                <h2 className="text-xl font-bold text-gray-800">
                  תורים ({filteredAppointments.length})
                </h2>
                <button
                  onClick={() => {
                    setNewDate(selectedDate);
                    setNewPrice(defaultPrice);
                    setIsModalOpen(true);
                  }}
                  className="bg-black hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1 shadow-sm"
                >
                  <Plus className="w-4 h-4 text-yellow-400" />
                  <span>תור חדש</span>
                </button>
              </div>

              {loading ? (
                <div className="text-center py-10 text-gray-500">טוען תורים...</div>
              ) : filteredAppointments.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl border border-gray-200 text-gray-500">
                  <p className="font-semibold">אין תורים רשומים לתאריך זה 👍</p>
                  <p className="text-xs mt-1">לחץ על "תור חדש" כדי להוסיף תור ליומן.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredAppointments.map((app) => (
                    <div key={app.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all hover:border-gray-300">
                      <div className="flex items-center gap-3">
                        <div className="bg-gray-100 p-2.5 rounded-lg flex items-center gap-1">
                          <Clock className="w-4 h-4 text-gray-500" />
                          <span className="font-bold text-gray-900">{app.time}</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-lg text-gray-900">{app.name}</h3>
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <span>{app.service}</span>
                            <span>•</span>
                            <span className="font-bold text-gray-800">₪{app.price}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100">
                        {app.date > todayStr ? (
                          <span className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200">
                            תור עתידי
                          </span>
                        ) : (
                          <>
                            <button
                              onClick={() => togglePaid(app.id, app.paid)}
                              className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-all ${
                                app.paid
                                  ? "bg-green-100 text-green-700 border border-green-300"
                                  : "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                              }`}
                            >
                              {app.paid ? <Check className="w-4 h-4" /> : null}
                              {app.paid ? "שולם" : "לא שולם"}
                            </button>

                            {!app.paid && (
                              <button
                                onClick={() => sendWhatsAppReminder(app.name, app.phone, app.price)}
                                className="bg-green-500 hover:bg-green-600 text-white px-2.5 py-2 rounded-lg text-sm font-medium shadow-sm flex items-center gap-1"
                                title="שלח תזכורת בוואטסאפ"
                              >
                                <MessageCircle className="w-4 h-4" />
                                <span>תזכורת</span>
                              </button>
                            )}
                          </>
                        )}

                        <button
                          onClick={() => openEditModal(app)}
                          className="text-gray-400 hover:text-blue-600 p-2 rounded-lg transition-colors"
                          title="ערוך פרטי תור"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => deleteAppointment(app.id)}
                          className="text-gray-400 hover:text-red-500 p-2 rounded-lg transition-colors"
                          title="מחק תור"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: STATS */}
          {activeTab === "stats" && (
            <div className="space-y-5">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                    <BarChart3 className="w-6 h-6 text-black" />
                    <span>סיכום ביצועים</span>
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {statsPeriod === "week" && `שבוע נוכחי (יום ראשון עד היום)`}
                    {statsPeriod === "month" && `חודש נוכחי (מ-1 בחודש עד היום)`}
                    {statsPeriod === "year" && `שנה נוכחית (1 בינואר עד היום)`}
                  </p>
                </div>

                <div className="bg-gray-200 p-1 rounded-xl flex gap-1">
                  <button
                    onClick={() => setStatsPeriod("week")}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      statsPeriod === "week" ? "bg-black text-white shadow" : "text-gray-600 hover:text-black"
                    }`}
                  >
                    שבועי
                  </button>
                  <button
                    onClick={() => setStatsPeriod("month")}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      statsPeriod === "month" ? "bg-black text-white shadow" : "text-gray-600 hover:text-black"
                    }`}
                  >
                    חודשי
                  </button>
                  <button
                    onClick={() => setStatsPeriod("year")}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      statsPeriod === "year" ? "bg-black text-white shadow" : "text-gray-600 hover:text-black"
                    }`}
                  >
                    שנתי
                  </button>
                </div>
              </div>

              <div key={statsPeriod} className="grid grid-cols-2 gap-4 transition-all duration-300">
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
                  <div>
                    <span className="text-xs text-gray-500 font-semibold">התקבל בפועל</span>
                    <p className="text-3xl font-black text-green-600 mt-1">₪{statsEarned}</p>
                  </div>
                  <div className="mt-3 text-xs text-green-700 bg-green-50 px-2 py-1 rounded-md w-fit font-medium flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    <span>כסף שנכנס</span>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
                  <div>
                    <span className="text-xs text-gray-500 font-semibold">חוב פתוח / טרם שולם</span>
                    <p className="text-3xl font-black text-red-500 mt-1">₪{statsPending}</p>
                  </div>
                  <div className="mt-3 text-xs text-red-700 bg-red-50 px-2 py-1 rounded-md w-fit font-medium">
                    לתשלום ביומן
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 font-semibold">סה"כ תורים</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{statsTotalCount} תורים</p>
                  </div>
                  <div className="bg-blue-50 p-3 rounded-xl text-blue-600">
                    <Clock className="w-6 h-6" />
                  </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 font-semibold">לקוחות חדשים</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{newClientsCount} חדשים</p>
                  </div>
                  <div className="bg-purple-50 p-3 rounded-xl text-purple-600">
                    <UserPlus className="w-6 h-6" />
                  </div>
                </div>
              </div>

              {statsPeriod === "month" && (
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-3">
                  <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                    <span>השוואה לחודש הקודם (מלא)</span>
                  </h3>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <span className="text-gray-500 block mb-1">הכנסות חודש שעבר:</span>
                      <span className="font-bold text-sm text-gray-800">₪{prevMonthEarned}</span>
                      <div className={`mt-2 font-bold flex items-center gap-1 ${earnedDiff >= 0 ? "text-green-600" : "text-red-500"}`}>
                        {earnedDiff >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        <span>{earnedDiff >= 0 ? `+₪${earnedDiff}` : `-₪${Math.abs(earnedDiff)}`}</span>
                      </div>
                    </div>

                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <span className="text-gray-500 block mb-1">תספורות חודש שעבר:</span>
                      <span className="font-bold text-sm text-gray-800">{prevMonthCount} תורים</span>
                      <div className={`mt-2 font-bold flex items-center gap-1 ${countDiff >= 0 ? "text-green-600" : "text-red-500"}`}>
                        {countDiff >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        <span>{countDiff >= 0 ? `+${countDiff} תורים` : `${countDiff} תורים`}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CLIENTS */}
          {activeTab === "clients" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Users className="w-6 h-6 text-black" />
                  <span>ספר לקוחות ({allClients.length})</span>
                </h2>
              </div>

              <div className="relative">
                <input
                  type="text"
                  placeholder="חפש לפי שם או טלפון..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl py-2.5 pr-10 pl-4 text-sm focus:outline-none focus:ring-2 focus:ring-black bg-white shadow-sm"
                />
                <Search className="w-5 h-5 text-gray-400 absolute right-3 top-2.5" />
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                <span className="text-gray-400 flex items-center gap-1 font-medium whitespace-nowrap">
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span>מיין לפי:</span>
                </span>

                <button
                  onClick={() => setClientSort("recent")}
                  className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
                    clientSort === "recent" ? "bg-black text-white shadow-sm" : "bg-white text-gray-600 border border-gray-200"
                  }`}
                >
                  הכי לאחרונה
                </button>

                <button
                  onClick={() => setClientSort("oldest")}
                  className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
                    clientSort === "oldest" ? "bg-black text-white shadow-sm" : "bg-white text-gray-600 border border-gray-200"
                  }`}
                >
                  הכי ישן
                </button>

                <button
                  onClick={() => setClientSort("spent")}
                  className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
                    clientSort === "spent" ? "bg-black text-white shadow-sm" : "bg-white text-gray-600 border border-gray-200"
                  }`}
                >
                  הכי רווחי
                </button>

                <button
                  onClick={() => setClientSort("visits")}
                  className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all ${
                    clientSort === "visits" ? "bg-black text-white shadow-sm" : "bg-white text-gray-600 border border-gray-200"
                  }`}
                >
                  כמות תספורות
                </button>
              </div>

              {sortedClients.length === 0 ? (
                <div className="text-center py-10 bg-white rounded-xl border border-gray-200 text-gray-500">
                  <p className="font-semibold">לא נמצאו לקוחות במאגר</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedClients.map((client) => (
                    <div key={client.key} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between transition-transform duration-200 hover:border-gray-300">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-gray-900 text-lg">{client.name}</h3>
                          {client.totalVisits >= 5 && (
                            <span className="bg-yellow-100 text-yellow-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-0.5">
                              <Sparkles className="w-3 h-3 text-yellow-600" />
                              <span>לקוח זהב</span>
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{client.phone || "ללא טלפון"}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs font-semibold text-gray-700">
                          <span className="bg-gray-100 px-2 py-0.5 rounded">{client.totalVisits} תספורות</span>
                          <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded">₪{client.totalSpent} שולמו</span>
                          <span className="text-gray-400 text-[11px]">
                            {client.lastVisit ? `ביקור אחרון: ${client.lastVisit}` : "תור עתידי בלבד"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {client.phone && (
                          <>
                            <a
                              href={`tel:${client.phone}`}
                              className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                              title="חייג ללקוח"
                            >
                              <Phone className="w-4 h-4" />
                            </a>
                            <a
                              href={`https://wa.me/972${client.phone.substring(1)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                              title="פתח וואטסאפ"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>

        {/* חלון קופץ להגדרות Google Calendar iCal */}
        {isSettingsOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl relative text-right" dir="rtl">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="absolute top-4 left-4 text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>

              <h3 className="text-xl font-bold mb-2 text-gray-900">הגדרות סנכרון גוגל</h3>
              <p className="text-xs text-gray-500 mb-4">
                הדבק כאן את הכתובת הסודית בפורמט iCal מתוך הגדרות היומן בגוגל קלנדר לסנכרון אוטומטי בפתיחה.
              </p>

              <form onSubmit={handleSaveIcalUrl} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">קישור iCal סודי מהגוגל קלנדר</label>
                  <input
                    type="url"
                    required
                    placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                    value={icalUrl}
                    onChange={(e) => setIcalUrl(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    type="submit"
                    className="w-full bg-black hover:bg-gray-800 text-white font-bold py-2.5 rounded-lg shadow-md transition-all text-sm"
                  >
                    שמור וסנכרן עכשיו
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-lg text-sm"
                  >
                    ביטול
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* חלון קופץ להוספת תור חדש */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl relative text-right" dir="rtl">
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setShowClientSuggestions(false);
                }}
                className="absolute top-4 left-4 text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>

              <h3 className="text-xl font-bold mb-4 text-gray-900">הוספת תור חדש</h3>

              <form onSubmit={handleAddAppointment} className="space-y-4">
                <div className="relative">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">שם הלקוח *</label>
                  <input
                    type="text"
                    required
                    placeholder="הקלד שם (למשל: איתי)..."
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setShowClientSuggestions(true);
                    }}
                    onFocus={() => setShowClientSuggestions(true)}
                    className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />

                  {showClientSuggestions && newName.trim().length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-40 overflow-y-auto mt-1">
                      {allClients
                        .filter(c => c.name.toLowerCase().includes(newName.trim().toLowerCase()))
                        .map(client => (
                          <div
                            key={client.key}
                            className="p-2.5 hover:bg-gray-100 cursor-pointer flex justify-between items-center text-xs border-b border-gray-50 last:border-b-0"
                            onClick={() => {
                              setNewName(client.name);
                              if (client.phone) setNewPhone(client.phone);
                              setShowClientSuggestions(false);
                            }}
                          >
                            <span className="font-bold text-gray-900">{client.name}</span>
                            <span className="text-gray-500">{client.phone || "ללא טלפון"}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">תאריך</label>
                    <input
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">שעה</label>
                    <input
                      type="time"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">מחיר (₪)</label>
                    <input
                      type="number"
                      value={newPrice}
                      onChange={(e) => setNewPrice(Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">סוג השירות</label>
                    <input
                      type="text"
                      value={newService}
                      onChange={(e) => setNewService(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">מספר טלפון (לתזכורת בוואטסאפ)</label>
                  <input
                    type="tel"
                    placeholder="0501234567"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    type="submit"
                    className="w-full bg-black hover:bg-gray-800 text-white font-bold py-2.5 rounded-lg shadow-md transition-all text-sm"
                  >
                    שמור תור
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      setShowClientSuggestions(false);
                    }}
                    className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-lg text-sm"
                  >
                    ביטול
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* חלון קופץ לעריכת תור קיים + השלמה אוטומטית */}
        {editingApp && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl relative text-right" dir="rtl">
              <button
                onClick={() => {
                  setEditingApp(null);
                  setShowEditClientSuggestions(false);
                }}
                className="absolute top-4 left-4 text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>

              <h3 className="text-xl font-bold mb-4 text-gray-900">עריכת תור קיים</h3>

              <form onSubmit={handleSaveEditAppointment} className="space-y-4">
                <div className="relative">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">שם הלקוח *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => {
                      setEditName(e.target.value);
                      setShowEditClientSuggestions(true);
                    }}
                    onFocus={() => setShowEditClientSuggestions(true)}
                    className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />

                  {showEditClientSuggestions && editName.trim().length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-40 overflow-y-auto mt-1">
                      {allClients
                        .filter(c => c.name.toLowerCase().includes(editName.trim().toLowerCase()))
                        .map(client => (
                          <div
                            key={client.key}
                            className="p-2.5 hover:bg-gray-100 cursor-pointer flex justify-between items-center text-xs border-b border-gray-50 last:border-b-0"
                            onClick={() => {
                              setEditName(client.name);
                              if (client.phone) setEditPhone(client.phone);
                              setShowEditClientSuggestions(false);
                            }}
                          >
                            <span className="font-bold text-gray-900">{client.name}</span>
                            <span className="text-gray-500">{client.phone || "ללא טלפון"}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">תאריך</label>
                    <input
                      type="date"
                      required
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">שעה</label>
                    <input
                      type="time"
                      required
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">מחיר (₪)</label>
                    <input
                      type="number"
                      value={editPrice}
                      onChange={(e) => setEditPrice(Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">סוג השירות</label>
                    <input
                      type="text"
                      value={editService}
                      onChange={(e) => setEditService(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">מספר טלפון</label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    type="submit"
                    className="w-full bg-black hover:bg-gray-800 text-white font-bold py-2.5 rounded-lg shadow-md transition-all text-sm"
                  >
                    עדכן תור
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingApp(null);
                      setShowEditClientSuggestions(false);
                    }}
                    className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-lg text-sm"
                  >
                    ביטול
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* תפריט ניווט תחתי */}
        <nav className="fixed bottom-0 left-0 right-0 max-w-2xl mx-auto bg-white border-t border-gray-200 flex justify-around p-3 shadow-2xl">
          <button
            onClick={() => setActiveTab("today")}
            className={`flex flex-col items-center gap-1 p-1 w-full text-xs font-semibold ${
              activeTab === "today" ? "text-black font-bold" : "text-gray-400"
            }`}
          >
            <Calendar className="w-5 h-5" />
            יומן
          </button>

          <button
            onClick={() => setActiveTab("stats")}
            className={`flex flex-col items-center gap-1 p-1 w-full text-xs font-semibold ${
              activeTab === "stats" ? "text-black font-bold" : "text-gray-400"
            }`}
          >
            <DollarSign className="w-5 h-5" />
            ביצועים
          </button>

          <button
            onClick={() => setActiveTab("clients")}
            className={`flex flex-col items-center gap-1 p-1 w-full text-xs font-semibold ${
              activeTab === "clients" ? "text-black font-bold" : "text-gray-400"
            }`}
          >
            <Users className="w-5 h-5" />
            לקוחות
          </button>
        </nav>
      </div>
    </div>
  );
}