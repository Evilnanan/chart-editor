export class Transport {
  constructor(onEnd,onWaveform=()=>{}) {
    this.onEnd=onEnd;
    this.onWaveform=onWaveform;
    this.onsets=[];
    this.rate=1;
    this.position=0;
    this.volume=.8;
    this.duration=60;
    this.playing=false;
  }

  context() {
    if (!this.ctx) {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.ctx=new Audio();
      this.gain=this.ctx.createGain();
      this.gain.gain.value=this.volume;
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async decode(blob) {
    const bytes=await blob.arrayBuffer();
    const context=this.context();
    try {
      return await context.decodeAudioData(bytes.slice(0));
    } catch(error) {
      if (new TextDecoder().decode(bytes.slice(0,4))!=='OggS') throw error;
      const { OggVorbisDecoder }=await import('@wasm-audio-decoders/ogg-vorbis');
      const decoder=new OggVorbisDecoder();
      await decoder.ready;
      try {
        const result=await decoder.decodeFile(new Uint8Array(bytes));
        if (!result.samplesDecoded) throw error;
        const buffer=context.createBuffer(result.channelData.length,result.samplesDecoded,result.sampleRate);
        result.channelData.forEach((source,index)=>buffer.copyToChannel(source,index));
        return buffer;
      } finally { decoder.free(); }
    }
  }

  setBuffer(buffer,duration) {
    this.pause();
    this.onsetTask?.abort();
    this.buffer=buffer;
    this.duration=duration;
    this.position=0;
    this.peaks=buffer ? waveform(buffer) : null;
    this.onsets=[];
    this.onsetTask=buffer ? new AbortController() : null;
    if(buffer) this.updateOnsets(buffer,this.onsetTask.signal);
  }

  async updateOnsets(buffer,signal) {
    const onsets=await findAudioOnsets(buffer,signal);
    if(signal.aborted) return;
    this.onsets=onsets;
    this.onWaveform();
  }

  time() {
    if (!this.playing) return this.position;
    return Math.min(this.duration,this.position+(performance.now()-this.anchor)*.001*this.rate);
  }

  async play() {
    if (this.playing) return;
    if (this.position>=this.duration) this.position=0;
    const context=this.context();
    await context.resume();
    if (this.playing || this.position>=this.duration) return;
    this.playing=true;
    this.anchor=performance.now();
    this.startSource();
  }

  startSource() {
    if (!this.buffer || this.position>=this.buffer.duration) return;
    const source=this.ctx.createBufferSource();
    source.buffer=this.buffer;
    source.playbackRate.value=this.rate;
    source.connect(this.gain);
    source.start(0,this.position);
    this.source=source;
  }

  stopSource() {
    if (this.source) {
      this.source.stop();
      this.source.disconnect();
      this.source=null;
    }
  }

  pause() {
    this.position=this.time();
    this.playing=false;
    this.stopSource();
  }

  seek(time) {
    this.position=Math.max(0,Math.min(this.duration,time));
    if (!this.playing) return;
    this.stopSource();
    this.anchor=performance.now();
    this.startSource();
  }

  setRate(rate) {
    this.seek(this.time());
    this.rate=rate;
    if (this.source) this.source.playbackRate.value=rate;
  }

  setVolume(volume) {
    this.volume=volume;
    if (this.gain) this.gain.gain.value=volume;
  }

  click(frequency=750,accent=false) {
    if (!this.ctx || this.ctx.state!=='running') return;
    const osc=this.ctx.createOscillator();
    const gain=this.ctx.createGain();
    const time=this.ctx.currentTime;
    osc.frequency.value=frequency;
    gain.gain.setValueAtTime(accent ? .15 : .075,time);
    gain.gain.exponentialRampToValueAtTime(.001,time+.045);
    osc.connect(gain);
    gain.connect(this.gain);
    osc.start(time);
    osc.stop(time+.05);
  }

  tick(loop) {
    const time=this.time();
    if (!this.playing) return time;
    if (loop && time>=loop.end) this.seek(loop.start);
    else if (time>=this.duration) {
      this.pause();
      this.onEnd();
    }
    return this.time();
  }
}

function waveform(buffer) {
  const channels=Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,i)=>buffer.getChannelData(i));
  const count=Math.min(24000,Math.max(800,Math.ceil(buffer.duration*240)));
  const step=buffer.length/count;
  const peaks=new Float32Array(count);
  for (let i=0;i<count;i++) {
    let peak=0;
    for (const samples of channels) {
      for (let j=Math.floor(i*step);j<(i+1)*step;j+=Math.max(1,Math.floor(step/36))) peak=Math.max(peak,Math.abs(samples[j] || 0));
    }
    peaks[i]=peak;
  }
  return peaks;
}

