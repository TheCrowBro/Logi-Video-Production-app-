// The crew roles of film, television and video work, grouped by department, for the role menu (js/role-picker.js) and
// the Crew page's filter. A role is its name, or [name, other names for the same job]: British names first, with the
// American and short forms after them (DOP: Director of Photography, DP, Cinematographer), so each is found by any
// of its names and may be saved under any of them. No name appears twice. The 21 roles Vdex offered before this list
// are all still here under the same names, so nothing a crew card already says changes. Departments and names were
// checked against published crew lists (Bectu's rate cards by department, and the film crew and television crew
// lists on Wikipedia). Loaded on first use.
import { db, upsert, remove } from './store.js';

export const ROLE_GROUPS = [
  { name: 'Producing', icon: '💼', roles: [
    ['Executive Producer', 'EP', 'Exec Producer'], 'Producer', 'Co-Producer', ['Line Producer', 'LP'], 'Associate Producer', ['Assistant Producer', 'AP'],
    'Series Producer', 'Showrunner', 'Supervising Producer', 'Creative Producer', 'Development Producer', ['Story Producer', 'Segment Producer'],
    ['Field Producer', 'Location Producer'], ['Archive Producer', 'Archive Researcher'], ['Head of Production', 'HoP'], 'Production Executive',
    ['Production Manager', 'PM', 'Unit Production Manager', 'UPM'], ['Production Coordinator', 'POC', 'Production Office Coordinator'],
    ['Assistant Production Coordinator', 'APOC'], 'Production Secretary',
    ['Production Accountant', 'Accountant'], ['Assistant Accountant', 'Accounts Assistant'], 'Researcher',
  ] },
  { name: 'Directing and ADs', icon: '🎬', roles: [
    'Director', 'Co-Director', 'Creative Director', ['Producer/Director', 'PD', 'Shooting PD', 'Self-shooting PD'], ['Second Unit Director', '2nd Unit Director'],
    ['1st AD', 'First Assistant Director', 'First AD'], ['2nd AD', 'Second Assistant Director', 'Second AD'], 'Crowd 2nd AD',
    ['3rd AD', 'Third Assistant Director', 'Third AD', '2nd 2nd AD'], ['AD Trainee', 'Trainee AD'], 'Choreographer', 'Movement Director',
    ['Dialect Coach', 'Dialogue Coach', 'Voice Coach'], ['Acting Coach', 'Drama Coach'],
  ] },
  { name: 'Camera', icon: '🎥', roles: [
    ['DOP', 'Director of Photography', 'DP', 'Cinematographer'], ['Lighting Cameraperson', 'Lighting Cameraman', 'Lighting Camerawoman'],
    ['Camera Operator', 'Cameraman', 'Camerawoman', 'Cameraperson', 'Cam Op'], ['B Camera Operator', 'Second Camera', 'Second Shooter', '2nd Camera Operator'],
    ['Videographer', 'Shooter'], ['1st AC', 'Focus Puller', 'First Assistant Camera', 'First AC'], ['2nd AC', 'Clapper Loader', 'Second Assistant Camera', 'Second AC'],
    ['Camera Assistant', 'AC', 'Assistant Camera'], ['Camera Trainee', 'Camera PA'], ['Film Loader', 'Central Loader', 'Loader'],
    ['Video Assist Operator', 'Video Assist', 'VTR Operator', 'Video Playback Operator', 'QTAKE Operator'], ['Autocue Operator', 'Teleprompter Operator', 'Prompter'],
  ] },
  { name: 'Drone and specialist camera', icon: '🚁', roles: [
    ['Drone Pilot', 'Drone Operator', 'UAV Pilot', 'Remote Pilot'], ['Drone Camera Operator', 'Aerial Camera Operator', 'Drone Gimbal Operator'],
    ['Drone Observer', 'Drone Spotter', 'Visual Observer'], ['FPV Drone Pilot', 'FPV Pilot'], ['Aerial DOP', 'Aerial Cinematographer', 'Aerial Director of Photography'],
    ['Steadicam Operator', 'Steadicam', 'Trinity Operator'], ['Gimbal Operator', 'Ronin Operator', 'MoVI Operator', 'Stabiliser Operator'],
    ['Jib Operator', 'Jimmy Jib Operator', 'Jib Op'], ['Crane Operator', 'Technocrane Operator', 'Camera Crane Operator'],
    ['Remote Head Technician', 'Remote Head Operator', 'Hot Head Operator'], ['Motion Control Operator', 'Moco Operator', 'Motion Control Technician', 'Bolt Operator'],
    ['Underwater Camera Operator', 'Underwater DOP', 'Underwater Cameraman'], ['Camera Car Driver', 'Tracking Vehicle Driver'],
    ['Russian Arm Operator', 'U-Crane Operator', 'Arm Car Operator'], ['High-speed Camera Technician', 'Phantom Technician', 'Phantom Tech'],
    ['Timelapse Photographer', 'Time-lapse Photographer'], ['360 Camera Operator', 'VR Camera Operator', 'VR Operator'],
    ['Cable Cam Operator', 'Wirecam Operator', 'Spidercam Operator'], ['Wildlife Camera Operator', 'Natural History Camera Operator'],
    ['Minicam Operator', 'Specialist Camera Operator', 'Fixed Rig Operator'],
  ] },
  { name: 'Lighting', icon: '💡', roles: [
    ['Gaffer', 'Chief Lighting Technician'], ['Best Boy', 'Best Boy Electric', 'Assistant Chief Lighting Technician'],
    ['Spark', 'Lighting Technician', 'Electrician', 'Lamp Operator'], 'Lighting Assistant', ['Lighting Trainee', 'Trainee Spark'], ['Lighting Director', 'LD'],
    'Lighting Designer', ['Lighting Desk Operator', 'Lighting Console Operator', 'Lighting Programmer', 'Dimmer Operator', 'Desk Op'], 'Rigging Gaffer',
    ['Rigging Electrician', 'Rigging Spark'], ['Practical Electrician', 'Practicals Spark'], ['Generator Operator', 'Genny Operator', 'Genny Op'],
  ] },
  { name: 'Grip', icon: '🔧', roles: [
    'Key Grip', 'Best Boy Grip', 'Grip', 'Dolly Grip', ['Crane Technician', 'Crane Grip'], ['Grip Assistant', 'Assistant Grip', 'Grip Trainee'],
    ['Rigger', 'Rigging Grip'], 'Standby Rigger', ['Stagehand', 'Standby Stagehand', 'Stage Hand'], ['Car Rigger', 'Car Rig Technician'],
  ] },
  { name: 'Sound', icon: '🎤', roles: [
    ['Sound Recordist', 'Production Sound Mixer', 'Sound Mixer', 'Location Sound Recordist'], ['Boom Operator', 'Boom Op', '1st AS', 'First Assistant Sound', 'Boom Swinger'],
    ['Sound Assistant', '2nd AS', 'Second Assistant Sound', 'Sound Utility', 'Cable Person'], 'Sound Trainee', 'Sound Supervisor', ['Sound Engineer', 'Audio Engineer'],
    ['Playback Operator', 'Sound Playback', 'Music Playback Operator'],
  ] },
  { name: 'Data and DIT', icon: '💾', roles: [
    ['DIT', 'Digital Imaging Technician'], ['DIT Assistant', 'DIT Trainee'], ['Data Wrangler', 'Media Manager', 'Data Manager'], 'Digital Loader',
    ['Dailies Operator', 'Rushes Operator', 'Lab Operator', 'Dailies Colourist'], ['Archivist', 'Media Librarian', 'Digital Asset Manager'],
  ] },
  { name: 'Art department', icon: '🎨', roles: [
    'Production Designer', 'Supervising Art Director', 'Art Director', 'Standby Art Director', 'Assistant Art Director',
    ['Art Department Assistant', 'Art Department Runner', 'Art Department Trainee', 'Art Assistant'], ['Set Designer', 'Draughtsperson'], 'Set Decorator',
    ['Set Dresser', 'Dressing Props'], ['Production Buyer', 'Buyer', 'Props Buyer'], ['Props Master', 'Property Master', 'Prop Master', 'Propmaster'],
    ['Standby Props', 'On-set Props'], ['Prop Maker', 'Props Maker', 'Model Maker', 'Props Modeller'], ['Prop Stylist', 'Props Stylist'],
    ['Food Stylist', 'Home Economist'], ['Graphic Designer', 'Graphic Artist', 'Graphics'], ['Concept Artist', 'Illustrator'], 'Storyboard Artist',
    ['Construction Manager', 'Construction Coordinator'], ['Carpenter', 'Chippy', 'Standby Carpenter'], ['Scenic Artist', 'Scenic Painter', 'Painter', 'Standby Painter'],
    ['Greens', 'Greensperson', 'Greensman'], ['Action Vehicle Coordinator', 'Picture Vehicle Coordinator', 'Action Vehicles'],
  ] },
  { name: 'Costume', icon: '👗', roles: [
    'Costume Designer', 'Assistant Costume Designer', ['Costume Supervisor', 'Wardrobe Supervisor'], ['Costume Standby', 'Wardrobe Standby', 'Set Costumer', 'Dresser'],
    ['Costume Assistant', 'Wardrobe Assistant', 'Wardrobe'], ['Costume Maker', 'Cutter', 'Tailor', 'Seamstress'], 'Costume Buyer', ['Costume Trainee', 'Costume PA'],
    ['Breakdown Artist', 'Costume Breakdown', 'Dyer'], ['Stylist', 'Wardrobe Stylist', 'Fashion Stylist'], ['Assistant Stylist', 'Stylist’s Assistant'],
  ] },
  { name: 'Hair and make-up', icon: '💄', roles: [
    ['Hair and Make-up Designer', 'Make-up Designer', 'Makeup Designer', 'HMU Designer'], ['Hair and Make-up Supervisor', 'Make-up Supervisor'],
    ['Hair and Make-up Artist', 'HMUA', 'HMU', 'Hair and Makeup Artist'], ['MUA', 'Make-up Artist', 'Makeup Artist'], ['Hair Stylist', 'Hairdresser', 'Hairstylist'],
    'Barber', ['Groomer', 'Men’s Grooming'], ['Hair and Make-up Assistant', 'Make-up Assistant', 'Junior MUA'], ['Hair and Make-up Trainee', 'Make-up Trainee'],
    ['Prosthetics Artist', 'SFX Make-up Artist', 'Special Make-up Effects Artist', 'Prosthetic Make-up Artist'], ['Wig Stylist', 'Wig Maker', 'Wigs'],
    ['Nail Technician', 'Manicurist', 'Nail Artist'],
  ] },
  { name: 'Locations', icon: '📍', roles: [
    'Supervising Location Manager', ['Location Manager', 'LM'], ['Assistant Location Manager', 'ALM'], 'Unit Manager', 'Location Scout', 'Location Assistant',
    ['Location Marshal', 'Locations PA', 'Marshal'], ['Fixer', 'Local Fixer', 'Local Producer'],
  ] },
  { name: 'Script and continuity', icon: '📝', roles: [
    ['Writer', 'Screenwriter', 'Scriptwriter'], ['Script Editor', 'Story Editor'], ['Script Supervisor', 'Continuity', 'Scripty'], 'Script Coordinator', 'Copywriter',
  ] },
  { name: 'Casting', icon: '📇', roles: [
    'Casting Director', 'Casting Associate', 'Casting Assistant', ['Extras Coordinator', 'Crowd Casting', 'Extras Casting', 'Background Casting'],
    ['Talent Booker', 'Guest Booker', 'Celebrity Booker'],
  ] },
  { name: 'Talent and on-screen', icon: '🎭', roles: [
    'Talent', ['Presenter', 'Host', 'Anchor'], ['Actor', 'Actress', 'Cast'], ['Supporting Artist', 'SA', 'Extra', 'Background Artist', 'Background'], 'Stand-in',
    ['Double', 'Body Double', 'Photo Double'], ['Voiceover Artist', 'VO', 'Voice Actor', 'Narrator'], 'Model', ['Contributor', 'Interviewee', 'Guest'], 'Interviewer',
    ['Reporter', 'Correspondent'], 'Commentator', 'Speaker', 'Dancer', ['Musician', 'Band'], ['Singer', 'Vocalist'], ['Performer', 'Artiste'], 'Puppeteer',
  ] },
  { name: 'Stunts and safety', icon: '🚨', roles: [
    'Stunt Coordinator', ['Stunt Performer', 'Stuntman', 'Stuntwoman', 'Stunt'], 'Stunt Double', 'Stunt Rigger', ['Stunt Driver', 'Precision Driver'],
    ['Fight Director', 'Fight Choreographer', 'Fight Coordinator'], 'Intimacy Coordinator', ['Armourer', 'Armorer', 'Weapons Master'],
    ['SFX Supervisor', 'Special Effects Supervisor'], ['SFX Technician', 'Special Effects Technician', 'Pyrotechnician'],
    ['Health and Safety Adviser', 'Health and Safety Officer', 'Safety Officer', 'H&S Adviser'], ['Fire Safety Officer', 'Fire Marshal', 'Fire Officer'],
    ['Safety Diver', 'Dive Supervisor', 'Diver'], ['Marine Coordinator', 'Boat Master', 'Safety Boat'], ['Animal Handler', 'Animal Wrangler', 'Wrangler', 'Horse Master'],
  ] },
  { name: 'Production support', icon: '🚐', roles: [
    ['Production Assistant', 'PA', 'Set PA', 'Office PA'], ['Runner', 'Gofer'], ['Floor Runner', 'Set Runner'], ['Production Runner', 'Office Runner'], 'Runner/Driver',
    ['Driver', 'Unit Driver', 'Minibus Driver'], ['Transport Captain', 'Transport Coordinator', 'Transport Manager'], ['Truck Driver', 'HGV Driver', 'Facilities Driver'],
    ['Caterer', 'Catering', 'Chef', 'Location Caterer'], 'Catering Assistant', ['Craft Services', 'Crafty', 'Tea Table'],
    ['Medic', 'Unit Medic', 'Set Medic', 'Paramedic', 'Unit Nurse'], ['Security', 'Security Guard', 'Security Officer'], 'Chaperone',
    ['Tutor', 'Set Teacher', 'Studio Teacher'], ['Unit Publicist', 'Publicist', 'PR'], ['Translator', 'Interpreter'], ['BSL Interpreter', 'Sign Language Interpreter'],
    ['Sustainability Coordinator', 'Green Steward', 'Eco Manager'], 'Wellbeing Facilitator',
  ] },
  { name: 'Editing and colour', icon: '✂️', roles: [
    ['Post-production Supervisor', 'Post Supervisor'], ['Post-production Coordinator', 'Post Coordinator'], 'Post Producer', 'Edit Producer',
    ['Editor', 'Video Editor', 'Film Editor', 'Offline Editor'], ['Assistant Editor', 'AE', '1st Assistant Editor', 'Edit Assistant'],
    ['Online Editor', 'Finishing Editor', 'Conform Editor', 'Flame Artist'], ['Post Runner', 'Edit Runner', 'Post-production Runner'], ['Colourist', 'Colorist', 'Grader'],
    ['Colour Assistant', 'Color Assistant', 'Grade Assistant'], ['Subtitler', 'Captioner', 'Subtitles'], ['Transcriber', 'Logger'], ['QC Operator', 'Quality Control'],
    ['Trailer Editor', 'Promo Editor'],
  ] },
  { name: 'Sound post and music', icon: '🎧', roles: [
    'Sound Designer', 'Supervising Sound Editor', ['Sound Editor', 'Sound Effects Editor', 'SFX Editor'], 'Dialogue Editor', ['ADR Recordist', 'ADR Mixer'],
    ['Foley Artist', 'Foley'], ['Dubbing Mixer', 'Re-recording Mixer', 'Audio Mixer'], 'Composer', 'Music Supervisor', 'Music Editor', 'Music Producer',
  ] },
  { name: 'VFX and motion graphics', icon: '✨', roles: [
    ['VFX Supervisor', 'Visual Effects Supervisor'], 'VFX Producer', 'VFX Coordinator', 'VFX Editor', ['VFX Artist', 'Visual Effects Artist'],
    ['VFX Data Wrangler', 'On-set VFX'], ['Compositor', 'Comp Artist', 'Nuke Artist'], ['Roto Artist', 'Rotoscope Artist', 'Paint and Prep Artist'],
    ['Matchmove Artist', 'Tracking Artist'], ['Matte Painter', 'DMP Artist'], ['3D Artist', 'CG Artist', '3D Generalist', '3D Modeller'],
    ['Animator', '2D Animator', '3D Animator', 'Stop-motion Animator'], ['Motion Designer', 'Motion Graphics Designer', 'Motion Graphics Artist', 'Mograph Artist'],
    ['Title Designer', 'Titles'], ['Previs Artist', 'Previsualisation Artist'], ['Virtual Production Supervisor', 'VP Supervisor'],
    ['Unreal Engine Operator', 'Virtual Production Operator', 'Volume Operator'],
  ] },
  { name: 'Live, broadcast and events', icon: '📡', roles: [
    ['Multi-camera Director', 'Gallery Director', 'Studio Director', 'Live Director'], ['Vision Mixer', 'Switcher', 'Video Switcher'], ['Technical Director', 'TD'],
    ['Floor Manager', 'FM'], ['Assistant Floor Manager', 'AFM'], 'Stage Manager', 'Show Caller', ['Gallery PA', 'Broadcast PA'],
    ['Studio Camera Operator', 'OB Camera Operator', 'Multi-camera Operator'], ['ENG Camera Operator', 'News Camera Operator', 'ENG Crew'],
    ['Video Journalist', 'VJ', 'Journalist'], ['Vision Engineer', 'Racks Engineer', 'Video Shader', 'CCU Operator'], ['Broadcast Engineer', 'OB Engineer'],
    ['EVS Operator', 'Replay Operator', 'VT Operator'], ['Graphics Operator', 'CG Operator', 'Caption Operator', 'Aston Operator'],
    ['Streaming Engineer', 'Live Stream Engineer', 'Webcast Engineer', 'Livestream Technician'], ['Live Stream Producer', 'Webcast Producer'],
    ['Live Sound Engineer', 'FOH Engineer', 'A1'], 'Monitor Engineer', ['RF Engineer', 'Radio Mic Technician', 'Comms Engineer'],
    ['AV Technician', 'Audio-visual Technician', 'Projectionist'], ['LED Screen Technician', 'Video Wall Technician', 'LED Technician'],
    ['Media Server Operator', 'Disguise Operator', 'Resolume Operator', 'Screens Operator'], ['Uplink Engineer', 'Satellite Engineer', 'SNG Engineer'],
    ['Cable Basher', 'Cable Puller'], ['Event Manager', 'Event Producer'],
  ] },
  { name: 'Stills', icon: '📷', roles: [
    ['Stills Photographer', 'Still Photographer', 'Unit Stills Photographer', 'Set Photographer', 'Unit Stills'], 'Photographer', ['Photographer’s Assistant', 'Photo Assistant', 'Photography Assistant'],
    ['Digital Operator', 'Digi Op', 'Digital Tech'], ['Retoucher', 'Photo Retoucher'], ['BTS Photographer', 'Behind-the-scenes Photographer'], 'Studio Assistant',
  ] },
  { name: 'Social and content', icon: '📱', roles: [
    ['Content Creator', 'Creator', 'Influencer', 'UGC Creator'], ['Social Media Manager', 'SMM'], ['Social Media Producer', 'Social Producer'],
    ['Social Video Editor', 'Short-form Editor', 'Reels Editor'], ['Shooter/Editor', 'Shoot-edit', 'Self-shooting Editor'],
    ['BTS Videographer', 'Behind-the-scenes Videographer', 'EPK'], ['Content Strategist', 'Content Planner'], 'Community Manager', ['Digital Producer', 'Online Producer'],
    ['Podcast Producer', 'Audio Producer'], ['Channel Manager', 'YouTube Manager'], 'Thumbnail Designer',
  ] },
  { name: 'General', icon: '🙋', roles: [
    'Other', 'Assistant', 'Trainee', 'Apprentice', ['Work Experience', 'Intern', 'Placement'], 'Volunteer', ['Consultant', 'Adviser', 'Advisor', 'Technical Adviser'],
  ] },
].map(g => ({ ...g, roles: g.roles.map(r => (Array.isArray(r) ? { name: r[0], aka: r.slice(1) } : { name: r, aka: [] })) }));

