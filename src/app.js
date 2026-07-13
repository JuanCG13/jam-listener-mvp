import { autoCorrelate, estimateKey, frequencyToMidi, midiToNote, NOTE_NAMES, scaleForKey } from './music.js';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['visualizer','listenState','statusText','liveNote','liveHz','stageNum','stageLabel','stageTitle','timer','progressBar','mainButton','buttonIcon','buttonText','demoButton','stopButton','keyResult','confidence','noteCount','topNotes'].map(id => [id,$(id)]));
const canvasCtx = ui.visualizer.getContext('2d');
let audioCtx, analyser, source, stream, raf, countdown, sequenceTimer;
let state = 'idle', secondsLeft = 60, samples = [], histogram = Array(12).fill(0), lastCaptured = 0, demoMode = false;

function resizeCanvas() { const dpr = devicePixelRatio || 1, r = ui.visualizer.getBoundingClientRect(); ui.visualizer.width = r.width*dpr; ui.visualizer.height = r.height*dpr; canvasCtx.setTransform(dpr,0,0,dpr,0,0); }
addEventListener('resize', resizeCanvas); resizeCanvas();

function resetAnalysis() { samples=[]; histogram=Array(12).fill(0); secondsLeft=60; ui.noteCount.textContent='0'; ui.topNotes.textContent='—'; ui.keyResult.textContent='Analizando…'; ui.confidence.textContent='Confianza —'; }

async function startListening(useDemo=false) {
  stopEverything(); resetAnalysis(); demoMode=useDemo;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)(); await audioCtx.resume();
  analyser = audioCtx.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=.15;
  if (!useDemo) {
    try { stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}}); source=audioCtx.createMediaStreamSource(stream); source.connect(analyser); }
    catch(err) { state='idle'; ui.keyResult.textContent='Permiso requerido'; ui.statusText.textContent='Activa el micrófono'; return; }
  }
  state='listening'; ui.mainButton.disabled=true; ui.demoButton.disabled=true; ui.stopButton.disabled=false; ui.listenState.classList.add('active'); ui.statusText.textContent=useDemo?'Demo: escuchando progresión':'Escuchando tu guitarra'; ui.buttonText.textContent='Analizando música…';
  const started=performance.now();
  countdown=setInterval(()=>{ secondsLeft=Math.max(0,60-Math.floor((performance.now()-started)/1000)); updateTimer(); if(secondsLeft<=0) beginImprovisation(); },250);
  if(useDemo) startDemoInput(); else analyzeLoop();
}

function analyzeLoop() {
  if(state!=='listening') return;
  const buffer=new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(buffer);
  const result=autoCorrelate(buffer,audioCtx.sampleRate);
  processPitch(result.frequency,result.clarity,result.rms,buffer);
  raf=requestAnimationFrame(analyzeLoop);
}

function processPitch(frequency, clarity=.9, rms=.1, waveform=null) {
  drawWave(waveform,rms);
  if(frequency>65 && frequency<1200 && clarity>.62) {
    const note=midiToNote(frequencyToMidi(frequency)); ui.liveNote.textContent=`${note.name}${note.octave}`; ui.liveHz.textContent=`${frequency.toFixed(1)} Hz · ${Math.round(clarity*100)}% claridad`;
    if(performance.now()-lastCaptured>115) { histogram[note.pitchClass]+=Math.max(.25,clarity); samples.push({time:60-secondsLeft,pc:note.pitchClass,midi:note.midi}); lastCaptured=performance.now(); updateInsights(); }
  }
}

function startDemoInput() {
  const progression=[[60,64,67],[57,60,64],[65,69,72],[67,71,74]]; let step=0;
  sequenceTimer=setInterval(()=>{ if(state!=='listening')return; const chord=progression[Math.floor(step/8)%4]; const midi=chord[step%chord.length]; processPitch(440*Math.pow(2,(midi-69)/12),.94,.15); step++; },140);
}

function updateInsights() {
  const key=estimateKey(histogram); ui.keyResult.textContent=key.label; ui.confidence.textContent=`Confianza ${Math.round(key.confidence*100)}%`; ui.noteCount.textContent=samples.length;
  ui.topNotes.textContent=histogram.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v).slice(0,3).filter(x=>x.v).map(x=>NOTE_NAMES[x.i]).join(' · ')||'—';
}

function updateTimer(){ ui.timer.textContent=`00:${String(secondsLeft).padStart(2,'0')}`; ui.progressBar.style.width=`${(60-secondsLeft)/60*100}%`; }

