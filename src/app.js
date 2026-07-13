import { autoCorrelate, chordPitchClasses, chooseMelodyPitch, detectChord, estimateKey, frequencyToMidi, mergeChroma, midiToNote, NOTE_NAMES, spectrumToChroma } from './music.js';

const $=id=>document.getElementById(id);
const ids=['visualizer','listenState','statusText','liveNote','liveHz','stageNum','stageLabel','stageTitle','timer','progressBar','mainButton','buttonText','demoButton','stopButton','keyResult','confidence','noteCount','topNotes','currentChord','progressionResult','modulationResult','harmonicTimeline'];
const ui=Object.fromEntries(ids.map(id=>[id,$(id)]));
const canvasCtx=ui.visualizer.getContext('2d');
let audioCtx,analyser,source,stream,raf,countdown,sequenceTimer,masterBus;
let state='idle',secondsLeft=60,samples=[],histogram=Array(12).fill(0),chromaFrames=[],progression=[],keyTimeline=[],lastCaptured=0,lastHarmonyAt=0,pendingChord=null,pendingKey=null;

function resizeCanvas(){const dpr=devicePixelRatio||1,r=ui.visualizer.getBoundingClientRect();ui.visualizer.width=r.width*dpr;ui.visualizer.height=r.height*dpr;canvasCtx.setTransform(dpr,0,0,dpr,0,0)}
addEventListener('resize',resizeCanvas);resizeCanvas();

function resetAnalysis(){samples=[];histogram=Array(12).fill(0);chromaFrames=[];progression=[];keyTimeline=[];pendingChord=null;pendingKey=null;secondsLeft=60;ui.noteCount.textContent='0';ui.topNotes.textContent='—';ui.keyResult.textContent='Analizando…';ui.confidence.textContent='Confianza —';ui.currentChord.textContent='—';ui.progressionResult.textContent='Escuchando…';ui.modulationResult.textContent='Sin modulación detectada';renderTimeline()}

async function startListening(useDemo=false){
  stopEverything();resetAnalysis();audioCtx=new(window.AudioContext||window.webkitAudioContext)();await audioCtx.resume();setupOutput();
  analyser=audioCtx.createAnalyser();analyser.fftSize=4096;analyser.smoothingTimeConstant=.35;analyser.minDecibels=-95;analyser.maxDecibels=-15;
  if(!useDemo){try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});source=audioCtx.createMediaStreamSource(stream);source.connect(analyser)}catch{state='idle';ui.keyResult.textContent='Permiso requerido';ui.statusText.textContent='Activa el micrófono';return}}
  state='listening';ui.mainButton.disabled=true;ui.demoButton.disabled=true;ui.stopButton.disabled=false;ui.listenState.classList.add('active');ui.statusText.textContent=useDemo?'Demo: analizando progresión':'Analizando armonía';ui.buttonText.textContent='Detectando acordes y tonalidad…';
  const started=performance.now();countdown=setInterval(()=>{secondsLeft=Math.max(0,60-Math.floor((performance.now()-started)/1000));updateTimer();if(secondsLeft<=0)beginImprovisation()},250);
  useDemo?startDemoInput():analyzeLoop();
}

function analyzeLoop(){
  if(state!=='listening')return;
  const timeData=new Float32Array(analyser.fftSize),frequencyData=new Float32Array(analyser.frequencyBinCount);analyser.getFloatTimeDomainData(timeData);analyser.getFloatFrequencyData(frequencyData);
  const pitch=autoCorrelate(timeData,audioCtx.sampleRate);processPitch(pitch.frequency,pitch.clarity,pitch.rms,timeData);
  const chroma=spectrumToChroma(frequencyData,audioCtx.sampleRate,analyser.fftSize);if(chroma.reduce((a,b)=>a+b,0)>.5)chromaFrames.push(chroma);
  if(performance.now()-lastHarmonyAt>1350&&chromaFrames.length){processHarmony(mergeChroma(chromaFrames.splice(0)),60-secondsLeft);lastHarmonyAt=performance.now()}
  raf=requestAnimationFrame(analyzeLoop);
}

function processPitch(frequency,clarity=.9,rms=.1,waveform=null){
  drawWave(waveform,rms);if(frequency>65&&frequency<1200&&clarity>.58){const note=midiToNote(frequencyToMidi(frequency));ui.liveNote.textContent=`${note.name}${note.octave}`;ui.liveHz.textContent=`${frequency.toFixed(1)} Hz · ${Math.round(clarity*100)}% claridad`;if(performance.now()-lastCaptured>110){histogram[note.pitchClass]+=Math.max(.25,clarity);samples.push({time:60-secondsLeft,pc:note.pitchClass,midi:note.midi});lastCaptured=performance.now();updateInsights()}}
}