// The group of the person's own roles: what they typed themselves, kept in the database (db.myRoles), together with
// any role a crew card or a hired person already carries that is not in the list above.
export const MY_ROLES = 'My roles';
export const MY_ROLES_ICON = '⭐';

// Names are compared without regard to capitals, accents, punctuation or spacing ("make up artist" is "Make-up
// Artist"), in any alphabet; a role written only in signs is compared as it stands.
export const fold = s => { const t = String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); return t.replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || t.replace(/\s+/g, ' ').trim(); };
export const tidyRole = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const MAX = 60; // letters in a role typed by hand

// Every name a listed role goes by, folded: name -> { group, role, label } (label: that name as it is written here).
const INDEX = new Map();
for (const g of ROLE_GROUPS) for (const r of g.roles) for (const label of [r.name, ...r.aka]) INDEX.set(fold(label), { group: g.name, role: r, label });

export const groupNames = () => ROLE_GROUPS.map(g => g.name);
export const allRoles = () => ROLE_GROUPS.flatMap(g => g.roles.map(r => r.name));
// A listed role by any of its names, or null for a role of the person's own.
export const findRole = role => INDEX.get(fold(role)) || null;
export const isListed = role => INDEX.has(fold(role));
// The group a role belongs to: its department, or My roles when it is not in the list. '' for no role at all.
export const groupOf = role => (fold(role) ? (INDEX.get(fold(role)) || { group: MY_ROLES }).group : '');
// Words a search may find a person's role by, beyond the role as written: its department and its other names.
export const roleWords = role => { const hit = findRole(role); return hit ? [hit.group, hit.role.name, ...hit.role.aka].join(' ') : (fold(role) ? MY_ROLES : ''); };

