import { autoCorrelate, chordPitchClasses, chooseLockedMelodyPitch, detectChord, estimateKey, estimateMeter, frequencyToMidi, mergeChroma, midiToNote, NOTE_NAMES, scaleForKey, spectrumToChroma } from './music.js';

const $=id=>document.getElementById(id);
const ids=['visualizer','listenState','statusText','liveNote','liveHz','stageNum','stageLabel','stageTitle','timer','progressBar','mainButton','buttonText','demoButton','stopButton','keyResult','confidence','noteCount','topNotes','currentChord','progressionResult','modulationResult','harmonicTimeline','meterResult','tempoResult','tempoSlider','tempoInput','tempoValue'];
const ui=Object.fromEntries(ids.map(id=>[id,$(id)]));
const canvasCtx=ui.visualizer.getContext('2d');
let audioCtx,analyser,source,stream,raf,countdown,sequenceTimer,metronomeTimer,piano,pianoReverb,metronomeSynth;
let state='idle',secondsLeft=60,analysisStartedAt=0,sessionTempo=100,lockedKey=null,samples=[],histogram=Array(12).fill(0),chromaFrames=[],progression=[],keyTimeline=[],onsets=[],energyAverage=.01,lastOnsetAt=-1,currentMeter=null,lastCaptured=0,lastHarmonyAt=0,pendingChord=null,pendingKey=null;

function resizeCanvas(){const dpr=devicePixelRatio||1,r=ui.visualizer.getBoundingClientRect();ui.visualizer.width=r.width*dpr;ui.visualizer.height=r.height*dpr;canvasCtx.setTransform(dpr,0,0,dpr,0,0)}
addEventListener('resize',resizeCanvas);resizeCanvas();

function resetAnalysis(){samples=[];histogram=Array(12).fill(0);chromaFrames=[];progression=[];keyTimeline=[];onsets=[];energyAverage=.01;lastOnsetAt=-1;currentMeter=null;lockedKey=null;pendingChord=null;pendingKey=null;secondsLeft=60;ui.noteCount.textContent='0';ui.topNotes.textContent='—';ui.keyResult.textContent='Analizando…';ui.confidence.textContent='Confianza —';ui.currentChord.textContent='—';ui.meterResult.textContent='—';ui.tempoResult.textContent=`${sessionTempo} BPM · tempo fijado`;ui.progressionResult.textContent='Escuchando…';ui.modulationResult.textContent='Sin modulación detectada';renderTimeline()}

async function startListening(useDemo=false){
  stopEverything();sessionTempo=clampTempo(ui.tempoInput.value);resetAnalysis();audioCtx=new(window.AudioContext||window.webkitAudioContext)();await audioCtx.resume();if(window.Tone){await Tone.start();setupPiano();startMetronome()}
  analyser=audioCtx.createAnalyser();analyser.fftSize=4096;analyser.smoothingTimeConstant=.35;analyser.minDecibels=-95;analyser.maxDecibels=-15;
  if(!useDemo){try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});source=audioCtx.createMediaStreamSource(stream);source.connect(analyser)}catch{state='idle';ui.keyResult.textContent='Permiso requerido';ui.statusText.textContent='Activa el micrófono';return}}
  state='listening';ui.mainButton.disabled=true;ui.demoButton.disabled=true;ui.stopButton.disabled=false;ui.tempoSlider.disabled=true;ui.tempoInput.disabled=true;ui.listenState.classList.add('active');ui.statusText.textContent=useDemo?'Demo con metrónomo':'Metrónomo activo · analizando armonía';ui.buttonText.textContent='Detectando acordes y tonalidad…';
  analysisStartedAt=performance.now();countdown=setInterval(()=>{secondsLeft=Math.max(0,60-Math.floor((performance.now()-analysisStartedAt)/1000));updateTimer();if(secondsLeft<=0)beginImprovisation()},250);
  useDemo?startDemoInput():analyzeLoop();
}

function analyzeLoop(){
  if(state!=='listening')return;
  const timeData=new Float32Array(analyser.fftSize),frequencyData=new Float32Array(analyser.frequencyBinCount);analyser.getFloatTimeDomainData(timeData);analyser.getFloatFrequencyData(frequencyData);
  const pitch=autoCorrelate(timeData,audioCtx.sampleRate);processPitch(pitch.frequency,pitch.clarity,pitch.rms,timeData);
  processOnset(pitch.rms,(performance.now()-analysisStartedAt)/1000);
  const chroma=spectrumToChroma(frequencyData,audioCtx.sampleRate,analyser.fftSize);if(chroma.reduce((a,b)=>a+b,0)>.5)chromaFrames.push(chroma);
  if(performance.now()-lastHarmonyAt>1350&&chromaFrames.length){processHarmony(mergeChroma(chromaFrames.splice(0)),(performance.now()-analysisStartedAt)/1000);lastHarmonyAt=performance.now()}
  raf=requestAnimationFrame(analyzeLoop);
}