function processHarmony(chroma,time){
  chroma.forEach((value,i)=>histogram[i]+=value*2.4);const chord=detectChord(chroma);if(chord.confidence>.17){
    if(pendingChord?.label===chord.label)pendingChord.count++;else pendingChord={...chord,count:1};
    if(pendingChord.count>=2){const last=progression.at(-1);if(!last||last.label!==chord.label||time-last.time>8)progression.push({...chord,time});ui.currentChord.textContent=chord.label;pendingChord=null}
  }
  const recent=progression.filter(item=>time-item.time<12);const keyHistogram=Array(12).fill(0);recent.forEach(item=>chordPitchClasses(item).forEach((pc,index)=>keyHistogram[pc]+=index?1:1.45));const key=estimateKey(keyHistogram.reduce((acc,v,i)=>(acc[i]=v+histogram[i]*.08,acc),Array(12).fill(0)));
  if(key.confidence>.16){const signature=`${key.root}-${key.mode}`;if(pendingKey?.signature===signature)pendingKey.count++;else pendingKey={signature,key,count:1};if(pendingKey.count>=3){const last=keyTimeline.at(-1);if(!last||last.signature!==signature){keyTimeline.push({...key,signature,time});if(keyTimeline.length>1)ui.modulationResult.textContent=`${keyTimeline.at(-2).label} → ${key.label}`}pendingKey=null}}
  updateInsights();renderTimeline();
}

function startDemoInput(){
  const demo=[{root:0,quality:'maj',suffix:'',intervals:[0,4,7]},{root:9,quality:'min',suffix:'m',intervals:[0,3,7]},{root:5,quality:'maj',suffix:'',intervals:[0,4,7]},{root:7,quality:'7',suffix:'7',intervals:[0,4,7,10]},{root:2,quality:'maj',suffix:'',intervals:[0,4,7]},{root:9,quality:'maj',suffix:'',intervals:[0,4,7]},{root:7,quality:'maj',suffix:'',intervals:[0,4,7]}];let step=0;
  sequenceTimer=setInterval(()=>{if(state!=='listening')return;const chord=demo[Math.floor(step/12)%demo.length],chroma=Array(12).fill(.005);chord.intervals.forEach((interval,index)=>chroma[(chord.root+interval)%12]=index?.27:.4);processHarmony(chroma,60-secondsLeft);const midi=48+chord.root+chord.intervals[step%chord.intervals.length];processPitch(440*Math.pow(2,(midi-69)/12),.95,.15);step++},150);
}

function updateInsights(){const key=keyTimeline.at(-1)||estimateKey(histogram);ui.keyResult.textContent=key.label;ui.confidence.textContent=`Confianza ${Math.round(key.confidence*100)}%`;ui.noteCount.textContent=samples.length;ui.topNotes.textContent=histogram.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v).slice(0,3).filter(x=>x.v).map(x=>NOTE_NAMES[x.i]).join(' · ')||'—';ui.progressionResult.textContent=progression.length?progression.slice(-8).map(c=>c.label).join('  →  '):'Escuchando…'}
function renderTimeline(){if(!ui.harmonicTimeline)return;ui.harmonicTimeline.innerHTML=progression.slice(-12).map((chord,index)=>`<span class="chord-chip ${index===progression.slice(-12).length-1?'active':''}">${chord.label}</span>`).join('')||'<span class="timeline-empty">Los acordes aparecerán aquí</span>'}
function updateTimer(){ui.timer.textContent=`00:${String(secondsLeft).padStart(2,'0')}`;ui.progressBar.style.width=`${(60-secondsLeft)/60*100}%`}

function beginImprovisation(){
  if(state!=='listening')return;clearInterval(countdown);clearInterval(sequenceTimer);cancelAnimationFrame(raf);if(stream)stream.getTracks().forEach(t=>t.stop());state='playing';const key=keyTimeline.at(-1)||estimateKey(histogram);if(!progression.length)progression=defaultProgression(key);
  ui.stageNum.textContent='02';ui.stageLabel.textContent='FASE DE JAM';ui.stageTitle.textContent='Improvisación armónica';ui.timer.textContent='LIVE';ui.progressBar.style.width='100%';ui.statusText.textContent='Guitarra clásica generativa';ui.buttonText.textContent='Improvisando sobre los acordes…';ui.liveNote.textContent=key.label;ui.liveHz.textContent='Melodía guiada por notas del acorde';startBand(key);ui.stopButton.disabled=false;
}

function defaultProgression(key){const degrees=key.mode==='minor'?[0,5,3,7]:[0,7,9,5];return degrees.map(root=>({root:(key.root+root)%12,quality:root===9?'min':'maj',suffix:root===9?'m':'',intervals:root===9?[0,3,7]:[0,4,7],label:`${NOTE_NAMES[(key.root+root)%12]}${root===9?'m':''}`}))}

function setupOutput(){masterBus=audioCtx.createGain();masterBus.gain.value=.74;const warmth=audioCtx.createBiquadFilter();warmth.type='lowpass';warmth.frequency.value=5200;warmth.Q.value=.35;const body=audioCtx.createBiquadFilter();body.type='peaking';body.frequency.value=215;body.Q.value=1.1;body.gain.value=4;const presence=audioCtx.createBiquadFilter();presence.type='peaking';presence.frequency.value=2100;presence.Q.value=.8;presence.gain.value=2;masterBus.connect(body).connect(presence).connect(warmth).connect(audioCtx.destination)}