function beginImprovisation() {
  if(state!=='listening') return; clearInterval(countdown); clearInterval(sequenceTimer); cancelAnimationFrame(raf); if(stream)stream.getTracks().forEach(t=>t.stop());
  state='playing'; const key=estimateKey(histogram); ui.stageNum.textContent='02'; ui.stageLabel.textContent='FASE DE JAM'; ui.stageTitle.textContent='Improvisando contigo'; ui.timer.textContent='LIVE'; ui.progressBar.style.width='100%'; ui.statusText.textContent='Acompañamiento generado'; ui.buttonText.textContent='Improvisando…'; ui.liveNote.textContent=key.label; ui.liveHz.textContent='Toca encima · usa auriculares';
  startBand(key); ui.stopButton.disabled=false;
}

function startBand(key) {
  const scale=scaleForKey(key.root,key.mode); const degrees=key.mode==='minor'?[0,5,3,6]:[0,5,3,4]; let beat=0; const beatMs=430;
  const play=()=>{ if(state!=='playing')return; const degree=degrees[Math.floor(beat/4)%degrees.length]; const rootPc=scale[degree]; const rootMidi=36+rootPc+(rootPc<key.root?12:0); if(beat%4===0){tone(rootMidi,'triangle',.18,.55); chord(rootMidi+12,key.mode,degree);} if(beat%2===0)tone(42,'noise',.025,.06); const melodicPc=scale[Math.floor(Math.random()*scale.length)]; const melodicMidi=60+melodicPc+(melodicPc<key.root?12:0); if(Math.random()>.25)tone(melodicMidi,'sine',.08,.22); beat++; };
  play(); sequenceTimer=setInterval(play,beatMs);
}

function chord(root,mode,degree){ const minorDegrees=mode==='minor'?[0,3,4]:[1,2,5]; const third=minorDegrees.includes(degree)?3:4; [0,third,7].forEach((n,i)=>setTimeout(()=>tone(root+n,'triangle',.055,.75),i*18)); }
function tone(midi,type,gain,duration){ const now=audioCtx.currentTime, g=audioCtx.createGain(); g.gain.setValueAtTime(.0001,now); g.gain.exponentialRampToValueAtTime(gain,now+.018); g.gain.exponentialRampToValueAtTime(.0001,now+duration); if(type==='noise'){const b=audioCtx.createBuffer(1,audioCtx.sampleRate*.08,audioCtx.sampleRate); const d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1; const s=audioCtx.createBufferSource(); s.buffer=b;s.connect(g);s.start(now);s.stop(now+duration);}else{const o=audioCtx.createOscillator();o.type=type;o.frequency.value=440*Math.pow(2,(midi-69)/12);o.connect(g);o.start(now);o.stop(now+duration);} g.connect(audioCtx.destination); }

function drawWave(waveform,rms=.05){ const w=ui.visualizer.clientWidth,h=ui.visualizer.clientHeight; canvasCtx.clearRect(0,0,w,h); const grad=canvasCtx.createLinearGradient(0,0,w,0);grad.addColorStop(0,'#7357ff');grad.addColorStop(.5,'#32e5bb');grad.addColorStop(1,'#7357ff'); canvasCtx.strokeStyle=grad;canvasCtx.lineWidth=2;canvasCtx.beginPath(); const count=waveform?waveform.length:180; for(let i=0;i<count;i++){const x=i/(count-1)*w;const value=waveform?waveform[i]:Math.sin(i*.23+performance.now()/240)*rms;const y=h/2+value*h*.9;(i?canvasCtx.lineTo(x,y):canvasCtx.moveTo(x,y));}canvasCtx.stroke(); }

function stopEverything(){ clearInterval(countdown);clearInterval(sequenceTimer);cancelAnimationFrame(raf);if(stream)stream.getTracks().forEach(t=>t.stop());if(audioCtx&&audioCtx.state!=='closed')audioCtx.close(); state='idle'; ui.mainButton.disabled=false;ui.demoButton.disabled=false;ui.stopButton.disabled=true;ui.listenState.classList.remove('active');ui.statusText.textContent='Listo para escuchar';ui.buttonText.textContent='Comenzar a escuchar';ui.stageNum.textContent='01';ui.stageLabel.textContent='FASE DE ESCUCHA';ui.stageTitle.textContent='Aprender tu música'; }
ui.mainButton.addEventListener('click',()=>startListening(false));ui.demoButton.addEventListener('click',()=>startListening(true));ui.stopButton.addEventListener('click',stopEverything);
setInterval(()=>{if(state==='idle')drawWave(null,.035)},40);
