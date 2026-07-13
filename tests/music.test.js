import test from 'node:test';
import assert from 'node:assert/strict';
import { autoCorrelate, estimateKey, frequencyToMidi, midiToNote, scaleForKey } from '../src/music.js';

test('maps A4 correctly',()=>{assert.ok(Math.abs(frequencyToMidi(440)-69)<.001);assert.equal(midiToNote(69).name,'A');});
test('detects a clean 440Hz tone',()=>{const rate=48000,b=new Float32Array(4096);for(let i=0;i<b.length;i++)b[i]=.5*Math.sin(2*Math.PI*440*i/rate);const r=autoCorrelate(b,rate);assert.ok(Math.abs(r.frequency-440)<5);});
test('estimates C major from its scale emphasis',()=>{const h=[10,0,4,0,7,5,0,8,0,4,0,3];const k=estimateKey(h);assert.equal(k.root,0);assert.equal(k.mode,'major');});
test('builds A minor scale',()=>assert.deepEqual(scaleForKey(9,'minor'),[9,11,0,2,4,5,7]));
