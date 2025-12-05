const express = require('express');
const { makeWASocket, useMultiFileAuthState, delay, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.static('public'));
app.use(express.json());

// Ensure sessions folder exists
if (!fs.existsSync('./sessions')) fs.mkdirSync('./sessions');

// --- 1. PAIRING CODE ROUTE ---
app.get('/pair', async (req, res) => {
    const phoneNumber = req.query.number;
    if (!phoneNumber) return res.json({ error: "Number is required" });

    // Create unique session ID
    const id = "pair_" + Date.now();
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${id}`);
    const { version } = await fetchLatestBaileysVersion();

    try {
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            version
        });

        sock.ev.on('creds.update', saveCreds);

        // Wait for socket to be ready
        await delay(1500);

        if (!sock.authState.creds.registered) {
            await delay(1000); 
            const code = await sock.requestPairingCode(phoneNumber);
            const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
            
            res.json({ status: true, code: formattedCode });
            
            // Clean up session after 2 minutes
            setTimeout(() => { 
                sock.end(undefined);
                fs.rmSync(`./sessions/${id}`, { recursive: true, force: true });
            }, 120000);
        } else {
            res.json({ error: "Already registered" });
        }

    } catch (err) {
        console.error(err);
        res.json({ error: "Connection Failed. Check number format." });
    }
});

// --- 2. QR CODE ROUTE ---
app.get('/qr', async (req, res) => {
    const id = "qr_" + Date.now();
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${id}`);
    const { version } = await fetchLatestBaileysVersion();

    try {
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            browser: ["Ultralight Web", "Chrome", "1.0.0"],
            version
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { qr } = update;
            if (qr) {
                const url = await QRCode.toDataURL(qr);
                
                // Only send response if we haven't already
                if (!res.headersSent) res.json({ status: true, qr_img: url });
                
                sock.ev.removeAllListeners('connection.update');
                
                // Clean up session after 1 minute
                setTimeout(() => { 
                    sock.end(undefined);
                    fs.rmSync(`./sessions/${id}`, { recursive: true, force: true });
                }, 60000);
            }
        });

    } catch (err) {
        if (!res.headersSent) res.json({ error: "QR Generation Failed" });
    }
});

app.listen(PORT, () => {
    console.log(`🌐 Server running on Port ${PORT}`);
});