const onsetSize=512;
const onsetBands=[120,260,560,1200,2400,4400];
const onsetWindow=Float32Array.from({length:onsetSize},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(onsetSize-1)));
const onsetCos=Float32Array.from({length:onsetSize/2},(_,i)=>Math.cos(2*Math.PI*i/onsetSize));
const onsetSin=Float32Array.from({length:onsetSize/2},(_,i)=>-Math.sin(2*Math.PI*i/onsetSize));
const onsetOrder=Uint16Array.from({length:onsetSize},(_,index)=>{
  let reversed=0;
  for(let bit=1;bit<onsetSize;bit*=2) {
    reversed=(reversed<<1)|(index&1);
    index>>=1;
  }
  return reversed;
});

function onsetFft(real,imaginary) {
  for(let span=2;span<=onsetSize;span*=2) {
    const half=span/2;
    const step=onsetSize/span;
    for(let start=0;start<onsetSize;start+=span) for(let j=0;j<half;j++) {
      const left=start+j, right=left+half;
      const cos=onsetCos[j*step], sin=onsetSin[j*step];
      const re=cos*real[right]-sin*imaginary[right];
      const im=sin*real[right]+cos*imaginary[right];
      real[right]=real[left]-re;
      imaginary[right]=imaginary[left]-im;
      real[left]+=re;
      imaginary[left]+=im;
    }
  }
}

export async function findAudioOnsets(buffer,signal) {
  const stride=Math.max(1,Math.round(buffer.sampleRate/12000));
  const rate=buffer.sampleRate/stride;
  const hop=Math.max(1,Math.round(rate/200));
  const frames=Math.max(0,Math.floor((buffer.length/stride-onsetSize/2)/hop)+1);
  const channels=Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,index)=>buffer.getChannelData(index));
  const bands=Uint8Array.from({length:onsetSize/2},(_,i)=>onsetBands.filter(edge=>i*rate/onsetSize>=edge).length);
  const bandCount=onsetBands.length+1;
  const bandPower=new Float32Array(bandCount);
  const history=Array.from({length:3},()=>new Float32Array(bandCount));
  const real=new Float32Array(onsetSize), imaginary=new Float32Array(onsetSize);
  const flux=new Float32Array(frames);
  const sum=new Float64Array(frames+1);

  for(let frame=0;frame<frames;frame++) {
    if(frame%200===0) {
      await new Promise(resolve=>setTimeout(resolve,0));
      if(signal?.aborted) return [];
    }
    const sampleStart=(frame*hop-onsetSize/2)*stride;
    bandPower.fill(0);
    for(const samples of channels) {
      imaginary.fill(0);
      for(let i=0;i<onsetSize;i++) {
        const start=sampleStart+i*stride;
        let value=0;
        for(let j=0;j<stride;j++) value+=samples[start+j] || 0;
        real[onsetOrder[i]]=onsetWindow[i]*value/stride;
      }
      onsetFft(real,imaginary);
      for(let i=1;i<bands.length;i++) bandPower[bands[i]]+=real[i]**2+imaginary[i]**2;
    }
    // A new spectral band can reveal an attack in audio with nearly constant amplitude.
    const previous=history[frame%history.length];
    let rise=0;
    for(let band=0;band<bandCount;band++) {
      const level=Math.log1p(.6*Math.sqrt(bandPower[band]/channels.length));
      rise+=Math.max(0,level-previous[band]);
      previous[band]=level;
    }
    const score=rise/bandCount;
    flux[frame]=score;
    sum[frame+1]=sum[frame]+Math.min(score,.25);
  }

  const peaks=[];
  for(let frame=0;frame<frames;frame++) {
    const score=flux[frame];
    if(score<.06 || score<(flux[frame-1] ?? 0) || score<=(flux[frame+1] ?? 0)) continue;
    const from=Math.max(0,frame-36), to=Math.min(frames,frame+37);
    const local=(sum[to]-sum[from])/(to-from);
    if(score<local*3+.035) continue;
    const last=peaks.at(-1);
    if(last && frame-last.frame<10) {
      if(score<=last.score) continue;
      peaks.pop();
    }
    peaks.push({frame,score,local});
  }
  return peaks.map(({frame,score,local})=>({time:frame*hop/rate,strength:Math.min(1,.3+score-local)}));
}

export function makeDemoAudio(context, duration=90, bpm=128) {
  const rate=22050;
  const buffer=context.createBuffer(1,Math.floor(rate*duration),rate);
  const pcm=buffer.getChannelData(0);
  const beat=60/bpm;
  const scale=[110,110,130.81,98,110,146.83,130.81,98];
  let noise=19;
  for (let i=0;i<pcm.length;i++) {
    const t=i/rate;
    const phase=t%beat;
    const n=Math.floor(t/beat);
    const hat=t%(beat/2);
    const bass=scale[Math.floor(n/2)%scale.length];
    const kick=Math.sin(2*Math.PI*(53*phase+6*(1-Math.exp(-phase*28))))*Math.exp(-phase*18)*.32;
    noise=(Math.imul(1664525,noise)+1013904223)|0;
    const snare=(noise/2147483648)*Math.exp(-hat*75)*.09+(n%2 ? (noise/2147483648)*Math.exp(-phase*28)*.09 : 0);
    const synth=(Math.sin(2*Math.PI*bass*t)+Math.sin(4*Math.PI*bass*t)*.23)*Math.exp(-phase*3.7)*.12;
    const arp=Math.sin(2*Math.PI*bass*[4,6,8,5][Math.floor(t/(beat/2))%4]*hat)*Math.min(hat*180,1)*Math.exp(-hat*16)*.062;
    pcm[i]=(kick+snare+synth+arp)*Math.min(1,(duration-t)*2,t*30);
  }
  return buffer;
}

