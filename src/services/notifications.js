// Notifications Service — push notification registration
import { sb } from './supabase.js';

const VAPID_PUBLIC_KEY =
  'BHqBb8cUt0T7Zb2aBo3G8vFpQRw0zBVnKbGqT5Fv3qYxPkPU4A9J-a4dIWx7U5VnSXBqK8aGnL1yMzRsQf3xG8';

/**
 * Convert a URL-safe base64 string to a Uint8Array (for VAPID key).
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Register for push notifications.
 * Requests permission, subscribes via the Push API, and saves the
 * subscription to the `push_subscriptions` table.
 */
export async function registerPushNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    console.warn('[notifications] Push not supported in this browser');
    return;
  }

  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.log('[notifications] Permission not granted:', permission);
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();

    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const key = subscription.getKey('p256dh');
    const auth = subscription.getKey('auth');

    const { error } = await sb.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
        auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
      },
      { onConflict: 'user_id,endpoint' }
    );

    if (error) console.error('[notifications] Push subscription save failed:', error);
    else console.log('[notifications] Push subscription saved successfully');
  } catch (err) {
    console.error('[notifications] Push subscribe error:', err);
  }
}

/**
 * Unregister push notifications.
 * Unsubscribes from the Push API and removes the subscription from the DB.
 */
export async function unregisterPushNotifications() {
  if (!('serviceWorker' in navigator)) return;

  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();

    if (user) {
      await sb.from('push_subscriptions').delete().eq('user_id', user.id);
    }
    console.log('[notifications] Push subscription removed');
  } catch (e) {
    console.error('[notifications] Unsubscribe failed:', e);
  }
}
