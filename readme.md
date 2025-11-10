# Devices User-Agent API — Quick Guide

Your API is live at **https://ua.theteklink.com**.

---

## Endpoints

### 1) Health
- **GET** `/health` → returns `ok` (HTTP 200) when the app is up.

### 2) Identify
- **GET** `/identify`
- **POST** `/identify` (JSON or `application/x-www-form-urlencoded`)

#### Request Parameters

| Field          | Type   | Required | Notes |
|----------------|--------|----------|------|
| `platform`     | string | ✅       | `kazoo` \| `skyswitch` (selects billing code set) |
| `device_type`  | string | –        | `sip_device` \| `ata` \| `smartphone` \| `softphone` \| `cellphone` \| `landline` \| `meta` \| `application` \| `fax` \| `sip_uri` \| `desktop` |
| `ua`           | string | –        | Raw User-Agent |
| `mac`          | string | –        | Any format; validated down to 12 hex characters |
| `line`         | number | –        | SIP line number (default `1`) |
| `device_name`  | string | –        | Friendly name; can narrow options but never overrides UA family |

> Empty or missing params are treated as empty strings (except `line` which defaults to `1`).

#### Response (200)

```json
{
  "platform": "kazoo",
  "family": "Deskphone | Desktop Softphone | Smartphone App | ATA SIP Account | Door Bell | Pager | SIP URI | SIP Trunk | null",
  "candidates": [
    { "product": "Provisioned Deskphone", "code": "KZ1004" }
  ],
  "basis": "trace of decisions"
}
```

- `family` — detected device family based on UA (or `null`).
- `candidates[]` — one or more product candidates; each includes the platform-specific **billing code**.
- `basis` — human-readable decision trace (great for debugging).

---

## Key Behaviors

- **SkySwitch + empty UA** → `candidates: []` (not billable on SS without UA).
- **`device_type = cellphone | landline`** → short-circuit to `["Cellphone Routing Device"]` (ignores UA).
- **`device_type = sip_uri`** → short-circuit to `["SIP URI"]`.
- **UA contains `fpbx`/`freepbx`** → `family = "SIP Trunk"`, candidates = `["SIP Trunk"]`.

### Deskphone Refinement (remove only impossibles)
- `line > 1` → only **Deskphone Additional SIP Account**.
- `line == 1` **and** valid `mac` → keep **Provisioned Deskphone** + **Clone Deskphone**; drop **Manual**, **Additional**, **SIP Credentials**.
- `line == 1` **and** no valid `mac` → keep **Manual Deskphone** + **Clone Deskphone** + **SIP Credentials**; drop **Provisioned**, **Additional**.
- `device_name` can **narrow within current candidates** but never override UA family.

---

## Examples

### GET (simple)

```bash
curl -sS "https://ua.theteklink.com/identify?platform=kazoo&ua=Yealink%20SIP-T46S&mac=00:11:22:33:44:55&line=1"
```

### POST (JSON)

```bash
curl -sS -X POST https://ua.theteklink.com/identify \
  -H 'Content-Type: application/json' \
  -d '{
    "platform": "skyswitch",
    "device_type": "softphone",
    "ua": "Bria Android 6.15.2",
    "line": 1,
    "device_name": "Sales Mobile"
  }'
```

### POST (form-URL-encoded)

```bash
curl -sS -X POST https://ua.theteklink.com/identify \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "platform=kazoo" \
  --data-urlencode "ua=Grandstream GXP2135" \
  --data-urlencode "mac=AA-BB-CC-DD-EE-FF" \
  --data-urlencode "line=2"
```

### SkySwitch “empty UA” (expect empty candidates)

```bash
curl -sS "https://ua.theteklink.com/identify?platform=skyswitch&ua="
```

### SIP URI short-circuit

```bash
curl -sS "https://ua.theteklink.com/identify?platform=kazoo&device_type=sip_uri"
```

---

## HTTP Status Codes

- `200` — Success (inspect `candidates` & `basis`; `candidates` may be empty).
- `400` — Malformed request (e.g., invalid JSON).
- `500` — Unexpected server error (check PM2/NGINX logs).

---

## Operational Notes

- **Health check:** `GET /health`
- **Rolling reload after code update:**

```bash
sudo -u teklink -H bash -lc '
  cd /opt/teklink/app &&
  git pull &&
  npm ci || npm i --production &&
  pm2 reload ua-api --time &&
  pm2 save
'
```

- **Logs:**

```bash
sudo -u teklink -H pm2 logs ua-api
sudo tail -n 200 /var/log/nginx/access.log
sudo tail -n 200 /var/log/nginx/error.log
```

---

## Client Guidance (optional)

- **Timeouts:** 2–5s per request.
- **Retries:** Exponential backoff + jitter.
- **Nightly bulk checks:** Throttle/batch (e.g., ≤ 20 RPS) on the $7 plan.
- **Caching:** Short-term cache by `(platform, ua tokens, mac-present?, line, device_name-hint)` to reduce repeats.

---

## Common Product Values (reference)

- **Deskphone:** Provisioned Deskphone · Manual Deskphone · Clone Deskphone · Deskphone Additional SIP Account · SIP Credentials for External Device  
- **Softphone:** Desktop Softphone User · Desktop Softphone (User’s Additional Device)  
- **Smartphone:** Smartphone App User · Smartphone App (User’s Additional Device)  
- **ATA:** ATA SIP Account (Analog Telephone) · ATA SIP Account (Doorbell / Pager / Elevator Line) · ATA SIP Account (Public Phone / Resident Phone)  
- **Other:** Door Bell · Pager · SIP URI · SIP Trunk · Cellphone Routing Device

Each maps to the platform-specific billing code in `candidates[].code`.

