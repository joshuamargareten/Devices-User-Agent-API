/**
 * Teklink — Device Classification API (single file, final now)
 * ------------------------------------------------------------
 * Narrowing pipeline = start with ALL products, remove things it CANNOT be.
 *
 * Short-circuits:
 *  - platform=skyswitch && UA empty  => [] (not billed on SS)
 *  - device_type=cellphone|landline  => ["Cellphone Routing Device"] (ignore UA)
 *  - device_type=sip_uri             => ["SIP URI"]
 *
 * UA → FAMILY narrows only the family (Deskphone / Desktop Softphone / Smartphone App / ATA / Door Bell / Pager / SIP URI).
 * Deskphone refinement (never “decide” a single option unless only one remains):
 *  - line > 1                     -> keep only "Deskphone Additional SIP Account"
 *  - line == 1 && valid MAC       -> remove Manual, Additional, and SIP-Creds (keep Provisioned + Clone)
 *  - line == 1 && NO valid MAC    -> remove Provisioned, Additional (keep Manual + Clone + SIP-Creds)
 *
 * FPBX (FreePBX trunk) → "SIP Trunk" (via UA or name hint).
 *
 * Start:
 *   npm i express
 *   node server.js
 *
 * Env:
 *   PORT=3000 node server.js
 */

const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
// Allow ALL origins (no credentials). Preflight cached for 24h.
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));

// Make sure preflight never 404s:
app.options('*', cors());

/* ------------------------------ 1) Billing codes ------------------------------ */
const BILLING = {
    kazoo: {
        "Provisioned Deskphone": "KZ1004",
        "Manual Deskphone": "KZ1005",
        "Clone Deskphone": "KZ1006",
        "Deskphone Additional SIP Account": "KZ1007",
        "SIP Credentials for External Device": "KZ1008",
        "Desktop Softphone User": "KZ1009",
        "Desktop Softphone (User's Additional Device)": "KZ1010",
        "Smartphone App User": "KZ1011",
        "Smartphone App (User's Additional Device)": "KZ1012",
        "Cellphone Routing Device": "KZ1013",
        "Door Bell": "KZ1014",
        "Pager": "KZ1015",
        "ATA SIP Account (Analog Telephone)": "KZ1016",
        "ATA SIP Account (Doorbell / Pager / Elevator Line)": "KZ1017",
        "ATA SIP Account (Public Phone / Resident Phone)": "KZ1018",
        "SIP URI": "KZ1019",
        "SIP Trunk": "KZ1020"
    },
    skyswitch: {
        "Provisioned Deskphone": "SS2004",
        "Manual Deskphone": "SS2005",
        "Clone Deskphone": "SS2006",
        "Deskphone Additional SIP Account": "SS2007",
        "SIP Credentials for External Device": "SS2008",
        "Desktop Softphone User": "SS2009",
        "Desktop Softphone (User's Additional Device)": "SS2010",
        "Smartphone App User": "SS2011",
        "Smartphone App (User's Additional Device)": "SS2012",
        "Door Bell": "SS2014",
        "Pager": "SS2015",
        "ATA SIP Account (Analog Telephone)": "SS2016",
        "ATA SIP Account (Doorbell / Pager / Elevator Line)": "SS2017",
        "ATA SIP Account (Public Phone / Resident Phone)": "SS2018",
        "SIP URI": "SS2019",
        "SIP Trunk": "SS2020"
    }
};

/* ----------------------- 2) Product universes & helpers ----------------------- */
const DESK_VARIANTS = [
    "Manual Deskphone",
    "Deskphone Additional SIP Account",
    "Provisioned Deskphone",
    "Clone Deskphone",
    "SIP Credentials for External Device"
];
const ATA_VARIANTS = [
    "ATA SIP Account (Analog Telephone)",
    "ATA SIP Account (Doorbell / Pager / Elevator Line)",
    "ATA SIP Account (Public Phone / Resident Phone)"
];
const SMART_VARIANTS = [
    "Smartphone App User",
    "Smartphone App (User's Additional Device)"
];
const SOFT_VARIANTS = [
    "Desktop Softphone User",
    "Desktop Softphone (User's Additional Device)"
];
const SINGLETONS = ["Door Bell",
    "Pager",
    "SIP URI"];

const ALL_PRODUCTS = [
    ...DESK_VARIANTS,
    ...ATA_VARIANTS,
    ...SMART_VARIANTS,
    ...SOFT_VARIANTS,
    ...SINGLETONS,
    "Cellphone Routing Device",
    "SIP Trunk"
];