function processOnset(energy,time){
  const novelty=Math.max(0,energy-energyAverage);energyAverage=energyAverage*.94+energy*.06;
  if(energy>.018&&novelty>Math.max(.008,energyAverage*.32)&&time-lastOnsetAt>.16){
    onsets.push({time,strength:Math.min(2.5,novelty/Math.max(.006,energyAverage))});lastOnsetAt=time;
    if(onsets.length>=8){currentMeter={...estimateMeter(onsets),bpm:sessionTempo};ui.meterResult.textContent=currentMeter.label;ui.tempoResult.textContent=`${sessionTempo} BPM · tempo fijado`}
  }
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
  sequenceTimer=setInterval(()=>{if(state!=='listening')return;const chord=demo[Math.floor(step/16)%demo.length],chroma=Array(12).fill(.005);chord.intervals.forEach((interval,index)=>chroma[(chord.root+interval)%12]=index?.27:.4);processHarmony(chroma,60-secondsLeft);const midi=48+chord.root+chord.intervals[step%chord.intervals.length];processPitch(440*Math.pow(2,(midi-69)/12),.95,.15);if(step%4===0){const beat=Math.floor(step/4);onsets.push({time:beat*(60/sessionTempo),strength:beat%4===0?2:1});lastOnsetAt=beat*(60/sessionTempo);currentMeter={...estimateMeter(onsets),bpm:sessionTempo};if(onsets.length>=8){ui.meterResult.textContent=currentMeter.label;ui.tempoResult.textContent=`${sessionTempo} BPM · tempo fijado`}}step++},125);
}

function updateInsights(){const key=keyTimeline.at(-1)||estimateKey(histogram);ui.keyResult.textContent=key.label;ui.confidence.textContent=`Confianza ${Math.round(key.confidence*100)}%`;ui.noteCount.textContent=samples.length;ui.topNotes.textContent=histogram.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v).slice(0,3).filter(x=>x.v).map(x=>NOTE_NAMES[x.i]).join(' · ')||'—';ui.progressionResult.textContent=progression.length?progression.slice(-8).map(c=>c.label).join('  →  '):'Escuchando…';if(onsets.length>=8){currentMeter={...estimateMeter(onsets),bpm:sessionTempo};ui.meterResult.textContent=currentMeter.label;ui.tempoResult.textContent=`${sessionTempo} BPM · tempo fijado`}}
function renderTimeline(){if(!ui.harmonicTimeline)return;ui.harmonicTimeline.innerHTML=progression.slice(-12).map((chord,index)=>`<span class="chord-chip ${index===progression.slice(-12).length-1?'active':''}">${chord.label}</span>`).join('')||'<span class="timeline-empty">Los acordes aparecerán aquí</span>'}
function updateTimer(){ui.timer.textContent=`00:${String(secondsLeft).padStart(2,'0')}`;ui.progressBar.style.width=`${(60-secondsLeft)/60*100}%`}

function beginImprovisation(){
  if(state!=='listening')return;clearInterval(countdown);clearInterval(sequenceTimer);clearInterval(metronomeTimer);cancelAnimationFrame(raf);if(stream)stream.getTracks().forEach(t=>t.stop());state='playing';lockedKey=lockSessionKey();const key=lockedKey;if(!progression.length)progression=defaultProgression(key);
  currentMeter={...(currentMeter||estimateMeter(onsets)),bpm:sessionTempo};ui.stageNum.textContent='02';ui.stageLabel.textContent='FASE DE JAM';ui.stageTitle.textContent='Improvisación métrica';ui.timer.textContent='LIVE';ui.progressBar.style.width='100%';ui.statusText.textContent='Tonalidad bloqueada';ui.buttonText.textContent='Improvisando melodía y armonía…';ui.liveNote.textContent=`${key.label} 🔒`;ui.liveHz.textContent=`${currentMeter.label} · ${sessionTempo} BPM · sin notas externas`;ui.keyResult.textContent=`${key.label} 🔒`;startBand(key);ui.stopButton.disabled=false;
}

