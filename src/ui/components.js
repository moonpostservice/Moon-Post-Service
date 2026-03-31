// UI Components — reusable UI components (message cards, contact rows, etc.)
import { timeAgo } from '../lib/utils.js';

/**
 * Create a message card element for the inbox list.
 * @param {object} message - Message data
 * @param {string} message.sender - Sender display name
 * @param {string} [message.senderAvatar] - Avatar URL
 * @param {string} message.messageText - Message preview text
 * @param {string} message.status - Message status (e.g., 'In Transit', 'Released')
 * @param {string} message.createdAt - ISO timestamp
 * @param {string} message.type - 'sent' or 'received'
 * @param {string} [message.location] - Sender/recipient location
 * @returns {HTMLElement}
 */
export function createMessageCard(message) {
  const item = document.createElement('div');
  item.className = 'message-item';
  item.setAttribute('role', 'button');
  item.setAttribute('tabindex', '0');

  const isSent = message.type === 'sent';
  const initial = (message.sender || '?').charAt(0).toUpperCase();
  const time = message.createdAt ? timeAgo(message.createdAt) : '';

  // Avatar
  const avatarEl = document.createElement('div');
  avatarEl.className = 'msg-avatar';
  if (message.senderAvatar) {
    const img = document.createElement('img');
    img.src = message.senderAvatar;
    img.alt = message.sender || 'Avatar';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = initial;
  }
  item.appendChild(avatarEl);

  // Content
  const content = document.createElement('div');
  content.className = 'message-content';

  const senderEl = document.createElement('div');
  senderEl.className = 'message-sender';
  senderEl.textContent = message.sender || 'Unknown';
  content.appendChild(senderEl);

  const preview = document.createElement('div');
  preview.className = 'message-preview';
  const previewText = message.messageText || message.status || '';
  preview.textContent = previewText.length > 50
    ? previewText.substring(0, 50) + '...'
    : previewText;
  content.appendChild(preview);

  item.appendChild(content);

  // Time
  const timeEl = document.createElement('div');
  timeEl.className = 'message-time';
  timeEl.textContent = time;
  item.appendChild(timeEl);

  // Transit bar for in-transit messages
  if (message.status === 'In Transit' && message.releaseAt) {
    const bar = document.createElement('div');
    bar.className = 'moon-transit-bar';
    const fill = document.createElement('div');
    fill.className = 'moon-transit-fill';
    const now = Date.now();
    const created = new Date(message.createdAt).getTime();
    const release = new Date(message.releaseAt).getTime();
    const total = release - created;
    const elapsed = now - created;
    const progress = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 0;
    fill.style.width = `${progress}%`;
    bar.appendChild(fill);
    item.appendChild(bar);
  }

  return item;
}

/**
 * Create a contact row element for the contacts list.
 * @param {object} contact - Contact data
 * @param {string} contact.name - Contact display name
 * @param {string} [contact.avatar] - Avatar URL
 * @param {string} [contact.location] - City name
 * @param {string} [contact.email] - Email address
 * @param {boolean} [contact.isOnMoonpop] - Whether the contact is on MoonPop
 * @returns {HTMLElement}
 */
export function createContactRow(contact) {
  const row = document.createElement('div');
  row.className = 'message-item';
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');

  const initial = (contact.name || '?').charAt(0).toUpperCase();

  // Avatar
  const avatarEl = document.createElement('div');
  avatarEl.className = 'msg-avatar';
  if (contact.avatar) {
    const img = document.createElement('img');
    img.src = contact.avatar;
    img.alt = contact.name || 'Contact';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = initial;
  }
  row.appendChild(avatarEl);

  // Content
  const content = document.createElement('div');
  content.className = 'message-content';

  const nameEl = document.createElement('div');
  nameEl.className = 'message-sender';
  nameEl.textContent = contact.name || 'Unknown';
  content.appendChild(nameEl);

  const locationEl = document.createElement('div');
  locationEl.className = 'message-preview';
  locationEl.textContent = contact.location || contact.email || '';
  content.appendChild(locationEl);

  row.appendChild(content);

  // MoonPop badge
  if (contact.isOnMoonpop) {
    const badge = document.createElement('span');
    badge.style.cssText =
      'font-size:10px;background:rgba(53,125,197,0.1);color:var(--blue);padding:3px 8px;border-radius:10px;font-weight:600;';
    badge.textContent = '🌙 on MoonPop';
    row.appendChild(badge);
  }

  return row;
}