export async function encodeOgg(buffer) {
  const {createOggEncoder}=await import('wasm-media-encoders');
  const encoder=await createOggEncoder();
  const channels=Math.min(buffer.numberOfChannels,2);
  encoder.configure({sampleRate:buffer.sampleRate,channels,vbrQuality:.55});
  const parts=[];
  const arrays=Array.from({length:channels},(_,i)=>buffer.getChannelData(i));
  for (let start=0;start<buffer.length;start+=8192) {
    parts.push(encoder.encode(arrays.map(data=>data.subarray(start,start+8192))).slice());
    if (start%(8192*80)===0) await new Promise(resolve=>setTimeout(resolve,0));
  }
  parts.push(encoder.finalize().slice());
  return new Blob(parts,{type:'audio/ogg'});
}

export async function readAudioDetails(file) {
  const fallbackTitle=file.name.replace(/\.[^.]+$/,'').trim();
  try {
    const {parseBlob,selectCover}=await import('music-metadata');
    const {common}=await parseBlob(file);
    const formats={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
    const picture=selectCover(common.picture?.filter(item=>Object.hasOwn(formats,item.format)));
    const bpm=Number(common.bpm);
    return {
      name:common.title?.trim() || fallbackTitle,
      artist:common.artist?.trim() || '',
      bpm:bpm>=1 && bpm<=9999 ? bpm : null,
      cover:picture ? {name:`cover.${formats[picture.format]}`,blob:new Blob([picture.data],{type:picture.format})} : null,
    };
  } catch {
    return {name:fallbackTitle,artist:'',bpm:null,cover:null};
  }
}

export async function estimateBpm(buffer, high=false) {
  const hop=Math.max(1,Math.floor(buffer.sampleRate/200));
  const length=Math.floor(Math.min(buffer.length,buffer.sampleRate*150)/hop);
  if(length<600) return null;
  const channels=Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,i)=>buffer.getChannelData(i));
  const envelope=new Float32Array(length);
  const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
  let level=0;
  let maxLevel=0, maxOnset=0, mean=0;
  for (let frame=0;frame<length;frame++) {
    const start=frame*hop;
    let energy=0;
    for(const data of channels) for(let j=start;j<start+hop;j+=4) energy+=data[j]**2;
    energy=Math.sqrt(energy/(channels.length*Math.ceil(hop/4)));
    if(frame===0) level=energy;
    const onset=Math.max(0,energy-level);
    envelope[frame]=onset;
    mean+=onset;
    maxOnset=Math.max(maxOnset,onset);
    maxLevel=Math.max(maxLevel,energy);
    level+=.13*(energy-level);
    if(frame && frame%2500===0) await yieldFrame();
  }
  if(maxLevel<1e-5 || maxOnset<maxLevel*.08) return null;
  mean/=length;
  for(let i=0;i<length;i++) envelope[i]-=mean;
  const rate=buffer.sampleRate/hop;
  const correlation = lag => {
    let score=0, left=0, right=0;
    for(let i=lag;i<length;i++) {
      const a=envelope[i], b=envelope[i-lag];
      score+=a*b;
      left+=a*a;
      right+=b*b;
    }
    return left*right ? score/Math.sqrt(left*right) : 0;
  };
  const min=high ? 180 : 62;
  const max=high ? 500 : 295;
  const first=Math.floor(60*rate/max);
  const last=Math.ceil(60*rate/min);
  const values=new Float32Array(2*last+3);
  for(let lag=first-1;lag<values.length;lag++) {
    values[lag]=correlation(lag);
    if(lag%40===0) await yieldFrame();
  }
  const scoreAt=lag=>{
    const bpm=60*rate/lag;
    return (values[lag]+.45*values[2*lag])*(high?1:Math.exp(-(((bpm-135)/140)**2)));
  };
  let best=0, winner=0;
  for(let lag=first;lag<=last;lag++) {
    const score=scoreAt(lag);
    if (score>best) {best=score;winner=lag;}
  }
  if(!winner || values[winner]<.18 || length/winner<4) return null;
  const a=values[winner-1],b=values[winner],c=values[winner+1];
  const delta=a+c===2*b ? 0 : Math.max(-.5,Math.min(.5,(a-c)/(2*(a+c-2*b))));
  return Math.round(Math.min(max,Math.max(min,60*rate/(winner+delta)))*100)/100;
}