function defaultProgression(key){const degrees=key.mode==='minor'?[0,5,3,7]:[0,7,9,5];return degrees.map(root=>({root:(key.root+root)%12,quality:root===9?'min':'maj',suffix:root===9?'m':'',intervals:root===9?[0,3,7]:[0,4,7],label:`${NOTE_NAMES[(key.root+root)%12]}${root===9?'m':''}`}))}

function lockSessionKey(){
  const evidence=histogram.slice();progression.forEach(chord=>chordPitchClasses(chord).forEach((pc,index)=>evidence[pc]+=index?1.2:1.8));keyTimeline.forEach(key=>{evidence[key.root]+=Math.max(.5,key.confidence*3)});return estimateKey(evidence)
}

function clampTempo(value){return Math.max(45,Math.min(180,Math.round(Number(value)||100)))}
function syncTempo(value){const bpm=clampTempo(value);ui.tempoSlider.value=bpm;ui.tempoInput.value=bpm;ui.tempoValue.textContent=bpm;sessionTempo=bpm}

function startMetronome(){
  if(!window.Tone)return;if(!metronomeSynth)metronomeSynth=new Tone.Synth({oscillator:{type:'sine'},envelope:{attack:.001,decay:.035,sustain:0,release:.018},volume:-12}).toDestination();let next=Tone.now()+.12,beat=0,interval=60/sessionTempo;
  const schedule=()=>{if(state!=='listening'&&state!=='idle')return;while(next<Tone.now()+.12){metronomeSynth.triggerAttackRelease(beat%4===0?'C7':'A6',.025,next,beat%4===0?.82:.55);next+=interval;beat++}};schedule();metronomeTimer=setInterval(schedule,25)
}

function setupPiano(){
  if(piano||!window.Tone)return;const eq=new Tone.EQ3({low:1.5,mid:-.8,high:1.2,lowFrequency:280,highFrequency:3200});const compressor=new Tone.Compressor({threshold:-18,ratio:2.2,attack:.025,release:.22});pianoReverb=new Tone.Reverb({decay:2.8,preDelay:.022,wet:.19}).toDestination();eq.connect(compressor).connect(pianoReverb);
  piano=new Tone.Sampler({urls:{A0:'A0.mp3',C1:'C1.mp3','D#1':'Ds1.mp3','F#1':'Fs1.mp3',A1:'A1.mp3',C2:'C2.mp3','D#2':'Ds2.mp3','F#2':'Fs2.mp3',A2:'A2.mp3',C3:'C3.mp3','D#3':'Ds3.mp3','F#3':'Fs3.mp3',A3:'A3.mp3',C4:'C4.mp3','D#4':'Ds4.mp3','F#4':'Fs4.mp3',A4:'A4.mp3',C5:'C5.mp3','D#5':'Ds5.mp3','F#5':'Fs5.mp3',A5:'A5.mp3',C6:'C6.mp3'},release:1.65,baseUrl:'https://tonejs.github.io/audio/salamander/'}).connect(eq);
}

function startBand(initialKey){
  if(!window.Tone||!piano){ui.statusText.textContent='No se pudo cargar el motor de piano';return}
  const quarter=60/sessionTempo,stepDuration=quarter/2,stepsPerBar=Math.max(4,Math.round(currentMeter.numerator*(4/currentMeter.denominator)*2));let step=0,previousMidi=64,nextTime=Tone.now()+.15;
  const scheduler=()=>{if(state!=='playing')return;while(nextTime<Tone.now()+.12){const bar=Math.floor(step/stepsPerBar),position=step%stepsPerBar,chord=progression[bar%progression.length];previousMidi=schedulePianoStep(chord,initialKey,position,stepsPerBar,nextTime,previousMidi,bar);if(position===0){ui.currentChord.textContent=chord.label;ui.liveNote.textContent=chord.label;renderPlayingTimeline(bar%progression.length)}step++;nextTime+=stepDuration}}
  scheduler();sequenceTimer=setInterval(scheduler,25);
}

