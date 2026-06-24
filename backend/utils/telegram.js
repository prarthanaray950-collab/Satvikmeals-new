const axios = require('axios');

const BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CHAT  = () => process.env.TELEGRAM_CHAT_ID;

const sendTelegramMessage = async (text) => {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN || !CHAT()) return;
    await axios.post(`${BASE()}/sendMessage`, { chat_id: CHAT(), text: `[SatvikMeals]\n\n${text}` });
  } catch(e) { console.log('Telegram msg failed:', e.message); }
};

const sendTelegramPhoto = async (base64, caption) => {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN || !CHAT()) return;
    const FormData = require('form-data');
    const form = new FormData();
    form.append('chat_id', CHAT());
    form.append('caption', caption);
    form.append('photo', Buffer.from(base64, 'base64'), { filename: 'photo.jpg' });
    await axios.post(`${BASE()}/sendPhoto`, form, { headers: form.getHeaders() });
  } catch(e) { console.log('Telegram photo failed:', e.message); }
};

const sendTelegramVideo = async (base64, caption) => {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN || !CHAT()) return;
    const FormData = require('form-data');
    const form = new FormData();
    form.append('chat_id', CHAT());
    form.append('caption', caption);
    form.append('video', Buffer.from(base64, 'base64'), { filename: 'video.mp4' });
    await axios.post(`${BASE()}/sendVideo`, form, { headers: form.getHeaders() });
  } catch(e) { console.log('Telegram video failed:', e.message); }
};

module.exports = { sendTelegramMessage, sendTelegramPhoto, sendTelegramVideo };
