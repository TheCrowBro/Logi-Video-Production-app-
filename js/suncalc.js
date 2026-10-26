// Solar + Polaris maths. Sun routines follow the well-known SunCalc algorithm (BSD-2, Vladimir Agafonkin).
const PI = Math.PI, rad = PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, E = rad * 23.4397;
const toJulian = d => d.valueOf() / dayMs - 0.5 + J1970;
const fromJulian = j => new Date((j + 0.5 - J1970) * dayMs);
const toDays = d => toJulian(d) - J2000;

const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l));
const azimuthFromSouth = (H, phi, dec) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
const altitude = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
const solarMeanAnomaly = d => rad * (357.5291 + 0.98560028 * d);
const eclipticLongitude = M => M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + PI;
const sunCoords = d => { const L = eclipticLongitude(solarMeanAnomaly(d)); return { dec: declination(L, 0), ra: rightAscension(L, 0) }; };

const deg = r => ((r / rad) % 360 + 360) % 360;

/** Sun position: azimuth in degrees clockwise from true north, altitude in degrees. */
export function getPosition(date, lat, lon) {
  const lw = rad * -lon, phi = rad * lat, d = toDays(date), c = sunCoords(d), H = siderealTime(d, lw) - c.ra;
  return { azimuth: deg(azimuthFromSouth(H, phi, c.dec) + PI), altitude: altitude(H, phi, c.dec) / rad };
}

const J0 = 0.0009;
const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2 * PI));
const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * PI) + n;
const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
const hourAngle = (h, phi, d) => Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));

const ANGLES = [
  [-0.833, 'sunrise', 'sunset'], [-0.3, 'sunriseEnd', 'sunsetStart'], [-6, 'dawn', 'dusk'],
  [-12, 'nauticalDawn', 'nauticalDusk'], [-18, 'nightEnd', 'night'], [6, 'goldenHourEnd', 'goldenHour'],
  [-4, 'blueHourEnd', 'blueHourStart'], [-8, 'blueHour', 'blueHourDusk'],
];

/** Key times for the day nearest `date` (pass local noon). Missing events (polar day/night) are Invalid Date. */
export function getTimes(date, lat, lon) {
  const lw = rad * -lon, phi = rad * lat, d = toDays(date), n = julianCycle(d, lw), ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0), Jnoon = solarTransitJ(ds, M, L);
  const out = { solarNoon: fromJulian(Jnoon), nadir: fromJulian(Jnoon - 0.5) };
  for (const [angle, rise, set] of ANGLES) {
    const w = hourAngle(angle * rad, phi, dec);
    const Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
    out[rise] = fromJulian(Jnoon - (Jset - Jnoon));
    out[set] = fromJulian(Jset);
  }
  return out;
}

/* ------------------------------- Polaris ------------------------------- */
// J2000 mean position, precessed to the date (IAU 1976 angles).
const POLARIS = { ra: 37.95456067 * rad, dec: 89.26410897 * rad };

export function polarisPosition(date, lat, lon) {
  const T = (toJulian(date) - J2000) / 36525;
  const arc = rad / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * arc;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * arc;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * arc;
  const { ra: a0, dec: d0 } = POLARIS;
  const A = Math.cos(d0) * Math.sin(a0 + zeta);
  const B = Math.cos(theta) * Math.cos(d0) * Math.cos(a0 + zeta) - Math.sin(theta) * Math.sin(d0);
  const C = Math.sin(theta) * Math.cos(d0) * Math.cos(a0 + zeta) + Math.cos(theta) * Math.sin(d0);
  const ra = Math.atan2(A, B) + z, dec = Math.asin(C);
  const lw = rad * -lon, phi = rad * lat;
  const H = siderealTime(toDays(date), lw) - ra;
  return {
    azimuth: deg(azimuthFromSouth(H, phi, dec) + PI),
    altitude: altitude(H, phi, dec) / rad,
    // How far from true north the star sits right now (positive = east of north).
    offsetFromNorth: ((deg(azimuthFromSouth(H, phi, dec) + PI) + 180) % 360) - 180,
    declination: dec / rad,
  };
}

export const compassPoint = az => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(az / 22.5) % 16];
