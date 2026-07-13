export const NOTE_NAMES = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];

export function frequencyToMidi(frequency) {
  return frequency > 0 ? 69 + 12 * Math.log2(frequency / 440) : null;
}

export function midiToNote(midi) {
  const rounded = Math.round(midi);
  return { midi: rounded, pitchClass: ((rounded % 12) + 12) % 12, name: NOTE_NAMES[((rounded % 12) + 12) % 12], octave: Math.floor(rounded / 12) - 1 };
}

export function autoCorrelate(buffer, sampleRate) {
  let rms = 0;
  for (const value of buffer) rms += value * value;
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.012) return { frequency: -1, clarity: 0, rms };
  const minLag = Math.floor(sampleRate / 1200);
  const maxLag = Math.min(Math.floor(sampleRate / 65), buffer.length - 1);
  let bestLag = -1, best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0;
    for (let i = 0; i < buffer.length - lag; i++) correlation += buffer[i] * buffer[i + lag];
    correlation /= buffer.length - lag;
    if (correlation > best) { best = correlation; bestLag = lag; }
  }
  if (bestLag < 0) return { frequency: -1, clarity: 0, rms };
  const clarity = Math.min(1, best / (rms * rms));
  return { frequency: clarity > 0.62 ? sampleRate / bestLag : -1, clarity, rms };
}

const MAJOR_PROFILE = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR_PROFILE = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

export function estimateKey(histogram) {
  const total = histogram.reduce((a,b) => a + b, 0);
  if (!total) return { root: 0, mode: 'major', confidence: 0, label: 'Sin datos' };
  const scores = [];
  for (let root = 0; root < 12; root++) {
    for (const [mode, profile] of [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]]) {
      let score = 0;
      for (let pc = 0; pc < 12; pc++) score += histogram[pc] * profile[(pc - root + 12) % 12];
      scores.push({ root, mode, score });
    }
  }
  scores.sort((a,b) => b.score - a.score);
  const confidence = Math.max(0, Math.min(0.98, (scores[0].score - scores[1].score) / scores[0].score * 4 + Math.min(total / 100, .32)));
  return { ...scores[0], confidence, label: `${NOTE_NAMES[scores[0].root]} ${scores[0].mode === 'major' ? 'mayor' : 'menor'}` };
}

export function scaleForKey(root, mode) {
  const pattern = mode === 'minor' ? [0,2,3,5,7,8,10] : [0,2,4,5,7,9,11];
  return pattern.map(x => (root + x) % 12);
}

const CHORD_TYPES = [
  { quality: 'maj', suffix: '', intervals: [0,4,7] },
  { quality: 'min', suffix: 'm', intervals: [0,3,7] },
  { quality: '7', suffix: '7', intervals: [0,4,7,10] },
  { quality: 'maj7', suffix: 'maj7', intervals: [0,4,7,11] },
  { quality: 'min7', suffix: 'm7', intervals: [0,3,7,10] },
  { quality: 'dim', suffix: '°', intervals: [0,3,6] },
  { quality: 'sus4', suffix: 'sus4', intervals: [0,5,7] },
];

export function spectrumToChroma(frequencyData, sampleRate, fftSize) {
  const chroma = Array(12).fill(0);
  const binHz = sampleRate / fftSize;
  for (let bin = 1; bin < frequencyData.length; bin++) {
    const frequency = bin * binHz;
    if (frequency < 70 || frequency > 1500) continue;
    const db = frequencyData[bin];
    if (!Number.isFinite(db) || db < -82) continue;
    const midi = frequencyToMidi(frequency);
    const nearest = Math.round(midi);
    const centsDistance = Math.abs(midi - nearest);
    const pitchClass = ((nearest % 12) + 12) % 12;
    const magnitude = Math.pow(10, (db + 82) / 28);
    const tuningWeight = Math.exp(-centsDistance * centsDistance * 9);
    const frequencyWeight = 1 / Math.sqrt(Math.max(1, frequency / 220));
    chroma[pitchClass] += magnitude * tuningWeight * frequencyWeight;
  }
  const sum = chroma.reduce((a,b) => a+b, 0);
  return sum ? chroma.map(value => value / sum) : chroma;
}