function startBand(initialKey){let beat=0,previousMidi=64;const beatMs=445;const play=()=>{if(state!=='playing')return;const chord=progression[Math.floor(beat/4)%progression.length];const key=keyForChord(chord,initialKey);ui.currentChord.textContent=chord.label;ui.liveNote.textContent=chord.label;renderPlayingTimeline(Math.floor(beat/4)%progression.length);if(beat%4===0)playGuitarChord(chord);if(beat%2===0)playPluck(40+chord.root,.18,1.9,-.25);if(beat%2===0||Math.random()>.42){previousMidi=chooseMelodyPitch(chord,key,previousMidi);playPluck(previousMidi,.19,.8,.3)}beat++};play();sequenceTimer=setInterval(play,beatMs)}
function keyForChord(chord,fallback){const nearby=keyTimeline.slice().reverse().find(key=>progression.findIndex(c=>c===chord)>=0&&key.time<=chord.time+3);return nearby||fallback}
function renderPlayingTimeline(index){if(!ui.harmonicTimeline)return;const visible=progression.slice(0,12);ui.harmonicTimeline.innerHTML=visible.map((chord,i)=>`<span class="chord-chip ${i===index?'active':''}">${chord.label}</span>`).join('')}
function playGuitarChord(chord){const base=48+chord.root;chord.intervals.forEach((interval,index)=>setTimeout(()=>playPluck(base+interval+(index===2?12:0),.13,2.35,(index-1)*.18),index*52))}

function playPluck(midi,gain=.18,duration=1.8,pan=0){
  const frequency=440*Math.pow(2,(midi-69)/12),rate=audioCtx.sampleRate,length=Math.floor(rate*duration),period=Math.max(2,Math.round(rate/frequency)),data=new Float32Array(length),ring=new Float32Array(period);for(let i=0;i<period;i++)ring[i]=(Math.random()*2-1)*(.82+.18*Math.sin(Math.PI*i/period));let previous=0;const damping=.992-Math.min(.006,frequency/150000);for(let i=0;i<length;i++){const current=ring[i%period],next=ring[(i+1)%period],value=(current+next)*.5*damping;ring[i%period]=value;data[i]=current*.86+previous*.14;previous=current}const buffer=audioCtx.createBuffer(1,length,rate);buffer.copyToChannel(data,0);const src=audioCtx.createBufferSource();src.buffer=buffer;const envelope=audioCtx.createGain(),panner=audioCtx.createStereoPanner();panner.pan.value=pan;const now=audioCtx.currentTime;envelope.gain.setValueAtTime(.0001,now);envelope.gain.exponentialRampToValueAtTime(gain,now+.009);envelope.gain.exponentialRampToValueAtTime(.0001,now+duration);const nail=audioCtx.createBiquadFilter();nail.type='lowpass';nail.frequency.value=3400+Math.random()*900;src.connect(nail).connect(envelope).connect(panner).connect(masterBus);src.start(now);src.stop(now+duration)}

function drawWave(waveform,rms=.05){const w=ui.visualizer.clientWidth,h=ui.visualizer.clientHeight;canvasCtx.clearRect(0,0,w,h);const grad=canvasCtx.createLinearGradient(0,0,w,0);grad.addColorStop(0,'#7357ff');grad.addColorStop(.5,'#32e5bb');grad.addColorStop(1,'#7357ff');canvasCtx.strokeStyle=grad;canvasCtx.lineWidth=2;canvasCtx.beginPath();const count=waveform?waveform.length:180;for(let i=0;i<count;i++){const x=i/(count-1)*w,value=waveform?waveform[i]:Math.sin(i*.23+performance.now()/240)*rms,y=h/2+value*h*.9;i?canvasCtx.lineTo(x,y):canvasCtx.moveTo(x,y)}canvasCtx.stroke()}
function stopEverything(){clearInterval(countdown);clearInterval(sequenceTimer);cancelAnimationFrame(raf);if(stream)stream.getTracks().forEach(t=>t.stop());if(audioCtx&&audioCtx.state!=='closed')audioCtx.close();state='idle';ui.mainButton.disabled=false;ui.demoButton.disabled=false;ui.stopButton.disabled=true;ui.listenState.classList.remove('active');ui.statusText.textContent='Listo para escuchar';ui.buttonText.textContent='Comenzar a escuchar';ui.stageNum.textContent='01';ui.stageLabel.textContent='FASE DE ESCUCHA';ui.stageTitle.textContent='Aprender tu música'}
ui.mainButton.addEventListener('click',()=>startListening(false));ui.demoButton.addEventListener('click',()=>startListening(true));ui.stopButton.addEventListener('click',stopEverything);setInterval(()=>{if(state==='idle')drawWave(null,.035)},40);
