// UI Settings — settings panel logic
import { cities, findCity } from '../lib/cities.js';

/**
 * Render the settings panel, populating fields from stored profile data.
 * Expects the settings DOM structure to already exist in the HTML.
 */
export function renderSettings() {
  // Populate profile fields from localStorage
  const username = localStorage.getItem('moonpop_username') || '';
  const firstName = localStorage.getItem('moonpop_firstname') || '';
  const lastName = localStorage.getItem('moonpop_lastname') || '';
  const profilePic = localStorage.getItem('moonpop_profilepic') || '';
  const locationData = JSON.parse(localStorage.getItem('moonpop_location') || '{}');

  const usernameEl = document.getElementById('settingsUsername');
  const firstNameEl = document.getElementById('settingsFirstName');
  const lastNameEl = document.getElementById('settingsLastName');
  const locationEl = document.getElementById('manualLocation');
  const locationDisplay = document.getElementById('sectionLocationSummary');

  if (usernameEl) usernameEl.value = username;
  if (firstNameEl) firstNameEl.value = firstName;
  if (lastNameEl) lastNameEl.value = lastName;
  if (locationEl) locationEl.value = locationData.name || '';
  if (locationDisplay) {
    locationDisplay.textContent = locationData.country
      ? `${locationData.name}, ${locationData.country}`
      : locationData.name || 'Not set';
  }

  // Update avatar display
  updateSettingsAvatar(profilePic, firstName || username);

  // Update section summaries
  updateSettingsSummaries();
}

/**
 * Handle settings form updates.
 * @param {object} data - Settings data to save
 * @param {string} [data.username] - Display name / sender name
 * @param {string} [data.firstName] - First name
 * @param {string} [data.lastName] - Last name
 * @param {string} [data.city] - City name for location
 * @param {string} [data.avatarUrl] - Profile picture URL
 * @returns {{ saved: boolean, city?: object }}
 */
export function handleSettingsUpdate(data) {
  if (!data) return { saved: false };

  if (data.username !== undefined) {
    localStorage.setItem('moonpop_username', data.username);
    const el = document.getElementById('settingsUsername');
    if (el) el.value = data.username;
  }

  if (data.firstName !== undefined) {
    localStorage.setItem('moonpop_firstname', data.firstName);
  }

  if (data.lastName !== undefined) {
    localStorage.setItem('moonpop_lastname', data.lastName);
  }

  if (data.avatarUrl !== undefined) {
    localStorage.setItem('moonpop_profilepic', data.avatarUrl);
    updateSettingsAvatar(data.avatarUrl, data.firstName || data.username || '');
  }

  let cityData = null;
  if (data.city) {
    const city = findCity(data.city);
    if (city) {
      cityData = city;
      localStorage.setItem(
        'moonpop_location',
        JSON.stringify({ name: city.name, country: city.country })
      );
      const locationDisplay = document.getElementById('sectionLocationSummary');
      if (locationDisplay) {
        locationDisplay.textContent = `${city.name}, ${city.country}`;
      }
    }
  }

  updateSettingsSummaries();
  return { saved: true, city: cityData };
}

/**
 * Update the avatar display in the settings panel.
 */
function updateSettingsAvatar(avatarUrl, fallbackName) {
  const sectionImg = document.getElementById('sectionProfileImg');
  const sectionInitial = document.getElementById('sectionProfileInitial');

  if (avatarUrl && sectionImg) {
    sectionImg.src = avatarUrl;
    sectionImg.style.display = 'block';
    if (sectionInitial) sectionInitial.style.display = 'none';
  } else if (sectionInitial) {
    sectionInitial.textContent = (fallbackName || '?').charAt(0).toUpperCase();
    sectionInitial.style.display = '';
    if (sectionImg) sectionImg.style.display = 'none';
  }
}

/**
 * Update the summary text shown in collapsed settings sections.
 */
function updateSettingsSummaries() {
  const username = localStorage.getItem('moonpop_username') || '';
  const firstName = localStorage.getItem('moonpop_firstname') || '';
  const lastName = localStorage.getItem('moonpop_lastname') || '';
  const fullName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : '';

  const profileSummary = document.getElementById('sectionProfileSummary');
  if (profileSummary) {
    profileSummary.textContent = username || fullName || 'Profile';
  }
}

/**
 * Filter cities for the settings city autocomplete dropdown.
 * @param {string} query - Search query
 */
export function filterSettingsCities(query) {
  const dropdown = document.getElementById('settingsCityDropdown');
  if (!dropdown) return;
  if (!query || query.length < 2) {
    dropdown.classList.remove('active');
    return;
  }

  const filtered = cities
    .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  if (filtered.length === 0) {
    dropdown.classList.remove('active');
    return;
  }

  dropdown.innerHTML = filtered
    .map(
      (c) =>
        `<div class="city-option" data-city="${c.name}">${c.name}<span class="country">${c.country}</span></div>`
    )
    .join('');
  dropdown.classList.add('active');
}