/* --------------------------------- my roles --------------------------------- */
// db.myRoles holds { id, name, updatedAt }, the id made from the name so the same role typed on two devices is one
// record; it merges record by record like the other lists, and forgetting one leaves a tombstone (js/store.js).
const myId = name => 'myrole:' + fold(name);
// Roles in use on crew cards and hired people, as they are written there.
const rolesInUse = () => [...db.crew.map(c => c && c.role), ...db.bookings.flatMap(b => (Array.isArray(b.hires) ? b.hires : []).map(x => x && x.role))].map(tidyRole).filter(Boolean);
// The person's own roles, A to Z: [{ name, kept (it is in db.myRoles), used (someone has it) }].
export function myRoles() {
  const out = new Map();
  for (const r of db.myRoles || []) { const name = tidyRole(r && r.name); if (name && !isListed(name) && !out.has(fold(name))) out.set(fold(name), { name, kept: true, used: false }); }
  for (const name of rolesInUse()) { if (isListed(name)) continue; const k = fold(name); if (out.has(k)) out.get(k).used = true; else out.set(k, { name, kept: false, used: true }); }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
// What a typed role becomes: the listed name it matches (as the list writes it), a role of the person's own it
// matches (as they wrote it first), or the text itself, tidied.
export function resolveRole(text) {
  const name = tidyRole(tidyRole(text).slice(0, MAX)); if (!name) return '';
  const hit = findRole(name); if (hit) return hit.label;
  const mine = myRoles().find(r => fold(r.name) === fold(name));
  return mine ? mine.name : name;
}
// Keeps a role of the person's own for next time. Listed roles and blanks are left alone; false when nothing changed
// (already kept, or Vdex is read-only).
export function rememberRole(role) {
  const name = tidyRole(role);
  if (!fold(name) || isListed(name) || (db.myRoles || []).some(r => r && r.id === myId(name))) return false;
  return upsert('myRoles', { id: myId(name), name });
}
export const forgetRole = role => remove('myRoles', myId(role));

/* ---------------------------------- search ---------------------------------- */
// How well a name answers what was typed: 0 the same, 1 starts with it, 2 a word in it starts with it, 3 it is inside
// (ignoring spaces, three letters or more: "makeup" finds "Make-up Artist"); -1 not at all.
function rank(label, q) {
  const f = fold(label);
  if (f === q) return 0; if (f.startsWith(q)) return 1; if ((' ' + f).includes(' ' + q)) return 2;
  const tight = q.replace(/ /g, '');
  return tight.length >= 3 && f.replace(/ /g, '').includes(tight) ? 3 : -1;
}
// Roles matching the text, best first: [{ label (the name to save), group, same (the listed name, when the label is
// another name for it), aka }]. A role found by its own name is offered under it; found only by another of its names,
// under that name, so "focus puller" offers Focus Puller and says it is the 1st AC.
export function searchRoles(text, limit = 40) {
  const q = fold(text); if (!q) return { hits: [], more: false };
  const hits = [];
  let order = 0;
  for (const m of myRoles()) { const r = rank(m.name, q); if (r >= 0) hits.push({ label: m.name, group: MY_ROLES, same: '', aka: [], r, order: order++ }); }
  for (const g of ROLE_GROUPS) for (const role of g.roles) {
    const own = rank(role.name, q);
    if (own >= 0) hits.push({ label: role.name, group: g.name, same: '', aka: role.aka, r: own, order: order++ });
    for (const a of role.aka) { const r = rank(a, q); if (r >= 0 && (own < 0 || r === 0)) hits.push({ label: a, group: g.name, same: role.name, aka: [], r, order: order++ }); }
  }
  hits.sort((a, b) => a.r - b.r || a.order - b.order);
  return { hits: hits.slice(0, limit), more: hits.length > limit };
}
