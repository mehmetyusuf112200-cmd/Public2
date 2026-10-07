// Local reminder notifications (no server needed). Scheduled whenever the app
// goes to the background, cancelled when it comes back.
import { LocalNotifications } from '@capacitor/local-notifications';
import { isNative } from './platform.js';

let allowed = false;

export async function initNotifications() {
  if (!isNative) return;
  try {
    const p = await LocalNotifications.checkPermissions();
    allowed = p.display === 'granted';
    await LocalNotifications.createChannel?.({ id: 'reminders', name: 'Hatırlatmalar', importance: 3 });
  } catch {
    allowed = false;
  }
}

/** ask once, at a friendly moment (after a few wins) */
export async function askNotificationPermission() {
  if (!isNative || allowed) return allowed;
  try {
    const p = await LocalNotifications.requestPermissions();
    allowed = p.display === 'granted';
  } catch {
    allowed = false;
  }
  return allowed;
}

function at(daysFromNow, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() < Date.now() + 30 * 60 * 1000) d.setDate(d.getDate() + 1);
  return d;
}

const IDS = [101, 102, 103, 104];

/** texts: { daily, wheel, comeback, streak? } already translated */
export async function scheduleReminders(texts) {
  if (!isNative || !allowed) return;
  try {
    await LocalNotifications.cancel({ notifications: IDS.map((id) => ({ id })) });
    const list = [
      { id: 101, title: texts.dailyTitle, body: texts.daily, schedule: { at: at(1, 19, 5), allowWhileIdle: false } },
      { id: 102, title: texts.wheelTitle, body: texts.wheel, schedule: { at: at(2, 12, 30), allowWhileIdle: false } },
      { id: 103, title: texts.comebackTitle, body: texts.comeback, schedule: { at: at(4, 18, 40), allowWhileIdle: false } },
    ];
    if (texts.streak) list.push({ id: 104, title: texts.streakTitle, body: texts.streak, schedule: { at: new Date(Date.now() + 4 * 3600 * 1000), allowWhileIdle: false } });
    await LocalNotifications.schedule({
      notifications: list.map((n) => ({ ...n, channelId: 'reminders', smallIcon: 'ic_stat_bus', isExactNotification: false })),
    });
  } catch {
    /* ignore */
  }
}

export async function clearReminders() {
  if (!isNative) return;
  try {
    await LocalNotifications.cancel({ notifications: IDS.map((id) => ({ id })) });
  } catch {
    /* ignore */
  }
}