export function detectChord(chroma) {
  const energy = chroma.reduce((a,b) => a+b, 0);
  if (!energy) return { label: '—', root: 0, quality: 'maj', confidence: 0, intervals: [0,4,7] };
  const candidates = [];
  for (let root=0; root<12; root++) {
    for (const type of CHORD_TYPES) {
      const tones = new Set(type.intervals.map(interval => (root+interval)%12));
      let inside=0, outside=0;
      chroma.forEach((value,pc) => tones.has(pc) ? inside += value : outside += value);
      const rootBonus = chroma[root] * .22;
      const complexityPenalty = Math.max(0,type.intervals.length-3)*.025;
      candidates.push({root,...type,score:inside-outside*.58+rootBonus-complexityPenalty});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0], second=candidates[1];
  const confidence=Math.max(0,Math.min(.99,(best.score-second.score)*3.2+best.score*.36));
  return {...best,confidence,label:`${NOTE_NAMES[best.root]}${best.suffix}`};
}

export function chordPitchClasses(chord) {
  return chord.intervals.map(interval => (chord.root+interval)%12);
}

export function mergeChroma(frames) {
  const merged=Array(12).fill(0);
  frames.forEach(frame=>frame.forEach((value,i)=>merged[i]+=value));
  const sum=merged.reduce((a,b)=>a+b,0);
  return sum ? merged.map(value=>value/sum) : merged;
}

export function chooseMelodyPitch(chord, key, previousMidi=64) {
  const chordTones=chordPitchClasses(chord);
  const scale=scaleForKey(key.root,key.mode);
  const targetPool=Math.random()<.68?chordTones:scale;
  const candidates=[];
  for(let midi=52;midi<=76;midi++) if(targetPool.includes(midi%12)) candidates.push(midi);
  candidates.sort((a,b)=>Math.abs(a-previousMidi)-Math.abs(b-previousMidi));
  const near=candidates.slice(0,Math.min(5,candidates.length));
  return near[Math.floor(Math.random()*near.length)] ?? previousMidi;
}

export function chooseLockedMelodyPitch(chord,key,previousMidi=64,strongBeat=false){
  const scale=scaleForKey(key.root,key.mode),chordTones=chordPitchClasses(chord).filter(pc=>scale.includes(pc));
  const pool=strongBeat&&chordTones.length?chordTones:scale,candidates=[];
  for(let midi=55;midi<=79;midi++)if(pool.includes(((midi%12)+12)%12))candidates.push(midi);
  candidates.sort((a,b)=>Math.abs(a-previousMidi)-Math.abs(b-previousMidi));
  const limit=strongBeat?3:5,near=candidates.slice(0,Math.min(limit,candidates.length));
  return near[Math.floor(Math.random()*near.length)]??previousMidi;
}

export function estimateMeter(onsets) {
  if (!onsets || onsets.length < 6) return { numerator: 4, denominator: 4, bpm: 96, confidence: 0, pulseDuration: .625, label: '4/4' };
  const intervals=[];
  for(let i=1;i<onsets.length;i++){
    const delta=onsets[i].time-onsets[i-1].time;
    if(delta>.18&&delta<1.5)intervals.push(delta);
  }
  if(!intervals.length)return { numerator:4,denominator:4,bpm:96,confidence:0,pulseDuration:.625,label:'4/4' };
  const candidates=[];
  for(let bpm=60;bpm<=180;bpm++){
    const beat=60/bpm;let score=0;
    intervals.forEach(delta=>{const ratio=delta/beat,nearest=Math.max(1,Math.round(ratio));score+=Math.exp(-Math.pow(ratio-nearest,2)*22)/nearest});
    candidates.push({bpm,beat,score});
  }
  candidates.sort((a,b)=>b.score-a.score);let {bpm,beat}=candidates[0];
  if(bpm>150){bpm=Math.round(bpm/2);beat*=2}
  const start=onsets[0].time,slots=[];
  onsets.forEach(onset=>{const slot=Math.round((onset.time-start)/beat);if(!slots[slot])slots[slot]=[];slots[slot].push(onset.strength||1)});
  const meters=[{n:2,d:4,prior:.96},{n:3,d:4,prior:1.02},{n:4,d:4,prior:1.08},{n:6,d:8,prior:.94}];
  const scored=meters.map(meter=>{
    let best=-Infinity;
    for(let phase=0;phase<meter.n;phase++){
      const buckets=Array.from({length:meter.n},()=>[]);
      slots.forEach((values,slot)=>values&&buckets[(slot+phase)%meter.n].push(...values));
      const means=buckets.map(values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0);
      const downbeat=means[0],others=means.slice(1).reduce((a,b)=>a+b,0)/Math.max(1,meter.n-1);
      const secondary=meter.n===6?(means[3]||0)*.22:0;
      const coverage=buckets.filter(x=>x.length).length/meter.n;
      best=Math.max(best,(downbeat-others)*1.8+secondary+coverage*.35+meter.prior);
    }
    return {...meter,score:best};
  }).sort((a,b)=>b.score-a.score);
  const best=scored[0],margin=Math.max(0,best.score-scored[1].score);
  return {numerator:best.n,denominator:best.d,bpm,confidence:Math.min(.96,.25+margin*1.7+Math.min(onsets.length/80,.32)),pulseDuration:best.d===8?beat/2:beat,label:`${best.n}/${best.d}`};
}
