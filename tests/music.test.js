import test from 'node:test';
import assert from 'node:assert/strict';
import { autoCorrelate, chooseMelodyPitch, detectChord, estimateKey, estimateMeter, frequencyToMidi, midiToNote, scaleForKey } from '../src/music.js';

test('maps A4 correctly',()=>{assert.ok(Math.abs(frequencyToMidi(440)-69)<.001);assert.equal(midiToNote(69).name,'A');});
test('detects a clean 440Hz tone',()=>{const rate=48000,b=new Float32Array(4096);for(let i=0;i<b.length;i++)b[i]=.5*Math.sin(2*Math.PI*440*i/rate);const r=autoCorrelate(b,rate);assert.ok(Math.abs(r.frequency-440)<5);});
test('estimates C major from its scale emphasis',()=>{const h=[10,0,4,0,7,5,0,8,0,4,0,3];const k=estimateKey(h);assert.equal(k.root,0);assert.equal(k.mode,'major');});
test('builds A minor scale',()=>assert.deepEqual(scaleForKey(9,'minor'),[9,11,0,2,4,5,7]));
test('detects a C major chord from chroma',()=>{const c=[.4,0,0,0,.3,0,0,.3,0,0,0,0];const chord=detectChord(c);assert.equal(chord.label,'C');assert.ok(chord.confidence>.1);});
test('detects an A minor chord from chroma',()=>{const c=[.3,0,0,0,.3,0,0,0,0,.4,0,0];assert.equal(detectChord(c).label,'Am');});
test('melody targets valid key or chord tones',()=>{const chord={root:0,intervals:[0,4,7]};const key={root:0,mode:'major'};const midi=chooseMelodyPitch(chord,key,64);assert.ok([0,2,4,5,7,9,11].includes(midi%12));});
test('estimates steady tempo near 120 BPM',()=>{const onsets=Array.from({length:24},(_,i)=>({time:i*.5,strength:i%4===0?2:1}));const meter=estimateMeter(onsets);assert.ok(Math.abs(meter.bpm-120)<=2);assert.ok([2,3,4,6].includes(meter.numerator));});
