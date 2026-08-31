#!/usr/bin/env node
/**
 * ImkereiApp - Telegram-Nachfrage fuer ueberfaellige Aufgaben.
 *
 * Laeuft als GitHub Action. Liest data.json (vom App-Sync geschrieben),
 * filtert offene Aufgaben mit Prioritaet 'hoch', die laenger als ihre
 * individuelle Schwelle t ueberfaellig sind, und schickt EINE gebuendelte
 * Nachricht an Telegram.
 *
 * Bewusst ohne "Erledigt"-Button: die App liest data.json nie zurueck,
 * ein Rueckkanal wuerde beim naechsten App-Push ueberschrieben.
 *
 * ENV: TG_TOKEN, TG_CHAT, optional DATA_FILE, NACHFRAGE_STD, DRY_RUN, FORCE
 */
const fs = require('fs');

const TZ = 'Europe/Zurich';
const SENDESTUNDE = 8;
const ESKALATION_TAEGLICH_AB = 14;   // Tage ueberfaellig -> ab hier jeden Tag
const NACHFRAGE_DEFAULT = {
  'Schwarm': 1, 'Behandlung': 2, 'Futter': 3, 'Sonstige': 3, 'Kontrolle': 5, 'Ernte': 7,
};
const MONATE = ['Januar','Februar','Maerz','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

const lokal = (opts) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, ...opts });
const heute = () => lokal({ year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
const stunde = () => parseInt(lokal({ hour:'2-digit', hour12:false }).format(new Date()), 10);

function faelligAb(a) {
  if (a.typ === 'saison') {
    const j = a.jahr || new Date(heute()).getFullYear();
    return `${j}-${String(a.monat || 1).padStart(2, '0')}-01`;
  }
  return a.datum || null;
}

function tageUeberfaellig(a, ref) {
  const f = faelligAb(a);
  if (!f) return -1;
  return Math.floor((new Date(ref) - new Date(f)) / 86400000);
}

function schwelle(a, std) {
  if (a.nachfrageTage > 0) return a.nachfrageTage;
  if (std > 0) return std;
  return NACHFRAGE_DEFAULT[a.kategorie] || 3;
}

/**
 * Eskalation: erste Nachfrage bei t Tagen, danach jeden zweiten Tag,
 * ab ESKALATION_TAEGLICH_AB Tagen ueberfaellig jeden Tag.
 */
function heuteFaellig(a, ref, std) {
  if (a.erledigt) return false;
  if (a.prioritaet !== 'hoch') return false;
  const d = tageUeberfaellig(a, ref);
  if (d < 0) return false;
  const seitErster = d - schwelle(a, std);
  if (seitErster < 0) return false;
  if (d >= ESKALATION_TAEGLICH_AB) return true;
  return seitErster % 2 === 0;
}

function baueNachricht(treffer, voelker, ref, datenAlterTage) {
  const volkName = id => (voelker.find(v => v.id === id) || {}).name;
  const n = treffer.length;
  const zeilen = [`\u{1F41D} ${n} überfällige Aufgabe${n > 1 ? 'n' : ''}`, ''];
  treffer
    .sort((a, b) => tageUeberfaellig(b, ref) - tageUeberfaellig(a, ref))
    .forEach(a => {
      const d = tageUeberfaellig(a, ref);
      const volk = a.volkId ? volkName(a.volkId) : null;
      const wann = a.typ === 'saison' ? MONATE[(a.monat || 1) - 1] : a.datum;
      zeilen.push(`• ${a.titel} — ${d} Tage (${wann}${volk ? ', ' + volk : ''})`);
    });
  zeilen.push('', 'In der App abhaken.');
  if (datenAlterTage > 3) {
    zeilen.push('', `⚠️ Datenstand ist ${datenAlterTage} Tage alt — App öffnen, damit sie synct.`);
  }
  return zeilen.join('\n');
}

async function sende(text) {
  const token = process.env.TG_TOKEN, chat = process.env.TG_CHAT;
  if (!token || !chat) throw new Error('TG_TOKEN oder TG_CHAT fehlt');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_notification: false }),
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function main() {
  const force = process.env.FORCE === '1';
  if (!force && stunde() !== SENDESTUNDE) {
    console.log(`Nicht ${SENDESTUNDE} Uhr in Zuerich (aktuell ${stunde()}) - dieser Lauf sendet nicht.`);
    return;
  }
  const datei = process.env.DATA_FILE || 'data.json';
  if (!fs.existsSync(datei)) { console.log(`${datei} fehlt - nichts zu tun.`); return; }
  const daten = JSON.parse(fs.readFileSync(datei, 'utf8'));
  const ref = heute();
  const std = parseInt(process.env.NACHFRAGE_STD, 10);
  const aufgaben = daten.aufgaben || [];
  const treffer = aufgaben.filter(a => heuteFaellig(a, ref, std));

  const alter = daten.lastSync
    ? Math.floor((new Date(ref) - new Date(daten.lastSync.slice(0, 10))) / 86400000) : 0;

  console.log(`${aufgaben.length} Aufgaben, ${treffer.length} Nachfragen, Datenstand ${alter} Tage alt`);
  if (!treffer.length) return;

  const text = baueNachricht(treffer, daten.voelker || [], ref, alter);
  if (process.env.DRY_RUN === 'true') { console.log('--- DRY RUN ---\n' + text); return; }
  await sende(text);
  console.log('Nachricht gesendet.');
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { faelligAb, tageUeberfaellig, schwelle, heuteFaellig, baueNachricht };
