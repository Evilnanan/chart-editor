import test from 'node:test';
import assert from 'node:assert/strict';
import { Transport, estimateBpm, makeDemoAudio } from '../src/audio.js';

const context={
  createBuffer(numberOfChannels,length,sampleRate) {
    const channels=Array.from({length:numberOfChannels},()=>new Float32Array(length));
    return {numberOfChannels,length,sampleRate,duration:length/sampleRate,getChannelData:i=>channels[i]};
  },
};

test('detects steady music tempos in the normal and fast ranges',async()=>{
  for(const bpm of [92,128,174,320]) {
    const track=makeDemoAudio(context,18,bpm);
    const detected=await estimateBpm(track,bpm>295);
    assert.ok(detected!==null && Math.abs(detected-bpm)<1, `expected ${bpm}, got ${detected}`);
  }
});

test('uses the right channel for peaks and tempo when the left channel is silent',async()=>{
  const melody=makeDemoAudio(context,12,112);
  const stereo=context.createBuffer(2,melody.length,melody.sampleRate);
  stereo.getChannelData(1).set(melody.getChannelData(0));
  const transport=new Transport(()=>{});
  transport.setBuffer(stereo,stereo.duration);
  assert.ok(transport.peaks.some(peak=>peak>.2));
  const detected=await estimateBpm(stereo);
  assert.ok(detected!==null && Math.abs(detected-112)<1);
});

test('rejects silence, steady tones, and insufficient audio for BPM',async()=>{
  const samples=context.createBuffer(1,22050*12,22050);
  assert.equal(await estimateBpm(samples),null);
  const tone=samples.getChannelData(0);
  for(let i=0;i<tone.length;i++) tone[i]=.5*Math.sin(2*Math.PI*i*440/samples.sampleRate);
  assert.equal(await estimateBpm(samples),null);
  assert.equal(await estimateBpm(makeDemoAudio(context,1,128)),null);
});
