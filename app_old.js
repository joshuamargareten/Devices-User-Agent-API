const express = require('express');
const app = express();
const port = 3000;

// Sample database of user-agent prefixes
const deviceDB = {
    "2n": "Door Bell",
    "3cxphone": "Desktop Softphone",
    "acrobits": "Smartphone App",
    "akcloudunion": "Door Bell",
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
        "spa303": "Deskphone",
        "spa504g": "Deskphone",
        "spa508g": "Deskphone",
        "spa525g2": "Deskphone",
        "spa525": "Deskphone",
        "spa8800": "ATA SIP Account"
    },
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
        "i10sd": "Door Bell",
        "i10v": "Door Bell",
        "i12": "Door Bell",
        "i20s": "Door Bell",
        "i20t": "Door Bell",
        "i23": "Door Bell",
        "i23s": "Door Bell",
        "i30": "Door Bell",
        "i31s": "Door Bell",
        "pa2": "Pager",
        "pa2s": "Pager",
        "x2": "Deskphone",
        "x6u": "Deskphone"
    },
    "grandstream": {
        "gds3710": "Door Bell",
        "grp2602p": "Deskphone",
        "grp2615": "Deskphone",
        "gsc3505": "Pager",
        "gsc3510": "Pager",
        "gxp1610": "Deskphone",
        "gxp1625": "Deskphone",
        "gxp2130": "Deskphone",
        "gxp2135": "Deskphone",
        "gxp2140": "Deskphone",
        "gxp2160": "Deskphone",
        "gxp2170": "Deskphone",
        "gxv3370": "Deskphone",
        "gxw4216": "Deskphone",
        "gxw4224": "Deskphone",
        "gxw4248": "Deskphone",
        "gxw4248v2": "Deskphone",
        "ht801": "ATA SIP Account",
        "ht802": "ATA SIP Account",
        "ht813": "ATA SIP Account",
        "ht814": "ATA SIP Account",
        "ht818": "ATA SIP Account",
        "wp820": "Deskphone",
        "wp825": "Deskphone"
    },
    "linksys": {
        "pap2t": "ATA SIP Account",
        "spa942": "Deskphone"
    },
    "microsip": "Desktop Softphone",
    "obihai": {
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
    "sipaua": "Smartphone App",
    "skyswitch": "Smartphone App",
    "snompa1": "Pager",
    "ucsip": {
        "r8.44.2236": {
            "iver60.65dbg": "Pager"
        }
    },
    "valcom": "Pager",
    "voip": {
        "door": {
            "phone": "Door Bell"
        }
    },
    "yealink": "Deskphone",
    "zoiper": "Desktop Softphone"
};

app.get('/identify', (req, res) => {
    try {
        const userAgent = decodeURIComponent(req.query.ua || '').trim();
        const mac = decodeURIComponent(req.query.mac || '').trim();
        const line = decodeURIComponent(req.query.line || '').trim();
        if (!userAgent) {
            return res.status(400).json({ error: "User-Agent is required" });
        }

        // Tokenize user-agent and find the best match
        const tokens = userAgent.toLowerCase().split(/[^a-zA-Z\d.:]+/mg);
        if (!tokens.length) {
            return res.status(400).json({ error: "Invalid User-Agent format" });
        }

        let match = deviceDB[tokens[0]] || null;

        // Iterate through tokenized words to match nested objects
        for (let i = 1; match && typeof match === 'object' && i < tokens.length; i++) {
            match = match[tokens[i]] || null;
        }

        if (mac && match === 'Deskphone') {
            match = `Provisioned ${match}`
        }

        if (Number(line) > 1 && match === 'Deskphone') {
            match = `Additional SIP Account ${match}`
        }

        if (match && typeof match !== 'object') {
            return res.json({ product_code: match });
        } else {
            return res.status(404).json({ error: "Device not found" });
        }
    } catch (error) {
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
