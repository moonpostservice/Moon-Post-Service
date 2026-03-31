// Cities Library — city data for location selection

/**
 * @typedef {{ name: string, lat: number, lon: number, country: string, timezone: string, tz: string }} City
 */

/** @type {City[]} */
export const cities = [
  { name: 'New York', country: 'USA', lat: 40.71, lon: -74.01, tz: 'America/New_York' },
  { name: 'Los Angeles', country: 'USA', lat: 34.05, lon: -118.24, tz: 'America/Los_Angeles' },
  { name: 'Chicago', country: 'USA', lat: 41.88, lon: -87.63, tz: 'America/Chicago' },
  { name: 'San Francisco', country: 'USA', lat: 37.77, lon: -122.42, tz: 'America/Los_Angeles' },
  { name: 'Miami', country: 'USA', lat: 25.76, lon: -80.19, tz: 'America/New_York' },
  { name: 'Seattle', country: 'USA', lat: 47.61, lon: -122.33, tz: 'America/Los_Angeles' },
  { name: 'Boston', country: 'USA', lat: 42.36, lon: -71.06, tz: 'America/New_York' },
  { name: 'Austin', country: 'USA', lat: 30.27, lon: -97.74, tz: 'America/Chicago' },
  { name: 'Denver', country: 'USA', lat: 39.74, lon: -104.99, tz: 'America/Denver' },
  { name: 'Portland', country: 'USA', lat: 45.52, lon: -122.68, tz: 'America/Los_Angeles' },
  { name: 'Washington DC', country: 'USA', lat: 38.91, lon: -77.04, tz: 'America/New_York' },
  { name: 'Philadelphia', country: 'USA', lat: 39.95, lon: -75.17, tz: 'America/New_York' },
  { name: 'Houston', country: 'USA', lat: 29.76, lon: -95.37, tz: 'America/Chicago' },
  { name: 'Phoenix', country: 'USA', lat: 33.45, lon: -112.07, tz: 'America/Phoenix' },
  { name: 'San Diego', country: 'USA', lat: 32.72, lon: -117.16, tz: 'America/Los_Angeles' },
  { name: 'Atlanta', country: 'USA', lat: 33.75, lon: -84.39, tz: 'America/New_York' },
  { name: 'Nashville', country: 'USA', lat: 36.16, lon: -86.78, tz: 'America/Chicago' },
  { name: 'London', country: 'UK', lat: 51.51, lon: -0.13, tz: 'Europe/London' },
  { name: 'Manchester', country: 'UK', lat: 53.48, lon: -2.24, tz: 'Europe/London' },
  { name: 'Edinburgh', country: 'UK', lat: 55.95, lon: -3.19, tz: 'Europe/London' },
  { name: 'Paris', country: 'France', lat: 48.86, lon: 2.35, tz: 'Europe/Paris' },
  { name: 'Lyon', country: 'France', lat: 45.76, lon: 4.84, tz: 'Europe/Paris' },
  { name: 'Berlin', country: 'Germany', lat: 52.52, lon: 13.41, tz: 'Europe/Berlin' },
  { name: 'Munich', country: 'Germany', lat: 48.14, lon: 11.58, tz: 'Europe/Berlin' },
  { name: 'Amsterdam', country: 'Netherlands', lat: 52.37, lon: 4.90, tz: 'Europe/Amsterdam' },
  { name: 'Barcelona', country: 'Spain', lat: 41.39, lon: 2.17, tz: 'Europe/Madrid' },
  { name: 'Madrid', country: 'Spain', lat: 40.42, lon: -3.70, tz: 'Europe/Madrid' },
  { name: 'Rome', country: 'Italy', lat: 41.90, lon: 12.50, tz: 'Europe/Rome' },
  { name: 'Milan', country: 'Italy', lat: 45.46, lon: 9.19, tz: 'Europe/Rome' },
  { name: 'Lisbon', country: 'Portugal', lat: 38.72, lon: -9.14, tz: 'Europe/Lisbon' },
  { name: 'Dublin', country: 'Ireland', lat: 53.35, lon: -6.26, tz: 'Europe/Dublin' },
  { name: 'Stockholm', country: 'Sweden', lat: 59.33, lon: 18.07, tz: 'Europe/Stockholm' },
  { name: 'Copenhagen', country: 'Denmark', lat: 55.68, lon: 12.57, tz: 'Europe/Copenhagen' },
  { name: 'Oslo', country: 'Norway', lat: 59.91, lon: 10.75, tz: 'Europe/Oslo' },
  { name: 'Helsinki', country: 'Finland', lat: 60.17, lon: 24.94, tz: 'Europe/Helsinki' },
  { name: 'Vienna', country: 'Austria', lat: 48.21, lon: 16.37, tz: 'Europe/Vienna' },
  { name: 'Zurich', country: 'Switzerland', lat: 47.38, lon: 8.54, tz: 'Europe/Zurich' },
  { name: 'Brussels', country: 'Belgium', lat: 50.85, lon: 4.35, tz: 'Europe/Brussels' },
  { name: 'Prague', country: 'Czech Republic', lat: 50.08, lon: 14.44, tz: 'Europe/Prague' },
  { name: 'Warsaw', country: 'Poland', lat: 52.23, lon: 21.01, tz: 'Europe/Warsaw' },
  { name: 'Athens', country: 'Greece', lat: 37.98, lon: 23.73, tz: 'Europe/Athens' },
  { name: 'Istanbul', country: 'Turkey', lat: 41.01, lon: 28.98, tz: 'Europe/Istanbul' },
  { name: 'Budapest', country: 'Hungary', lat: 47.50, lon: 19.04, tz: 'Europe/Budapest' },
  { name: 'Bucharest', country: 'Romania', lat: 44.43, lon: 26.10, tz: 'Europe/Bucharest' },
  { name: 'Tokyo', country: 'Japan', lat: 35.68, lon: 139.69, tz: 'Asia/Tokyo' },
  { name: 'Osaka', country: 'Japan', lat: 34.69, lon: 135.50, tz: 'Asia/Tokyo' },
  { name: 'Seoul', country: 'South Korea', lat: 37.57, lon: 126.98, tz: 'Asia/Seoul' },
  { name: 'Singapore', country: 'Singapore', lat: 1.35, lon: 103.82, tz: 'Asia/Singapore' },
  { name: 'Hong Kong', country: 'China', lat: 22.32, lon: 114.17, tz: 'Asia/Hong_Kong' },
  { name: 'Shanghai', country: 'China', lat: 31.23, lon: 121.47, tz: 'Asia/Shanghai' },
  { name: 'Beijing', country: 'China', lat: 39.90, lon: 116.41, tz: 'Asia/Shanghai' },
  { name: 'Taipei', country: 'Taiwan', lat: 25.03, lon: 121.57, tz: 'Asia/Taipei' },
  { name: 'Bangkok', country: 'Thailand', lat: 13.76, lon: 100.50, tz: 'Asia/Bangkok' },
  { name: 'Kuala Lumpur', country: 'Malaysia', lat: 3.14, lon: 101.69, tz: 'Asia/Kuala_Lumpur' },
  { name: 'Jakarta', country: 'Indonesia', lat: -6.21, lon: 106.85, tz: 'Asia/Jakarta' },
  { name: 'Manila', country: 'Philippines', lat: 14.60, lon: 120.98, tz: 'Asia/Manila' },
  { name: 'Mumbai', country: 'India', lat: 19.08, lon: 72.88, tz: 'Asia/Kolkata' },
  { name: 'Delhi', country: 'India', lat: 28.61, lon: 77.21, tz: 'Asia/Kolkata' },
  { name: 'Bangalore', country: 'India', lat: 12.97, lon: 77.59, tz: 'Asia/Kolkata' },
  { name: 'Dubai', country: 'UAE', lat: 25.20, lon: 55.27, tz: 'Asia/Dubai' },
  { name: 'Tel Aviv', country: 'Israel', lat: 32.09, lon: 34.78, tz: 'Asia/Jerusalem' },
  { name: 'Sydney', country: 'Australia', lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' },
  { name: 'Melbourne', country: 'Australia', lat: -37.81, lon: 144.96, tz: 'Australia/Melbourne' },
  { name: 'Brisbane', country: 'Australia', lat: -27.47, lon: 153.03, tz: 'Australia/Brisbane' },
  { name: 'Perth', country: 'Australia', lat: -31.95, lon: 115.86, tz: 'Australia/Perth' },
  { name: 'Auckland', country: 'New Zealand', lat: -36.85, lon: 174.76, tz: 'Pacific/Auckland' },
  { name: 'Toronto', country: 'Canada', lat: 43.65, lon: -79.38, tz: 'America/Toronto' },
  { name: 'Vancouver', country: 'Canada', lat: 49.28, lon: -123.12, tz: 'America/Vancouver' },
  { name: 'Montreal', country: 'Canada', lat: 45.50, lon: -73.57, tz: 'America/Toronto' },
  { name: 'Halifax', country: 'Canada', lat: 44.65, lon: -63.57, tz: 'America/Halifax' },
  { name: 'Dartmouth', country: 'Canada', lat: 44.67, lon: -63.57, tz: 'America/Halifax' },
  { name: 'Calgary', country: 'Canada', lat: 51.05, lon: -114.07, tz: 'America/Edmonton' },
  { name: 'São Paulo', country: 'Brazil', lat: -23.55, lon: -46.63, tz: 'America/Sao_Paulo' },
  { name: 'Rio de Janeiro', country: 'Brazil', lat: -22.91, lon: -43.17, tz: 'America/Sao_Paulo' },
  { name: 'Buenos Aires', country: 'Argentina', lat: -34.60, lon: -58.38, tz: 'America/Argentina/Buenos_Aires' },
  { name: 'Mexico City', country: 'Mexico', lat: 19.43, lon: -99.13, tz: 'America/Mexico_City' },
  { name: 'Bogotá', country: 'Colombia', lat: 4.71, lon: -74.07, tz: 'America/Bogota' },
  { name: 'Lima', country: 'Peru', lat: -12.05, lon: -77.04, tz: 'America/Lima' },
  { name: 'Santiago', country: 'Chile', lat: -33.45, lon: -70.67, tz: 'America/Santiago' },
  { name: 'Cape Town', country: 'South Africa', lat: -33.93, lon: 18.42, tz: 'Africa/Johannesburg' },
  { name: 'Johannesburg', country: 'South Africa', lat: -26.20, lon: 28.05, tz: 'Africa/Johannesburg' },
  { name: 'Lagos', country: 'Nigeria', lat: 6.52, lon: 3.38, tz: 'Africa/Lagos' },
  { name: 'Cairo', country: 'Egypt', lat: 30.04, lon: 31.24, tz: 'Africa/Cairo' },
  { name: 'Nairobi', country: 'Kenya', lat: -1.29, lon: 36.82, tz: 'Africa/Nairobi' },
  { name: 'Casablanca', country: 'Morocco', lat: 33.57, lon: -7.59, tz: 'Africa/Casablanca' },
  { name: 'Accra', country: 'Ghana', lat: 5.56, lon: -0.19, tz: 'Africa/Accra' },
  { name: 'Honolulu', country: 'USA', lat: 21.31, lon: -157.86, tz: 'Pacific/Honolulu' },
  { name: 'Anchorage', country: 'USA', lat: 61.22, lon: -149.90, tz: 'America/Anchorage' },
  { name: 'Reykjavik', country: 'Iceland', lat: 64.15, lon: -21.94, tz: 'Atlantic/Reykjavik' },
  { name: 'Moscow', country: 'Russia', lat: 55.76, lon: 37.62, tz: 'Europe/Moscow' },
  { name: 'Doha', country: 'Qatar', lat: 25.29, lon: 51.53, tz: 'Asia/Qatar' },
  { name: 'Riyadh', country: 'Saudi Arabia', lat: 24.71, lon: 46.68, tz: 'Asia/Riyadh' },
];

// Add timezone alias for compatibility
cities.forEach((c) => {
  c.timezone = c.tz;
});

/**
 * Find a city by name (case-insensitive).
 * @param {string} name - City name to search for
 * @returns {City|undefined}
 */
export function findCity(name) {
  if (!name) return undefined;
  return cities.find((c) => c.name.toLowerCase() === name.toLowerCase());
}
