const express = require('express');
const { protect } = require('../middleware/auth');
const { sendTelegramMessage, sendTelegramPhoto, sendTelegramVideo } = require('../utils/telegram');
const router = express.Router();
router.use(protect);

router.post('/complaint', async (req, res) => {
  try {
    const { text, mediaBase64, mediaType, fileName } = req.body;
    const user = req.user;
    const msg = `COMPLAINT RECEIVED\n\nFrom: ${user.name}\nEmail: ${user.email}\nPhone: ${user.phone||'N/A'}\n\nComplaint:\n${text}`;
    await sendTelegramMessage(msg);
    if (mediaBase64 && mediaType) {
      if (mediaType.startsWith('image')) await sendTelegramPhoto(mediaBase64, `Complaint image from ${user.name}`);
      else if (mediaType.startsWith('video')) await sendTelegramVideo(mediaBase64, `Complaint video from ${user.name}`);
    }
    res.json({ message: 'Complaint submitted. We will review it within 24 hours.' });
  } catch(err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to submit complaint.' });
  }
});

router.post('/suggestion', async (req, res) => {
  try {
    const { text, mediaBase64, mediaType } = req.body;
    const user = req.user;
    const msg = `SUGGESTION RECEIVED\n\nFrom: ${user.name}\nEmail: ${user.email}\n\nSuggestion:\n${text}`;
    await sendTelegramMessage(msg);
    if (mediaBase64 && mediaType) {
      if (mediaType.startsWith('image')) await sendTelegramPhoto(mediaBase64, `Suggestion from ${user.name}`);
      else if (mediaType.startsWith('video')) await sendTelegramVideo(mediaBase64, `Suggestion video from ${user.name}`);
    }
    res.json({ message: 'Suggestion received. Thank you!' });
  } catch(err) {
    res.status(500).json({ message: 'Failed to submit suggestion.' });
  }
});

router.post('/health-report', async (req, res) => {
  try {
    const { data, confirmed } = req.body;
    const user = req.user;
    const bmi = (data.weight / ((data.height/100) ** 2)).toFixed(1);
    let bmiCategory = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';

    const recommendations = generateRecommendations(data, bmi);

    const report = `HEALTH REPORT${confirmed ? ' [CONFIRMED - APPLY TO MEALS]' : ' [PREVIEW]'}\n\n` +
      `Customer: ${user.name}\nEmail: ${user.email}\nPhone: ${user.phone||'N/A'}\n\n` +
      `=== BODY MEASUREMENTS ===\nHeight: ${data.height} cm\nWeight: ${data.weight} kg\nAge: ${data.age}\nGender: ${data.gender}\nBMI: ${bmi} (${bmiCategory})\n\n` +
      `=== HEALTH CONDITIONS ===\nDiabetes: ${data.diabetes}\nBlood Pressure: ${data.bloodPressure}\nEye Problems: ${data.eyeProblems}\nVitamin Deficiency: ${data.vitamins.join(', ')||'None'}\nCholesterol: ${data.cholesterol}\nThyroid: ${data.thyroid}\nAllergies: ${data.allergies||'None'}\n\n` +
      `=== LIFESTYLE ===\nActivity Level: ${data.activity}\nSpice Preference: ${data.spice}\nOil Preference: ${data.oil}\nSalt Preference: ${data.salt}\nMeal Type: ${data.mealPreference}\n\n` +
      `=== RECOMMENDED MEAL ADJUSTMENTS ===\n${recommendations.join('\n')}`;

    await sendTelegramMessage(report);
    res.json({ bmi, bmiCategory, recommendations, message: confirmed ? 'Report confirmed and sent to kitchen.' : 'Report preview generated.' });
  } catch(err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to process health report.' });
  }
});

function generateRecommendations(data, bmi) {
  const recs = [];
  const bmiNum = parseFloat(bmi);

  if (bmiNum > 25) {
    recs.push('Less rice — replace with more roti (oil-free)');
    recs.push('Add: Raw salad with carrots, lettuce, cucumber, beetroot daily');
    recs.push('Smaller portions of dal, larger portions of sabzi');
    recs.push('No fried items — use baked/steamed alternatives');
  }
  if (bmiNum < 18.5) {
    recs.push('Extra roti with ghee (if no cholesterol issues)');
    recs.push('Add: Banana, dry fruits, milk-based dishes');
    recs.push('Double portion of dal/protein');
  }
  if (data.diabetes === 'Type 2' || data.diabetes === 'Pre-diabetic') {
    recs.push('No sugar in any dish');
    recs.push('Less rice — max 1 small katori');
    recs.push('Add: Karela (bitter gourd) sabzi twice a week');
    recs.push('Add: Methi (fenugreek) roti instead of plain roti');
    recs.push('No potatoes in sabzi');
  }
  if (data.bloodPressure === 'High') {
    recs.push('Very less salt in all dishes');
    recs.push('Add: Lauki (bottle gourd) sabzi — BP reducing');
    recs.push('No pickle, no papad');
    recs.push('Add: Garlic (if not Satvik) in cooking');
  }
  if (data.bloodPressure === 'Low') {
    recs.push('Slightly more salt than normal');
    recs.push('Add: Nimbu pani (lemon water) with meals');
  }
  if (data.vitamins.includes('Vitamin B12')) {
    recs.push('Add: Paneer or milk-based item daily');
    recs.push('Add: Curd/raita with every meal');
  }
  if (data.vitamins.includes('Vitamin D')) {
    recs.push('Add: Mushroom sabzi twice a week');
    recs.push('Add: Fortified milk in evening meal');
  }
  if (data.vitamins.includes('Iron / Anaemia')) {
    recs.push('Add: Palak (spinach) sabzi 3x/week');
    recs.push('Add: Beetroot salad daily');
    recs.push('Add: Chana/rajma for iron-rich protein');
    recs.push('Nimbu squeeze on dal for iron absorption');
  }
  if (data.vitamins.includes('Vitamin C')) {
    recs.push('Add: Raw tomato and lemon with every meal');
    recs.push('Add: Amla chutney option');
  }
  if (data.eyeProblems === 'Yes') {
    recs.push('Add: Carrot sabzi or raw carrot daily (Vitamin A)');
    recs.push('Add: Spinach — lutein for eye health');
    recs.push('Add: Sweet potato once a week');
  }
  if (data.cholesterol === 'High') {
    recs.push('Zero ghee or butter in cooking');
    recs.push('Add: Oats khichdi option for breakfast');
    recs.push('No fried items whatsoever');
    recs.push('Add: Flaxseed sprinkled on dal');
  }
  if (data.thyroid === 'Hypothyroid') {
    recs.push('Avoid raw cabbage and cauliflower');
    recs.push('Add: Selenium-rich items — sunflower seeds on salad');
  }
  if (data.oil === 'Less') recs.push('All sabzi cooked in minimum oil (1 tsp max)');
  if (data.salt === 'Less') recs.push('Salt reduced by 50% across all dishes');
  if (data.spice === 'Mild') recs.push('Minimal chilli — use only mild spices');
  if (data.activity === 'Very Active') recs.push('Extra roti + larger protein portion');

  if (!recs.length) recs.push('Standard balanced meal — no special adjustments needed');
  return recs;
}

module.exports = router;
