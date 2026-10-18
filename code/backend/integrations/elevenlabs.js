// Speech-to-text (Scribe) and text-to-speech with ElevenLabs.
//
// POST https://api.elevenlabs.io/v1/speech-to-text            (multipart: model_id + file)
// POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id} (JSON: text + model_id) -> mp3
// both with `xi-api-key: <ELEVENLABS_API_KEY>`. Only ever receives the recording
// and short confirmations, never budgets.

const API_URL = 'https://api.elevenlabs.io/v1';
const STT_URL = `${API_URL}/speech-to-text`;
const STT_MODEL = 'scribe_v2';
const TTS_MODEL = 'eleven_v4_turbo'; // low latency, made for real-time replies
// Any voice from your ElevenLabs voice library; this default is the one from their docs.
const VOICE_ID = () => process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';

/**
 * @param {Buffer} audio     the recording
 * @param {string} mimeType  e.g. 'audio/webm' (Chrome) or 'audio/mp4' (Safari)
 * @returns {Promise<string|null>} what was said, or null if it couldn't be transcribed
 */
async function transcribe(audio, mimeType, { fetchImpl = fetch } = {}) {
  if (!process.env.ELEVENLABS_API_KEY) return null;
  const form = new FormData();
  form.append('model_id', STT_MODEL);
  form.append('tag_audio_events', 'false'); // no "(laughter)" in the transcript
  form.append('file', new Blob([audio], { type: mimeType }), 'expense');
  try {
    const res = await fetchImpl(STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
      body: form,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const body = await res.json();
    return typeof body.text === 'string' && body.text.trim() ? body.text.trim() : null;
  } catch (err) {
    console.error('elevenlabs transcribe failed:', err.message);
    return null;
  }
}

/**
 * @param {string} text  a short sentence to read out
 * @returns {Promise<Buffer|null>} mp3 audio, or null if it couldn't be made
 */
async function speak(text, { fetchImpl = fetch } = {}) {
  if (!process.env.ELEVENLABS_API_KEY || !text) return null;
  try {
    const res = await fetchImpl(`${API_URL}/text-to-speech/${VOICE_ID()}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: TTS_MODEL }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error('elevenlabs speak failed:', err.message);
    return null;
  }
}

module.exports = { transcribe, speak };
