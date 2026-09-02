require('dotenv').config();
const { Client } = require('pg');
const fetch = require('node-fetch');

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  const res = await client.query('SELECT value FROM settings WHERE key = $1', ['gemini_api_key']);
  const rawApiKey = res.rows[0].value;
  const key = rawApiKey.split(',')[0].trim();
  
  console.log('Testing gemini-flash-lite-latest...');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${key}`;
  const payload = {
    contents: [{ parts: [{ text: 'Hola, dame un JSON simple con la clave "mensaje" y valor "ping"' }] }],
    generationConfig: { responseMimeType: 'application/json' }
  };
  
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await r.json();
  console.log(JSON.stringify(data, null, 2));
  
  await client.end();
}

main();