function N(x) { return (x === undefined || x == null) ? "" : String(x).trim(); }
function lc(x) { return N(x).toLowerCase(); }
function validMac(mac) { return lc(mac).replace(/[^0-9a-f]/g, "").length === 12; }
function toIntOr(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function hasFullWord(haystack, needle) {
    return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(haystack);
}

/* -------------------------- 3) UA DB (nested tokens) -------------------------- */
/** Base UA DB (extend via DEVICE_DB_EXT below by pasting your new entries) */
const deviceDB = {
    "2n": "Door Bell",
    "3cxphone": "Desktop Softphone",
    "acrobits": "Smartphone App",
    "akcloudunion": "Deskphone",
    "akuvox": "Door Bell",
    "algo": {
        "8028": "Door Bell",
        "8028g2": "Door Bell",
        "8063": "Door Bell",
        "8180": "Pager",
        "8180g2": "Pager",
        "8186": "Pager",
        "8188": "Pager",
        "8201": "Door Bell",
        "8301": "Pager"
    },
    "axis": "Pager",
    "bria": {
        "android": "Smartphone App",
        "release": "Desktop Softphone"
    },
    "cisco": {
        "cp": {
            "8841": "Deskphone",
            "8861": "Deskphone"
        },
        "spa112": "ATA SIP Account",
        "spa122": "ATA SIP Account",
        "spa303": "Deskphone",
        "spa504g": "Deskphone",
        "spa508g": "Deskphone",
        "spa525": "Deskphone",
        "spa525g2": "Deskphone",
        "spa8800": "ATA SIP Account"
    },
    "client.webrtc":"Desktop Softphone",
    "cloudsoftphone":"Smartphone App",
    "connectuc": {
        "mobile": "Smartphone App",
        "web": "Desktop Softphone"
    },
    "control4": "Door Bell",
    "cyberdata": "Door Bell",
    "dimensions": "Desktop Softphone",
    "e12w": "Door Bell",
    "fanvil": {
        "h2u": "Deskphone",
        "i10": "Door Bell",
        "i10s": "Door Bell",
        "i10sd": "Door Bell",
        "i10v": "Door Bell",
        "i12": "Door Bell",
        "i20s": "Door Bell",
        "i20t": "Door Bell",
        "i23": "Door Bell",
        "i23s": "Door Bell",
        "i30": "Door Bell",
        "i31s": "Door Bell",
        "i67": "Door Bell",
        "pa2": "Pager",
        "pa2s": "Pager",
        "x2": "Deskphone",
        "x4u": "Deskphone",
        "x6u": "Deskphone"
    },
    "gac2500": "Deskphone",
    "grandstream": {
        "gac2500": "Deskphone",
        "gds3710": "Door Bell",
        "ghp6110": "Deskphone",
        "grp2602p": "Deskphone",
        "grp2615": "Deskphone",
        "gsc3505": "Pager",
        "gsc3506": "Pager",
        "gsc3510": "Pager",
        "gxp1610": "Deskphone",
        "gxp1625": "Deskphone",
        "gxp2130": "Deskphone",
        "gxp2135": "Deskphone",
        "gxp2140": "Deskphone",
        "gxp2160": "Deskphone",
        "gxp2170": "Deskphone",
        "gxv3370": "Deskphone",
        "gxw4216": "ATA SIP Account",
        "gxw4224": "ATA SIP Account",
        "gxw4224v2": "ATA SIP Account",
        "gxw4248": "ATA SIP Account",
        "gxw4248v2": "ATA SIP Account",
        "ht701": "ATA SIP Account",
        "ht801": "ATA SIP Account",
        "ht801v2": "ATA SIP Account",
        "ht802": "ATA SIP Account",
        "ht802v2": "ATA SIP Account",
        "ht813": "ATA SIP Account",
        "ht814": "ATA SIP Account",
        "ht814v2": "ATA SIP Account",
        "ht818": "ATA SIP Account",
        "ht818v2": "ATA SIP Account",
        "wp820": "Deskphone",
        "wp825": "Deskphone"
    },
    "koonloon": "ATA SIP Account",
    "linksys": {
        "pap2t": "ATA SIP Account",
        "spa942": "Deskphone"
    },
    "lol512": "Deskphone",
    "microsip": "Desktop Softphone",
    "netsapiens": {
        "ncs": "Desktop Softphone"
    },
    "obihai": {
        "obi200": "ATA SIP Account",
        "obi202": "ATA SIP Account",
        "obi300": "ATA SIP Account",
        "obi302": "ATA SIP Account",
        "obi1062": "Deskphone",
        "obi2182": "Deskphone"
    },
    "panasonic": "Deskphone",
    "patton": "ATA SIP Account",
    "polycom": "Deskphone",
    "polycomsoundpointip": "Deskphone",
    "polycomsoundstationip": "Deskphone",
    "polycomvvx": "Deskphone",
    "polyedge": "Deskphone",
    "push": {
        "server": "Smartphone App"
    },
    "r20a": "Door Bell",
    "r20k": "Door Bell",
    "r20v": "Door Bell",
    "r26c": "Door Bell",
    "reachuc": "Smartphone App",
    "sh30": "Pager",
    "sip": {
        "softphone": "Desktop Softphone"
    },
    "sipaua": "Smartphone App",
    "skyswitch": "Smartphone App",
    "snompa1": "Pager",
    "tsip": "Pager",
    "uc": {
        "sipis": "Smartphone App"
    },
    "ucsip": {
        "r8.44.2236": {
            "iver60.65dbg": "Pager"
        }
    },
    "v9.2.0": "Door Bell",
    "valcom": "Pager",
    "voip": {
        "door": {
            "phone": "Door Bell"
        },
        "ip": {
            "paging": "Pager"
        }
    },
    "yealink": "Deskphone",
    "z": "Desktop Softphone",
    "zoiper": "Desktop Softphone",
    // Trunk indicators (family = SIP Trunk)
    "fpbx": "SIP Trunk",                      // FreePBX trunk UAs
    "freepbx": "SIP Trunk"
};

/** Paste UA extensions generated from your CSV here (array of entries).
 * Example entry: [ ["akuvox","x912"],
"Door Bell" ]
 */
const DEVICE_DB_EXT = [
    // ... paste generated entries here when you export them ...
];

/** Merge DEVICE_DB_EXT into deviceDB (nested create-if-missing). */
for (const entry of DEVICE_DB_EXT) {
    const path = Array.isArray(entry[0]) ? entry[0] : entry.slice(0, entry.length - 1);
    const family = Array.isArray(entry[0]) ? entry[1] : entry[entry.length - 1];
    let node = deviceDB;
    for (let i = 0; i < path.length; i++) {
        const key = String(path[i]).toLowerCase();
        if (i === path.length - 1) {
            node[key] = family;
        } else {
            node[key] = node[key] || {};
            if (typeof node[key] !== 'object') node[key] = {};
            node = node[key];
        }
    }
}

/** deviceDB prefix-walk */
function deviceDBFamily(uaRaw) {
    const u = lc(uaRaw);
    if (!u) return null;
    const tokens = u.split(/[^a-z0-9.:]+/i).filter(Boolean);
    if (!tokens.length) return null;

    let node = deviceDB[tokens[0]];
    if (!node) return null;
    if (typeof node === 'string') return node;

    for (let i = 1; i < tokens.length && node && typeof node === 'object'; i++) {
        node = node[tokens[i]];
    }
    return (typeof node === 'string') ? node : null;
}

/* ------------------------ 4) UA heuristic fallback rules ---------------------- */
function uaFamilyFallback(uaRaw) {
    const u = lc(uaRaw);
    if (!u) return null;

    // Trunks
    if (u.includes('fpbx') || u.includes('freepbx')) return 'SIP Trunk';

    if (u.includes('control4') && u.includes('door station')) return 'Door Bell';
    if (u.startsWith('e12w')) return 'Door Bell';
    if (u.includes('client.webrtc')) return 'Desktop Softphone';
    if (u.includes('dimensions.ucd.uwp')) return 'Desktop Softphone';
    if (u.includes('cloudsoftphone')) return 'Smartphone App';
    if (u.includes('acrobits')) return 'Smartphone App';
    if (u.includes('akcloudunion')) return 'Deskphone';

    if (u.includes('bria')) {
        if (u.includes('release')) return 'Desktop Softphone';
        return 'Smartphone App';
    }

    if (u.includes('callthru.us')) return 'Smartphone App';
    if (u.includes('sip softphone')) return 'Desktop Softphone';
    if (u.includes('tsip')) return 'Pager';
    if (u.includes('uc sipis')) return 'Smartphone App';
    if (/\byealink\s+link\b/i.test(u)) return 'Desktop Softphone';
    if (u.includes('yealink')) return 'Deskphone';

    if (u.includes('fanvil')) {
        if (/\bh2u\b/.test(u)) return 'Deskphone';
        if (/\bx\d+[a-z]?\b/.test(u)) return 'Deskphone'; // X-series
        if (u.includes('pa2')) return 'Pager';
        if (/\bi(10|12|20s|20t|23|23s|30|31s)\b/.test(u)) return 'Door Bell';
        return 'Deskphone';
    }

    if (u.includes('grandstream') || /\b(?:gx[pvwr]|grp|gds|gsc|ht8)/i.test(u)) {
        if (u.includes('gds')) return 'Door Bell';
        if (u.includes('gsc')) return 'Pager';
        if (/\bgxw\d{4}/i.test(u)) return 'ATA SIP Account';
        if (/\bht8(01|02|13|14|18)\b/i.test(u)) return 'ATA SIP Account';
        if (/\bgxp|grp|gxv3370|wp82[05]\b/i.test(u)) return 'Deskphone';
    }

    if (u.includes('polyedge') || u.includes('polycom') || u.includes('vvx')) return 'Deskphone';

    if (u.includes('cisco') || u.includes('spa')) {
        if (u.includes('spa112')) return 'ATA SIP Account';
        if (/\b(spa303|spa504g|spa508g|spa525|spa525g2)\b/i.test(u)) return 'Deskphone';
        return 'Deskphone';
    }

    if (u.includes('obi') || u.includes('obihai')) {
        if (/\bobi(200|202|300|302)\b/i.test(u)) return 'ATA SIP Account';
        if (/\bobi(1062|2182)\b/i.test(u)) return 'Deskphone';
    }

    if (u.includes('akuvox')) return 'Door Bell';
    if (/\b2n\b/i.test(u)) return 'Door Bell';
    if (u.includes('cyberdata')) return 'Door Bell';
    if (u.includes('axis')) return 'Pager';
    if (u.includes('valcom') || u.includes('algo')) return 'Pager';
    if (u.includes('reachuc')) return 'Smartphone App';
    if (u.includes('connectuc')) {
        if (u.includes('mobile')) return 'Smartphone App';
        if (u.includes('web')) return 'Desktop Softphone';
    }
    if (u.includes('zoiper') || u.includes('microsip')) return 'Desktop Softphone';
    if (u.includes('sipaua')) return 'Smartphone App';
    if (u.startsWith('sip:') || u.includes('sip uri')) return 'SIP URI';

    return null;
}

function uaFamily(uaRaw) {
    return deviceDBFamily(uaRaw) || uaFamilyFallback(uaRaw);
}

/* ---------------------- 5) Name keywords (narrow ONLY) ----------------------- */
const NAME_FULL_WORDS = {
    "2n": "Door Bell",
    "bria": "Desktop Softphone",
    "db": "Door Bell",
    "pa2": "Pager",
    "koonloon": "ATA SIP Account (Public Phone / Resident Phone)",
    "horn": "Pager",
    "app": "Smartphone App",
    "fpbx": "SIP Trunk",
    "freepbx": "SIP Trunk"
};
const NAME_SUBSTRINGS = {
    // Door bells
    "door": "Door Bell",
    "doorbell": "Door Bell",
    "inside": "Door Bell",
    "outside": "Door Bell",
    "intercom": "Door Bell",
    "entrance": "Door Bell",
    "doorphone": "Door Bell",
    "downstairs": "Door Bell",
    "upstairs": "Door Bell",
    "akuvox": "Door Bell",
    "gds3710": "Door Bell",
    "control4": "Door Bell",
    "r20a": "Door Bell",
    "r20k": "Door Bell",
    "r20v": "Door Bell",
    "r26c": "Door Bell",
    "e12w": "Door Bell",
    "i10": "Door Bell",
    "i10sd": "Door Bell",
    "i10v": "Door Bell",
    "i12": "Door Bell",
    "i20s": "Door Bell",
    "i20t": "Door Bell",
    "i23": "Door Bell",
    "i23s": "Door Bell",
    "i30": "Door Bell",
    "i31s": "Door Bell",

    // Pagers
    "page": "Pager",
    "speaker": "Pager",
    "amplifier": "Pager",
    "algo": "Pager",
    "gsc3505": "Pager",
    "gsc3510": "Pager",
    "pa2": "Pager",
    "pa2s": "Pager",
    "8301": "Pager",

    // Desktop softphone
    "zoiper": "Desktop Softphone",
    "microsip": "Desktop Softphone",
    "connect web": "Desktop Softphone",
    "connect desktop": "Desktop Softphone",
    "comm.io": "Desktop Softphone",
    "softphone": "Desktop Softphone",
    "client.webrtc": "Desktop Softphone",
    "dimensions.ucd.uwp": "Desktop Softphone",

    // Smartphone app
    "reachuc": "Smartphone App",
    "acrobits": "Smartphone App",
    "groundwire": "Smartphone App",
    "connect mobile": "Smartphone App",
    "mobile": "Smartphone App",
    "smartphone": "Smartphone App",
    "cloudsoftphone": "Smartphone App",

    // ATA keywords
    "ht801": "ATA SIP Account (Analog Telephone)",
    "ht802": "ATA SIP Account (Analog Telephone)",
    "ht813": "ATA SIP Account (Analog Telephone)",
    "ht814": "ATA SIP Account (Public Phone / Resident Phone)",
    "ht818": "ATA SIP Account (Public Phone / Resident Phone)",
    "gxw4216": "ATA SIP Account (Public Phone / Resident Phone)",
    "gxw4224": "ATA SIP Account (Public Phone / Resident Phone)",
    "gxw4248": "ATA SIP Account (Public Phone / Resident Phone)",
    "gxw4248v2": "ATA SIP Account (Public Phone / Resident Phone)",
    "spa112": "ATA SIP Account (Analog Telephone)",
    "pap2t": "ATA SIP Account (Analog Telephone)",
    "patton": "ATA SIP Account (Analog Telephone)",
    "adapter": "ATA SIP Account (Analog Telephone)",
    "cordless": "ATA SIP Account (Analog Telephone)",
    "public": "ATA SIP Account (Public Phone / Resident Phone)",
    "resident": "ATA SIP Account (Public Phone / Resident Phone)",
    "elevator": "ATA SIP Account (Doorbell / Pager / Elevator Line)",

    // Trunks
    "fpbx": "SIP Trunk",
    "freepbx": "SIP Trunk"
};

function nameHint(nameRaw) {
    const nm = lc(nameRaw);
    if (!nm) return null;
    const padded = ` ${nm} `;
    if (padded.includes(' pa ')) return 'Pager';
    for (const [word, prod] of Object.entries(NAME_FULL_WORDS)) {
        if (hasFullWord(nm, word)) return prod;
    }
    for (const [key, prod] of Object.entries(NAME_SUBSTRINGS)) {
        if (nm.includes(key)) return prod;
    }
    return null;
}

/* -------------------- 6) Narrowing (remove-not-fit pipeline) ------------------ */
function narrowCandidates({ platform, device_type, ua, mac, line, device_name }) {
    const plat = lc(platform);
    const dtype = lc(device_type);
    const uastr = N(ua);
    const ln = toIntOr(line, 1);
    const macOk = validMac(mac);

    // SkySwitch: empty UA => not billed
    if (plat === 'skyswitch' && !uastr) {
        return { candidates: [], basis: 'platform:SkySwitch | ua:empty' };
    }

    // Cellphone/Landline: short-circuit ALWAYS (ignore UA)
    if (dtype === 'cellphone' || dtype === 'landline') {
        return { candidates: ['Cellphone Routing Device'], basis: `type:${dtype}` };
    }

    // SIP URI: short-circuit
    if (dtype === 'sip_uri') {
        return { candidates: ['SIP URI'], basis: 'type:sip_uri' };
    }

    // Begin with EVERYTHING
    let candidates = new Set(ALL_PRODUCTS);
    const basis = [`type:${dtype || 'unknown'}`, `mac:${macOk}`, `line:${ln}`];

    // UA -> FAMILY narrows families only
    const fam = uaFamily(uastr);
    if (fam === 'Door Bell') {
        candidates = new Set(['Door Bell']);
        basis.push('ua:Door Bell');
    } else if (fam === 'Pager') {
        candidates = new Set(['Pager']);
        basis.push('ua:Pager');
    } else if (fam === 'SIP URI') {
        candidates = new Set(['SIP URI']);
        basis.push('ua:SIP URI');
    } else if (fam === 'SIP Trunk') {
        candidates = new Set(['SIP Trunk']);
        basis.push('ua:SIP Trunk');
    } else if (fam === 'Deskphone') {
        candidates = new Set([...candidates].filter(x => DESK_VARIANTS.includes(x)));
        basis.push('ua:Deskphone');
    } else if (fam === 'ATA SIP Account') {
        candidates = new Set([...candidates].filter(x => ATA_VARIANTS.includes(x)));
        basis.push('ua:ATA');
    } else if (fam === 'Desktop Softphone') {
        candidates = new Set([...candidates].filter(x => SOFT_VARIANTS.includes(x)));
        basis.push('ua:Desktop Softphone');
    } else if (fam === 'Smartphone App') {
        candidates = new Set([...candidates].filter(x => SMART_VARIANTS.includes(x)));
        basis.push('ua:Smartphone App');
    } else {
        basis.push('ua:None');
    }

    // Deskphone refinement — remove only impossible ones
    const isDeskSet = [...candidates].every(x => DESK_VARIANTS.includes(x)) && candidates.size > 0;
    if (isDeskSet) {
        if (ln > 1) {
            // Only Additional if multi-line
            candidates = new Set(['Deskphone Additional SIP Account']);
            basis.push('desk:line>1 -> only Additional');
        } else if (macOk) {
            // MAC present + line=1 => keep Provisioned + Clone; remove Manual, Additional, SIP-Creds
            candidates.delete('Manual Deskphone');
            candidates.delete('Deskphone Additional SIP Account');
            candidates.delete('SIP Credentials for External Device');
            basis.push('desk:mac=True line=1 -> drop Manual/Additional/SIP-Creds');
        } else {
            // No MAC + line=1 => keep Manual + Clone + SIP-Creds; remove Provisioned, Additional
            candidates.delete('Provisioned Deskphone');
            candidates.delete('Deskphone Additional SIP Account');
            basis.push('desk:mac=False line=1 -> drop Provisioned/Additional');
        }
    }

    // Name can only narrow within current options; never override UA family
    if (candidates.size > 1) {
        const hint = nameHint(device_name);
        if (hint && candidates.has(hint)) {
            candidates = new Set([hint]);
            basis.push(`name:${device_name || ''} -> ${hint}`);
        }
    }

    return { candidates: [...candidates], basis: basis.join(' | ') };
}

/* ------------------------------------------------------------- */
// Helper to get params from req (GET query or POST body)
function getParams(req) {
  // accept both query (GET) and body (POST JSON or x-www-form-urlencoded)
  const src = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  return {
    platform: (src.platform ?? '').toString(),
    device_type: (src.device_type ?? '').toString(),
    ua: (src.ua ?? '').toString(),
    mac: (src.mac ?? '').toString(),
    line: (src.line ?? '').toString(),
    device_name: (src.device_name ?? '').toString()
  };
}


/* -------------------------------- 7) API endpoint ------------------------------ */
/**
 * GET /identify
 * Query:
 *   platform     = kazoo | skyswitch        (required for billing code mapping)
 *   device_type  = sip_device | ata | smartphone | softphone | cellphone | landline | meta | application | fax | sip_uri | desktop
 *   ua           = user agent string
 *   mac          = MAC address
 *   line         = line number (default 1)
 *   device_name  = friendly name
 *
 * Response: 200
 * {
 *   platform: "kazoo" | "skyswitch",
 *   family: "Deskphone" | "Desktop Softphone" | "Smartphone App" | "ATA SIP Account" | "Door Bell" | "Pager" | "SIP URI" | "SIP Trunk" | null,
 *   candidates: [ { product: "<Product>", code: "<KZ/SS code or ''>" }, ... ],
 *   basis: "trace of decisions"
 * }
 */
app.all('/identify', (req, res) => {
  try {
    const { platform, device_type, ua, mac, line, device_name } = getParams(req);
    const plat = lc(platform || 'kazoo');
    const { candidates, basis } = narrowCandidates({
      platform: plat, device_type, ua, mac, line, device_name
    });
    const fam = uaFamily(ua);
    const codeMap = (plat === 'skyswitch') ? BILLING.skyswitch : BILLING.kazoo;
    const out = candidates.map(product => ({ product, code: codeMap[product] || "" }));
    res.json({ platform: plat, family: fam, candidates: out, basis });
  } catch (e) {
    res.status(500).json({ error: 'Internal Server Error', details: String(e?.message || e) });
  }
});

/* health */
app.get('/health', (req, res) => res.send('ok'));

app.listen(PORT, () => console.log(`Device API listening on :${PORT}`));