function schedulePianoStep(chord,key,position,stepsPerBar,time,previousMidi,bar){
  const strong=position===0,quarterBeat=position%2===0,phrase=Math.sin((bar%8)/8*Math.PI),dynamic=.86+phrase*.12+(Math.random()-.5)*.05;if(strong){const root=snapToScale(chord.root,key),bass=36+root+(root<4?12:0);playPiano([bass],2.1,time+.014,.66*dynamic);playVoicing(pianoVoicing(chord,key),Math.max(1.5,(60/sessionTempo)*1.8),time+.022,.53*dynamic)}else if(quarterBeat&&currentMeter.numerator>2){playVoicing(pianoVoicing(chord,key).slice(1),.78,time+.012,.27*dynamic)}
  if(strong||quarterBeat||Math.random()>.3){const target=chooseLockedMelodyPitch(chord,key,previousMidi,strong);playPiano([target],quarterBeat?.5:.3,time+.004+(Math.random()-.5)*.008,(strong?.68:.46)*dynamic);return target}return previousMidi
}

function snapToScale(pc,key){const scale=scaleForKey(key.root,key.mode);if(scale.includes(pc))return pc;return scale.slice().sort((a,b)=>Math.min((a-pc+12)%12,(pc-a+12)%12)-Math.min((b-pc+12)%12,(pc-b+12)%12))[0]}
function pianoVoicing(chord,key){const scale=scaleForKey(key.root,key.mode),root=snapToScale(chord.root,key),base=48+root,tones=chordPitchClasses(chord).filter(pc=>scale.includes(pc));for(const pc of scale)if(tones.length<4&&!tones.includes(pc))tones.push(pc);return tones.slice(0,4).map((pc,index)=>base+(pc-root+12)%12+(index>1?12:0))}
function midiName(midi){const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];return `${names[((midi%12)+12)%12]}${Math.floor(midi/12)-1}`}
function playPiano(midis,duration,time,velocity){piano.triggerAttackRelease(midis.map(midiName),duration,time,velocity)}
function playVoicing(midis,duration,time,velocity){midis.forEach((midi,index)=>playPiano([midi],duration,time+index*.009,velocity*(1-index*.045)))}
function keyForChord(chord,fallback){const nearby=keyTimeline.slice().reverse().find(key=>progression.findIndex(c=>c===chord)>=0&&key.time<=chord.time+3);return nearby||fallback}
function renderPlayingTimeline(index){if(!ui.harmonicTimeline)return;const visible=progression.slice(0,12);ui.harmonicTimeline.innerHTML=visible.map((chord,i)=>`<span class="chord-chip ${i===index?'active':''}">${chord.label}</span>`).join('')}
function drawWave(waveform,rms=.05){const w=ui.visualizer.clientWidth,h=ui.visualizer.clientHeight;canvasCtx.clearRect(0,0,w,h);const grad=canvasCtx.createLinearGradient(0,0,w,0);grad.addColorStop(0,'#7357ff');grad.addColorStop(.5,'#32e5bb');grad.addColorStop(1,'#7357ff');canvasCtx.strokeStyle=grad;canvasCtx.lineWidth=2;canvasCtx.beginPath();const count=waveform?waveform.length:180;for(let i=0;i<count;i++){const x=i/(count-1)*w,value=waveform?waveform[i]:Math.sin(i*.23+performance.now()/240)*rms,y=h/2+value*h*.9;i?canvasCtx.lineTo(x,y):canvasCtx.moveTo(x,y)}canvasCtx.stroke()}
function stopEverything(){clearInterval(countdown);clearInterval(sequenceTimer);clearInterval(metronomeTimer);cancelAnimationFrame(raf);if(stream)stream.getTracks().forEach(t=>t.stop());if(piano?.releaseAll)piano.releaseAll();if(audioCtx&&audioCtx.state!=='closed')audioCtx.close();state='idle';ui.mainButton.disabled=false;ui.demoButton.disabled=false;ui.stopButton.disabled=true;ui.tempoSlider.disabled=false;ui.tempoInput.disabled=false;ui.listenState.classList.remove('active');ui.statusText.textContent='Listo para escuchar';ui.buttonText.textContent='Comenzar a escuchar';ui.stageNum.textContent='01';ui.stageLabel.textContent='FASE DE ESCUCHA';ui.stageTitle.textContent='Aprender tu música'}
ui.tempoSlider.addEventListener('input',event=>syncTempo(event.target.value));ui.tempoInput.addEventListener('change',event=>syncTempo(event.target.value));syncTempo(100);ui.mainButton.addEventListener('click',()=>startListening(false));ui.demoButton.addEventListener('click',()=>startListening(true));ui.stopButton.addEventListener('click',stopEverything);setInterval(()=>{if(state==='idle')drawWave(null,.035)},40);
